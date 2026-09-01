import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

/**
 * Bootstrap function to initialize the NestJS application.
 */
async function bootstrap() {
  // Cria a aplicação usando o módulo raiz (AppModule) e injeta o logger bufferizado
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  // Configura o pino-logger como o logger principal da aplicação
  const logger = app.get(Logger);
  app.useLogger(logger);

  /**
   * SEM ISTO O RATE LIMIT NÃO PROTEGE NADA.
   *
   * Atrás do proxy do Render (e de qualquer PaaS), o `req.ip` que o Express vê
   * é o do PROXY, não o do visitante. Todo o tráfego do mundo chega com o mesmo
   * endereço — então o throttler ou libera todo mundo, ou bloqueia todo mundo
   * junto assim que uma pessoa passa do limite. Nos dois casos ele não faz o
   * trabalho, e faz parecer que faz.
   *
   * `trust proxy: 1` manda o Express ler o primeiro endereço do
   * `X-Forwarded-For`, que é o do cliente. O `1` (e não `true`) é deliberado:
   * confiar na cadeia inteira deixaria qualquer um forjar o cabeçalho e
   * escapar do limite escolhendo um IP falso a cada requisição.
   */
  app.set('trust proxy', 1);

  /**
   * Cabeçalhos de segurança. Não havia nenhum: a API respondia sem
   * `X-Content-Type-Options`, sem `Referrer-Policy`, sem HSTS, e ainda
   * anunciava `X-Powered-By: Express` — um convite a scanner automático.
   *
   * `contentSecurityPolicy` fica desligado de propósito: esta API só devolve
   * JSON, nunca HTML. Um CSP aqui não protege nada e quebraria o Swagger em
   * desenvolvimento. A CSP que importa é a do frontend, na Vercel.
   */
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.disable('x-powered-by');

  // Aplica prefixo global para todas as rotas
  app.setGlobalPrefix('api/v1');

  // Configuração rigorosa de CORS (Cross-Origin Resource Sharing)
  // Permitindo que o frontend conecte na API.
  //
  // ATENÇÃO: com `credentials: true`, o navegador REJEITA a resposta se o
  // Access-Control-Allow-Origin for `*`. A origem precisa ser explícita — por
  // isso não existe fallback para curinga aqui.
  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3030')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Configuração do Swagger (OpenAPI) para documentação interativa
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('AetherTable Backend Core API')
      .setDescription('API REST principal do AetherTable (usuários, decks, salas)')
      .setVersion('1.0')
      .addBearerAuth() // Habilita o input de token JWT no Swagger UI
      .build();

    const document = SwaggerModule.createDocument(app, config);
    // Expõe a documentação na rota /api/v1/docs
    SwaggerModule.setup('api/v1/docs', app, document);
  }

  // Porta canônica da API Core em dev: 3333 (docs/guia_de_configuracao_e_desenvolvimento.md §1).
  // Se mudar aqui, mude também NEXT_PUBLIC_API_URL do frontend e BACKEND_CORE_URL
  // do game-server — os três precisam concordar.
  //
  // Em produção a porta é IMPOSTA pelo host (Render, Fly, Koyeb injetam PORT).
  // E o bind precisa ser em 0.0.0.0: ligar em localhost faz o health check
  // externo falhar e o deploy ser marcado como não saudável.
  const port = process.env.PORT || 3333;
  await app.listen(port, '0.0.0.0');

  logger.log(`🚀 AetherTable Backend-Core rodando na porta: ${port}`);
}

bootstrap();
