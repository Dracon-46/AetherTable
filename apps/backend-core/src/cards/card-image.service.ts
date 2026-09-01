import { Injectable, Logger } from '@nestjs/common';

/**
 * card-image.service.ts — espelho da CDN de imagens da Scryfall.
 *
 * POR QUE ISTO EXISTE
 *
 * Até aqui o navegador buscava a arte direto em `cards.scryfall.io`. Isso é o
 * ideal — CDN global, custo zero para nós — e é exatamente o que quebra numa
 * rede que filtra domínios: a mesa monta, o estado sincroniza, e toda carta
 * aparece em branco. O sintoma parece bug de render; a causa é o firewall.
 *
 * Com o proxy, o único domínio que o navegador precisa alcançar é o da própria
 * API. Se a API roda fora da rede filtrada (Render, Fly, um VPS), a arte volta.
 *
 * O QUE ESTE SERVIÇO NÃO É
 *
 * Não é um proxy genérico. A URL de destino é MONTADA aqui a partir de um UUID
 * validado — nunca recebida do cliente. Sem isso, a rota seria um open proxy:
 * qualquer pessoa mandaria o servidor buscar qualquer endereço, inclusive a
 * rede interna do host.
 */

/** Ids da Scryfall são UUID v4. Qualquer outra coisa não vira URL. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const QUALIDADES = ['small', 'normal', 'large', 'art_crop'] as const;
export const FACES = ['front', 'back'] as const;

export type Qualidade = (typeof QUALIDADES)[number];
export type Face = (typeof FACES)[number];

export interface ImagemDeCarta {
  corpo: Buffer;
  tipo: string;
  etag: string;
}

/** Orçamento do cache em memória. O plano gratuito do Render tem 512 MB. */
const ORCAMENTO_MB = Number(process.env.CARD_IMAGE_CACHE_MB ?? 64);
const ORCAMENTO_BYTES = Math.max(8, ORCAMENTO_MB) * 1024 * 1024;

/**
 * Teto de requisições simultâneas à CDN.
 *
 * Uma mesa de quatro jogadores abre umas cem imagens de uma vez no primeiro
 * render. Sem limite, o servidor dispara cem sockets ao mesmo tempo e a própria
 * CDN começa a recusar.
 */
const MAX_SIMULTANEAS = 8;

/** Uma carta de face única devolve 404 em `/back/`. Não vale repetir a pergunta. */
const TTL_NEGATIVO_MS = 10 * 60 * 1000;

const TIMEOUT_MS = 10_000;

@Injectable()
export class CardImageService {
  private readonly logger = new Logger(CardImageService.name);
  private readonly baseUrl =
    process.env.SCRYFALL_IMAGE_URL?.trim().replace(/\/+$/, '') || 'https://cards.scryfall.io';

  /**
   * Cache LRU por ordem de inserção do `Map`: o primeiro item é o mais antigo,
   * e reinserir no acerto o manda para o fim. Um deck com trinta Montanhas
   * ocupa uma entrada, não trinta.
   */
  private readonly cache = new Map<string, ImagemDeCarta>();
  private bytesEmCache = 0;

  /** 404 recentes, para não perguntar de novo. */
  private readonly ausentes = new Map<string, number>();

  /**
   * Buscas em curso. Sem isto, as trinta Montanhas que chegam no mesmo
   * milissegundo viram trinta downloads — o cache só ajuda a partir do segundo
   * render.
   */
  private readonly emVoo = new Map<string, Promise<ImagemDeCarta | null>>();

  private ativas = 0;
  private readonly fila: Array<() => void> = [];

  /** Valida e normaliza os parâmetros da rota. `null` = pedido inválido. */
  static validar(
    scryfallId: string,
    qualidade: string | undefined,
    face: string | undefined,
  ): { id: string; qualidade: Qualidade; face: Face } | null {
    if (!UUID_RE.test(scryfallId)) return null;

    const q = (qualidade ?? 'normal') as Qualidade;
    const f = (face ?? 'front') as Face;

    if (!QUALIDADES.includes(q)) return null;
    if (!FACES.includes(f)) return null;

    return { id: scryfallId.toLowerCase(), qualidade: q, face: f };
  }

