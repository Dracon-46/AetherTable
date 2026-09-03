import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { UsersService } from '../users/users.service.js';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { AdminSistemaService, FLAGS } from '../admin/admin-sistema.service.js';
import { ttlEmSegundos } from './ttl.js';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
    private sistema: AdminSistemaService,
  ) {}

  /**
   * O MESMO TTL com que o token é assinado — ver auth.module.ts.
   *
   * Antes era `900` escrito à mão aqui, enquanto o módulo assinava com `'7d'`:
   * a API dizia ao cliente que a sessão durava 15 minutos e entregava um token
   * de uma semana. Ler da mesma fonte é o que impede os dois de divergirem
   * outra vez.
   */
  private readonly ttlSegundos = ttlEmSegundos(process.env['JWT_ACCESS_TTL']);

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
      /**
       * OAuth também passa pela suspensão.
       *
       * Sem esta linha, "Entrar com Google" seria a porta lateral que ignora a
       * punição — e ela é o caminho mais usado, não uma exceção.
       */
      this.exigirContaLiberada(account.user);
      if (account.user.deletedAt) {
        throw new ForbiddenException('Esta conta foi encerrada.');
      }
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

    /**
     * ─── A SUSPENSÃO PRECISA VALER NO LOGIN ──────────────────────────────────
     *
     * DOC-061 §2 define a suspensão como algo que "impede login e invalida
     * JWT". O campo passou a existir com o backoffice, e sem esta checagem ele
     * seria uma anotação decorativa: o `PapeisGuard` barra o suspenso do
     * PAINEL, e o resto do sistema o deixaria entrar e jogar normalmente — quer
     * dizer, suspender alguém por conduta na mesa não o tiraria da mesa.
     *
     * A checagem vem DEPOIS da senha de propósito. Antes dela, a mensagem de
     * suspensão viraria um oráculo: qualquer pessoa descobriria quais contas
     * estão punidas digitando e-mails com senha errada.
     */
    this.exigirContaLiberada(user);

    // Descarte intencional: a hash da senha nunca sai do serviço.
    const { passwordHash: _hash, ...result } = user;

    // Gerar JWT Tokens
    const payload = { username: user.username, sub: user.id };
    const accessToken = this.jwtService.sign(payload);

    return {
      user: result,
      accessToken,
      expiresIn: this.ttlSegundos,
    };
  }

  /**
   * Recusa o acesso de uma conta suspensa, dizendo até quando e por quê.
   *
   * A data e o motivo são MOSTRADOS: uma recusa sem prazo é indistinguível de
   * um banimento, e a pessoa suspensa por sete dias abriria um ticket de
   * suporte todo dia até o prazo vencer.
   */
  private exigirContaLiberada(user: {
    suspendedUntil?: Date | null;
    suspensionReason?: string | null;
  }): void {
    const ate = user.suspendedUntil;
    if (!ate || ate.getTime() <= Date.now()) return;

    const quando = ate.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const porque = user.suspensionReason ? ` Motivo: ${user.suspensionReason}` : '';
    throw new ForbiddenException(`Sua conta está suspensa até ${quando}.${porque}`);
  }

  /**
   * Registra um novo usuário no banco de dados
   */
  async register(email: string, username: string, pass: string) {
    /**
     * O INTERRUPTOR DE CADASTRO (DOC-061 §5).
     *
     * Sem esta linha, `REGISTRATION_ENABLED` seria um botão no painel que não
     * liga nada — e o administrador acreditaria ter fechado o cadastro durante
     * um ataque de contas automatizadas.
     *
     * A consulta é uma leitura por registro, não por requisição de jogo, e
     * cadastro é a operação mais rara da API.
     */
    if (!(await this.sistema.flagLigada(FLAGS.CADASTRO))) {
      throw new ForbiddenException(
        'O cadastro de novas contas está temporariamente fechado. Tente mais tarde.',
      );
    }

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
      expiresIn: this.ttlSegundos,
    };
  }
}
