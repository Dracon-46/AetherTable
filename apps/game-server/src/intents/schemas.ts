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
import {
  COUNTER_NAME_PATTERN,
  DICE_SIDES,
  ZONES,
  ehBorderValido,
  ehPetValido,
  ehPlaymatValido,
  ehSleeveValido,
  ehTitleValido,
} from '@aethertable/shared-types';

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

export const UntapAllIntent = z.object({}).strict();

export const UpdatePropertyIntent = z.object({
  entityId: z.string().uuid(),
  property: z.enum(['isTapped', 'faceDown', 'rotation']),
  value: z.union([z.boolean(), z.number()]),
});

export const CopyCardIntent = z.object({ entityId: z.string().uuid() });

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

// ─────────────────────────────────────────────────────────────────────────────
//  Intencoes que o CLIENTE ja emitia e o servidor NAO conhecia.
//
//  `intents.ts` do frontend exportava 35 emissores; o REGISTRY implementava 20.
//  As 15 restantes viravam mensagens que o Colyseus descartava em silencio —
//  era essa a causa de "varias funcoes nao estao funcionando": passar o turno,
//  limpar tokens, dano de comandante, contadores de jogador, monarca /
//  iniciativa, conjurar comandante, moer, transformar, anotar, destacar.
// ─────────────────────────────────────────────────────────────────────────────

export const SetCounterIntent = z.object({
  entityId,
  name: z.string().regex(COUNTER_NAME_PATTERN),
  value: z.number().int().min(-99).max(99),
});

export const ClearCountersIntent = z.object({ entityId });

export const SetNoteIntent = z.object({
  entityId,
  /** Sanitizada no handler; 120 caracteres e o limite de DOC-036. */
  text: z.string().max(120),
});

export const SetHighlightIntent = z.object({
  entityId,
  /** Cor CSS curta ou vazio para limpar. */
  color: z.string().max(24),
});

export const SetControllerIntent = z.object({
  entityId,
  controllerId: z.string().min(1).max(64),
});

export const TransformIntent = z.object({ entityId });

export const DestroyTokenIntent = z.object({ entityId });

export const ClearTokensIntent = z.object({}).strict();

export const SetCommanderDamageIntent = z.object({
  fromPlayerId: z.string().min(1).max(64),
  delta: z.number().int().min(-99).max(99),
});

export const AddPlayerCounterIntent = z.object({
  name: z.enum(['POISON', 'ENERGY', 'EXPERIENCE', 'RAD', 'TICKET']),
  amount: z.number().int().min(-99).max(99),
});

export const ToggleDesignationIntent = z.object({
  type: z.enum(['MONARCH', 'INITIATIVE']),
});

export const ConcedeIntent = z.object({}).strict();

export const CastCommanderIntent = z.object({ entityId });

export const PassTurnIntent = z.object({}).strict();

export const ResetMatchIntent = z.object({}).strict();

export const StartMatchIntent = z.object({}).strict();

// ─────────────────────────────────────────────────────────────────────────────
//  Fase 2 da paridade com DOC-036 (Catalogo de Acoes da Mesa).
//
//  A tabela do catalogo marca cada acao com prioridade M (must) / S (should) /
//  C (could). Todas as M e S entram aqui. As C que exigiriam zona ou schema
//  novo (Planechase, Archenemy, masmorra, meld, emblema, agrupamento visual)
//  ficam para V2 — estao anotadas em `INTENCOES_PENDENTES`, no registry.
// ─────────────────────────────────────────────────────────────────────────────

const sessionId = z.string().min(1).max(64);

/** Zonas que o dono pode inspecionar por inteiro. Nunca a de outro jogador. */
const zonaPropria = z.enum(['LIBRARY', 'GRAVEYARD', 'EXILE', 'SIDEBOARD', 'HAND']);

export const MoveTopToBottomIntent = z.object({
  amount: z.number().int().min(1).max(100),
});

export const DrawUpToIntent = z.object({ target: z.number().int().min(0).max(60) });

export const ReturnZoneIntent = z.object({
  from: z.enum(['GRAVEYARD', 'EXILE', 'HAND']),
  to: z.enum(['LIBRARY']),
  shuffle: z.boolean().default(true),
});

export const ReorderIntent = z.object({
  zone: zonaPropria,
  ids: z.array(entityId).min(1).max(200),
});

export const ScryIntent = z.object({ amount: z.number().int().min(1).max(20) });

export const ScryCommitIntent = z.object({
  toBottom: z.array(entityId).max(20),
  topOrder: z.array(entityId).max(20),
});

export const SurveilIntent = z.object({ amount: z.number().int().min(1).max(20) });

