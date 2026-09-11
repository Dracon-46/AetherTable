import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdminAction, Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { AuditoriaService } from './auditoria.service.js';
import type { RequisicaoAdmin } from './papeis.js';
import type {
  BuscarUsuariosDto,
  InventarioDto,
  MotivoDto,
  MudarPapelDto,
  MudarTierDto,
  RedefinirSenhaDto,
  ExcluirDefinitivoDto,
  SuspenderDto,
} from './admin.dto.js';
import { tierDoCosmetico, type FamiliaDeCosmetico } from '@aethertable/shared-types';

/**
 * admin-usuarios.service.ts — gestão de contas (DOC-061 §2).
 *
 * ─── AS TRÊS TRAVAS QUE ESTE SERVIÇO IMPÕE A SI MESMO ──────────────────────
 *
 * Um painel administrativo sem limites sobre o próprio administrador é o
 * caminho mais curto para uma plataforma sem administrador nenhum:
 *
 *  1. **NINGUÉM AGE SOBRE A PRÓPRIA CONTA.** Um clique errado em "banir" na
 *     própria linha da lista tranca a pessoa fora do painel que ela usaria para
 *     desfazer o clique. Não há caminho de volta pela aplicação.
 *  2. **MODERADOR NÃO TOCA EM ADMIN.** Sem isso, `MOD` seria um papel com poder
 *     de `ADMIN`: bastaria suspender todos os administradores.
 *  3. **NÃO SE APAGA O ÚLTIMO ADMIN.** Uma plataforma sem administrador só se
 *     recupera por acesso direto ao banco. A trava é sobre banir E sobre
 *     despromover — os dois produzem o mesmo resultado.
 */

