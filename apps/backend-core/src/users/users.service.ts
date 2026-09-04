import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
      include: {
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
    },
  ) {
    const { username, displayName, language } = data;

    if (username) {
      const existing = await this.prisma.user.findFirst({ where: { username, id: { not: id } } });
      if (existing) throw new BadRequestException('Username já em uso');
    }

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
