import './polyfill';

import http from 'node:http';
import express from 'express';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { monitor } from '@colyseus/monitor';
import { playground } from '@colyseus/playground';
import { AETHER_ROOM } from '@aethertable/shared-types';

import { config, isProd } from './config';
import { AetherRoom } from './rooms/AetherRoom';
import { registry } from './metrics';
import { Encoder } from '@colyseus/schema';

Encoder.BUFFER_SIZE = 100 * 1024; // 100KB for large EDH decks

/**
 * Ponto de entrada do game server.
 *
 * AVISO RECORRENTE (DOC-022 §6): este processo NAO pode rodar em plataforma
 * serverless. WebSocket exige conexao persistente; cold start e limite de
 * duracao de execucao quebram a partida. VPS dedicada, sempre.
 */

const app = express();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'game-server', ws: config.PUBLIC_WS_URL });
});

// Rede interna. Em producao, bloquear na borda (Cloudflare / firewall).
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

// Painel de inspecao de salas. Em producao precisa de auth na frente.
app.use('/colyseus', monitor());

// Playground: dispara intencoes a mao e inspeciona o estado sem passar pelo
// frontend. E a ferramenta mais util para desenvolver o motor.
if (!isProd) {
  app.use('/playground', playground());
}

const httpServer = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
    // Sem pong em 45 s, encerra. Heartbeat de 15 s (DOC-031 §2.2).
    pingInterval: 15_000,
    pingMaxRetries: 3,
    // Intencoes sao pequenas por natureza. Acima disto, so codigo malicioso.
    maxPayload: 4096,
  }),
  // Presence e driver do Redis: obrigatorios para escalar entre nos.
  // Ficam desligados em dev de um no para nao exigir Redis rodando.
  ...(config.USE_REDIS ? carregarRedis() : {}),
});

gameServer.define(AETHER_ROOM, AetherRoom).filterBy(['roomCode']);

// Bind explícito em 0.0.0.0: hosts gerenciados (Render, Fly, Koyeb) fazem o
// health check de fora do container. Ligar só em localhost derruba o deploy.
gameServer.listen(config.PORT, '0.0.0.0').then(() => {
  console.log(`[game-server] escutando em ws://localhost:${config.PORT}`);
  console.log(`[game-server] monitor:    http://localhost:${config.PORT}/colyseus`);
  if (!isProd) {
    console.log(`[game-server] playground: http://localhost:${config.PORT}/playground`);
  }
});

/**
 * Carrega presence/driver do Redis apenas quando pedido. O require e tardio de
 * proposito: em dev sem Redis, nem importar o modulo.
 */
function carregarRedis() {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { RedisPresence } = require('@colyseus/redis-presence');
  const { RedisDriver } = require('@colyseus/redis-driver');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return {
    presence: new RedisPresence(config.REDIS_URL),
    driver: new RedisDriver(config.REDIS_URL),
  };
}

// Encerramento gracioso: avisa as salas antes de cair, para o deploy nao
// derrubar partidas em andamento sem aviso.
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    console.log(`[game-server] ${sinal} recebido, drenando salas...`);
    void gameServer.gracefullyShutdown().then(() => process.exit(0));
  });
}
