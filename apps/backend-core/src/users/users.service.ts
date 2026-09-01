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
    data: { username?: string; displayName?: string; language?: string },
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

    if (language) {
      await this.prisma.userPreference.upsert({
        where: { userId: id },
        update: { language },
        create: { userId: id, language },
      });
    }

    return updatedUser;
  }
}
