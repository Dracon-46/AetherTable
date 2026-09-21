import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-discord';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { credenciaisDoProvedor } from './provedores.js';
import { ErroDeOAuth } from './erro-de-oauth.js';
import { EstadoOAuthStore } from './estado-oauth.store.js';
import { usernameSugerido, type PerfilOAuth } from './oauth.types.js';

/** O Discord entrega `email` direto no perfil, não em `emails[]`. */
interface PerfilDiscord extends PerfilOAuth {
  email?: string;
  /** O Discord permite conta com e-mail NÃO confirmado. Ver abaixo. */
  verified?: boolean;
}

type CallbackPassport = (erro: Error | null, user?: unknown) => void;

/** Mesma razão de `opcoesDoGoogle`: nada de credencial de mentira. */
function opcoesDoDiscord(config: ConfigService): Strategy.StrategyOptions {
  const credenciais = credenciaisDoProvedor(config, 'discord');
  if (!credenciais) {
    throw new Error(
      'DiscordStrategy registrada sem DISCORD_CLIENT_ID/DISCORD_CLIENT_SECRET. Ver auth.module.ts.',
    );
  }

  const opcoes: Strategy.StrategyOptions = {
    clientID: credenciais.clientId,
    clientSecret: credenciais.clientSecret,
    // Mesmo defeito do Google: faltava o `v1` do prefixo global da API.
    callbackURL: credenciais.callbackUrl,
    scope: ['identify', 'email'],
    // Sem `store`, o `state` não é verificado — ver `estado-oauth.store.ts` e o
    // comentário gêmeo em `google.strategy.ts`.
    store: new EstadoOAuthStore(config.get<string>('NODE_ENV') === 'production'),
  };

  return opcoes;
}

@Injectable()
export class DiscordStrategy extends PassportStrategy(Strategy, 'discord') {
  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    super(opcoesDoDiscord(config));
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: PerfilDiscord,
    done: CallbackPassport,
  ): Promise<void> {
    try {
      const email = profile.email?.toLowerCase();
      if (!email) {
        // Conta sem e-mail: falhar aqui, e não deixar `undefined` chegar ao
        // banco como chave de vínculo.
        done(new ErroDeOAuth('sem_email', 'Perfil do Discord sem e-mail.'));
        return;
      }

      const username = usernameSugerido(email, profile);
      const user = await this.authService.validateOAuthUser(
        'DISCORD',
        profile.id,
        email,
        username,
        profile.username ?? username,
        /**
         * ─── O `verified` DO DISCORD É O QUE IMPEDE UMA TOMADA DE CONTA ────
         *
         * O Discord deixa a conta existir e autorizar aplicativos com o e-mail
         * AINDA NÃO CONFIRMADO. Sem esta checagem, qualquer pessoa criaria uma
         * conta Discord declarando o endereço de um jogador do AetherTable e
         * entraria na conta dele — `validateOAuthUser` casa por e-mail quando
         * não há vínculo prévio.
         *
         * `=== true` e não um valor "verdadeiro qualquer": `undefined` (campo
         * ausente numa versão futura da API) precisa contar como NÃO
         * verificado. Falha fechada.
         */
        profile.verified === true,
      );

      done(null, user);
    } catch (err) {
      // Exceções do Nest (conta suspensa, conta encerrada) e `ErroDeOAuth`
      // atravessam inteiras — ver o comentário gêmeo em `google.strategy.ts`.
      done(err instanceof Error ? err : new ErroDeOAuth('falhou', String(err)));
    }
  }
}
