import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { UsersService } from '../users/users.service.js';
import { PrismaService } from '../common/prisma/prisma.service.js';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  /**
   * Valida e/ou cria o usuário via OAuth
   */
  async validateOAuthUser(
    provider: 'GOOGLE' | 'DISCORD',
    providerAccountId: string,
    email: string,
    username: string,
    displayName: string,
  ) {
    // Busca a conta vinculada
    const account = await this.prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider,
          providerAccountId,
        },
      },
      include: { user: true },
    });

    if (account) {
      return account.user;
    }

    // Se a conta não existe, verifica se o email já está em uso por outra conta
    let user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Cria o usuário
      user = await this.prisma.user.create({
        data: {
          email,
          username: `${username}_${Math.floor(Math.random() * 1000)}`, // Evita colisão
          displayName,
          // Não possui senha, pois o login é OAuth
        },
      });
    }

    // Vincula a conta OAuth ao usuário
    await this.prisma.account.create({
      data: {
        userId: user.id,
        provider,
        providerAccountId,
      },
    });

    return user;
  }

  /**
   * Criptografa a senha com Argon2id, o algoritmo mais avançado e recomendado
   * pela OWASP contra ataques de força bruta e GPU.
   */
  private async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  /**
   * Valida o login e retorna os tokens se a senha for válida.
   * Emite erro 401 genérico em caso de falha (evita enumeração de usuários).
   */
  async login(email: string, pass: string) {
    const user = await this.usersService.findForAuthByEmail(email);

    // Se não encontrou o usuário ou ele não tem senha (login via OAuth apenas)
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    // Compara a senha informada com o Hash seguro
    const isPasswordValid = await argon2.verify(user.passwordHash, pass);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    // Descarte intencional: a hash da senha nunca sai do serviço.
    const { passwordHash: _hash, ...result } = user;

    // Gerar JWT Tokens
    const payload = { username: user.username, sub: user.id };
    const accessToken = this.jwtService.sign(payload);

    return {
      user: result,
      accessToken,
      expiresIn: 900, // 15 minutos (900 segundos)
    };
  }

  /**
   * Registra um novo usuário no banco de dados
   */
  async register(email: string, username: string, pass: string) {
    // Verifica unicidade
    const existingEmail = await this.prisma.user.findUnique({ where: { email } });
    if (existingEmail) throw new ConflictException({ error: 'EMAIL_IN_USE' });

    const existingUsername = await this.prisma.user.findUnique({ where: { username } });
    if (existingUsername) throw new ConflictException({ error: 'USERNAME_TAKEN' });

    const hashedPassword = await this.hashPassword(pass);

    const user = await this.prisma.user.create({
      data: {
        email,
        username,
        passwordHash: hashedPassword,
      },
    });

    // Descarte intencional: a hash da senha nunca sai do serviço.
    const { passwordHash: _hash, ...result } = user;

    // Gera token para auto-login
    const payload = { username: user.username, sub: user.id };
    const accessToken = this.jwtService.sign(payload);

    return {
      user: result,
      accessToken,
      expiresIn: 900,
    };
  }
}