/** Colunas que o painel mostra. `passwordHash` NUNCA sai daqui. */
const CAMPOS_DE_LISTA = {
  id: true,
  email: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  role: true,
  supporterTier: true,
  emailVerifiedAt: true,
  lastSeenAt: true,
  deletedAt: true,
  suspendedUntil: true,
  suspensionReason: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AdminUsuariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Busca por username, email ou id.
   *
   * `contains` sem `mode: 'insensitive'` faria a busca por "Arthur" não achar
   * "arthur" — num campo de investigação, isso é a diferença entre encontrar a
   * conta e concluir que ela não existe.
   */
  async buscar(dto: BuscarUsuariosDto) {
    const termo = dto.q?.trim();
    const where: Prisma.UserWhereInput = {};

    if (!dto.incluirApagados) where.deletedAt = null;
    if (dto.papel) where.role = dto.papel;
    if (dto.apenasSuspensos) where.suspendedUntil = { gt: new Date() };

    if (termo) {
      const filtros: Prisma.UserWhereInput[] = [
        { username: { contains: termo, mode: 'insensitive' } },
        { email: { contains: termo, mode: 'insensitive' } },
        { displayName: { contains: termo, mode: 'insensitive' } },
      ];
      // Um UUID inteiro colado no campo é o caso do moderador que veio de um
      // log; `contains` num campo UUID falharia no Postgres.
      if (/^[0-9a-f-]{36}$/i.test(termo)) filtros.push({ id: termo });
      where.OR = filtros;
    }

    const linhas = await this.prisma.user.findMany({
      where,
      select: { ...CAMPOS_DE_LISTA, _count: { select: { decks: true, reportsGot: true } } },
      orderBy: { createdAt: 'desc' },
      take: dto.limite + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
    });

    const temMais = linhas.length > dto.limite;
    const pagina = temMais ? linhas.slice(0, dto.limite) : linhas;
    return {
      itens: pagina,
      proximoCursor: temMais ? (pagina[pagina.length - 1]?.id ?? null) : null,
    };
  }

  /** Ficha completa: papel, punições, decks, denúncias e histórico de ações. */
  async detalhar(id: string) {
    const usuario = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...CAMPOS_DE_LISTA,
        updatedAt: true,
        accounts: { select: { provider: true, createdAt: true } },
        decks: {
          select: { id: true, name: true, formatId: true, cardCount: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
          take: 20,
        },
        cosmetics: {
          select: {
            id: true,
            acquiredAt: true,
            cosmetic: { select: { id: true, name: true, type: true } },
          },
        },
        _count: {
          select: { decks: true, participions: true, reportsGot: true, reportsMade: true },
        },
      },
    });
    if (!usuario) throw new NotFoundException('Usuário não encontrado.');

    const [denuncias, acoes] = await Promise.all([
      this.prisma.report.findMany({
        where: { reportedId: id },
        select: {
          id: true,
          reason: true,
          status: true,
          createdAt: true,
          details: true,
          roomCode: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      // O histórico de punições daquela conta — é o que responde "isto é
      // reincidência?", a pergunta que decide entre aviso e banimento.
      this.prisma.auditLog.findMany({
        where: { targetType: 'user', targetId: id },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);

    return { ...usuario, denuncias, historico: acoes };
  }

  // ─── Punições ──────────────────────────────────────────────────────────────

  async suspender(req: RequisicaoAdmin, id: string, dto: SuspenderDto) {
    const alvo = await this.exigirAlvo(req, id);
    const ate = new Date(Date.now() + dto.dias * 24 * 60 * 60 * 1000);

    await this.prisma.user.update({
      where: { id },
      data: { suspendedUntil: ate, suspensionReason: dto.motivo },
    });

    await this.auditoria.registrar(req, {
      action: AdminAction.USER_SUSPEND,
      targetType: 'user',
      targetId: id,
      targetLabel: alvo.username,
      reason: dto.motivo,
      metadata: { dias: dto.dias, ate: ate.toISOString() },
    });

    return { suspensoAte: ate };
  }

  async removerSuspensao(req: RequisicaoAdmin, id: string, dto: MotivoDto) {
    const alvo = await this.exigirAlvo(req, id);
    await this.prisma.user.update({
      where: { id },
      data: { suspendedUntil: null, suspensionReason: null },
    });
    await this.auditoria.registrar(req, {
      action: AdminAction.USER_UNSUSPEND,
      targetType: 'user',
      targetId: id,
      targetLabel: alvo.username,
      reason: dto.motivo,
    });
    return { sucesso: true };
  }

  /**
   * Banimento = soft delete. Aciona o fluxo de expurgo de 30 dias (§7.1).
   *
   * NÃO apaga a linha: `deletedAt` inativa a conta imediatamente e um job
   * posterior faz o expurgo físico. Apagar aqui destruiria em cascata os decks,
   * as denúncias FEITAS pela conta (que podem ser a prova contra outra pessoa) e
   * a própria trilha de auditoria da punição.
   */
  async banir(req: RequisicaoAdmin, id: string, dto: MotivoDto) {
    const alvo = await this.exigirAlvo(req, id);
    if (alvo.deletedAt) throw new BadRequestException('Esta conta já está banida.');
    await this.exigirOutroAdminRestante(alvo);

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), suspensionReason: dto.motivo },
    });

    await this.auditoria.registrar(req, {
      action: AdminAction.USER_BAN,
      targetType: 'user',
      targetId: id,
      targetLabel: alvo.username,
      reason: dto.motivo,
      metadata: { email: alvo.email },
    });

    return { sucesso: true };
  }

  async restaurar(req: RequisicaoAdmin, id: string, dto: MotivoDto) {
    const alvo = await this.exigirAlvo(req, id, { permitirApagado: true });
    if (!alvo.deletedAt) throw new BadRequestException('Esta conta não está banida.');

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: null, suspensionReason: null, suspendedUntil: null },
    });

    await this.auditoria.registrar(req, {
      action: AdminAction.USER_RESTORE,
      targetType: 'user',
      targetId: id,
      targetLabel: alvo.username,
      reason: dto.motivo,
    });

    return { sucesso: true };
  }

  // ─── Papel ─────────────────────────────────────────────────────────────────

  async mudarPapel(req: RequisicaoAdmin, id: string, dto: MudarPapelDto) {
    const alvo = await this.exigirAlvo(req, id, { permitirApagado: true });
    if (alvo.role === dto.papel) {
      throw new BadRequestException(`A conta já é ${dto.papel}.`);
    }
    if (alvo.role === Role.ADMIN && dto.papel !== Role.ADMIN) {
      await this.exigirOutroAdminRestante(alvo);
    }

    await this.prisma.user.update({ where: { id }, data: { role: dto.papel } });

    await this.auditoria.registrar(req, {
      action: AdminAction.USER_ROLE_CHANGE,
      targetType: 'user',
      targetId: id,
      targetLabel: alvo.username,
      reason: dto.motivo,
      metadata: { de: alvo.role, para: dto.papel },
    });

    return { papel: dto.papel };
  }

  // ─── Inventário ────────────────────────────────────────────────────────────

  /** Dá um cosmético a um jogador — o prêmio de campeonato de DOC-061 §2. */
  async concederCosmetico(req: RequisicaoAdmin, id: string, dto: InventarioDto) {
    const alvo = await this.exigirAlvo(req, id);
    const item = await this.prisma.cosmeticItem.findUnique({ where: { id: dto.cosmeticoId } });
    if (!item) throw new NotFoundException('Cosmético não encontrado.');

    // `upsert` e não `create`: conceder duas vezes é um clique repetido, não um
    // erro que merece 409 na cara do administrador.
    await this.prisma.userCosmetic.upsert({
      where: { userId_cosmeticId: { userId: id, cosmeticId: dto.cosmeticoId } },
      create: { userId: id, cosmeticId: dto.cosmeticoId },
      update: {},
    });

    await this.auditoria.registrar(req, {
      action: AdminAction.INVENTORY_GRANT,
      targetType: 'user',
      targetId: id,
      targetLabel: alvo.username,
      reason: dto.motivo,
      metadata: { cosmeticoId: item.id, cosmetico: item.name, tipo: item.type },
    });

    return { sucesso: true };
  }

  /**
   * ─── CONCEDE OU RETIRA O DIREITO A COSMÉTICO DE APOIADOR ──────────────────
   *
   * O catálogo marca itens como `APOIADOR` desde sempre, e a marca não valia
   * nada: o cadeado da interface era decorativo, o DTO validava só a existência
   * do id, e `updateUser` gravava o que chegasse.
   *
   * Enquanto não houver integração de pagamento — não há nenhuma no
   * repositório — o direito é concedido aqui, com motivo e auditoria como
   * qualquer outra ação do backoffice. No dia em que houver, ela escreve na
   * mesma coluna e nada mais muda.
   *
   * ─── REBAIXAR DESEQUIPA ────────────────────────────────────────────────────
   *
   * Tirar o tier sem limpar o que já está equipado deixaria a pessoa usando um
   * cosmético a que não tem mais direito por tempo indeterminado: o servidor só
   * checa no momento de EQUIPAR, e ela não precisa equipar de novo. O efeito
   * seria "revogar não revoga", que é exatamente o defeito que este trabalho
   * corrige.
   *
   * A limpeza é feita item a item contra o catálogo, e não por um `UPDATE` que
   * zera tudo: um jogador de tier `APOIADOR` rebaixado costuma ter cosméticos
   * gratuitos equipados também, e apagá-los seria punir além do combinado.
   */
  async mudarTier(req: RequisicaoAdmin, id: string, dto: MudarTierDto) {
    const alvo = await this.exigirAlvo(req, id, { permitirApagado: true });
    if (alvo.supporterTier === dto.tier) {
      throw new BadRequestException(`A conta já é ${dto.tier}.`);
    }

    await this.prisma.user.update({ where: { id }, data: { supporterTier: dto.tier } });

    let desequipados: string[] = [];
    if (dto.tier === 'FREE') {
      desequipados = await this.desequiparCosmeticosDeApoiador(id);
    }

    await this.auditoria.registrar(req, {
      action: AdminAction.USER_ROLE_CHANGE,
      targetType: 'user',
      targetId: id,
      targetLabel: alvo.username,
      reason: dto.motivo,
      metadata: { tierDe: alvo.supporterTier, tierPara: dto.tier, desequipados },
    });

    return { tier: dto.tier, desequipados };
  }

  /** Devolve ao padrão só o que é de apoiador. Retorna o que foi tirado. */
  private async desequiparCosmeticosDeApoiador(userId: string): Promise<string[]> {
    const pref = await this.prisma.userPreference.findUnique({
      where: { userId },
      select: { sleeveId: true, playmatId: true, borderId: true, titleId: true, petId: true },
    });
    if (!pref) return [];

    const limpar: Partial<Record<FamiliaDeCosmetico, null>> = {};
    const tirados: string[] = [];

    for (const familia of [
      'sleeveId',
      'playmatId',
      'borderId',
      'titleId',
      'petId',
    ] as FamiliaDeCosmetico[]) {
      const id = pref[familia];
      if (id && tierDoCosmetico(familia, id) === 'APOIADOR') {
        limpar[familia] = null;
        tirados.push(id);
      }
    }

    if (tirados.length > 0) {
      await this.prisma.userPreference.update({ where: { userId }, data: limpar });
    }
    return tirados;
  }

  async revogarCosmetico(req: RequisicaoAdmin, id: string, dto: InventarioDto) {
    const alvo = await this.exigirAlvo(req, id);
    const item = await this.prisma.cosmeticItem.findUnique({ where: { id: dto.cosmeticoId } });

    await this.prisma.userCosmetic.deleteMany({
      where: { userId: id, cosmeticId: dto.cosmeticoId },
    });

    /**
     * O item revogado pode ser o EQUIPADO. Sem limpar a preferência, o jogador
     * continuaria com um cosmético que não possui mais — e a mesa desenharia
     * um sleeve que o inventário diz que não é dele.
     *
     * ─── ATENÇÃO: ISTO LIMPA O INVENTÁRIO CONCEDIDO, NÃO O QUE A MESA DESENHA
     *
     * São duas trilhas de dados, e elas não se encontram. `CosmeticItem` /
     * `UserCosmetic` usam UUID; o que o jogo desenha vem do catálogo em código
     * (`shared-types/cosmetics.ts`) e tem id de texto — `aether-classic`. As
     * colunas `active*Id` limpas abaixo são as de UUID, e `sleeveId` /
     * `playmatId` / `borderId` / `titleId` / `petId` — as reais — não têm como
     * ser alcançadas a partir de um UUID, porque nada no `CosmeticItem` casa
     * com um id de catálogo.
     *
     * Por isso o que governa o direito de equipar é o TIER, e não o inventário:
     * ver `mudarTier` abaixo, que é a ação que de fato tira um cosmético de
     * apoiador da mesa de alguém.
     */
    await this.prisma.userPreference.updateMany({
      where: { userId: id, activePlaymatId: dto.cosmeticoId },
      data: { activePlaymatId: null },
    });
    await this.prisma.userPreference.updateMany({
      where: { userId: id, activeSleeveId: dto.cosmeticoId },
      data: { activeSleeveId: null },
    });
    await this.prisma.userPreference.updateMany({
      where: { userId: id, activeBorderId: dto.cosmeticoId },
      data: { activeBorderId: null },
    });
    await this.prisma.userPreference.updateMany({
      where: { userId: id, activeTitleId: dto.cosmeticoId },
      data: { activeTitleId: null },
    });

    await this.auditoria.registrar(req, {
      action: AdminAction.INVENTORY_REVOKE,
      targetType: 'user',
      targetId: id,
      targetLabel: alvo.username,
      reason: dto.motivo,
      metadata: { cosmeticoId: dto.cosmeticoId, cosmetico: item?.name ?? null },
    });

    return { sucesso: true };
  }

  // ─── Senha e expurgo ───────────────────────────────────────────────────────

  /**
   * ─── O ADMIN REDEFINE A SENHA SEM NUNCA SABER A ANTIGA ───────────────────
   *
   * Nem a nova, por muito tempo: a senha e GERADA aqui, devolvida uma unica
   * vez na resposta e nunca mais recuperavel — o banco guarda so a hash
   * Argon2id, como toda senha.
   *
   * Deixar o admin ESCOLHER seria pior de tres formas ao mesmo tempo: ele
   * escolheria algo fraco e ditavel por telefone; a senha passaria pelo corpo
   * da requisicao e por qualquer log de proxy no caminho; e ele ficaria
   * sabendo a senha de outra pessoa por tempo indeterminado — que e
   * exatamente o que um reset existe para evitar.
   *
   * ─── E DERRUBA TODAS AS SESSOES ──────────────────────────────────────────
   *
   * Sem `derrubarTodasAsSessoes`, redefinir a senha de uma conta invadida NAO
   * expulsa o invasor: ele segue dentro com o token que ja tinha, por ate 24
   * horas. O motivo numero um para um reset e justamente suspeitar que alguem
   * entrou, e e nesse caso que ele precisa funcionar.
   */
  async redefinirSenha(req: RequisicaoAdmin, id: string, dto: RedefinirSenhaDto) {
    const alvo = await this.exigirAlvo(req, id);

    /**
     * 18 bytes em base64url: ~24 caracteres de alfabeto seguro, sem os
     * ambiguos de base64 padrao (`+`, `/`, `=`) que quebram ao ser ditados ou
     * colados. `randomBytes` e CSPRNG — uma senha de `Math.random()` seria
     * previsivel a partir de outras geradas na mesma sessao do processo.
     */
    const senhaTemporaria = randomBytes(18).toString('base64url');
    const hash = await argon2.hash(senhaTemporaria, { type: argon2.argon2id });

    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: hash, tokensValidosApos: new Date() },
    });

    await this.auditoria.registrar(req, {
      action: AdminAction.USER_PASSWORD_RESET,
      targetType: 'user',
      targetId: id,
      targetLabel: alvo.username,
      reason: dto.motivo,
      // A SENHA NAO ENTRA AQUI. A auditoria responde quem fez, em quem e por
      // que; guardar a senha faria o log virar um deposito de credencial.
      metadata: { sessoesDerrubadas: true },
    });

    return { senhaTemporaria, username: alvo.username };
  }

  /**
   * ─── EXPURGO DEFINITIVO ──────────────────────────────────────────────────
   *
   * `banir` e soft delete e tem volta por `restaurar`. Isto NAO tem: apaga a
   * linha, e em cascata os decks, as preferencias e o inventario.
   *
   * O que SOBREVIVE, de proposito:
   *
   *   - `MatchParticipant.userId` vira NULL em vez de sumir (`onDelete:
   *     SetNull`), preservando a estatistica agregada da partida sem ligar a
   *     pessoa a ela. E o desenho do expurgo de 30 dias da LGPD (§7.1).
   *   - A trilha de AUDITORIA nao aponta para `users` por chave estrangeira,
   *     entao o registro de quem apagou quem continua de pe. Uma exclusao que
   *     apaga o proprio registro de si mesma nao e auditavel.
   *
   * A confirmacao por digitacao do username existe porque o custo do erro e
   * assimetrico: "suspender" se desfaz num clique, isto nao se desfaz de jeito
   * nenhum, e as duas moram na mesma tela.
   */
  async excluirDefinitivamente(req: RequisicaoAdmin, id: string, dto: ExcluirDefinitivoDto) {
    const alvo = await this.exigirAlvo(req, id, { permitirApagado: true });

    if (dto.confirmacao !== alvo.username) {
      throw new BadRequestException(
        `Para excluir definitivamente, digite o nome de usuário exato: ${alvo.username}.`,
      );
    }

    // A mesma trava do banimento, e pelo mesmo motivo: uma plataforma sem
    // administrador so se recupera por acesso direto ao banco.
    await this.exigirOutroAdminRestante(alvo);

    /**
     * A auditoria e registrada ANTES do delete.
     *
     * Depois seria tarde: se o `delete` falhar no meio (uma FK inesperada, uma
     * queda de conexao), o log ja existe e diz o que se tentou fazer. O
     * inverso — apagar e so entao registrar — deixa a possibilidade de a conta
     * sumir sem nenhum registro de quem a apagou.
     */
    await this.auditoria.registrar(req, {
      action: AdminAction.USER_PURGE,
      targetType: 'user',
      targetId: id,
      targetLabel: alvo.username,
      reason: dto.motivo,
      metadata: { email: alvo.email },
    });

    await this.prisma.user.delete({ where: { id } });

    return { sucesso: true, username: alvo.username };
  }

  // ─── Travas ────────────────────────────────────────────────────────────────

  /**
   * Carrega o alvo e aplica as travas 1 e 2 do cabeçalho.
   *
   * Toda ação punitiva passa por aqui — é o que garante que uma rota nova nasça
   * com as travas em vez de precisar lembrar de copiá-las.
   */
  private async exigirAlvo(
    req: RequisicaoAdmin,
    id: string,
    opcoes: { permitirApagado?: boolean } = {},
  ) {
    if (id === req.autor.id) {
      throw new ForbiddenException(
        'Você não pode aplicar esta ação na sua própria conta — não haveria caminho de volta pelo painel.',
      );
    }

    const alvo = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        deletedAt: true,
        supporterTier: true,
      },
    });
    if (!alvo) throw new NotFoundException('Usuário não encontrado.');
    if (alvo.deletedAt && !opcoes.permitirApagado) {
      throw new BadRequestException('Esta conta está banida; restaure antes de agir sobre ela.');
    }

    if (alvo.role === Role.ADMIN && req.autor.role !== Role.ADMIN) {
      throw new ForbiddenException('Moderadores não agem sobre contas administrativas.');
    }

    return alvo;
  }

  /** Trava 3: a plataforma nunca fica sem administrador. */
  private async exigirOutroAdminRestante(alvo: { id: string; role: Role }) {
    if (alvo.role !== Role.ADMIN) return;
    const outros = await this.prisma.user.count({
      where: { role: Role.ADMIN, deletedAt: null, id: { not: alvo.id } },
    });
    if (outros === 0) {
      throw new ForbiddenException(
        'Este é o último administrador ativo. Promova outra conta antes de remover esta — sem administrador, o painel só volta por acesso direto ao banco.',
      );
    }
  }
}
