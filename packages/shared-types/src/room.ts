import type { ICard } from './card';
import type { IPlayer } from './player';

export const ROOM_PHASES = ['WAITING', 'PLAYING', 'PAUSED', 'CLOSING'] as const;
export type RoomPhase = (typeof ROOM_PHASES)[number];

/**
 * Estado autoritativo da sala. Vive na RAM do game node — nunca no Postgres
 * (ADR-006, RN12). Fonte canonica: docs/especificacao_do_motor_sandbox.md §3.
 */
export interface IRoomState {
  roomCode: string;
  phase: RoomPhase;
  /** Marcador VISUAL apenas (F29). O motor nao controla turnos. */
  turn: number;
  /** Marcador VISUAL apenas. */
  activePlayerId: string;
  startedAt: number;

  players: Record<string, IPlayer>;
  cards: Record<string, ICard>;

  /**
   * Ordem por zona: `zoneOrder["p1:LIBRARY"] = [cardId, ...]`.
   * Contem IDs DE MESA, nunca `scryfallId` (DOC-032 §3.1).
   */
  zoneOrder: Record<string, string[]>;
}

/** Nome do room handler registrado no Colyseus. */
export const AETHER_ROOM = 'aether_room';

/** Opcoes enviadas no `joinById` — validadas em `onAuth` (FR-20). */
export interface JoinOptions {
  /** JWT de assento emitido pela API Core. Expira em 1 dia, uso unico. */
  seatToken: string;
  /**
   * Deck com que o jogador entra. OPCIONAL desde que a escolha do grimorio
   * passou a acontecer na sala de espera (`INTENT_SET_DECK`): quem cria a mesa
   * pelo painel nao precisa mais decidir o deck antes de ver quem sentou.
   */
  deckId?: string;
}

/** Rejeicoes possiveis no handshake. DOC-031 §2.1. */
export const HANDSHAKE_ERRORS = [
  'INVALID_TOKEN',
  'TOKEN_EXPIRED',
  'TOKEN_ALREADY_USED',
  'ROOM_FULL',
  'ROOM_CLOSED',
  'PLAYER_BLOCKED',
] as const;
export type HandshakeError = (typeof HANDSHAKE_ERRORS)[number];

/** Parametros do canal de tempo real. DOC-031 §2.2. */
export const REALTIME_LIMITS = {
  /** Taxa de envio de patches, em ms (20 Hz). */
  PATCH_RATE_MS: 50,
  HEARTBEAT_MS: 15_000,
  CONNECTION_TIMEOUT_MS: 45_000,
  /** Janela de reconexao, em segundos (RN10). */
  RECONNECTION_WINDOW_S: 90,
  /** Intencoes por segundo, por cliente. Excedente e descartado com `warning`. */
  MAX_INTENTS_PER_SECOND: 30,
  /** Intencoes sao pequenas por natureza. Acima disto, fecha a conexao. */
  MAX_MESSAGE_BYTES: 4096,
  /** TTL do lock de arraste, em ms (FR-10). */
  DRAG_LOCK_TTL_MS: 5_000,
  /** Throttle do cliente durante o arraste. */
  CLIENT_DRAG_THROTTLE_PER_SECOND: 20,
  /** Validade do peekBuffer. Buffer eterno travaria o grimorio. */
  PEEK_TIMEOUT_MS: 120_000,
  /** Janela do INTENT_UNDO. */
  UNDO_WINDOW_MS: 10_000,

  /**
   * Teto de assentos de UMA sala.
   *
   * Era 4 — o tamanho de uma mesa de Commander — e a sala recusava o quinto
   * jogador antes mesmo de o anfitriao poder escolher. Formatos livres,
   * multiplayer caseiro e mesas de espectadores-jogadores pedem mais; o custo
   * de cada assento a mais e linear (uma faixa na mesa, uma reconciliacao de
   * visibilidade a mais por mutacao), e a 8 continua dentro do orcamento de
   * ~1.600 avaliacoes por reconciliacao completa que DOC-032 §7 dimensiona.
   */
  MAX_PLAYERS: 8,
  /** Assentos de uma sala recem-criada, quando ninguem escolhe. */
  DEFAULT_SEATS: 4,

  /**
   * Teto de ESPECTADORES de uma sala, alem dos assentos.
   *
   * Espectador nao ocupa assento e nao aparece em `state.players` — ele tem o
   * proprio mapa. O custo dele e bem menor que o de um jogador: nao tem zonas,
   * nao tem cartas, nao entra em nenhuma reconciliacao de visibilidade alem da
   * propria (e a dele e a mais barata que existe, porque nega tudo).
   *
   * O que ele custa e uma copia do patch a cada 50 ms. Dez e o numero em que
   * uma mesa de oito com plateia cheia continua dentro do orcamento de banda
   * que DOC-031 §2.2 dimensiona, e ja e mais gente do que qualquer mesa caseira
   * junta.
   */
  MAX_ESPECTADORES: 10,

  /**
   * SORTEIOS EM RAJADA (dado, moeda, jogador/carta ao acaso).
   *
   * Sem teto, segurar o botao do dado emitia 30 rolagens por segundo — dentro
   * do limite geral de intencoes, porque CADA UMA e uma intencao valida. Cada
   * rolagem faz um `broadcast` para a mesa inteira e uma entrada de log em
   * todos os clientes: e a unica familia de acoes em que uma pessoa sozinha
   * gera trabalho para todas as outras, sem tocar em estado nenhum.
   *
   * Cinco por janela cobre o uso real (rolar de novo, desempatar, "melhor de
   * tres") e corta a rajada.
   */
  MAX_SORTEIOS_POR_JANELA: 5,
  SORTEIO_JANELA_MS: 8_000,
} as const;

/**
 * Condicoes de derrota, aplicadas pelo servidor.
 *
 * O motor nasceu sem elas por decisao de projeto (RN01: sandbox, sem regras).
 * A decisao foi revertida: sem estes tres numeros, "21 de comandante" era um
 * contador vermelho que nao significava nada, e a mesa tinha de combinar de
 * viva-voz quem ja tinha perdido.
 */
export const DERROTA = {
  /** Vida neste valor ou abaixo. */
  VIDA_MINIMA: 0,
  /** Marcadores de veneno neste valor ou acima. */
  VENENO_LETAL: 10,
  /** Dano de comandante de UM MESMO oponente neste valor ou acima. */
  DANO_DE_COMANDANTE_LETAL: 21,
} as const;

/** Por que o jogador saiu do jogo. */
export const MOTIVOS_DE_DERROTA = ['LIFE', 'POISON', 'COMMANDER', 'DECKED', 'CONCEDED'] as const;
export type MotivoDeDerrota = (typeof MOTIVOS_DE_DERROTA)[number];
