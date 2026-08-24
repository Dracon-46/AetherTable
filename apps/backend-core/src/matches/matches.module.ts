import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MatchesController } from './matches.controller.js';
import { MatchesService } from './matches.service.js';
import { DecksModule } from '../decks/decks.module.js';

@Module({
  imports: [
    DecksModule, // Para usar o DecksService
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [MatchesController],
  providers: [MatchesService],
})
export class MatchesModule {}
