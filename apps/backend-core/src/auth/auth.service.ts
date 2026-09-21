import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { UsersService } from '../users/users.service.js';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { AdminSistemaService, FLAGS } from '../admin/admin-sistema.service.js';
import { ttlEmSegundos } from './ttl.js';
import { ErroDeOAuth } from './erro-de-oauth.js';

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
    /**
     * O provedor CONFIRMA que o dono do endereço é quem está entrando?
     *
     * Parâmetro obrigatório, e não opcional com padrão `true`: um padrão
     * permissivo faria uma estratégia futura que esquecesse de informá-lo
     * herdar silenciosamente o comportamento inseguro. Ver
     * `emailVerificadoPeloProvedor` em `oauth.types.ts`.
     */
    emailVerificado: boolean,
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

    /**
     * ─── DAQUI PARA BAIXO, O E-MAIL É A ÚNICA PROVA DE IDENTIDADE ──────────
     *
     * Não há vínculo prévio: a decisão de entrar numa conta existente ou criar
     * uma nova sai do endereço que o provedor informou. Se ele não garantir que
     * o endereço é mesmo de quem está entrando, esta função vira um caminho de
     * tomada de conta — basta declarar o e-mail da vítima num provedor que não
     * confirme. O Discord permite exatamente isso.
     */
    if (!emailVerificado) {
      throw new ErroDeOAuth(
        'email_nao_verificado',
        `${provider} não confirmou a posse do e-mail; vínculo recusado.`,
      );
    }

    // Se a conta não existe, verifica se o email já está em uso por outra conta
    const existente = await this.prisma.user.findUnique({ where: { email } });

    if (existente?.deletedAt) {
      throw new ForbiddenException('Esta conta foi encerrada.');
    }

    const user =
      existente ??
      (await this.prisma.user.create({
        data: {
          email,
          username: await this.usernameLivre(username),
          displayName,
          /**
           * `emailVerifiedAt` existia no schema e NUNCA era escrito por nada
           * (DOC-094 §I.8, "não há verificação de e-mail"). Aqui ele tem uma
           * fonte legítima: o provedor acabou de confirmar a posse do
           * endereço, que é mais do que o cadastro por senha jamais fez.
           */
          emailVerifiedAt: new Date(),
        },
      }));

    // Conta que já existia e era só de senha: passa a ter também esta entrada.
    if (existente) {
      this.exigirContaLiberada(existente);
      if (!existente.emailVerifiedAt) {
        await this.prisma.user.update({
          where: { id: existente.id },
          data: { emailVerifiedAt: new Date() },
        });
      }
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
   * Um `username` que ainda não existe.
   *
   * ─── O SUFIXO ALEATÓRIO NÃO RESOLVIA A COLISÃO, SÓ A ADIAVA ───────────────
   *
   * Era `${username}_${Math.floor(Math.random() * 1000)}` com o comentário
   * "Evita colisão" ao lado. Mil valores possíveis: dois `joao` entrando pelo
   * Google têm ~0,1% de chance de colidir no primeiro par e a certeza de
   * colidir depois de algumas centenas. E o resultado da colisão é uma violação
   * de chave única que sobe como **erro 500 no meio do callback do Google** —
   * para o usuário, "entrar com Google não funciona", sem mais nada.
   *
   * Pior, o sufixo era aplicado SEMPRE: quem entrava primeiro com um nome livre
   * virava `joao_417` sem motivo nenhum.
   *
   * Agora o nome desejado é tentado como está, e o sufixo só entra quando
   * precisa. O laço é limitado porque uma consulta por tentativa sem teto é um
   * jeito de transformar um nome disputado em varredura de tabela; ao fim dele,
   * o sufixo longo de CSPRNG não colide na prática.
   */
  private async usernameLivre(desejado: string): Promise<string> {
    const livre = async (nome: string) =>
      (await this.prisma.user.findUnique({ where: { username: nome }, select: { id: true } })) ===
      null;

    if (await livre(desejado)) return desejado;

    // 24 é o teto do `username` no cadastro (auth.dto.ts) e no schema (32, mas
    // o formato público é o do DTO). O corte precisa deixar espaço para o sufixo.
    const base = desejado.slice(0, 18);

    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const candidato = `${base}_${randomBytes(2).toString('hex')}`;
      if (await livre(candidato)) return candidato;
    }

    return `${base}_${randomBytes(3).toString('hex')}`;
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
    // `jwtid` e o que torna o token REVOGAVEL: sem ele, o logout nao tem o que
    // gravar na denylist e a sessao vive ate o TTL expirar. Ver
    // `revogacao.service.ts`.
    const accessToken = this.jwtService.sign(payload, { jwtid: randomBytes(16).toString('hex') });

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
  /**
   * Troca a própria senha.
   *
   * ─── O QUE ACONTECE COM AS OUTRAS SESSÕES ────────────────────────────────
   *
   * Todas caem. `tokensValidosApos` é o corte lido em `jwt.strategy.ts`: todo
   * token emitido ANTES deste instante passa a ser recusado.
   *
   * Isso é o ponto, não um efeito colateral. A razão mais comum para alguém
   * trocar a senha é suspeitar que outra pessoa entrou na conta — e uma troca
   * que deixasse a sessão do invasor viva resolveria nada. É o mesmo corte que
   * a redefinição pelo administrador aplica, pelo mesmo motivo.
   *
   * ─── MENOS A SESSÃO DE QUEM TROCOU ───────────────────────────────────────
   *
   * Um token NOVO é emitido e devolvido. Sem ele, a pessoa seria deslogada pelo
   * próprio ato de trocar a senha, e — no meio de uma partida de três horas —
   * cairia da mesa por ter ido nos ajustes. O token novo nasce depois do corte,
   * então passa; os antigos, inclusive o que fez esta chamada, não.
   */
  async trocarSenha(userId: string, senhaAtual: string, novaSenha: string) {
    const user = await this.usersService.findForAuthById(userId);

    /**
     * Conta de OAuth não tem senha para conferir.
     *
     * Deixar passar criaria uma senha do nada para quem entra pelo Google — e
     * qualquer um com o token faria isso. A saída certa é "defina uma senha",
     * que é outro fluxo e ainda não existe; até lá, a recusa é explícita em vez
     * de um erro genérico de credencial.
     */
    if (!user?.passwordHash) {
      throw new BadRequestException(
        'Esta conta entra por Google ou Discord e não tem senha para trocar.',
      );
    }

    const confere = await argon2.verify(user.passwordHash, senhaAtual);
    if (!confere) throw new UnauthorizedException('A senha atual não confere.');

    const hash = await this.hashPassword(novaSenha);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hash, tokensValidosApos: new Date() },
    });

    /**
     * O token novo é assinado DEPOIS do update.
     *
     * O corte usa o `iat` do token, que tem resolução de SEGUNDOS. Assinar
     * antes de gravar poderia produzir um token com `iat` igual ao segundo do
     * corte — e a comparação o derrubaria junto com os outros, deslogando
     * exatamente quem acabou de trocar a senha. `jwt.strategy.ts` já dá uma
     * folga de um segundo por esta razão; a ordem aqui é a outra metade.
     */
    const accessToken = this.jwtService.sign(
      { username: user.username, sub: user.id },
      { jwtid: randomBytes(16).toString('hex') },
    );

    return { accessToken, expiresIn: this.ttlSegundos };
  }

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
    // `jwtid` e o que torna o token REVOGAVEL: sem ele, o logout nao tem o que
    // gravar na denylist e a sessao vive ate o TTL expirar. Ver
    // `revogacao.service.ts`.
    const accessToken = this.jwtService.sign(payload, { jwtid: randomBytes(16).toString('hex') });

    return {
      user: result,
      accessToken,
      expiresIn: this.ttlSegundos,
    };
  }
}
