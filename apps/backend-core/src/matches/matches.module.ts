import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { InternalMatchesController, MatchesController } from './matches.controller.js';
import { MatchesService } from './matches.service.js';
import { DecksModule } from '../decks/decks.module.js';
// Criar mesa consulta o interruptor MATCHMAKING_ENABLED (DOC-061 §5).
import { AdminModule } from '../admin/admin.module.js';

@Module({
  imports: [
    DecksModule, // Para usar o DecksService
    AdminModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [MatchesController, InternalMatchesController],
  providers: [MatchesService],
})
export class MatchesModule {}
