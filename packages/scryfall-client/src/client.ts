import { request } from 'undici';
import { tracked } from './rate-limiter';

/**
 * Cliente unico da Scryfall.
 *
 * REGRA (DOC-035 §3): nenhum service chama `api.scryfall.com` direto. Passar por
 * cima daqui ignora a fila de 100 ms e o `User-Agent` — e a Scryfall bloqueia.
 * Imagens NAO passam por aqui: o browser busca direto na CDN, sob demanda.
 */

const BASE_URL = 'https://api.scryfall.com';

/** Limite do endpoint `POST /cards/collection`. */
export const MAX_IDENTIFIERS_PER_REQUEST = 75;

/** Backoff para 429, em ms. Depois de esgotar, viramos 503 para o cliente. */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000] as const;

export class ScryfallError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: 'NOT_FOUND' | 'INVALID_QUERY' | 'CARD_PROVIDER_UNAVAILABLE' | 'UNEXPECTED',
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ScryfallError';
  }
}

export interface ScryfallClientOptions {
  /**
   * Obrigatorio pela Scryfall. Formato:
   * `AetherTable/1.0 (+https://aethertable.app; contato@exemplo.com)`
   */
  userAgent: string;
  baseUrl?: string;
}

export interface CardIdentifier {
  id?: string;
  name?: string;
  set?: string;
}

/**
 * Recorte MINIMO da carta da Scryfall que usamos. Nao modelamos a resposta
 * inteira de proposito: o formato muda e nao guardamos texto de carta.
 */
export interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  set: string;
  collector_number: string;
  lang: string;
  cmc?: number;
  type_line?: string;
  mana_cost?: string;
  color_identity?: string[];
  layout: string;
  legalities?: Record<string, string>;
  image_uris?: { small?: string; normal?: string; large?: string };
  /**
   * ATENCAO (DOC-035 §2.2): cartas de dupla face NAO tem `image_uris` na raiz —
   * as imagens ficam aqui. Ignorar isso quebra o render de qualquer deck com MDFC.
   */
  card_faces?: Array<{
    name: string;
    type_line?: string;
    mana_cost?: string;
    image_uris?: { small?: string; normal?: string; large?: string };
  }>;
}

export interface CollectionResponse {
  data: ScryfallCard[];
  not_found: CardIdentifier[];
}

export class ScryfallClient {
  private readonly userAgent: string;
  private readonly baseUrl: string;

  constructor(options: ScryfallClientOptions) {
    if (!options.userAgent?.trim()) {
      // Falha cedo e alto: sem User-Agent a Scryfall bloqueia, e o sintoma
      // (cartas sem imagem) e dificil de rastrear ate aqui.
      throw new Error(
        'SCRYFALL_USER_AGENT ausente. A Scryfall exige User-Agent identificavel (DOC-035 §3).',
      );
    }
    this.userAgent = options.userAgent;
    this.baseUrl = options.baseUrl ?? BASE_URL;
  }

  /** `GET /cards/search?q=...` — sintaxe de query da Scryfall. */
  search(query: string, params: { unique?: string; page?: number } = {}) {
    const qs = new URLSearchParams({ q: query });
    if (params.unique) qs.set('unique', params.unique);
    if (params.page) qs.set('page', String(params.page));
    return this.get<{ data: ScryfallCard[]; has_more: boolean }>(`/cards/search?${qs}`);
  }

  /** `GET /cards/autocomplete?q=...` — ate 20 nomes. */
  async autocomplete(query: string): Promise<string[]> {
    const res = await this.get<{ data: string[] }>(
      `/cards/autocomplete?${new URLSearchParams({ q: query })}`,
    );
    return res.data;
  }

  /** `GET /cards/:id` — printing especifico. */
  cardById(scryfallId: string) {
    return this.get<ScryfallCard>(`/cards/${encodeURIComponent(scryfallId)}`);
  }

  /** Todas as impressoes de uma carta — alimenta o seletor de arte (F04). */
  printings(exactName: string) {
    return this.search(`!"${exactName}"`, { unique: 'prints' });
  }

  /**
   * `POST /cards/collection` — endpoint principal da importacao de decklist.
   * Fatia automaticamente em lotes de 75 e agrega o resultado.
   */
  async collection(identifiers: CardIdentifier[]): Promise<CollectionResponse> {
    const out: CollectionResponse = { data: [], not_found: [] };

    for (let i = 0; i < identifiers.length; i += MAX_IDENTIFIERS_PER_REQUEST) {
      const batch = identifiers.slice(i, i + MAX_IDENTIFIERS_PER_REQUEST);
      const res = await this.post<CollectionResponse>('/cards/collection', {
        identifiers: batch,
      });
      out.data.push(...res.data);
      out.not_found.push(...(res.not_found ?? []));
    }

    return out;
  }

  private get<T>(path: string): Promise<T> {
    return this.send<T>('GET', path);
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>('POST', path, body);
  }

  private async send<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let attempt = 0;

    for (;;) {
      const res = await tracked(() =>
        request(`${this.baseUrl}${path}`, {
          method,
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );

      const { statusCode } = res;

      if (statusCode === 200) {
        return (await res.body.json()) as T;
      }

      // Drena o corpo para nao vazar socket.
      const text = await res.body.text();

      // 404 nao falha o import inteiro: a linha volta como "nao encontrada".
      if (statusCode === 404) {
        throw new ScryfallError('Carta ou rota nao encontrada', 404, 'NOT_FOUND');
      }

      if (statusCode === 422) {
        throw new ScryfallError(`Query malformada: ${text.slice(0, 200)}`, 422, 'INVALID_QUERY');
      }

      const retryable = statusCode === 429 || statusCode >= 500;
      const backoff = BACKOFF_MS[attempt];

      if (retryable && backoff !== undefined) {
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }

      // Nunca repassar 429 cru ao usuario final (DOC-035 §3.1).
      throw new ScryfallError(
        'Provedor de cartas indisponivel',
        503,
        'CARD_PROVIDER_UNAVAILABLE',
        30,
      );
    }
  }
}

/**
 * Extrai a URL de imagem respeitando DFC: cartas de dupla face nao tem
 * `image_uris` na raiz.
 */
export function imageUrl(
  card: ScryfallCard,
  size: 'small' | 'normal' | 'large' = 'normal',
  faceIndex = 0,
): string | undefined {
  return card.image_uris?.[size] ?? card.card_faces?.[faceIndex]?.image_uris?.[size];
}
