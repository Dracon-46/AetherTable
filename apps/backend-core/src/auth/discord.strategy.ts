import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-discord';
import { Injectable, Logger } from '@nestjs/common';
import type { AuthService } from './auth.service.js';
import { usernameSugerido, type PerfilOAuth } from './oauth.types.js';

/** O Discord entrega `email` direto no perfil, não em `emails[]`. */
interface PerfilDiscord extends PerfilOAuth {
  email?: string;
}

type CallbackPassport = (erro: Error | null, user?: unknown) => void;

@Injectable()
export class DiscordStrategy extends PassportStrategy(Strategy, 'discord') {
  private readonly logger = new Logger(DiscordStrategy.name);

  constructor(private readonly authService: AuthService) {
    super({
      clientID: process.env.DISCORD_CLIENT_ID || 'DUMMY_DISCORD_CLIENT_ID',
      clientSecret: process.env.DISCORD_CLIENT_SECRET || 'DUMMY_DISCORD_CLIENT_SECRET',
      // Mesmo defeito do Google: faltava o `v1` do prefixo global da API.
      callbackURL:
        process.env.DISCORD_CALLBACK_URL || 'http://localhost:3333/api/v1/auth/discord/callback',
      scope: ['identify', 'email'],
    });

    if (!process.env.DISCORD_CLIENT_ID) {
      this.logger.warn(
        'OAuth Discord instanciado com chaves de exemplo. O login com Discord vai falhar ao contatar o Discord.',
      );
    }
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
        // Conta sem e-mail verificado: falhar aqui, e não deixar `undefined`
        // chegar ao banco como chave de vínculo.
        done(new Error('A conta Discord não expôs um e-mail verificado.'));
        return;
      }

      const username = usernameSugerido(email, profile);
      const user = await this.authService.validateOAuthUser(
        'DISCORD',
        profile.id,
        email,
        username,
        profile.username ?? username,
      );

      done(null, user);
    } catch (err) {
      done(err instanceof Error ? err : new Error('Falha no OAuth Discord'));
    }
  }
}
