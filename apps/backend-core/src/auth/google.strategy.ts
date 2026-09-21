import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type StrategyOptions, type VerifyCallback } from 'passport-google-oauth20';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { credenciaisDoProvedor } from './provedores.js';
import { ErroDeOAuth } from './erro-de-oauth.js';
import { EstadoOAuthStore } from './estado-oauth.store.js';
import {
  emailVerificadoPeloProvedor,
  primeiroEmail,
  usernameSugerido,
  type PerfilOAuth,
} from './oauth.types.js';

/**
 * ─── AS CREDENCIAIS DE MENTIRA SUMIRAM ─────────────────────────────────────
 *
 * Havia `process.env.GOOGLE_CLIENT_ID || 'DUMMY_GOOGLE_CLIENT_ID'` e um `warn`
 * dizendo que o login "vai falhar ao contatar a Google". Ele falhava mesmo — e
 * o usuário só descobria na tela do Google, com "The OAuth client was not
 * found", depois de clicar num botão que a tela de login mostrava em todo
 * ambiente.
 *
 * Agora a estratégia só é REGISTRADA quando há credencial (ver
 * `auth.module.ts`), e o `throw` abaixo é o que garante que não existe caminho
 * de volta para o valor falso: se alguém registrar a estratégia sem
 * configuração, o boot quebra alto em vez de produzir um botão que não leva a
 * lugar nenhum.
 */
function opcoesDoGoogle(config: ConfigService): StrategyOptions {
  const credenciais = credenciaisDoProvedor(config, 'google');
  if (!credenciais) {
    throw new Error(
      'GoogleStrategy registrada sem GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET. Ver auth.module.ts.',
    );
  }

  const opcoes: StrategyOptions = {
    clientID: credenciais.clientId,
    clientSecret: credenciais.clientSecret,
    // O prefixo global da API é `api/v1` (main.ts). O padrão anterior era
    // `/api/auth/google/callback` — uma rota que não existe: o provedor
    // devolvia o usuário num 404. Ver `urlDeCallback` em `provedores.ts`.
    callbackURL: credenciais.callbackUrl,
    scope: ['email', 'profile'],
    /**
     * Sem `store`, o `passport-oauth2` instala um `NullStore` e o `state`
     * NÃO É VERIFICADO — a proteção contra login CSRF que DOC-050 §2.4 dá
     * como existente. Ver `estado-oauth.store.ts`.
     */
    store: new EstadoOAuthStore(config.get<string>('NODE_ENV') === 'production'),
  };

  return opcoes;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    super(opcoesDoGoogle(config));
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: PerfilOAuth,
    done: VerifyCallback,
  ): Promise<void> {
    try {
      const email = primeiroEmail(profile);
      if (!email) {
        // Falha explícita: sem e-mail não há como vincular a conta.
        done(new ErroDeOAuth('sem_email', 'Perfil do Google sem e-mail utilizável.'), false);
        return;
      }

      const nomeExibicao =
        profile.name?.givenName && profile.name?.familyName
          ? `${profile.name.givenName} ${profile.name.familyName}`
          : (profile.displayName ?? email.split('@')[0]!);

      const user = await this.authService.validateOAuthUser(
        'GOOGLE',
        profile.id,
        email,
        usernameSugerido(email, profile),
        nomeExibicao,
        emailVerificadoPeloProvedor(profile),
      );

      done(null, user);
    } catch (err) {
      /**
       * `ErroDeOAuth` e as exceções do Nest (conta suspensa, conta encerrada)
       * atravessam INTEIRAS. Antes, tudo virava `new Error('Falha no OAuth
       * Google')` aqui — e a suspensão de uma conta, que tem prazo e motivo
       * para mostrar, chegava ao usuário como uma falha genérica de login.
       */
      done(err instanceof Error ? err : new ErroDeOAuth('falhou', String(err)), false);
    }
  }
}
