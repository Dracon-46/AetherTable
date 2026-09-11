import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AdminAction, CosmeticType, Prisma, ReportStatus, Role } from '@prisma/client';
import {
  CHAT_TITLES,
  PETS,
  PLAYMATS,
  PROFILE_BORDERS,
  SLEEVES,
  normalizarCosmeticoAutoral,
  type CosmeticoAutoral,
} from '@aethertable/shared-types';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { CardsService } from '../cards/cards.service.js';
import { AuditoriaService } from './auditoria.service.js';
import { CatalogoDeCosmeticosService, FAMILIA_POR_TIPO } from '../cosmeticos/catalogo.service.js';
import type { RequisicaoAdmin } from './papeis.js';
import type { AtualizarCosmeticoDto, CriarCosmeticoDto, MudarFlagDto } from './admin.dto.js';

/**
 * admin-sistema.service.ts — cosméticos, interruptores e operações (DOC-061 §3 e §5).
 *
 * ─── OS INTERRUPTORES NÃO SÃO VARIÁVEIS DE AMBIENTE ────────────────────────
 *
 * DOC-061 §5 pede um "Kill Switch de Voz": um botão de emergência que desliga o
 * LiveKit para todo mundo se o faturamento do SFU disparar ou houver ataque.
 * Uma env var não serve — mudar env exige redeploy, e uma emergência de
 * faturamento não espera build. Vivem em `platform_flags`, com histórico de
 * quem mexeu, e a rota pública `GET /flags` deixa o cliente consultar.
 */

/** Chaves conhecidas. Fechado de propósito: uma flag sem código que a leia é
 *  um interruptor que não liga nada — e um painel cheio deles é pior que um
 *  painel vazio, porque o administrador acredita ter desligado algo. */
export const FLAGS = {
  /** Desliga o LiveKit para todo mundo. */
  VOZ: 'VOICE_ENABLED',
  /** Fecha a criação de novas mesas — para manutenção. */
  MESAS: 'MATCHMAKING_ENABLED',
  /** Fecha o cadastro de novas contas. */
  CADASTRO: 'REGISTRATION_ENABLED',
} as const;

const CHAVES_VALIDAS = new Set<string>(Object.values(FLAGS));

/** O catálogo em código, achatado para o painel. Ver `CriarCosmeticoDto`. */
function catalogoEmCodigo() {
  return [
    ...SLEEVES.map((i) => ({
      catalogoId: i.id,
      nome: i.nome,
      tier: i.tier,
      tipo: CosmeticType.SLEEVE,
    })),
    ...PLAYMATS.map((i) => ({
      catalogoId: i.id,
      nome: i.nome,
      tier: i.tier,
      tipo: CosmeticType.PLAYMAT,
    })),
    ...PROFILE_BORDERS.map((i) => ({
      catalogoId: i.id,
      nome: i.nome,
      tier: i.tier,
      tipo: CosmeticType.BORDER,
    })),
    ...CHAT_TITLES.map((i) => ({
      catalogoId: i.id,
      nome: i.nome,
      tier: i.tier,
      tipo: CosmeticType.TITLE,
    })),
    // Pets não têm `CosmeticType` no enum do banco. Aparecem no catálogo para o
    // administrador VER o que existe, e não são registráveis como concedíveis —
    // preferir isso a inventar um valor de enum que o banco não conhece.
    ...PETS.map((i) => ({
      catalogoId: i.id,
      nome: i.nome,
      tier: i.tier,
      tipo: CosmeticType.PET,
    })),
  ];
}

@Injectable()
export class AdminSistemaService {
  private readonly logger = new Logger(AdminSistemaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly cards: CardsService,
    private readonly catalogo: CatalogoDeCosmeticosService,
  ) {}

  // ─── Painel inicial ────────────────────────────────────────────────────────

