import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { podeEquipar, type CosmeticTier, type FamiliaDeCosmetico } from '@aethertable/shared-types';
import { PrismaService } from '../common/prisma/prisma.service.js';

/**
 * Serviço de Usuários. Isola a regra de negócio e
 * o acesso à tabela `users` no banco de dados.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Busca usuário pelo ID.
   * Não retorna usuários que já sofreram "soft delete" (LGPD).
   */
  async findById(id: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        deletedAt: null, // Regra fundamental de Soft Delete (DOC-023)
      },
      /**
       * ─── `select` EXPLÍCITO, E NÃO `include` ────────────────────────────
       *
       * Isto era um `include`, e `include` traz TODOS os campos escalares do
       * modelo além das relações pedidas. Quer dizer: `GET /users/me` estava
       * devolvendo o `passwordHash` — a hash Argon2id da senha — para o
       * navegador, junto de `suspensionReason` e `deletedAt`.
       *
       * É a hash da própria pessoa, então não é vazamento entre contas; mas
       * ela ia parar no `localStorage`, no cache do navegador e em qualquer
       * log de proxy que registre corpo de resposta. Uma hash de senha não
       * tem motivo nenhum para sair do banco.
       *
       * Com `select`, um campo novo no modelo é invisível até alguém decidir
       * expô-lo aqui — que é onde a decisão de expor pertence.
       */
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        role: true,
        /** O direito a cosmético de apoiador. O cliente usa para desabilitar
         *  o que a conta não pode equipar, e o servidor recusa de qualquer
         *  forma em `exigirDireitoAosCosmeticos`. */
        supporterTier: true,
        emailVerifiedAt: true,
        lastSeenAt: true,
        createdAt: true,
        _count: {
          select: { participions: true },
        },
        /**
         * As preferências vêm no `GET /users/me` porque é o cliente que
         * DESENHA os cosméticos. Sem elas na resposta, o navegador não teria de
         * onde hidratar o equipamento salvo, e a única fonte continuaria sendo
         * o `localStorage` — que é exatamente o que fazia trocar de máquina
         * perder tudo.
         */
        preference: {
          select: {
            theme: true,
            language: true,
            sleeveId: true,
            playmatId: true,
            borderId: true,
            titleId: true,
            petId: true,
            cosmeticosDeOponentes: true,
            /**
             * Os atalhos vêm no `GET /users/me` pelo mesmo motivo dos
             * cosméticos: é o CLIENTE que escuta o teclado. Sem eles na
             * resposta, o navegador não teria de onde hidratar o remapeamento e
             * a única fonte continuaria sendo o `localStorage` — que é o que
             * faz trocar de máquina perder tudo.
             */
            keybindings: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    return user;
  }

  /**
   * Busca usuário pelo nome de usuário. Utilizado no perfil público.
   */
  async findByUsername(username: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        username,
        deletedAt: null,
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        role: true,
        createdAt: true,
        // E-mail é explicitamente omitido do perfil público conforme DOC-030
        _count: {
          select: { participions: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    return user;
  }

  /**
   * Busca um usuário incluindo a hash de senha (Usado apenas internamente no AuthModule)
   */
  async findForAuthByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: {
        email,
        deletedAt: null,
      },
    });
  }

  /**
   * Deleta a conta de forma lógica (Soft Delete) agendando expurgo para 30 dias.
   */
  async softDelete(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  /**
   * ─── O CADEADO PASSA A TRANCAR ───────────────────────────────────────────
   *
   * `AtualizarPerfilDto` validava só que o id EXISTE no catálogo
   * (`ehSleeveValido` e companhia), nunca o tier. O cadeado do
   * `CosmeticPicker` era decorativo — o `<button>` não recebia `disabled` — e
   * `updateUser` gravava o que chegasse. Qualquer conta equipava qualquer item
   * de apoiador, e bastava um PATCH para contornar até a interface.
   *
   * A checagem NÃO cabe no DTO, e isso não é preguiça: um DTO valida o corpo
   * isoladamente e não conhece o usuário. "Este id é válido" é pergunta de
   * schema; "esta conta tem direito a este id" é pergunta de estado, e estado
   * mora no service.
   *
   * Uma consulta só, e apenas quando o corpo traz cosmético: um PATCH de
   * username não paga por isto.
   */
  private async exigirDireitoAosCosmeticos(
    userId: string,
    data: Partial<Record<FamiliaDeCosmetico, string | null>>,
  ): Promise<void> {
    const familias: FamiliaDeCosmetico[] = [
      'sleeveId',
      'playmatId',
      'borderId',
      'titleId',
      'petId',
    ];
    // `null` é "voltar ao padrão", e o padrão é sempre gratuito.
    const pedidos = familias
      .map((familia) => ({ familia, id: data[familia] }))
      .filter((p): p is { familia: FamiliaDeCosmetico; id: string } => Boolean(p.id));

    if (pedidos.length === 0) return;

    const usuario = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { supporterTier: true },
    });
    const tier = (usuario?.supporterTier ?? 'FREE') as CosmeticTier;

    const negados = pedidos.filter((p) => !podeEquipar(tier, p.familia, p.id));
    if (negados.length > 0) {
      throw new ForbiddenException(
        `Estes cosméticos são exclusivos de apoiadores: ${negados.map((n) => n.id).join(', ')}.`,
      );
    }
  }

  /**
   * Atualiza os dados do usuário (perfil e preferências)
   */
  async updateUser(
    id: string,
    data: {
      username?: string;
      displayName?: string;
      language?: string;
      /** Cosméticos equipados. `null` num campo = volta ao padrão. */
      sleeveId?: string | null;
      playmatId?: string | null;
      borderId?: string | null;
      titleId?: string | null;
      petId?: string | null;
      cosmeticosDeOponentes?: boolean;
      /** Mapa completo ação → tecla. Validado em `AtualizarPerfilDto`. */
      keybindings?: Record<string, string>;
    },
  ) {
    const { username, displayName, language } = data;

    if (username) {
      const existing = await this.prisma.user.findFirst({ where: { username, id: { not: id } } });
      if (existing) throw new BadRequestException('Username já em uso');
    }

    await this.exigirDireitoAosCosmeticos(id, data);

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: {
        ...(username && { username }),
        ...(displayName !== undefined && { displayName }), // Allows clearing displayName
      },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
    });

    /**
     * ─── PREFERÊNCIAS NUM UPSERT SÓ ──────────────────────────────────────────
     *
     * `language` já vinha por aqui; os cosméticos entraram no mesmo caminho
     * porque vivem na mesma linha de `user_preferences` — e porque a linha pode
     * NÃO EXISTIR: `UserPreference` é criada sob demanda, então um `update`
     * puro falharia na primeira vez que alguém equipasse um protetor.
     *
     * Só os campos presentes no corpo são tocados. Montar o objeto com
     * `undefined` nos ausentes é o que impede um PATCH de tema de apagar o
     * sleeve equipado — o Prisma ignora `undefined` e grava `null`, que aqui
     * significa "voltar ao padrão".
     */
    const prefs = {
      ...(language ? { language } : {}),
      ...(data.sleeveId !== undefined ? { sleeveId: data.sleeveId } : {}),
      ...(data.playmatId !== undefined ? { playmatId: data.playmatId } : {}),
      ...(data.borderId !== undefined ? { borderId: data.borderId } : {}),
      ...(data.titleId !== undefined ? { titleId: data.titleId } : {}),
      ...(data.petId !== undefined ? { petId: data.petId } : {}),
      ...(data.cosmeticosDeOponentes !== undefined
        ? { cosmeticosDeOponentes: data.cosmeticosDeOponentes }
        : {}),
      /**
       * Substitui o mapa inteiro, e é o contrato.
       *
       * O cliente sempre manda as treze entradas (ver `atalhos.store.ts`), então
       * um merge parcial aqui só criaria a dúvida de como apagar um atalho: uma
       * chave ausente significaria "não mexa" e a ação nunca poderia voltar a
       * ficar sem tecla.
       */
      // O `as` segue o mesmo caminho de `snapshot` em `admin-denuncias.service`:
      // um campo Json do Prisma tipa a entrada como `InputJsonValue`, e um
      // `Record<string, string>` não é aceito sem a asserção.
      ...(data.keybindings !== undefined
        ? { keybindings: data.keybindings as Prisma.InputJsonValue }
        : {}),
    };

    if (Object.keys(prefs).length > 0) {
      await this.prisma.userPreference.upsert({
        where: { userId: id },
        update: prefs,
        create: { userId: id, ...prefs },
      });
    }

    return updatedUser;
  }
}
