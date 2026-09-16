/**
 * textureCache.ts — cache de texturas de carta (DOC-040 §4.2 camada 3).
 *
 * Um deck com 30 Mountains carrega UMA textura, não trinta.
 * A imagem não é requisitada para cartas em zona oculta (FR-23) — o cliente
 * nem tem o `scryfallId` delas.
 */

import { API_URL } from '@/lib/api';

/**
 * ─── O CACHE PRECISOU DE TETO ──────────────────────────────────────────────
 *
 * Ele era um `Map` que só crescia: `limparCache()` existia e nunca era chamado
 * durante a partida. Toda carta que APARECEU alguma vez ficava guardada, na
 * qualidade `normal` — e um bitmap `normal` decodificado ocupa em torno de
 * 750 x 1050 x 4 bytes, uns 3 MB de memória de vídeo, independente do tamanho
 * em disco.
 *
 * Numa mesa de Commander com quatro jogadores são 400 cartas distintas, mais
 * fichas e as cartas que passaram por cemitério e exílio. Algumas centenas de
 * entradas × 3 MB chega facilmente à casa do gigabyte — e o sintoma disso não é
 * um erro: é a aba ficar cada vez mais lenta e depois travar, depois de tempo
 * suficiente de jogo. O relato foi exatamente esse, "depois de uns 15 minutos o
 * jogo trava", numa partida que dura três ou quatro horas.
 *
 * ─── POR QUE LRU, E POR QUE ESTE TAMANHO ───────────────────────────────────
 *
 * O que está na tela AGORA é um punhado de cartas; o resto é histórico. Um teto
 * com descarte do menos usado recentemente mantém exatamente o conjunto quente
 * e devolve o resto ao coletor.
 *
 * 300 entradas cobre com folga o que uma mesa cheia mostra ao mesmo tempo
 * (campo, mão, topos de pilha, o inspetor) e ainda segura o histórico recente,
 * sem nunca virar o gigabyte. Descartar não perde nada de verdade: a imagem
 * volta do cache do NAVEGADOR, que continua valendo — a resposta tem `immutable`
 * e ETag —, então o custo de um descarte errado é uma decodificação, não um
 * download.
 */
const TETO_DE_TEXTURAS = 300;

/**
 * `Map` preserva a ordem de inserção, e é isso que o torna um LRU pronto:
 * reinserir uma chave a manda para o fim, e a primeira chave do iterador é
 * sempre a menos usada recentemente.
 */
const cache = new Map<string, HTMLImageElement>();

type Quality = 'small' | 'normal' | 'art_crop' | 'large';
export type Face = 'front' | 'back';

/**
 * URL da arte da carta — servida pelo NOSSO backend, não pela CDN da Scryfall.
 *
 * POR QUE NÃO VAI MAIS DIRETO NA CDN
 *
 * `cards.scryfall.io` é o caminho ideal — CDN global, custo zero para nós — e é
 * exatamente o que some numa rede que filtra domínios: a mesa monta, o estado
 * sincroniza, e toda carta aparece em branco. Parece bug de render; é firewall.
 *
 * Apontando para `GET /cards/img/:id`, o único domínio que o navegador precisa
 * alcançar é o da própria API, que responde com `immutable` e ETag — o cache do
 * navegador continua funcionando igual.
 *
 * A separação `front/`/`back/` continua importando: uma carta de dupla face tem
 * as DUAS artes sob o mesmo id, e sem isso o `INTENT_TRANSFORM` viraria um
 * booleano no servidor sem nada mudar na tela.
 */
export function cardImageUrl(
  scryfallId: string,
  quality: Quality = 'small',
  face: Face = 'front',
): string {
  return `${API_URL}/cards/img/${scryfallId}?quality=${quality}&face=${face}`;
}

/**
 * O VERSO NÃO VEM MAIS DA WOTC.
 *
 * Este arquivo carregava `https://back.scryfall.io/large/back.jpg` — o verso
 * oficial das cartas de Magic — para toda carta oculta da mesa. DOC-060 §2.1 é
 * explícito: essa arte é propriedade da Hasbro/WotC e não deve ser usada nem
 * como padrão nem como item de catálogo. O verso agora é o SLEEVE do jogador,
 * desenhado proceduralmente em `cosmetics/render.ts`.
 */

/**
 * Retorna a HTMLImageElement para um `scryfallId`.
 *
 * Se não estiver em cache, cria e registra imediatamente, para que todas as
 * chamadas seguintes compartilhem a mesma instância — é isso que faz trinta
 * Mountains custarem um download.
 */
export function getTexture(
  scryfallId: string,
  quality: Quality = 'small',
  face: Face = 'front',
): HTMLImageElement {
  const cacheKey = `${scryfallId}:${quality}:${face}`;
  const emCache = cache.get(cacheKey);
  if (emCache) {
    // Reinserir move a chave para o fim da ordem: é o "usado recentemente" do
    // LRU, e custa um delete mais um set.
    cache.delete(cacheKey);
    cache.set(cacheKey, emCache);
    return emCache;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = cardImageUrl(scryfallId, quality, face);
  cache.set(cacheKey, img);

  /**
   * Descarta as mais antigas até caber.
   *
   * `while` e não `if` porque o teto pode ter sido baixado entre duas chamadas
   * — e porque um laço que termina sozinho é mais fácil de conferir do que uma
   * condição que assume que o cache cresce de um em um.
   *
   * ─── O DESCARTE SOLTA A REFERÊNCIA E NÃO MEXE NA IMAGEM ──────────────────
   *
   * A tentação é cancelar um download em andamento (`img.src = ''`) para não
   * gastar banda com uma imagem que "ninguém mais vai desenhar". É errado, e o
   * erro é caro: sair do cache NÃO significa sair da tela. Um nó do Konva pode
   * estar segurando aquela mesma instância, e cancelar o carregamento dela
   * deixaria a carta em branco PARA SEMPRE — nada reemite o pedido enquanto
   * aquele nó não for reconstruído.
   *
   * Soltar a referência e deixar o download terminar custa uma imagem de banda
   * no pior caso, e ainda por cima aquece o cache do navegador. A imagem é
   * coletada quando ninguém mais a segurar, que é exatamente o comportamento
   * desejado.
   */
  while (cache.size > TETO_DE_TEXTURAS) {
    const maisAntiga = cache.keys().next();
    if (maisAntiga.done) break;
    cache.delete(maisAntiga.value);
  }

  return img;
}

/** Quantas texturas estão guardadas. Só para teste e diagnóstico. */
export function tamanhoDoCache(): number {
  return cache.size;
}

/** Limpa o cache (testes / memória). */
export function limparCache() {
  cache.clear();
}
