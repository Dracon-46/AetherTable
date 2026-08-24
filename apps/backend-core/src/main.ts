import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Bootstrap function to initialize the NestJS application.
 */
async function bootstrap() {
  // Cria a aplicação usando o módulo raiz (AppModule) e injeta o logger bufferizado
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Configura o pino-logger como o logger principal da aplicação
  const logger = app.get(Logger);
  app.useLogger(logger);

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
