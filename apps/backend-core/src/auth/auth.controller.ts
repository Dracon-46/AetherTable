import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
  Req,
  Res,
  UsePipes,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { LoginDto, RegisterDto } from './auth.dto.js';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { RequisicaoOAuth, RespostaRedirecionavel } from './http.types.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    // Injetado de verdade. O código anterior fazia
    // `this.authService['jwtService']` — assinar token alcançando um campo
    // privado por índice de string, com o comentário "hack rápido" ao lado.
    // Qualquer renomeação do campo quebraria o OAuth em runtime, em silêncio.
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Para onde devolver o navegador depois do OAuth.
   *
   * Estava `http://localhost:3000/dashboard` escrito à mão nos dois callbacks —
   * e a porta nem era a do projeto (3030, ver `CORS_ORIGINS` em main.ts). Em
   * produção o usuário era redirecionado para a própria máquina dele.
   *
   * A primeira origem de `CORS_ORIGINS` é o melhor palpite disponível quando
   * nada foi configurado: é, por definição, uma origem de frontend que a API já
   * aceita. `OAUTH_REDIRECT_BASE` existe no .env do projeto e nunca era lido.
   */
  private urlDoFrontend(): string {
    const primeiraOrigemCors = (this.config.get<string>('CORS_ORIGINS') ?? '')
      .split(',')
      .map((o) => o.trim())
      .find(Boolean);

    const base =
      this.config.get<string>('FRONTEND_URL') ??
      this.config.get<string>('OAUTH_REDIRECT_BASE') ??
      primeiraOrigemCors ??
      'http://localhost:3030';

    return base.replace(/\/+$/, '');
  }

  private redirecionarComToken(req: RequisicaoOAuth, res: RespostaRedirecionavel): void {
    const accessToken = this.jwtService.sign({
      username: req.user.username,
      sub: req.user.id,
    });
    return res.redirect(
      `${this.urlDoFrontend()}/dashboard?token=${encodeURIComponent(accessToken)}`,
    );
  }

  /**
   * TENTATIVAS DE LOGIN SÃO O ALVO ÓBVIO.
   *
   * O limite global (10 req/5 s) protege a API de sobrecarga, mas é folgado
   * demais para senha: 120 tentativas por minuto quebram uma senha fraca numa
   * tarde. Aqui o balde é outro — 5 por minuto por IP.
   *
   * Cinco cobre errar a senha, corrigir e tentar de novo com folga. Não cobre
   * um script. E como a resposta de credencial inválida é sempre a mesma, o
   * atacante nem descobre se o e-mail existe antes de bater no limite.
   *
   * O limite é por IP, então não trava a conta da vítima — quem apanha é quem
   * tenta. Bloquear por conta seria um jeito fácil de qualquer um deixar outra
   * pessoa de fora do próprio login.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ curto: { ttl: 60_000, limit: 5 }, longo: { ttl: 900_000, limit: 20 } })
  @UsePipes(new ZodValidationPipe(LoginDto))
  @ApiOperation({ summary: 'Realiza o login e devolve os tokens JWT' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  /**
   * Cadastro é mais caro que login: cria linha no banco e roda argon2, que é
   * proposital e deliberadamente lento. Sem limite, um laço simples enche a
   * tabela de usuários e prende a CPU do único nó do plano gratuito.
   */
  @Post('register')
  @Throttle({ curto: { ttl: 60_000, limit: 3 }, longo: { ttl: 3_600_000, limit: 10 } })
  @UsePipes(new ZodValidationPipe(RegisterDto))
  @ApiOperation({ summary: 'Cadastra um novo usuário no sistema' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.email, dto.username, dto.password);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoga tokens de acesso (invalidar sessão)' })
  logout() {
    // O access token é stateless e curto; a sessão vive no cliente. Uma
    // denylist de tokens revogados entra junto com o refresh token (DOC-050).
    return;
  }

  // ── OAuth Google ───────────────────────────────────────────────────────────

  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Inicia o fluxo OAuth com Google' })
  googleAuth(): void {
    // O guard redireciona para o provedor; este corpo nunca executa.
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Callback do fluxo OAuth Google' })
  googleAuthRedirect(@Req() req: RequisicaoOAuth, @Res() res: RespostaRedirecionavel): void {
    return this.redirecionarComToken(req, res);
  }

  // ── OAuth Discord ──────────────────────────────────────────────────────────

  @Get('discord')
  @UseGuards(AuthGuard('discord'))
  @ApiOperation({ summary: 'Inicia o fluxo OAuth com Discord' })
  discordAuth(): void {
    // Idem: o guard redireciona.
  }

  @Get('discord/callback')
  @UseGuards(AuthGuard('discord'))
  @ApiOperation({ summary: 'Callback do fluxo OAuth Discord' })
  discordAuthRedirect(@Req() req: RequisicaoOAuth, @Res() res: RespostaRedirecionavel): void {
    return this.redirecionarComToken(req, res);
  }
}
