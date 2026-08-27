/**
 * Schemas Zod das intencoes. TODA intencao e validada antes de qualquer efeito
 * (FR-11). Payload invalido e DESCARTADO com evento `error` ao remetente — nunca
 * derruba a sala.
 *
 * Fonte canonica: docs/especificacao_websocket_e_eventos.md §3.8.
 *
 * Este arquivo cobre as intencoes implementadas nesta fase. Cada intencao nova
 * entra aqui E no registry.ts — as duas coisas, sempre.
 */

import { z } from 'zod';
import { COUNTER_NAME_PATTERN, DICE_SIDES, ZONES } from '@aethertable/shared-types';

const entityId = z.string().uuid();
const zona = z.enum(ZONES);

/** Coordenada da mesa. Limites evitam NaN, Infinity e posicoes absurdas. */
const coord = z.number().finite().min(-10_000).max(10_000);

// ─── Movimento ───────────────────────────────────────────────────────────────

export const GrabIntent = z.object({ entityId });

export const MoveCardIntent = z.object({ entityId, x: coord, y: coord });

export const ReleaseIntent = z.object({
  entityId,
  x: coord,
  y: coord,
  zIndex: z.number().int().min(0).max(100_000).optional(),
});

export const BringToFrontIntent = z.object({ entityId });

// ─── Zona e grimorio ─────────────────────────────────────────────────────────

export const ChangeZoneIntent = z.object({
  entityId,
  targetZone: zona,
  index: z.number().int().min(0).max(1000).optional(),
  x: coord.optional(),
  y: coord.optional(),
});

export const DrawIntent = z.object({ amount: z.number().int().min(1).max(100) });

export const MillIntent = z.object({
  amount: z.number().int().min(1).max(100),
  target: z.enum(['GRAVEYARD', 'EXILE']),
});

export const ShuffleIntent = z.object({
  zone: zona,
  keepTop: z.number().int().min(0).max(100).optional(),
});

export const MulliganIntent = z.object({}).strict();

// ─── Visibilidade — a familia mais sensivel ──────────────────────────────────

export const PeekIntent = z.object({
  // Nao aceita HAND: nao existe intencao para olhar a mao, nem a propria — a
  // mao ja e visivel ao dono pelo patch filtrado.
  zone: z.enum(['LIBRARY', 'GRAVEYARD', 'EXILE']),
  amount: z.number().int().min(1).max(100),
  from: z.enum(['TOP', 'BOTTOM']).default('TOP'),
});

export const ClosePeekIntent = z.object({}).strict();

export const RevealIntent = z.object({
  ids: z.array(entityId).min(1).max(100),
  to: z.union([z.literal('ALL'), z.array(z.string().min(1)).min(1).max(7)]),
});

export const UnrevealIntent = z.object({ ids: z.array(entityId).min(1).max(100) });

// ─── Propriedades de carta e contadores ──────────────────────────────────────

export const TapIntent = z.object({ entityId, isTapped: z.boolean() });

export const AddCounterIntent = z.object({
  entityId,
  /**
   * Chave livre, nao enum: ha 100+ tipos de contador em Magic (DOC-036 §5.1).
   * A validacao de formato tambem barra XSS e poluicao de cardinalidade em
   * metricas — um `name` livre viraria label do Prometheus.
   */
  name: z.string().regex(COUNTER_NAME_PATTERN),
  amount: z.number().int().min(-99).max(99),
});

export const CreateTokenIntent = z.object({
  scryfallId: z.string().optional(),
  name: z.string().optional(),
  power: z.string().optional(),
  toughness: z.string().optional(),
  amount: z.number().int().min(1).max(20).default(1),
  x: coord,
  y: coord,
});

// ─── Jogador ─────────────────────────────────────────────────────────────────

export const SetLifeIntent = z.union([
  z.object({ delta: z.number().int().min(-999).max(999) }),
  z.object({ absolute: z.number().int().min(-999).max(999) }),
]);

// ─── Aleatoriedade e comunicacao ─────────────────────────────────────────────

export const RollDiceIntent = z.object({
  sides: z.union(
    DICE_SIDES.map((s) => z.literal(s)) as unknown as [
      z.ZodLiteral<number>,
      z.ZodLiteral<number>,
      ...z.ZodLiteral<number>[],
    ],
  ),
});

export const FlipCoinIntent = z.object({}).strict();

export const ChatIntent = z.object({ text: z.string().min(1).max(500) });

export const PingIntent = z.object({
  x: coord,
  y: coord,
  targetId: entityId.optional(),
});

// ─── Ciclo ───────────────────────────────────────────────────────────────────

export const LeaveIntent = z.object({}).strict();
