import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ttlEmSegundos } from './ttl.js';
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
        /**
         * VIDA DO ACCESS TOKEN.
         *
         * Era `7d`, com o comentário "expiram longo para dev" ao lado — e foi
         * para a internet assim. Sete dias é muito para um bearer token que o
         * frontend guarda em `localStorage`: qualquer XSS numa dependência
         * rende uma semana de acesso, e não existe como revogar (o `logout`
         * apenas apaga o token no cliente; o servidor continua aceitando).
         *
         * O certo é access token curto (15 min) + refresh token rotativo com
         * denylist. Só que o refresh NÃO EXISTE ainda: encurtar para 15 min
         * hoje derrubaria a sessão do jogador no meio da partida, sem nada que
         * a renove. Doze horas é o meio-termo honesto — cobre uma noite de
         * jogo inteira e reduz a janela de um roubo de token de 168 h para 12 h.
         *
         * `JWT_ACCESS_TTL` e `JWT_REFRESH_TTL` existem no .env e no render.yaml
         * e NUNCA foram lidos por nada. Agora o primeiro é de verdade.
         */
        signOptions: { expiresIn: ttlEmSegundos(configService.get<string>('JWT_ACCESS_TTL')) },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GoogleStrategy, DiscordStrategy],
  exports: [AuthService], // Exporta o serviço caso outros módulos precisem emitir tokens
})
export class AuthModule {}
