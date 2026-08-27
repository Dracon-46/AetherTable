import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { JwtStrategy } from './jwt.strategy.js';
import { GoogleStrategy } from './google.strategy.js';
import { DiscordStrategy } from './discord.strategy.js';
import { UsersModule } from '../users/users.module.js';

/**
 * Módulo de Autenticação (AuthModule).
 * Encarregado da segurança, rotas públicas e injeção do Passport e JWT.
 */
@Module({
  imports: [
    UsersModule,
    PassportModule,
    // Registra o Módulo JWT assincronamente para ler o JWT_SECRET do arquivo .env
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' }, // Access Tokens expiram longo para dev
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GoogleStrategy, DiscordStrategy],
  exports: [AuthService], // Exporta o serviço caso outros módulos precisem emitir tokens
})
export class AuthModule {}
