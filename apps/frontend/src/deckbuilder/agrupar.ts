/**
 * agrupar.ts — organização da lista de cartas de um grimório.
 *
 * ─── POR QUE ISTO SAIU DO COMPONENTE ───────────────────────────────────────
 *
 * `getGroupedCards`, `calculatePowerBracket` e o `.sort()` da lista eram
 * funções declaradas DENTRO do componente e chamadas no corpo do render. Quer
 * dizer: a cada tecla digitada no campo de busca, a cada abrir de menu, a cada
 * atualização de qualquer estado, o deck de 100 cartas era reagrupado e
 * repontuado do zero.
 *
 * Pior que o custo: `deck.cards.sort(...)` ordena NO LUGAR. Estava mutando o
 * array que vinha do estado, durante o render — a fonte clássica de "a lista
 * muda de ordem sozinha" e, com o cache do react-query, de escrever por cima
 * de dado compartilhado.
 *
 * Aqui as funções são puras e recebem o que precisam, então o componente pode
 * envolvê-las em `useMemo` e elas ficam testáveis sem montar React.
 */

import { estimarBracket, rotuloDoBracket } from '@aethertable/shared-types';
import type { DeckCarta } from './useDecks';

/** Ordem em que os grupos aparecem. O resto vem depois, em ordem alfabética. */
const ORDEM_DOS_GRUPOS = [
  // Por tipo
  'Comandante',
  'Criaturas',
  'Planeswalkers',
  'Artefatos',
  'Encantamentos',
  'Mágicas',
  // Por custo — a curva precisa sair em ordem crescente, e não alfabética;
  // sem isto, "Custo 10" viria antes de "Custo 2".
  'Custo 0',
  'Custo 1',
  'Custo 2',
  'Custo 3',
  'Custo 4',
  'Custo 5',
  'Custo 6',
  'Custo 7+',
  'Custo desconhecido',
  // Por cor — mono primeiro na ordem WUBRG, depois as combinações.
  'Branco',
  'Azul',
  'Preto',
  'Vermelho',
  'Verde',
  'Incolor',
  // Terreno fecha os três cortes: é o rodapé natural de uma decklist.
  'Terrenos',
  'Outros',
];

/** Rótulo do grupo por linha de tipo. */
function grupoPorTipo(carta: DeckCarta): string {
  if (carta.boardType === 'COMMANDER') return 'Comandante';
  const t = carta.typeLine?.toLowerCase() ?? '';
  if (t.includes('creature')) return 'Criaturas';
  if (t.includes('land')) return 'Terrenos';
  if (t.includes('planeswalker')) return 'Planeswalkers';
  if (t.includes('artifact')) return 'Artefatos';
  if (t.includes('enchantment')) return 'Encantamentos';
  if (t.includes('instant') || t.includes('sorcery')) return 'Mágicas';
  return 'Outros';
}

/** Nome de cada cor, na ordem WUBRG — a ordem canônica de Magic. */
const NOME_DA_COR: Record<string, string> = {
  W: 'Branco',
  U: 'Azul',
  B: 'Preto',
  R: 'Vermelho',
  G: 'Verde',
};
const WUBRG = ['W', 'U', 'B', 'R', 'G'];

/**
 * Grupo por identidade de cor.
 *
 * Terreno sai fora do corte por cor de propósito: a base de mana de um deck
 * multicolor espalharia terrenos por cinco grupos e nenhum deles diria nada
 * útil sobre a cor do deck. Numa mesa de Commander, "quantos terrenos" é a
 * pergunta que se faz sobre eles, e ela precisa de um grupo só.
 */
function grupoPorCor(carta: DeckCarta): string {
  const t = carta.typeLine?.toLowerCase() ?? '';
  if (t.includes('land')) return 'Terrenos';

  const cores = (carta.colorIdentity ?? []).filter((c) => WUBRG.includes(c));
  if (cores.length === 0) return 'Incolor';
  if (cores.length === 1) return NOME_DA_COR[cores[0]!] ?? 'Incolor';
  if (cores.length >= 4) return `Multicolor (${cores.length})`;

  // Duas ou três cores: nomeia as duas/três, na ordem WUBRG, para o grupo ser
  // reconhecível ("Azul · Preto" e não "Preto · Azul", que é a mesma dupla).
  return WUBRG.filter((c) => cores.includes(c))
    .map((c) => NOME_DA_COR[c])
    .join(' · ');
}

/**
 * Grupo por custo convertido de mana.
 *
 * A curva é o que se olha aqui, então os degraus são de 1 até 6 e depois um
 * balde só: acima de seis, o que importa é "é caro", não se são sete ou nove.
 */
function grupoPorCmc(carta: DeckCarta): string {
  const t = carta.typeLine?.toLowerCase() ?? '';
  if (t.includes('land')) return 'Terrenos';
  const cmc = carta.cmc;
  if (typeof cmc !== 'number') return 'Custo desconhecido';
  if (cmc === 0) return 'Custo 0';
  if (cmc >= 7) return 'Custo 7+';
  return `Custo ${cmc}`;
}

export type Criterio = 'tipo' | 'cor' | 'cmc' | 'nenhum';

