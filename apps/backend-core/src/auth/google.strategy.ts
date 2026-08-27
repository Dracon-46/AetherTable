import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Injectable, Logger } from '@nestjs/common';
import { AuthService } from './auth.service.js';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(private authService: AuthService) {
    super({
      // Aviso: Estas são chaves falsas provisórias para F34 (MVP).
      // Em produção, isso virá de process.env.GOOGLE_CLIENT_ID
      clientID: process.env.GOOGLE_CLIENT_ID || 'DUMMY_GOOGLE_CLIENT_ID',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'DUMMY_GOOGLE_CLIENT_SECRET',
      callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3333/api/auth/google/callback',
      scope: ['email', 'profile'],
    });
    
    if (!process.env.GOOGLE_CLIENT_ID) {
      this.logger.warn('⚠️ OAuth Google instanciado com DUMMY KEYS. Login com Google falhará ao contatar os servidores da Google.');
    }
  }

  async validate(accessToken: string, refreshToken: string, profile: any, done: VerifyCallback): Promise<any> {
    try {
      const { name, emails, id } = profile;
      
      const email = emails[0].value;
      const displayName = name.givenName ? `${name.givenName} ${name.familyName}` : email.split('@')[0];
      const username = email.split('@')[0]; // Simple logic for demo

      const user = await this.authService.validateOAuthUser('GOOGLE', id, email, username, displayName);
      
      done(null, user);
    } catch (err: any) {
      done(err, false);
    }
  }
}
