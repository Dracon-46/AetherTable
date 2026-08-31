/**
 * textureCache.ts — cache de texturas de carta (DOC-040 §4.2 camada 3).
 *
 * Um deck com 30 Mountains carrega UMA textura, não trinta.
 * A imagem não é requisitada para cartas em zona oculta (FR-23) — o cliente
 * nem tem o `scryfallId` delas.
 */

const cache = new Map<string, HTMLImageElement>();

type Quality = 'small' | 'normal' | 'art_crop' | 'large';
export type Face = 'front' | 'back';

/**
 * URL da imagem na CDN da Scryfall.
 *
 * A CDN separa `front/` e `back/`: uma carta de dupla face tem as DUAS imagens
 * sob o mesmo id. O código anterior só conhecia `front`, e por isso
 * `INTENT_TRANSFORM` alternava um booleano no servidor sem que nada mudasse na
 * tela — o jogador virava a carta e via a mesma face.
 */
export function scryfallImageUrl(
  scryfallId: string,
  quality: Quality = 'small',
  face: Face = 'front',
): string {
  return `https://cards.scryfall.io/${quality}/${face}/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.jpg`;
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
  let img = cache.get(cacheKey);
  if (!img) {
    img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = scryfallImageUrl(scryfallId, quality, face);
    cache.set(cacheKey, img);
  }
  return img;
}

/** Limpa o cache (testes / memória). */
export function limparCache() {
  cache.clear();
}
