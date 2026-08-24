/**
 * textureCache.ts — Cache de texturas de carta (DOC-040 §4.2 camada 3).
 * 
 * Um deck com 30 Mountains carrega UMA textura, não trinta.
 * A imagem não é requisitada para cartas na LIBRARY (FR-23).
 */

const cache = new Map<string, HTMLImageElement>();

type Quality = 'small' | 'normal' | 'art_crop' | 'large';

/** URL da imagem no CDN do Scryfall */
export function scryfallImageUrl(scryfallId: string, quality: Quality = 'small'): string {
  return `https://cards.scryfall.io/${quality}/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.jpg`;
}

/** Verso padrão para cartas ocultas */
export const CARD_BACK_URL = 'https://back.scryfall.io/large/back.jpg';

/**
 * Retorna a HTMLImageElement decodificada para um scryfallId.
 * Se não estiver em cache, cria e coloca em cache imediatamente,
 * para que todas as chamadas subsequentes compartilhem a mesma instância.
 */
export function getTexture(scryfallId: string, quality: Quality = 'small'): HTMLImageElement {
  const cacheKey = `${scryfallId}:${quality}`;
  let img = cache.get(cacheKey);
  if (!img) {
    img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = scryfallImageUrl(scryfallId, quality);
    cache.set(cacheKey, img);
  }
  return img;
}

/** Verso da carta — um único asset para toda a mesa */
let cardBackCache: HTMLImageElement | null = null;
export function getCardBack(): HTMLImageElement {
  if (!cardBackCache) {
    cardBackCache = new Image();
    cardBackCache.crossOrigin = 'anonymous';
    cardBackCache.src = CARD_BACK_URL;
  }
  return cardBackCache;
}

/** Pré-carrega o verso para evitar flash na primeira compra */
export function preaquecer() {
  getCardBack();
}

/** Limpa o cache (testes / memória) */
export function limparCache() {
  cache.clear();
  cardBackCache = null;
}
