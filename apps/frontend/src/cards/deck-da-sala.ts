/**
 * deck-da-sala.ts — qual deck o jogador escolheu para esta sala.
 *
 * O servidor sabe (é ele quem monta o grimório), mas não manda a lista ao
 * cliente — e não deve: o grimório é informação oculta. O que o cliente
 * precisa é só o ID do próprio deck, para pedir a lista à API como já faz o
 * deckbuilder, e isso ele mesmo escolheu (no painel ou na sala de espera).
 *
 * `sessionStorage` e não `localStorage`: a escolha vale para a aba e para a
 * sala; numa sala nova, outro deck. Chave pelo CÓDIGO da sala, que é o que o
 * painel conhece antes de a conexão existir.
 */

const chave = (codigo: string) => `aether-deck-da-sala:${codigo.toUpperCase()}`;

export function lembrarDeckDaSala(codigo: string, deckId: string): void {
  if (!codigo || !deckId) return;
  try {
    sessionStorage.setItem(chave(codigo), deckId);
  } catch {
    /* aba privada sem storage: só perde a lista de fichas do deck */
  }
}

export function deckDaSala(codigo: string): string | null {
  if (!codigo) return null;
  try {
    return sessionStorage.getItem(chave(codigo));
  } catch {
    return null;
  }
}
