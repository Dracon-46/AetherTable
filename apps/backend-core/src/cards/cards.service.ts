import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ScryfallClient,
  ScryfallError,
  type CardIdentifier,
  type CollectionResponse,
  type ScryfallCard,
} from '@aethertable/scryfall-client';
import { SCRYFALL_CLIENT } from './scryfall.provider.js';

/**
 * cards.service.ts — espelho da API JSON da Scryfall.
 *
 * O deckbuilder, o seletor de impressão, o painel de fichas e a hidratação do
 * catálogo chamavam `api.scryfall.com` DIRETO do navegador. Além de quebrar em
 * rede filtrada, isso furava duas regras de uma vez (DOC-035 §3): cada aba
 * virava um cliente sem fila de 100 ms e sem User-Agent identificável.
 *
 * Aqui tudo passa pelo `ScryfallClient` — uma fila, um User-Agent, um backoff.
 */

/** Cartas não mudam. O que muda é o catálogo, e devagar. */
const TTL_CARTA_MS = 60 * 60 * 1000;
const TTL_BUSCA_MS = 10 * 60 * 1000;
const MAX_ENTRADAS = 500;

interface Entrada<T> {
  valor: T;
  expiraEm: number;
}

@Injectable()
export class CardsService {
  private readonly logger = new Logger(CardsService.name);
  private readonly cache = new Map<string, Entrada<unknown>>();

  constructor(@Inject(SCRYFALL_CLIENT) private readonly scryfall: ScryfallClient) {}

  search(query: string, unique?: string, page?: number, order?: string, dir?: string) {
    const chave = `search:${query}:${unique ?? ''}:${page ?? 1}:${order ?? ''}:${dir ?? ''}`;
    return this.memo(chave, TTL_BUSCA_MS, () =>
      this.traduzirErros(() => this.scryfall.search(query, { unique, page, order, dir })),
    );
  }

  autocomplete(query: string) {
    return this.memo(`ac:${query}`, TTL_BUSCA_MS, () =>
      this.traduzirErros(() => this.scryfall.autocomplete(query)),
    );
  }

  cardById(scryfallId: string) {
    return this.memo(`card:${scryfallId}`, TTL_CARTA_MS, () =>
      this.traduzirErros(() => this.scryfall.cardById(scryfallId)),
    );
  }

  /**
   * `POST /cards/collection` — a hidratação do catálogo da mesa.
   *
   * Responde do cache carta a carta e só pergunta à Scryfall o que falta. Numa
   * partida em que todo mundo joga o mesmo staple, a segunda mesa do dia não
   * gera requisição nenhuma.
   */
  async collection(identifiers: CardIdentifier[]): Promise<CollectionResponse> {
    const resposta: CollectionResponse = { data: [], not_found: [] };
    const faltando: CardIdentifier[] = [];

    for (const identifier of identifiers) {
      const cacheado = identifier.id ? this.ler<ScryfallCard>(`card:${identifier.id}`) : undefined;
      if (cacheado) resposta.data.push(cacheado);
      else faltando.push(identifier);
    }

    if (faltando.length > 0) {
      const nova = await this.traduzirErros(() => this.scryfall.collection(faltando));
      for (const carta of nova.data) {
        this.gravar(`card:${carta.id}`, carta, TTL_CARTA_MS);
        resposta.data.push(carta);
      }
      resposta.not_found.push(...nova.not_found);
    }

    return resposta;
  }

  // ─── Cache ─────────────────────────────────────────────────────────────────

  private async memo<T>(chave: string, ttl: number, produzir: () => Promise<T>): Promise<T> {
    const cacheado = this.ler<T>(chave);
    if (cacheado !== undefined) return cacheado;

    const valor = await produzir();
    this.gravar(chave, valor, ttl);
    return valor;
  }

  private ler<T>(chave: string): T | undefined {
    const entrada = this.cache.get(chave);
    if (!entrada) return undefined;
    if (Date.now() > entrada.expiraEm) {
      this.cache.delete(chave);
      return undefined;
    }
    // Renova a posição na LRU.
    this.cache.delete(chave);
    this.cache.set(chave, entrada);
    return entrada.valor as T;
  }

  private gravar(chave: string, valor: unknown, ttl: number): void {
    this.cache.set(chave, { valor, expiraEm: Date.now() + ttl });
    while (this.cache.size > MAX_ENTRADAS) {
      const maisAntiga = this.cache.keys().next();
      if (maisAntiga.done) break;
      this.cache.delete(maisAntiga.value);
    }
  }

  /**
   * Converte o erro do cliente em HTTP.
   *
   * O `ScryfallClient` já garante que um 429 nunca chega cru aqui — ele vira
   * 503 depois do backoff. O que resta é traduzir o resto sem vazar detalhe do
   * provedor para o navegador.
   */
  private async traduzirErros<T>(acao: () => Promise<T>): Promise<T> {
    try {
      return await acao();
    } catch (erro) {
      if (erro instanceof ScryfallError) {
        if (erro.code === 'NOT_FOUND') throw new NotFoundException('Carta não encontrada.');
        if (erro.code === 'INVALID_QUERY') throw new BadRequestException('Busca malformada.');
        this.logger.warn(`Scryfall indisponível (${erro.status}): ${erro.message}`);
        throw new ServiceUnavailableException('Provedor de cartas indisponível.');
      }

      // Sem este log, uma rede que bloqueia `api.scryfall.com` no SERVIDOR
      // aparece para o usuário como um 503 genérico e para nós como nada.
      this.logger.error(`Falha inesperada ao falar com a Scryfall: ${String(erro)}`);
      throw new ServiceUnavailableException('Provedor de cartas indisponível.');
    }
  }
}
