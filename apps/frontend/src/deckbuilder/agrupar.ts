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
 * Cartas que definem o teto de poder de um deck de Commander.
 *
 * `Set` e não `Array.some(includes)`: a versão anterior fazia
 * `cEDH.some((x) => nome.includes(x))` para CADA carta — 100 cartas × 16
 * nomes = 1.600 buscas de substring por render, e ela rodava no corpo do
 * componente. Com casamento exato por nome (o que a lista sempre pretendeu),
 * é uma consulta de hash por carta.
 *
 * O casamento exato também corrige um falso positivo real: `includes('Sol
 * Ring')` marcava "Sol Ring" e qualquer carta cujo nome o contivesse.
 */
const CARTAS_CEDH = new Set([
  'Mana Crypt',
  "Gaea's Cradle",
  'Underworld Breach',
  "Thassa's Oracle",
  'Demonic Tutor',
  'Vampiric Tutor',
  'Force of Will',
  'Fierce Guardianship',
  'Jeweled Lotus',
  'Mox Diamond',
  'Chrome Mox',
  'Dockside Extortionist',
  'Deflecting Swat',
  'Imperial Seal',
  'Timetwister',
  "Lion's Eye Diamond",
]);

const CARTAS_FORTES = new Set([
  'Sol Ring',
  'Mana Vault',
  'Rhystic Study',
  'Mystic Remora',
  'Sylvan Library',
  'Cyclonic Rift',
  'Smothering Tithe',
  "Teferi's Protection",
  'Craterhoof Behemoth',
]);

export interface Bracket {
  label: string;
  color: string;
}

/** Estimativa grosseira de poder, pelas cartas de maior impacto presentes. */
export function calcularBracket(cartas: readonly DeckCarta[] | undefined): Bracket {
  if (!cartas || cartas.length === 0) {
    return { label: 'Desconhecido', color: 'text-text-muted' };
  }

  let pontos = 0;
  for (const carta of cartas) {
    const nome = carta.name;
    if (!nome) continue;
    // Nome canônico de dupla face vem como "Frente // Verso"; a lista usa a
    // frente, que é o que aparece em qualquer decklist.
    const frente = nome.split(' // ')[0]!;
    if (CARTAS_CEDH.has(nome) || CARTAS_CEDH.has(frente)) pontos += 3;
    else if (CARTAS_FORTES.has(nome) || CARTAS_FORTES.has(frente)) pontos += 1;
  }

  if (pontos >= 10) return { label: 'Bracket 5 (cEDH / Máximo)', color: 'text-[#ef4444]' };
  if (pontos >= 7) return { label: 'Bracket 4 (High Power)', color: 'text-[#f97316]' };
  if (pontos >= 4) return { label: 'Bracket 3 (Mid-High)', color: 'text-[#eab308]' };
  if (pontos >= 2) return { label: 'Bracket 2 (Mid Power)', color: 'text-[#84cc16]' };
  return { label: 'Bracket 1 (Low Power / Casual)', color: 'text-[#22c55e]' };
}

/** Soma do preço em USD, formatada. `priceUsd` chega como texto da Scryfall. */
export function precoTotal(cartas: readonly DeckCarta[] | undefined): string {
  if (!cartas) return '0.00';
  let total = 0;
  for (const c of cartas) total += (parseFloat(String(c.priceUsd ?? 0)) || 0) * c.quantity;
  return total.toFixed(2);
}
