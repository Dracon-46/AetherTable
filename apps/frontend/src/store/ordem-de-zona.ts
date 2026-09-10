/**
 * ordem-de-zona.ts — a ordem REAL das pilhas, e como lê-la.
 *
 * O servidor guarda a ordem de cada zona em `RoomState.zoneOrder`, um mapa de
 * `"<playerId>:<ZONA>"` para a lista de ids **com o topo no FIM** (DOC-032
 * §2): empilhar é `push`, comprar é `pop`. Até o espelhamento existir, o
 * cliente derivava "o topo" de `Object.values(cards).filter(...)`, que devolve
 * as cartas na ordem de INSERÇÃO NO MAPA — sem relação nenhuma com a pilha.
 * Na prática: o cemitério mostrava uma carta arbitrária como se fosse a
 * última que caiu, e o grimório idem.
 *
 * Estas funções são puras e ficam fora dos componentes de propósito: são o
 * único lugar onde a convenção "topo no fim" é interpretada, e dá para
 * testá-las sem montar a mesa.
 */

/** Uma carta, no mínimo que estas funções precisam saber dela. */
interface ComId {
  id: string;
}

/**
 * O id do topo da pilha, ou `undefined` se a zona está vazia (ou ainda não
 * chegou do servidor).
 */
export function idDoTopo(ordem: readonly string[] | undefined): string | undefined {
  return ordem && ordem.length > 0 ? ordem[ordem.length - 1] : undefined;
}

/**
 * Coloca as cartas na ordem da pilha, do TOPO para o FUNDO.
 *
 * Topo primeiro porque é assim que se fala de uma pilha ("a de cima do
 * cemitério") e é como o inspetor precisa mostrar: quem abre o cemitério
 * quer ver primeiro o que acabou de cair lá.
 *
 * Duas garantias que não são detalhe:
 *
 *   1. **nenhuma carta some.** `zoneOrder` chega por outro caminho de rede
 *      que o mapa `cards` e pode estar um quadro atrasado. Carta que está na
 *      zona mas ainda não na lista vai para o FIM, em vez de desaparecer da
 *      tela — some é pior que fora de ordem;
 *   2. **id na lista que não está na zona é ignorado.** O caso simétrico: a
 *      lista chegou antes de a carta mudar de zona.
 */
export function ordenarDoTopo<T extends ComId>(
  cartas: readonly T[],
  ordem: readonly string[] | undefined,
): T[] {
  if (!ordem || ordem.length === 0) return [...cartas];
  const porId = new Map(cartas.map((c) => [c.id, c]));
  const saida: T[] = [];
  for (let i = ordem.length - 1; i >= 0; i -= 1) {
    const id = ordem[i];
    if (id === undefined) continue;
    const c = porId.get(id);
    if (c) {
      saida.push(c);
      porId.delete(id);
    }
  }
  for (const c of cartas) if (porId.has(c.id)) saida.push(c);
  return saida;
}

/** A chave de `zoneOrder`. Existe para o formato não ser copiado à mão. */
export function chaveDaZona(dono: string, zona: string): string {
  return `${dono}:${zona}`;
}
