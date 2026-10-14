/**
 * colecoes.ts — as coleções que dá para draftar, e de onde vêm as cartas.
 *
 * As cartas saem da busca da Scryfall pela API (`set:X is:booster`: só o que
 * vem em pacote, sem as cartas de deck pronto da mesma coleção). Uma coleção
 * tem de 250 a 400 cartas — duas ou três páginas de busca, uma vez por draft.
 */

import { buscar } from '../desafios/cartas';
import type { CartaDeDraft } from './motor';

/** Coleções recentes com pacote de draft. A mais nova primeiro. */
export const COLECOES_DE_DRAFT = [
  { codigo: 'tdm', nome: 'Tarkir: Dragonstorm' },
  { codigo: 'dft', nome: 'Aetherdrift' },
  { codigo: 'fdn', nome: 'Foundations' },
  { codigo: 'dsk', nome: 'Duskmourn: House of Horror' },
  { codigo: 'blb', nome: 'Bloomburrow' },
  { codigo: 'otj', nome: 'Outlaws of Thunder Junction' },
  { codigo: 'mkm', nome: 'Murders at Karlov Manor' },
  { codigo: 'lci', nome: 'The Lost Caverns of Ixalan' },
  { codigo: 'woe', nome: 'Wilds of Eldraine' },
] as const;

const POR_PAGINA = 175;
const MAX_PAGINAS = 4;

export async function carregarColecao(codigo: string): Promise<CartaDeDraft[]> {
  const todas: CartaDeDraft[] = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const cartas = (await buscar(`set:${codigo} is:booster game:paper`, {
      pagina,
      ordem: 'set',
    })) as unknown as CartaDeDraft[];
    todas.push(...cartas);
    if (cartas.length < POR_PAGINA) break;
  }
  return todas;
}

export const NOME_DO_BASICO: Record<string, string> = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest',
  C: 'Wastes',
};

/**
 * A lista no formato do importador: "1 Nome (SET)" mantém a impressão daquela
 * coleção, e a reserva vai na seção "Sideboard".
 */
export function listaDoDeck(
  deck: readonly CartaDeDraft[],
  reserva: readonly CartaDeDraft[],
  basicos: Record<string, number>,
  codigo: string,
): string {
  const agrupar = (cartas: readonly CartaDeDraft[]) => {
    const conta = new Map<string, { n: number; c: CartaDeDraft }>();
    for (const c of cartas) {
      const atual = conta.get(c.name);
      if (atual) atual.n += 1;
      else conta.set(c.name, { n: 1, c });
    }
    return [...conta.values()].map(
      ({ n, c }) => `${n} ${c.name} (${(c.set ?? codigo).toUpperCase()})`,
    );
  };
  const terrenos = Object.entries(basicos)
    .filter(([, n]) => n > 0)
    // Wastes não existe em coleção nenhuma de draft: vai sem coleção.
    .map(([cor, n]) =>
      cor === 'C' ? `${n} Wastes` : `${n} ${NOME_DO_BASICO[cor]} (${codigo.toUpperCase()})`,
    );
  const linhas = [...agrupar(deck), ...terrenos];
  if (reserva.length) linhas.push('', 'Sideboard', ...agrupar(reserva));
  return linhas.join('\n');
}
