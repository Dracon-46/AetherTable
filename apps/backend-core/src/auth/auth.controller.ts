import {
  BadRequestException,
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  UseFilters,
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
import {
  EsqueciSenhaDto,
  LoginDto,
  RedefinirComTokenDto,
  RegisterDto,
  TrocarSenhaDto,
} from './auth.dto.js';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type {
  RequisicaoAutenticada,
  RequisicaoOAuth,
  RespostaRedirecionavel,
} from './http.types.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RevogacaoService } from './revogacao.service.js';
import { RecuperacaoService, TokenDeRedefinicaoInvalido } from './recuperacao.service.js';
import { provedoresDisponiveis } from './provedores.js';
import { ExigirProvedorConfigurado, RedirecionarFalhaDeOAuth } from './oauth.guard.js';
import { urlDoFrontend } from './url-do-frontend.js';
import { randomBytes } from 'node:crypto';

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
    private readonly revogacao: RevogacaoService,
    private readonly recuperacao: RecuperacaoService,
  ) {}

  private redirecionarComToken(req: RequisicaoOAuth, res: RespostaRedirecionavel): void {
    const accessToken = this.jwtService.sign(
      {
        username: req.user.username,
        sub: req.user.id,
      },
      // Torna o token revogavel pelo logout. Ver `revogacao.service.ts`.
      { jwtid: randomBytes(16).toString('hex') },
    );

    /**
     * ─── O TOKEN VAI NO FRAGMENTO, NAO NA QUERYSTRING ───────────────────────
     *
     * Era `?token=<jwt>`. A querystring de um redirect entra no HISTORICO do
     * navegador, no cabecalho `Referer` de toda requisicao subsequente daquela
     * pagina, e em qualquer log de proxy ou CDN no caminho — que costumam
     * registrar a URL inteira.
     *
     * O FRAGMENTO nao e enviado ao servidor em nenhuma dessas situacoes: ele
     * existe so no navegador. E a diferenca entre um token que vaza para
     * infraestrutura de terceiros e um que nao vaza.
     *
     * Quem le e `CapturarTokenOAuth`, no layout do painel, que grava a sessao e
     * LIMPA o fragmento com `replaceState` — para o token nao sobreviver nem no
     * historico local.
     */
    return res.redirect(
      `${urlDoFrontend(this.config)}/dashboard#token=${encodeURIComponent(accessToken)}`,
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

  /**
   * ─── ISTO ERA `return;` ──────────────────────────────────────────────────
   *
   * Corpo vazio, comentario dizendo que a denylist "entra junto com o refresh
   * token". Nao revogava nada — e o frontend nem chamava esta rota:
   * `handleLogout` so limpava o `localStorage`. Com o access token valendo 24
   * horas, SAIR DA CONTA DEIXAVA UM TOKEN VALIDO POR ATE UM DIA.
   *
   * O refresh token continua sendo trabalho futuro, e o TTL continua em 24h
   * ate ele existir: encurtar sem refresh trocaria um problema de seguranca
   * por deslogar o jogador no meio de uma partida. O que muda aqui e que
   * `logout` agora DESLOGA.
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoga o token de acesso desta sessao' })
  async logoutDeVerdade(@Req() req: RequisicaoAutenticada): Promise<void> {
    const { jti, sub, exp } = req.user;
    // Token sem `jti` foi emitido antes desta mudanca e nao e revogavel; ele
    // expira sozinho em ate 24h. Nao ha o que fazer, e nao e erro.
    if (!jti) return;

    // `exp` vem em segundos (padrao JWT); a coluna e timestamp.
    await this.revogacao.revogar(jti, sub, new Date(exp * 1000));
    // Limpeza oportunista: nao ha scheduler no projeto, e o logout e
    // justamente quando uma linha nova entra.
    await this.revogacao.expurgarVencidos();
  }

  /**
   * Trocar a própria senha.
   *
   * ─── O LIMITE É APERTADO DE PROPÓSITO ────────────────────────────────────
   *
   * A rota recebe a senha atual e diz se ela confere — ou seja, é um oráculo de
   * senha para quem já tem o token. Com limite generoso, um token roubado viraria
   * força bruta contra a senha real, que é justamente a proteção que a conta
   * ainda teria nesse cenário. Cinco por minuto é folgado para quem erra ao
   * digitar e inútil para quem adivinha.
   *
   * Devolve um token NOVO: a troca derruba as outras sessões, e sem isso
   * derrubaria também a de quem trocou — deslogar alguém por ter ido nos
   * ajustes no meio de uma partida.
   */
  @Post('senha')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ curto: { limit: 2, ttl: 10_000 }, longo: { limit: 5, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(TrocarSenhaDto))
  @ApiOperation({ summary: 'Troca a senha da própria conta e derruba as outras sessões' })
  async trocarSenha(@Req() req: RequisicaoAutenticada, @Body() dto: TrocarSenhaDto) {
    return this.authService.trocarSenha(req.user.sub, dto.senhaAtual, dto.novaSenha);
  }

  // ── Recuperação de senha ───────────────────────────────────────────────────

  /**
   * Pedir o link de redefinição.
   *
   * ─── A RESPOSTA É `202` SEMPRE, E É ISSO QUE PROTEGE ─────────────────────
   *
   * Conta inexistente, banida, suspensa ou de OAuth: todas saem daqui com o
   * mesmo corpo. Uma rota pública que distinguisse os casos seria um
   * verificador de cadastro à disposição de qualquer um — útil para phishing
   * dirigido e para cruzar vazamentos de outras plataformas. É o mesmo
   * princípio do "credenciais inválidas" genérico do login (DOC-050, DOC-060).
   *
   * ─── O LIMITE É POR IP E É APERTADO ──────────────────────────────────────
   *
   * Cada pedido bem-sucedido dispara um e-mail para um endereço que QUEM PEDE
   * escolhe. Sem limite, a rota é um canhão de spam apontado para terceiros,
   * remetido pelo nosso domínio — e o preço disso não é a fatura do provedor,
   * é o domínio entrar em lista de bloqueio e nenhum e-mail do AetherTable
   * chegar a lugar nenhum depois.
   *
   * Três por minuto cobre "não chegou, manda de novo" e não cobre um script.
   */
  @Post('senha/esqueci')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ curto: { ttl: 60_000, limit: 3 }, longo: { ttl: 3_600_000, limit: 10 } })
  @UsePipes(new ZodValidationPipe(EsqueciSenhaDto))
  @ApiOperation({ summary: 'Envia o link de redefinição de senha, se a conta existir' })
  async esqueciSenha(@Body() dto: EsqueciSenhaDto) {
    await this.recuperacao.solicitar(dto.email);
    return {
      mensagem: 'Se houver uma conta com este e-mail, o link de redefinição chegará em instantes.',
    };
  }

  /**
   * Redefinir a senha com o token do e-mail.
   *
   * ─── NÃO DEVOLVE TOKEN DE SESSÃO, E A DIFERENÇA É DE PROPÓSITO ───────────
   *
   * `POST /auth/senha` (troca com a senha atual) devolve um `accessToken` novo
   * para não deslogar quem foi aos ajustes no meio de uma partida. Aqui é o
   * contrário: quem chega por este caminho ESQUECEU a senha ou perdeu o
   * controle da conta, e entrar de novo com a senha nova é a confirmação
   * barata de que a redefinição fez o que prometeu. Emitir sessão direto do
   * link do e-mail transformaria o e-mail no próprio fator de autenticação.
   *
   * O limite existe porque a rota é o oráculo do token: sem ele, um atacante
   * varreria tokens contra ela. 256 bits não se varrem, mas o limite é o que
   * torna a afirmação verdadeira sem depender só do tamanho do segredo.
   */
  @Post('senha/redefinir')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ curto: { ttl: 60_000, limit: 5 }, longo: { ttl: 3_600_000, limit: 20 } })
  @UsePipes(new ZodValidationPipe(RedefinirComTokenDto))
  @ApiOperation({ summary: 'Redefine a senha a partir do token enviado por e-mail' })
  async redefinirSenha(@Body() dto: RedefinirComTokenDto): Promise<void> {
    try {
      await this.recuperacao.redefinir(dto.token, dto.novaSenha);
    } catch (erro) {
      /**
       * As três causas — token inexistente, já usado e vencido — viram a MESMA
       * resposta. Distingui-las contaria a quem está tentando se ele acertou um
       * token e apenas chegou tarde, que é a única informação que faltaria para
       * saber que vale a pena continuar tentando. O motivo real vai para o log,
       * dentro do serviço.
       */
      if (erro instanceof TokenDeRedefinicaoInvalido) {
        throw new BadRequestException(erro.message);
      }
      throw erro;
    }
  }

  // ── OAuth ──────────────────────────────────────────────────────────────────

  /**
   * Quais provedores existem NESTE ambiente.
   *
   * ─── O BOTÃO PRECISA SABER SE LEVA A ALGUM LUGAR ─────────────────────────
   *
   * A tela de login desenhava Google e Discord sempre, e `render.yaml` nunca
   * declarou `GOOGLE_CLIENT_ID` nem `DISCORD_CLIENT_ID`: em produção os dois
   * botões levavam a uma página de erro do próprio provedor. O aviso de "DUMMY
   * KEYS" era condicionado a `NODE_ENV` e não à configuração real — ou seja,
   * sumia exatamente onde o problema existia.
   *
   * Pública e sem limite próprio (o global de 10 req/5 s basta): é uma leitura
   * de duas variáveis de ambiente, sem banco, e a primeira tela do produto a
   * chama antes de qualquer sessão existir.
   */
  @Get('provedores')
  @ApiOperation({ summary: 'Lista quais provedores de OAuth estão configurados no servidor' })
  provedores(): Record<string, boolean> {
    return provedoresDisponiveis(this.config);
  }

  // ── OAuth Google ───────────────────────────────────────────────────────────

  /**
   * `@UseFilters` nas quatro rotas de OAuth: elas são NAVEGAÇÃO, não chamada de
   * API. Sem isso, uma falha no meio do fluxo termina com o usuário olhando
   * `{"statusCode":401,"message":"Unauthorized"}` numa página em branco, sem
   * caminho de volta. Ver `oauth.guard.ts`.
   *
   * A ordem dos guards importa: `ExigirProvedorConfigurado` roda ANTES do
   * `AuthGuard`, então o Passport nunca procura uma estratégia que não foi
   * registrada (o que seria um 500 de `Unknown authentication strategy`).
   */
  @Get('google')
  @UseFilters(RedirecionarFalhaDeOAuth)
  @UseGuards(ExigirProvedorConfigurado('google'), AuthGuard('google'))
  @ApiOperation({ summary: 'Inicia o fluxo OAuth com Google' })
  googleAuth(): void {
    // O guard redireciona para o provedor; este corpo nunca executa.
  }

  @Get('google/callback')
  @UseFilters(RedirecionarFalhaDeOAuth)
  @UseGuards(ExigirProvedorConfigurado('google'), AuthGuard('google'))
  @ApiOperation({ summary: 'Callback do fluxo OAuth Google' })
  googleAuthRedirect(@Req() req: RequisicaoOAuth, @Res() res: RespostaRedirecionavel): void {
    return this.redirecionarComToken(req, res);
  }

  // ── OAuth Discord ──────────────────────────────────────────────────────────

  @Get('discord')
  @UseFilters(RedirecionarFalhaDeOAuth)
  @UseGuards(ExigirProvedorConfigurado('discord'), AuthGuard('discord'))
  @ApiOperation({ summary: 'Inicia o fluxo OAuth com Discord' })
  discordAuth(): void {
    // Idem: o guard redireciona.
  }

  @Get('discord/callback')
  @UseFilters(RedirecionarFalhaDeOAuth)
  @UseGuards(ExigirProvedorConfigurado('discord'), AuthGuard('discord'))
  @ApiOperation({ summary: 'Callback do fluxo OAuth Discord' })
  discordAuthRedirect(@Req() req: RequisicaoOAuth, @Res() res: RespostaRedirecionavel): void {
    return this.redirecionarComToken(req, res);
  }
}
