/**
 * Metricas Prometheus do canal de tempo real (NFR-11).
 * Expostas em /metrics — rede interna. Fonte: DOC-031 §7.
 */
import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const conexoesAtivas = new Gauge({
  name: 'ws_connections_active',
  help: 'Conexoes WebSocket ativas (CCU)',
  registers: [registry],
});

export const salasAtivas = new Gauge({
  name: 'ws_rooms_active',
  help: 'Salas ativas neste no',
  registers: [registry],
});

export const intentsRecebidas = new Counter({
  name: 'ws_intents_total',
  help: 'Intencoes aceitas, por tipo',
  labelNames: ['type'] as const,
  registers: [registry],
});

export const intentsRejeitadas = new Counter({
  name: 'ws_intents_rejected_total',
  help: 'Intencoes rejeitadas, por motivo (validacao, autorizacao, rate limit)',
  labelNames: ['reason'] as const,
  registers: [registry],
});

export const reconexoes = new Counter({
  name: 'ws_reconnections_total',
  help: 'Tentativas de reconexao, por resultado',
  labelNames: ['result'] as const,
  registers: [registry],
});
