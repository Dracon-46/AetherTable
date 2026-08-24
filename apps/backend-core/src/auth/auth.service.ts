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

    // Não retornamos a hash da senha
    const { passwordHash, ...result } = user;
    
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

    const { passwordHash, ...result } = user;
    
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
