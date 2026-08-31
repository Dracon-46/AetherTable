import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type VerifyCallback } from 'passport-google-oauth20';
import { Injectable, Logger } from '@nestjs/common';
import type { AuthService } from './auth.service.js';
import { primeiroEmail, usernameSugerido, type PerfilOAuth } from './oauth.types.js';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(private readonly authService: AuthService) {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID || 'DUMMY_GOOGLE_CLIENT_ID',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'DUMMY_GOOGLE_CLIENT_SECRET',
      // O prefixo global da API é `api/v1` (main.ts). O padrão anterior era
      // `/api/auth/google/callback` — uma rota que não existe: o provedor
      // devolvia o usuário num 404.
      callbackURL:
        process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3333/api/v1/auth/google/callback',
      scope: ['email', 'profile'],
    });

    if (!process.env.GOOGLE_CLIENT_ID) {
      this.logger.warn(
        'OAuth Google instanciado com chaves de exemplo. O login com Google vai falhar ao contatar a Google.',
      );
    }
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
        done(new Error('A conta Google não expôs um e-mail utilizável.'), false);
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
      );

      done(null, user);
    } catch (err) {
      done(err instanceof Error ? err : new Error('Falha no OAuth Google'), false);
    }
  }
}