/**
 * Ordena para exibição SEM mutar a entrada.
 *
 * Comandante primeiro (é a carta que define o deck e a que se procura antes de
 * qualquer outra), depois alfabético. `localeCompare` e não `<`: sem ele,
 * "Ãgua" cai depois de "Zumbi".
 */
export function ordenarParaExibir(cartas: readonly DeckCarta[]): DeckCarta[] {
  return [...cartas].sort((a, b) => {
    const comandanteA = a.boardType === 'COMMANDER' ? 0 : 1;
    const comandanteB = b.boardType === 'COMMANDER' ? 0 : 1;
    if (comandanteA !== comandanteB) return comandanteA - comandanteB;
    return (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR');
  });
}

/** Agrupa a lista pelo critério pedido. Já devolve cada grupo ordenado. */
export function agruparCartas(
  cartas: readonly DeckCarta[],
  criterio: Criterio,
): Array<{ nome: string; cartas: DeckCarta[]; total: number }> {
  const ordenadas = ordenarParaExibir(cartas);

  if (criterio === 'nenhum') {
    return ordenadas.length
      ? [
          {
            nome: 'Todas as Cartas',
            cartas: ordenadas,
            total: ordenadas.reduce((t, c) => t + c.quantity, 0),
          },
        ]
      : [];
  }

  const rotular =
    criterio === 'cor' ? grupoPorCor : criterio === 'cmc' ? grupoPorCmc : grupoPorTipo;

  const grupos = new Map<string, DeckCarta[]>();
  for (const carta of ordenadas) {
    const chave = rotular(carta);
    const atual = grupos.get(chave);
    if (atual) atual.push(carta);
    else grupos.set(chave, [carta]);
  }

  const indice = (nome: string) => {
    const i = ORDEM_DOS_GRUPOS.indexOf(nome);
    // Grupo desconhecido vai para o fim, e entre eles vale a ordem alfabética.
    return i === -1 ? ORDEM_DOS_GRUPOS.length : i;
  };

  return [...grupos.entries()]
    .sort(([a], [b]) => indice(a) - indice(b) || a.localeCompare(b, 'pt-BR'))
    .map(([nome, lista]) => ({
      nome,
      cartas: lista,
      total: lista.reduce((t, c) => t + c.quantity, 0),
    }));
}

// ─── Bracket de poder ────────────────────────────────────────────────────────

/**
 * O chip de bracket do deckbuilder.
 *
 * A conta saiu daqui. Isto era uma heurística de pontos com duas listas de
 * nomes escritas à mão — 25 cartas, das quais só 16 eram Game Changers, três
 * eram banidas e seis nem estavam na lista oficial — e faixas de pontos que não
 * correspondiam a regra nenhuma: quatro Game Changers davam "Bracket 3", dez
 * davam "Bracket 1". A estimativa agora é `estimarBracket`, em shared-types,
 * pela marcação `game_changer` da Scryfall — a mesma que o backend usa.
 *
 * O que fica aqui é só apresentação.
 */
export interface Bracket {
  label: string;
  color: string;
  /** Tooltip: quais Game Changers, e o que a estimativa NÃO verifica. */
  dica: string;
}

export function calcularBracket(
  cartas: readonly DeckCarta[] | undefined,
  formatId?: string | null,
): Bracket | null {
  // Carta pendente ainda não tem a marcação: contá-la como "sem dados" faria o
  // chip piscar "incompleto" a cada carta adicionada.
  const e = estimarBracket(
    (cartas ?? []).filter((c) => !c.pendente),
    formatId,
  );
  if (!e) return null;

  const n = e.gameChangers.length;
  const ressalva =
    'Estimativa pela lista oficial de Game Changers. Destruição de terrenos em massa, ' +
    'turnos extras e combos de duas cartas não são verificados — isso fica com a mesa.';
  const dica = n
    ? `${n} Game Changer(s): ${e.gameChangers.join(', ')}.

${ressalva}`
    : `Nenhum Game Changer.

${ressalva}`;

  if (e.semDados > 0 && e.minimo < 4) {
    return {
      label: `${rotuloDoBracket(e)} (incompleto)`,
      color: 'text-text-muted',
      dica: `${e.semDados} carta(s) sem dados da Scryfall — o bracket pode ser maior.

${dica}`,
    };
  }

  const sufixo = n ? ` · ${n} GC` : '';
  if (e.minimo === 4)
    return { label: `${rotuloDoBracket(e)}${sufixo}`, color: 'text-[#f97316]', dica };
  if (e.minimo === 3)
    return { label: `${rotuloDoBracket(e)}${sufixo}`, color: 'text-[#eab308]', dica };
  return { label: rotuloDoBracket(e), color: 'text-[#22c55e]', dica };
}

/** Soma do preço em USD, formatada. `priceUsd` chega como texto da Scryfall. */
export function precoTotal(cartas: readonly DeckCarta[] | undefined): string {
  if (!cartas) return '0.00';
  let total = 0;
  for (const c of cartas) total += (parseFloat(String(c.priceUsd ?? 0)) || 0) * c.quantity;
  return total.toFixed(2);
}