export const SurveilCommitIntent = z.object({
  toGraveyard: z.array(entityId).max(20),
  topOrder: z.array(entityId).max(20),
});

export const SearchZoneIntent = z.object({
  zone: zonaPropria,
  filter: z.string().max(64).optional(),
});

export const RevealZoneIntent = z.object({
  zone: zonaPropria,
  to: z.union([z.literal('ALL'), z.array(sessionId).min(1).max(7)]),
});

export const RevealTopIntent = z.object({ amount: z.number().int().min(1).max(20) });

export const SetZoneVisibilityIntent = z.object({
  zone: zonaPropria,
  to: z.union([z.literal('ALL'), z.array(sessionId).min(1).max(7)]),
});

export const TapAllIntent = z.object({}).strict();

export const AttachIntent = z.object({ childId: entityId, parentId: entityId });

export const DetachIntent = z.object({ childId: entityId });

export const SetPtIntent = z.object({
  entityId,
  power: z.number().int().min(-99).max(99),
  toughness: z.number().int().min(-99).max(99),
  /** false limpa o override e devolve o P/T impresso. */
  active: z.boolean().default(true),
});

export const SetDamageIntent = z.object({
  entityId,
  amount: z.number().int().min(0).max(999),
});

export const ClearDamageIntent = z.object({}).strict();

export const BatchUpdateIntent = z.object({
  entityIds: z.array(entityId).min(1).max(60),
  property: z.enum(['isTapped', 'faceDown', 'rotation', 'phasedOut', 'enteredThisTurn']),
  value: z.union([z.boolean(), z.number()]),
});

export const BatchCounterIntent = z.object({
  entityIds: z.array(entityId).min(1).max(60),
  name: z.string().regex(COUNTER_NAME_PATTERN),
  amount: z.number().int().min(-99).max(99),
});

export const SetCommanderIntent = z.object({ entityId });

export const SetCommanderTaxIntent = z.object({
  delta: z.number().int().min(-99).max(99),
});

export const SetPlayerCounterIntent = z.object({
  type: z.enum(['POISON', 'ENERGY', 'EXPERIENCE', 'RAD', 'TICKET']),
  delta: z.number().int().min(-99).max(99),
});

export const SetRingIntent = z.object({
  level: z.number().int().min(0).max(4),
  bearerId: entityId.optional(),
});

export const SetDayNightIntent = z.object({
  value: z.enum(['DAY', 'NIGHT', 'NEITHER']),
});

export const SetSpeedIntent = z.object({ value: z.number().int().min(0).max(4) });

export const SetMaxHandSizeIntent = z.object({
  value: z.number().int().min(0).max(99),
});

export const SetTurnOrderIntent = z.object({
  order: z.array(sessionId).min(1).max(8),
});

export const DiscardRandomIntent = z.object({
  amount: z.number().int().min(1).max(20),
});

export const DiscardAllIntent = z.object({}).strict();

export const RandomPlayerIntent = z.object({}).strict();

export const RandomCardIntent = z.object({ zone: zonaPropria });

export const ArrowIntent = z.object({
  fromId: entityId,
  toId: z.string().min(1).max(64),
  color: z.string().max(24).optional(),
  combat: z.boolean().default(false),
});

export const ClearArrowsIntent = z.object({ scope: z.enum(['MINE', 'COMBAT']) });

export const SetTurnIntent = z.object({
  turn: z.number().int().min(1).max(9999).optional(),
  phase: z.string().max(32).optional(),
});

export const UndoIntent = z.object({}).strict();

export const FetchFromSideboardIntent = z.object({
  entityId,
  to: z.enum(['HAND', 'BATTLEFIELD', 'LIBRARY', 'GRAVEYARD', 'EXILE', 'COMMAND']),
});

/**
 * Cosmeticos (DOC-060). A validacao e contra o CATALOGO, nao contra um formato:
 * um `z.string()` aqui aceitaria uma URL, e uma URL vinda do cliente e upload
 * disfarcado — o risco de IP e de conteudo que o sistema fechado existe para
 * eliminar.
 */
export const SetCosmeticsIntent = z
  .object({
    sleeveId: z.string().refine(ehSleeveValido, 'sleeve fora do catalogo').optional(),
    playmatId: z.string().refine(ehPlaymatValido, 'playmat fora do catalogo').optional(),
    borderId: z.string().refine(ehBorderValido, 'borda fora do catalogo').optional(),
    titleId: z.string().refine(ehTitleValido, 'titulo fora do catalogo').optional(),
    petId: z.string().refine(ehPetValido, 'mascote fora do catalogo').optional(),
  })
  .strict();