  /**
   * Os números da primeira tela.
   *
   * Tudo em UMA rodada de `Promise.all`: em série, sete consultas contra o Neon
   * (que autossuspende e tem latência de rede) somariam facilmente dois
   * segundos para abrir a tela de entrada do painel.
   */
  async visaoGeral() {
    const agora = new Date();
    const seteDias = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
    const vinteQuatroHoras = new Date(agora.getTime() - 24 * 60 * 60 * 1000);

    const [
      usuarios,
      novosNaSemana,
      ativosEm24h,
      suspensos,
      banidos,
      admins,
      moderadores,
      decks,
      partidas,
      partidasNaSemana,
      denunciasAbertas,
      flags,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: null, createdAt: { gte: seteDias } } }),
      this.prisma.user.count({ where: { deletedAt: null, lastSeenAt: { gte: vinteQuatroHoras } } }),
      this.prisma.user.count({ where: { deletedAt: null, suspendedUntil: { gt: agora } } }),
      this.prisma.user.count({ where: { deletedAt: { not: null } } }),
      this.prisma.user.count({ where: { deletedAt: null, role: Role.ADMIN } }),
      this.prisma.user.count({ where: { deletedAt: null, role: Role.MOD } }),
      this.prisma.deck.count(),
      this.prisma.matchSummary.count(),
      this.prisma.matchSummary.count({ where: { endedAt: { gte: seteDias } } }),
      this.prisma.report.count({ where: { status: ReportStatus.OPEN } }),
      this.listarFlags(),
    ]);

    return {
      usuarios: {
        total: usuarios,
        novosNaSemana,
        ativosEm24h,
        suspensos,
        banidos,
        admins,
        moderadores,
      },
      conteudo: { decks },
      partidas: { total: partidas, naSemana: partidasNaSemana },
      moderacao: { denunciasAbertas },
      flags,
    };
  }

  // ─── Interruptores ─────────────────────────────────────────────────────────

  /**
   * Todas as flags conhecidas, com o valor efetivo.
   *
   * Chave ausente no banco significa LIGADO. O padrão é ligado de propósito: um
   * interruptor que nasce desligado transformaria a primeira execução da
   * migração em uma plataforma sem voz, sem mesas e sem cadastro, e o sintoma
   * seria "o deploy quebrou tudo".
   */
  async listarFlags() {
    const gravadas = await this.prisma.platformFlag.findMany();
    const porChave = new Map(gravadas.map((f) => [f.key, f]));
    return Object.values(FLAGS).map((key) => {
      const f = porChave.get(key);
      return {
        key,
        enabled: f?.enabled ?? true,
        note: f?.note ?? null,
        updatedAt: f?.updatedAt ?? null,
        updatedBy: f?.updatedBy ?? null,
      };
    });
  }

  /** `true`/`false` de uma flag. Consultado por outros módulos e pelo cliente. */
  async flagLigada(key: string): Promise<boolean> {
    const f = await this.prisma.platformFlag.findUnique({ where: { key } });
    return f?.enabled ?? true;
  }

  async mudarFlag(req: RequisicaoAdmin, key: string, dto: MudarFlagDto) {
    if (!CHAVES_VALIDAS.has(key)) {
      throw new BadRequestException(
        `Interruptor desconhecido. Válidos: ${[...CHAVES_VALIDAS].join(', ')}.`,
      );
    }

    await this.prisma.platformFlag.upsert({
      where: { key },
      create: {
        key,
        enabled: dto.ligado,
        note: dto.nota ?? null,
        updatedById: req.autor.id,
        updatedBy: req.autor.username,
      },
      update: {
        enabled: dto.ligado,
        note: dto.nota ?? null,
        updatedById: req.autor.id,
        updatedBy: req.autor.username,
      },
    });

    await this.auditoria.registrar(req, {
      action: AdminAction.FLAG_CHANGE,
      targetType: 'flag',
      targetId: key,
      targetLabel: key,
      reason: dto.nota ?? null,
      metadata: { ligado: dto.ligado },
    });

    this.logger.warn(
      `Interruptor ${key} => ${dto.ligado ? 'LIGADO' : 'DESLIGADO'} por ${req.autor.username}`,
    );

    return { key, enabled: dto.ligado };
  }

  // ─── Cosméticos ────────────────────────────────────────────────────────────

  /**
   * O catálogo de código ao lado dos itens REGISTRADOS como concedíveis.
   *
   * A tela mostra os dois porque a pergunta do administrador é "o que existe e
   * o que já dá para dar de prêmio?" — e a resposta só faz sentido com as duas
   * listas casadas pelo `catalogoId`.
   */
  async listarCosmeticos() {
    const [registrados, contagens] = await Promise.all([
      this.prisma.cosmeticItem.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
      this.prisma.userCosmetic.groupBy({ by: ['cosmeticId'], _count: { _all: true } }),
    ]);
    const donosPorItem = new Map(contagens.map((c) => [c.cosmeticId, c._count._all]));

    return {
      catalogo: catalogoEmCodigo(),
      registrados: registrados.map((r) => ({
        ...r,
        // `resourceUrl` guarda o `catalogoId`, não uma URL: o item é desenhado
        // pelo cliente a partir do catálogo em código (DOC-060 §1.1), então o
        // que a linha do banco precisa guardar é a CHAVE, não um endereço.
        catalogoId: r.resourceUrl,
        donos: donosPorItem.get(r.id) ?? 0,
      })),
    };
  }

  /**
   * Registra um item — do catálogo em código, ou composto aqui.
   *
   * ─── DOIS CAMINHOS, E A DIFERENÇA ENTRE ELES ─────────────────────────────
   *
   * SEM `parametros`, o `catalogoId` tem que existir no bundle: é o caminho
   * antigo, que só torna CONCEDÍVEL um item que o cliente já sabe desenhar.
   *
   * COM `parametros`, o item nasce aqui. Continua valendo DOC-060 §1.1 — não
   * há upload, não entra arquivo, não entra arte de terceiros — porque o que
   * `normalizarCosmeticoAutoral` aceita é só combinação de primitivas que já
   * estão no cliente: as tramas, as silhuetas e cores hexadecimais. Um
   * `padrao` fora do vocabulário não passa, e é por isso que o caminho novo
   * não abre a porta que o documento fecha.
   *
   * O id novo não pode colidir com o do bundle. Se colidisse, o backoffice
   * redefiniria `aether-classic` — o sleeve do verso de TODA carta oculta — e
   * a mesa inteira mudaria de aparência a partir de uma linha no banco.
   */
  async criarCosmetico(req: RequisicaoAdmin, dto: CriarCosmeticoDto) {
    const noCatalogo = catalogoEmCodigo().find(
      (i) => i.catalogoId === dto.catalogoId && i.tipo === dto.tipo,
    );

    let autoral: CosmeticoAutoral | null = null;
    if (dto.parametros === undefined) {
      if (!noCatalogo) {
        throw new BadRequestException(
          `"${dto.catalogoId}" não existe no catálogo de ${dto.tipo}. Para criar um item novo, envie também os parâmetros (cores e padrão) — o catálogo é fechado a arquivos, não a combinações novas (DOC-060 §1.1).`,
        );
      }
    } else {
      if (noCatalogo) {
        throw new BadRequestException(
          `"${dto.catalogoId}" já existe no catálogo em código. Um item autoral não pode redefinir um item do bundle — escolha outro identificador.`,
        );
      }
      autoral = normalizarCosmeticoAutoral({
        ...(dto.parametros as Record<string, unknown>),
        familia: FAMILIA_POR_TIPO[dto.tipo],
        id: dto.catalogoId,
        nome: dto.nome,
        // O tier de EQUIPAR sai do `minTier` — é uma coisa só, e duas fontes
        // dariam um item comprável que a mesa recusa desenhar.
        tier: dto.minTier > 0 ? 'APOIADOR' : 'FREE',
      });
      if (!autoral) {
        throw new BadRequestException(
          'Os parâmetros do cosmético não formam um item válido. Cores precisam ser #rrggbb e o padrão precisa ser um dos que o cliente sabe desenhar.',
        );
      }
    }

    const jaExiste = await this.prisma.cosmeticItem.findFirst({
      where: { type: dto.tipo, resourceUrl: dto.catalogoId },
    });
    if (jaExiste) throw new BadRequestException('Este item já está registrado.');

    const item = await this.prisma.cosmeticItem.create({
      data: {
        type: dto.tipo,
        name: dto.nome,
        resourceUrl: dto.catalogoId,
        minTier: dto.minTier,
        isActive: dto.ativo,
        // Grava o item NORMALIZADO, não o que chegou: o que o banco guarda é
        // exatamente o que o cliente vai desenhar, sem campo extra pendurado.
        ...(autoral ? { parametros: autoral.item as unknown as Prisma.InputJsonValue } : {}),
      },
    });

    await this.auditoria.registrar(req, {
      action: AdminAction.COSMETIC_CREATE,
      targetType: 'cosmetic',
      targetId: item.id,
      targetLabel: item.name,
      metadata: {
        catalogoId: dto.catalogoId,
        tipo: dto.tipo,
        minTier: dto.minTier,
        autoral: Boolean(autoral),
      },
    });

    this.catalogo.invalidar();
    return item;
  }

  async atualizarCosmetico(req: RequisicaoAdmin, id: string, dto: AtualizarCosmeticoDto) {
    const antes = await this.prisma.cosmeticItem.findUnique({ where: { id } });
    if (!antes) throw new BadRequestException('Cosmético não encontrado.');

    const item = await this.prisma.cosmeticItem.update({
      where: { id },
      data: {
        ...(dto.nome !== undefined ? { name: dto.nome } : {}),
        ...(dto.minTier !== undefined ? { minTier: dto.minTier } : {}),
        ...(dto.ativo !== undefined ? { isActive: dto.ativo } : {}),
      },
    });

    await this.auditoria.registrar(req, {
      action: AdminAction.COSMETIC_UPDATE,
      targetType: 'cosmetic',
      targetId: id,
      targetLabel: item.name,
      metadata: {
        de: { nome: antes.name, minTier: antes.minTier, ativo: antes.isActive },
        para: { nome: item.name, minTier: item.minTier, ativo: item.isActive },
      },
    });

    // Desativar um item AUTORAL precisa tirá-lo do catálogo na hora: ele some
    // do seletor, e quem estava com ele equipado volta ao padrão.
    this.catalogo.invalidar();
    return item;
  }

  /**
   * Desregistra um item.
   *
   * NÃO apaga quando alguém já o possui: `onDelete: Cascade` em `UserCosmetic`
   * significaria que remover um item do painel confisca o prêmio de campeonato
   * de todo mundo que o ganhou, sem aviso e sem volta. Nesse caso o caminho é
   * DESATIVAR (`isActive: false`), que tira do seletor e preserva o inventário.
   */
  async removerCosmetico(req: RequisicaoAdmin, id: string) {
    const item = await this.prisma.cosmeticItem.findUnique({
      where: { id },
      include: { _count: { select: { ownedBy: true } } },
    });
    if (!item) throw new BadRequestException('Cosmético não encontrado.');

    if (item._count.ownedBy > 0) {
      throw new BadRequestException(
        `${item._count.ownedBy} jogador(es) possuem este item. Desative-o em vez de removê-lo — remover confiscaria o inventário de todos eles.`,
      );
    }

    await this.prisma.cosmeticItem.delete({ where: { id } });
    await this.auditoria.registrar(req, {
      action: AdminAction.COSMETIC_DELETE,
      targetType: 'cosmetic',
      targetId: id,
      targetLabel: item.name,
    });
    this.catalogo.invalidar();
    return { sucesso: true };
  }

  // ─── Operações ─────────────────────────────────────────────────────────────

  /**
   * Esvazia o cache de cartas da Scryfall (DOC-061 §5, "Forçar Cache").
   *
   * O documento descreve um worker de bulk download. Ele não existe, e o que
   * existe é o cache LRU de `CardsService`, alimentado sob demanda. O que faz
   * sentido oferecer aqui é o ESVAZIAMENTO: depois dos spoilers de uma coleção,
   * as cartas novas chegam na primeira consulta, e o que atrapalha é uma
   * entrada velha ainda válida por TTL. Oferecer um botão de "forçar download"
   * que não baixa nada seria um interruptor que não liga nada.
   */
  async limparCacheDeCartas(req: RequisicaoAdmin) {
    const removidas = this.cards.esvaziarCache();
    const doBanco = await this.prisma.cardCache.deleteMany({});

    await this.auditoria.registrar(req, {
      action: AdminAction.CARD_CACHE_PURGE,
      targetType: 'system',
      targetId: 'card-cache',
      targetLabel: 'Cache de cartas',
      metadata: { emMemoria: removidas, noBanco: doBanco.count },
    });

    return { emMemoria: removidas, noBanco: doBanco.count };
  }
}
