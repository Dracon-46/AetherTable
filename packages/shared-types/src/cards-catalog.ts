/**
 * Tipos do dominio "carta persistida" — decks e cache da Scryfall.
 * Fonte canonica: docs/modelo_de_dados.md §3.
 *
 * PRINCIPIO: nao armazenamos texto, regra nem imagem de carta. So o
 * `scryfallId`, que e a referencia ABSOLUTA de impressao (arte, edicao, idioma).
 */

export const BOARD_TYPES = [
  'MAIN',
  'SIDEBOARD',
  'COMMANDER',
  'MAYBEBOARD',
  'SIGNATURE_SPELL',
  'CUBE',
  'PLANAR',
  'SCHEME',
  'VANGUARD',
  'ATTRACTION',
  'CONTRAPTION',
  'STICKER',
] as const;
export type BoardType = (typeof BOARD_TYPES)[number];

/** Item de deck. Exatamente o que FR-04 exige — nada de nome ou imagem aqui. */
export interface IDeckCard {
  id: string;
  deckId: string;
  scryfallId: string;
  /** 1..99. */
  quantity: number;
  isCommander: boolean;
  boardType: BoardType;
  sortOrder: number;
}

export interface IDeck {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  commanderId?: string | null;
  /** Segundo comandante (Partner / Background). */
  partnerId?: string | null;
  /**
   * Referencia `FormatPreset.id`. NAO e enum: ha 45+ formatos e novos surgem a
   * cada colecao. Presets vivem versionados no codigo (DOC-037 §9.1).
   */
  formatId: string;
  isPublic: boolean;
  isFavorite: boolean;
  /** Desnormalizado: soma de `quantity`, para listar sem JOIN. */
  cardCount: number;
  colorIdentity: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Cache derivavel da Scryfall. Tabela DESCARTAVEL: um TRUNCATE nao perde nada
 * de valor — o job de bulk data a reconstroi.
 */
export interface ICardCache {
  scryfallId: string;
  oracleId: string;
  name: string;
  setCode: string;
  collectorNum: string;
  lang: string;
  cmc: number;
  typeLine: string;
  manaCost: string;
  colorIdentity: string[];
  legalCommander: boolean;
  layout: string;
  imageSmall: string;
  imageNormal: string;
  /** Faces de DFC / split / adventure. */
  faces: unknown;
  fetchedAt: string;
}

export const USER_ROLES = ['USER', 'MOD', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const OAUTH_PROVIDERS = ['GOOGLE', 'DISCORD'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export interface IUser {
  id: string;
  email: string;
  /** /^[a-zA-Z0-9_]{3,32}$/ */
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  role: UserRole;
  createdAt: string;
}

/** /^[a-zA-Z0-9_]{3,32}$/ — validacao compartilhada frontend/backend. */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,32}$/;
