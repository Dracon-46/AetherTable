/**
 * textureCache.ts — cache de texturas de carta (DOC-040 §4.2 camada 3).
 *
 * Um deck com 30 Mountains carrega UMA textura, não trinta.
 * A imagem não é requisitada para cartas em zona oculta (FR-23) — o cliente
 * nem tem o `scryfallId` delas.
 */

import { API_URL } from '@/lib/api';

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
  let img = cache.get(cacheKey);
  if (!img) {
    img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = cardImageUrl(scryfallId, quality, face);
    cache.set(cacheKey, img);
  }
  return img;
}

/** Limpa o cache (testes / memória). */
export function limparCache() {
  cache.clear();
}
