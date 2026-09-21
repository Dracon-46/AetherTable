import { Logger, Module, type Provider } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ttlEmSegundos } from './ttl.js';
import { AuthService } from './auth.service.js';
import { RevogacaoService } from './revogacao.service.js';
import { RecuperacaoService } from './recuperacao.service.js';
import { EmailService } from './email.service.js';
import { AuthController } from './auth.controller.js';
import { JwtStrategy } from './jwt.strategy.js';
import { GoogleStrategy } from './google.strategy.js';
import { DiscordStrategy } from './discord.strategy.js';
import { provedorConfigurado } from './provedores.js';
import { UsersModule } from '../users/users.module.js';
// O registro consulta o interruptor REGISTRATION_ENABLED (DOC-061 §5).
import { AdminModule } from '../admin/admin.module.js';

/**
 * ─── A ESTRATÉGIA SÓ EXISTE SE O PROVEDOR ESTIVER CONFIGURADO ──────────────
 *
 * Antes, `GoogleStrategy` e `DiscordStrategy` eram registradas
 * incondicionalmente e caíam em `'DUMMY_GOOGLE_CLIENT_ID'` quando faltava a
 * variável. O efeito era um botão na tela de login que levava a uma página de
 * erro do próprio Google — em produção, onde `render.yaml` nunca declarou
 * essas variáveis.
 *
 * Registrar condicionalmente é o que permite ao resto do sistema responder a
 * verdade: `GET /auth/provedores` diz quais existem, o guard recusa os que não
 * existem, e a tela desenha só os que funcionam.
 *
 * O log no boot é a única forma de alguém descobrir POR QUE o botão sumiu de um
 * ambiente. Sem ele, a resposta a "cadê o login com Google no staging?" seria
 * ler o código.
 */
function estrategiasDeOAuth(): Provider[] {
  const logger = new Logger('AuthModule');

  // `process.env` e não `ConfigService` porque a decisão acontece ANTES de o
  // container de injeção existir — é a lista de providers que está sendo
  // montada. O `ConfigModule` já carregou o `.env` neste ponto (ver
  // `ConfigModule.forRoot({ isGlobal: true })` em `app.module.ts`).
  const leitor = { get: <T = string>(chave: string) => process.env[chave] as T | undefined };

  const estrategias: Provider[] = [];

  if (provedorConfigurado(leitor, 'google')) {
    estrategias.push(GoogleStrategy);
  } else {
    logger.log('Login com Google DESLIGADO: GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET ausentes.');
  }

  if (provedorConfigurado(leitor, 'discord')) {
    estrategias.push(DiscordStrategy);
  } else {
    logger.log('Login com Discord DESLIGADO: DISCORD_CLIENT_ID/DISCORD_CLIENT_SECRET ausentes.');
  }

  return estrategias;
}

/**
 * Módulo de Autenticação (AuthModule).
 * Encarregado da segurança, rotas públicas e injeção do Passport e JWT.
 */
@Module({
  imports: [
    UsersModule,
    AdminModule,
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
  providers: [
    AuthService,
    JwtStrategy,
    RevogacaoService,
    RecuperacaoService,
    EmailService,
    ...estrategiasDeOAuth(),
  ],
  // `RevogacaoService` sai do modulo porque a `JwtStrategy` de QUALQUER modulo
  // protegido depende dele para a denylist valer em toda rota, e nao so aqui.
  exports: [AuthService, RevogacaoService], // Exporta o serviço caso outros módulos precisem emitir tokens
})
export class AuthModule {}
