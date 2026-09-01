import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { UsersModule } from './users/users.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DecksModule } from './decks/decks.module.js';
import { MatchesModule } from './matches/matches.module.js';

/**
 * Root Module of the application.
 * Imports essential global modules (Config, Logging, Database)
 * and feature modules (Health).
 */
@Module({
  imports: [
    // Carrega variáveis de ambiente do .env para a aplicação
    ConfigModule.forRoot({
      isGlobal: true, // Disponível em qualquer lugar sem precisar importar o ConfigModule novamente
      envFilePath: '.env',
    }),

    // Configura o Pino Logger como o logger padrão da aplicação
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env['NODE_ENV'] !== 'production' ? 'debug' : 'info',
        // transport pino-pretty removido para evitar dependência faltante em dev
        // pode ser reativado após: pnpm add pino-pretty --filter backend-core
      },
    }),

    // Módulos principais do domínio
    PrismaModule,
    HealthModule,
    UsersModule,
    AuthModule,
    DecksModule,
    MatchesModule,
  ],
})
export class AppModule {}
