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
const TTL_CARTA_MS = 12 * 60 * 60 * 1000;
const TTL_BUSCA_MS = 10 * 60 * 1000;

/**
 * DOIS BALDES, E NÃO UM.
 *
 * Carta e busca dividiam o mesmo LRU de 500 entradas. Um deck de Commander
 * hidratado ocupa 100 delas; o deckbuilder gera uma entrada por tecla digitada
 * (com `unique=prints`, cada busca guarda até 20 cartas num objeto só). Meia
 * dúzia de buscas empurrava o deck inteiro para fora do cache, e a próxima
 * abertura do grimório voltava a pagar dois round-trips na Scryfall — o cache
 * existia e não segurava justamente o dado que mais se relê.
 *
 * Separados, uma busca nunca expulsa uma carta. O teto de cartas é generoso
 * porque a entrada é pequena (~3 KB) e o ganho é grande: 6.000 impressões
 * cobrem o catálogo ativo de uma mesa cheia por várias partidas.
 */
const MAX_CARTAS = 6000;
const MAX_BUSCAS = 300;

interface Entrada<T> {
  valor: T;
  expiraEm: number;
}

@Injectable()
export class CardsService {
  private readonly logger = new Logger(CardsService.name);
  /** Impressões por id — o dado imutável, guardado com folga. */
  private readonly cartas = new Map<string, Entrada<unknown>>();
  /** Buscas e autocomplete — voláteis, e nunca disputam espaço com as cartas. */
  private readonly buscas = new Map<string, Entrada<unknown>>();

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

  /**
   * Esvazia os dois baldes. Devolve quantas entradas saíram.
   *
   * Existe para o botão do painel administrativo (DOC-061 §5): depois dos
   * spoilers de uma coleção, o que atrapalha é uma entrada ANTIGA ainda válida
   * por TTL — a carta nova chega na primeira consulta, mas a errata da antiga
   * espera 12 horas. Sem isto, a única forma de forçar a releitura era
   * reiniciar a API.
   */
  esvaziarCache(): number {
    const total = this.cartas.size + this.buscas.size;
    this.cartas.clear();
    this.buscas.clear();
    this.logger.warn(`Cache de cartas esvaziado: ${total} entradas removidas.`);
    return total;
  }

  // ─── Cache ─────────────────────────────────────────────────────────────────

  private async memo<T>(chave: string, ttl: number, produzir: () => Promise<T>): Promise<T> {
    const cacheado = this.ler<T>(chave);
    if (cacheado !== undefined) return cacheado;

    const valor = await produzir();
    this.gravar(chave, valor, ttl);
    return valor;
  }

  /** O balde de uma chave. `card:` é impressão; todo o resto é volátil. */
  private balde(chave: string): { mapa: Map<string, Entrada<unknown>>; teto: number } {
    return chave.startsWith('card:')
      ? { mapa: this.cartas, teto: MAX_CARTAS }
      : { mapa: this.buscas, teto: MAX_BUSCAS };
  }

  private ler<T>(chave: string): T | undefined {
    const { mapa } = this.balde(chave);
    const entrada = mapa.get(chave);
    if (!entrada) return undefined;
    if (Date.now() > entrada.expiraEm) {
      mapa.delete(chave);
      return undefined;
    }
    // Renova a posição na LRU.
    mapa.delete(chave);
    mapa.set(chave, entrada);
    return entrada.valor as T;
  }

  private gravar(chave: string, valor: unknown, ttl: number): void {
    const { mapa, teto } = this.balde(chave);
    mapa.set(chave, { valor, expiraEm: Date.now() + ttl });
    while (mapa.size > teto) {
      const maisAntiga = mapa.keys().next();
      if (maisAntiga.done) break;
      mapa.delete(maisAntiga.value);
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