  /**
   * Devolve a imagem, do cache ou da CDN. `null` quando a Scryfall não tem
   * aquela combinação — o caso normal de pedir o verso de uma carta comum.
   */
  async obter(id: string, qualidade: Qualidade, face: Face): Promise<ImagemDeCarta | null> {
    const chave = `${qualidade}:${face}:${id}`;

    const cacheado = this.cache.get(chave);
    if (cacheado) {
      // Reinsere: renova a posição na LRU.
      this.cache.delete(chave);
      this.cache.set(chave, cacheado);
      return cacheado;
    }

    const marcadaAusente = this.ausentes.get(chave);
    if (marcadaAusente !== undefined) {
      if (Date.now() - marcadaAusente < TTL_NEGATIVO_MS) return null;
      this.ausentes.delete(chave);
    }

    const jaEmVoo = this.emVoo.get(chave);
    if (jaEmVoo) return jaEmVoo;

    const promessa = this.baixar(chave, id, qualidade, face).finally(() => {
      this.emVoo.delete(chave);
    });
    this.emVoo.set(chave, promessa);
    return promessa;
  }

  private async baixar(
    chave: string,
    id: string,
    qualidade: Qualidade,
    face: Face,
  ): Promise<ImagemDeCarta | null> {
    // A URL é montada, nunca recebida: `id` já passou pelo regex de UUID.
    const url = `${this.baseUrl}/${qualidade}/${face}/${id[0]}/${id[1]}/${id}.jpg`;

    await this.entrarNaFila();
    try {
      const resposta = await fetch(url, {
        headers: {
          'User-Agent': process.env.SCRYFALL_USER_AGENT?.trim() || 'AetherTable/1.0',
          Accept: 'image/jpeg,image/*',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (resposta.status === 404) {
        this.ausentes.set(chave, Date.now());
        return null;
      }

      if (!resposta.ok) {
        this.logger.warn(`CDN da Scryfall respondeu ${resposta.status} para ${chave}`);
        return null;
      }

      const corpo = Buffer.from(await resposta.arrayBuffer());
      const imagem: ImagemDeCarta = {
        corpo,
        tipo: resposta.headers.get('content-type') ?? 'image/jpeg',
        // A arte de uma impressão nunca muda: a chave já identifica o conteúdo.
        etag: `"${chave}"`,
      };

      this.guardar(chave, imagem);
      return imagem;
    } catch (erro) {
      // Rede caiu, timeout, DNS: não é 404. Não entra na denylist, para que a
      // próxima tentativa (o próximo render) volte a perguntar.
      this.logger.warn(`Falha ao buscar ${chave} na CDN: ${(erro as Error).message}`);
      return null;
    } finally {
      this.sairDaFila();
    }
  }

  private guardar(chave: string, imagem: ImagemDeCarta): void {
    // Uma imagem sozinha maior que o orçamento inteiro esvaziaria o cache para
    // caber. Melhor servir e não guardar.
    if (imagem.corpo.byteLength > ORCAMENTO_BYTES / 4) return;

    this.cache.set(chave, imagem);
    this.bytesEmCache += imagem.corpo.byteLength;

    while (this.bytesEmCache > ORCAMENTO_BYTES) {
      const maisAntiga = this.cache.keys().next();
      if (maisAntiga.done) break;
      const removida = this.cache.get(maisAntiga.value);
      this.cache.delete(maisAntiga.value);
      this.bytesEmCache -= removida?.corpo.byteLength ?? 0;
    }
  }

  private entrarNaFila(): Promise<void> {
    if (this.ativas < MAX_SIMULTANEAS) {
      this.ativas += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.fila.push(() => {
        this.ativas += 1;
        resolve();
      });
    });
  }

  private sairDaFila(): void {
    this.ativas -= 1;
    this.fila.shift()?.();
  }

  /** Diagnóstico: quanto o espelho está segurando. */
  estatisticas() {
    return {
      entradas: this.cache.size,
      bytes: this.bytesEmCache,
      orcamentoBytes: ORCAMENTO_BYTES,
      ausentes: this.ausentes.size,
      emVoo: this.emVoo.size,
    };
  }

  /** Testes. */
  limpar(): void {
    this.cache.clear();
    this.ausentes.clear();
    this.bytesEmCache = 0;
  }
}
