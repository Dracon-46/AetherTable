import type { Zone } from './zones';

/**
 * Uma carta instanciada em uma partida.
 *
 * PRINCIPIO CENTRAL (docs/modelo_de_dados.md §1.2): nao guardamos texto, regras
 * nem imagem de carta. So o `scryfallId`. O frontend hidrata a partir da Scryfall
 * ou do `card_cache`.
 *
 * `scryfallId` e OPCIONAL neste tipo de proposito: para um cliente sem direito de
 * ver a carta, o campo simplesmente NAO foi serializado pelo servidor (`@filter`).
 * Nao esta escondido nem zerado — nunca existiu no pacote.
 * Fonte canonica: docs/especificacao_do_motor_sandbox.md §3.
 */
export interface ICard {
  /** UUID desta carta NESTA partida. Nao tem relacao com a identidade da carta. */
  id: string;
  /** Dono do deck. NUNCA muda. */
  ownerId: string;
  /** Quem manipula agora (RN08). Transferivel por INTENT_SET_CONTROLLER. */
  controllerId: string;
  zone: Zone;

  /**
   * Identidade da carta. `undefined` quando o cliente nao tem direito de ver.
   * Ver `podeVer()` no game-server e a tabela de decisao em DOC-032 §4.1.
   */
  scryfallId?: string;

  /** 'ALL' | 'sid1,sid2'. Persistente ate troca de zona (RN13). */
  revealedTo: string;
  /** 'sid1,sid2'. Transitorio: fechar painel, timeout de 120 s ou troca de zona. */
  peekedBy: string;

  x: number;
  y: number;
  /** 0 = normal, 90 = virada, 180 = invertida. */
  rotation: number;
  zIndex: number;

  isTapped: boolean;
  /** morph / manifest / disguise / exilio oculto. */
  faceDown: boolean;
  /** Marcador visual — o motor nao impoe efeito (RN01). */
  phasedOut: boolean;
  isToken: boolean;
  isCopy: boolean;
  /** DFC mostrando a face de tras. */
  isFlipped: boolean;

  /** sessionId de quem arrasta (FR-10). Vazio = livre. TTL de 5 s. */
  lockedBy: string;
  /** Equipamento / aura anexada a outra carta. O grupo se move junto. */
  attachedTo: string;
  /** Agrupa o exilio pela carta que exilou. */
  exiledBy: string;
  goadedBy: string;

  /** Anotacao livre do jogador, max. 120 caracteres, sanitizada. */
  note: string;
  highlight: string;

  /** Dano marcado — distinto de marcadores -1/-1. */
  damage: number;
  powerOverride: number;
  toughnessOverride: number;

  /**
   * Contadores com chave STRING LIVRE, nao enum: Magic tem 100+ tipos nomeados e
   * cada colecao adiciona outros (DOC-036 §5.1). Chave: /^[a-z0-9_+\-]{1,24}$/.
   */
  counters: Record<string, number>;
}

/** O que um cliente sem direito de ver recebe de uma carta em zona oculta. */
export type MaskedCard = Omit<ICard, 'scryfallId'>;

/** Proporcao real da carta: 63 x 88 mm. DOC-041 §2.4. */
export const CARD_ASPECT_RATIO = 0.716;
export const CARD_BASE_WIDTH = 100;
export const CARD_BASE_HEIGHT = 140;

/** Formato da chave de contador aceito pelo servidor. */
export const COUNTER_NAME_PATTERN = /^[a-z0-9_+-]{1,24}$/;
