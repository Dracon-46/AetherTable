import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-discord';
import { Injectable, Logger } from '@nestjs/common';
import { AuthService } from './auth.service.js';

@Injectable()
export class DiscordStrategy extends PassportStrategy(Strategy, 'discord') {
  private readonly logger = new Logger(DiscordStrategy.name);

  constructor(private authService: AuthService) {
    super({
      // Aviso: Estas são chaves falsas provisórias para F34 (MVP).
      // Em produção, isso virá de process.env.DISCORD_CLIENT_ID
      clientID: process.env.DISCORD_CLIENT_ID || 'DUMMY_DISCORD_CLIENT_ID',
      clientSecret: process.env.DISCORD_CLIENT_SECRET || 'DUMMY_DISCORD_CLIENT_SECRET',
      callbackURL: process.env.DISCORD_CALLBACK_URL || 'http://localhost:3333/api/auth/discord/callback',
      scope: ['identify', 'email'],
    });

    if (!process.env.DISCORD_CLIENT_ID) {
      this.logger.warn('⚠️ OAuth Discord instanciado com DUMMY KEYS. Login com Discord falhará ao contatar os servidores do Discord.');
    }
  }

  async validate(accessToken: string, refreshToken: string, profile: any, done: (error: any, user?: any) => void): Promise<any> {
    try {
      const { email, username, id } = profile;
      
      const user = await this.authService.validateOAuthUser('DISCORD', id, email, username, username);
      
      done(null, user);
    } catch (err: any) {
      done(err, false);
    }
  }
}
