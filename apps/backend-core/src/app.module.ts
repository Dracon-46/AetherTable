import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { UsersModule } from './users/users.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DecksModule } from './decks/decks.module.js';
import { MatchesModule } from './matches/matches.module.js';
import { CardsModule } from './cards/cards.module.js';
import { AdminModule } from './admin/admin.module.js';
import { CosmeticosModule } from './cosmeticos/cosmeticos.module.js';
import { NotificacoesModule } from './notificacoes/notificacoes.module.js';
import { DesafiosModule } from './desafios/desafios.module.js';
import { BALDES_GLOBAIS } from './common/limites.js';
import { FiltroDeErrosDoPrisma } from './common/filtro-de-erros-do-prisma.js';
import { opcoesDoRegistroHttp } from './common/registro-http.js';

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

    // Configura o Pino Logger como o logger padrão da aplicação. Os
    // cabeçalhos com credencial saem censurados — ver `registro-http.ts`.
    LoggerModule.forRoot({
      pinoHttp: opcoesDoRegistroHttp(process.env.NODE_ENV),
    }),

    /**
     * RATE LIMITING — o `@nestjs/throttler` era dependência do projeto desde o
     * início e NUNCA foi registrado. Na prática a API subiu para a internet com
     * `/auth/login` aberto: força bruta contra qualquer conta, sem custo e sem
     * registro, limitada só pela banda de quem ataca.
     *
     * Dois baldes, porque um só não serve:
     *
     *   curto   10 req / 5 s   — corta rajada, o padrão de scanner e de script
     *   longo  120 req / min   — corta o volume sustentado, que a janela curta
     *                            deixaria passar em gotas
     *
     * As rotas de autenticação apertam ainda mais, com `@Throttle` próprio —
     * ver auth.controller.ts. O limite generoso aqui é para a navegação normal
     * da mesa, que faz muitas chamadas curtas.
     *
     * Guarda o estado EM MEMÓRIA. Com um nó só (o plano gratuito) isso é
     * correto. Ao subir para dois ou mais, precisa de storage no Redis, senão
     * cada nó conta seu próprio balde e o limite real vira o dobro, o triplo…
     */
    //
    // A lista mora em `common/limites.ts` porque as rotas internas precisam
    // NOMEAR os baldes para sair deles — ver o comentário de lá.
    ThrottlerModule.forRoot([...BALDES_GLOBAIS]),

    // Módulos principais do domínio
    PrismaModule,
    HealthModule,
    UsersModule,
    AuthModule,
    DecksModule,
    MatchesModule,
    CardsModule,
    CosmeticosModule,
    NotificacoesModule,
    DesafiosModule,
    AdminModule,
  ],
  providers: [
    // Global: vale para toda rota, inclusive as que ainda não existem. Ligar o
    // throttler rota a rota garante que a próxima rota criada nasça exposta.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Chave única violada e registro sumido subiam como 500. Ver o filtro.
    { provide: APP_FILTER, useClass: FiltroDeErrosDoPrisma },
  ],
})
export class AppModule {}
