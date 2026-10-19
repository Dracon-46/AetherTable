/**
 * cartas.ts — de onde os desafios tiram as cartas, e as regras de cada um.
 *
 * Tudo passa pelo proxy da Scryfall da API (`/cards/search`, com cache e fila
 * nossos): nenhum desafio fala direto com a Scryfall, e nenhum guarda base de
 * cartas própria.
 *
 * "Ao acaso entre as mais jogadas": a busca ordenada pelo EDHREC devolve 175
 * cartas por página; sortear uma página entre as primeiras e uma carta dentro
 * dela dá cartas que um jogador de Commander reconhece — um desafio de
 * "adivinhe a carta" com uma comum obscura de 1997 não é desafio, é loteria.
 *
 * O sorteio aqui é `Math.random`: é passatempo, não mesa. A RN06 (CSPRNG do
 * servidor) vale para o que decide partida.
 */

import { api, ApiError } from '../lib/fetcher';

export interface CartaDoDesafio {
  id: string;
  name: string;
  type_line?: string;
  mana_cost?: string;
  cmc?: number;
  colors?: string[];
  color_identity?: string[];
  oracle_text?: string;
  keywords?: string[];
  power?: string;
  toughness?: string;
  set_name?: string;
  released_at?: string;
  edhrec_rank?: number;
  prices?: { usd?: string | null; usd_foil?: string | null };
  card_faces?: {
    name?: string;
    type_line?: string;
    oracle_text?: string;
    mana_cost?: string;
    colors?: string[];
    power?: string;
    toughness?: string;
  }[];
}

export type Sorteador = () => number;

/** As mais jogadas em Commander, sem básicos e sem o que só existe em digital. */
export const POPULARES = 'game:paper -t:basic legal:commander';

export async function buscar(
  q: string,
  opcoes: { pagina?: number; ordem?: string; dir?: 'asc' | 'desc' } = {},
): Promise<CartaDoDesafio[]> {
  const qs = new URLSearchParams({ q, unique: 'cards' });
  if (opcoes.pagina) qs.set('page', String(opcoes.pagina));
  if (opcoes.ordem) qs.set('order', opcoes.ordem);
  if (opcoes.dir) qs.set('dir', opcoes.dir);
  try {
    const r = await api<{ data?: CartaDoDesafio[] }>(`/cards/search?${qs}`);
    return r.data ?? [];
  } catch (erro) {
    // A Scryfall responde 404 a uma busca sem resultado: aqui isso é "nenhuma".
    if (erro instanceof ApiError && erro.status === 404) return [];
    throw erro;
  }
}

export function sortearDe<T>(lista: readonly T[], sortear: Sorteador = Math.random): T | undefined {
  return lista.length ? lista[Math.floor(sortear() * lista.length)] : undefined;
}

/** `n` itens distintos, sem repetição. */
export function sortearVarios<T>(
  lista: readonly T[],
  n: number,
  sortear: Sorteador = Math.random,
): T[] {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(sortear() * (i + 1));
    [copia[i], copia[j]] = [copia[j]!, copia[i]!];
  }
  return copia.slice(0, n);
}

/** Uma página sorteada entre as `paginas` primeiras da busca ordenada pelo EDHREC. */
export async function paginaAoAcaso(
  q: string,
  paginas = 5,
  sortear: Sorteador = Math.random,
): Promise<CartaDoDesafio[]> {
  const pagina = 1 + Math.floor(sortear() * paginas);
  const cartas = await buscar(q, { pagina, ordem: 'edhrec' });
  // Busca com menos páginas que o sorteado: a primeira sempre existe.
  return cartas.length ? cartas : buscar(q, { pagina: 1, ordem: 'edhrec' });
}

// ─── Nomes ─────────────────────────────────────────────────────────────────

/** Sem acento, sem pontuação, sem caixa: "Æther Vial" e "aether vial" são o mesmo palpite. */
export function normalizarNome(nome: string): string {
  return nome
    .replace(/æ/gi, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** O palpite confere com o nome inteiro ou com o de uma das faces ("A // B"). */
export function nomeConfere(carta: Pick<CartaDoDesafio, 'name' | 'card_faces'>, palpite: string) {
  const alvo = normalizarNome(palpite);
  if (!alvo) return false;
  const nomes = [
    carta.name,
    ...carta.name.split('//'),
    ...(carta.card_faces ?? []).map((f) => f.name ?? ''),
  ];
  return nomes.some((n) => n && normalizarNome(n) === alvo);
}

/** O texto da carta com o nome trocado por "~" — a dica não pode entregar a resposta. */
export function textoSemNome(carta: CartaDoDesafio): string {
  const texto =
    carta.oracle_text ?? (carta.card_faces ?? []).map((f) => f.oracle_text ?? '').join('\n—\n');
  const nomes = [carta.name, ...carta.name.split('//')].map((n) => n.trim()).filter(Boolean);
  // O nome curto ("Atraxa" de "Atraxa, Praetors' Voice") também aparece no texto.
  const curtos = nomes.map((n) => n.split(',')[0]!.trim());
  let saida = texto;
  for (const n of [...nomes, ...curtos].sort((a, b) => b.length - a.length)) {
    saida = saida.split(n).join('~');
  }
  return saida;
}

// ─── Grade de criaturas ────────────────────────────────────────────────────

export interface Criterio {
  id: string;
  rotulo: string;
  /** Trecho da busca da Scryfall — é com ele que a grade confere se a casa tem resposta. */
  consulta: string;
  /** A mesma regra, conferida na carta que a pessoa digitou. */
  atende: (c: CartaDoDesafio) => boolean;
}

const tipoDe = (c: CartaDoDesafio) =>
  [c.type_line ?? '', ...(c.card_faces ?? []).map((f) => f.type_line ?? '')].join(' // ');
const coresDe = (c: CartaDoDesafio) =>
  c.colors ?? [...new Set((c.card_faces ?? []).flatMap((f) => f.colors ?? []))];
const forcaDe = (c: CartaDoDesafio) => Number(c.power ?? c.card_faces?.[0]?.power ?? NaN);
const temPalavraChave = (c: CartaDoDesafio, k: string) =>
  (c.keywords ?? []).some((x) => x.toLowerCase() === k.toLowerCase());
const temTipo = (c: CartaDoDesafio, t: string) => new RegExp(`\\b${t}\\b`, 'i').test(tipoDe(c));

const cor = (sigla: string, rotulo: string): Criterio => ({
  id: `cor-${sigla}`,
  rotulo,
  consulta: `c=${sigla.toLowerCase()}`,
  atende: (c) => {
    const cs = coresDe(c);
    return cs.length === 1 && cs[0] === sigla;
  },
});

/** As linhas: uma cor só (monocolor), multicolor ou incolor. */
export const LINHAS: readonly Criterio[] = [
  cor('W', 'Branca'),
  cor('U', 'Azul'),
  cor('B', 'Preta'),
  cor('R', 'Vermelha'),
  cor('G', 'Verde'),
  {
    id: 'multi',
    rotulo: 'Multicolorida',
    consulta: 'c:m',
    atende: (c) => coresDe(c).length >= 2,
  },
];

/** As colunas: tipo, custo, palavra-chave ou força. */
export const COLUNAS: readonly Criterio[] = [
  {
    id: 'voar',
    rotulo: 'Voar',
    consulta: 'kw:flying',
    atende: (c) => temPalavraChave(c, 'Flying'),
  },
  {
    id: 'atropelar',
    rotulo: 'Atropelar',
    consulta: 'kw:trample',
    atende: (c) => temPalavraChave(c, 'Trample'),
  },
  {
    id: 'toque',
    rotulo: 'Toque mortífero',
    consulta: 'kw:deathtouch',
    atende: (c) => temPalavraChave(c, 'Deathtouch'),
  },
  {
    id: 'lendaria',
    rotulo: 'Lendária',
    consulta: 't:legendary',
    atende: (c) => temTipo(c, 'Legendary'),
  },
  { id: 'barata', rotulo: 'Custo 1 ou 2', consulta: 'cmc<=2', atende: (c) => (c.cmc ?? 99) <= 2 },
  { id: 'cara', rotulo: 'Custo 6 ou mais', consulta: 'cmc>=6', atende: (c) => (c.cmc ?? 0) >= 6 },
  { id: 'forte', rotulo: 'Força 5 ou mais', consulta: 'pow>=5', atende: (c) => forcaDe(c) >= 5 },
  { id: 'humano', rotulo: 'Humano', consulta: 't:human', atende: (c) => temTipo(c, 'Human') },
  { id: 'zumbi', rotulo: 'Zumbi', consulta: 't:zombie', atende: (c) => temTipo(c, 'Zombie') },
  { id: 'elfo', rotulo: 'Elfo', consulta: 't:elf', atende: (c) => temTipo(c, 'Elf') },
  { id: 'dragao', rotulo: 'Dragão', consulta: 't:dragon', atende: (c) => temTipo(c, 'Dragon') },
];

export const BASE_DA_GRADE = 't:creature game:paper';

/** A carta digitada vale para a casa (linha × coluna)? Precisa ser criatura. */
export function atendeCasa(c: CartaDoDesafio, linha: Criterio, coluna: Criterio): boolean {
  return temTipo(c, 'Creature') && linha.atende(c) && coluna.atende(c);
}

// ─── Comparações ───────────────────────────────────────────────────────────

export const precoDe = (c: CartaDoDesafio): number | null => {
  const v = Number(c.prices?.usd ?? c.prices?.usd_foil ?? NaN);
  return Number.isFinite(v) ? v : null;
};

/**
 * Um par que dá para comparar: valores diferentes o bastante para a resposta
 * não ser cara-ou-coroa (preço: 15 % ou mais; posição no EDHREC: 10 %).
 */
export function sortearPar(
  cartas: readonly CartaDoDesafio[],
  valor: (c: CartaDoDesafio) => number | null,
  folga: number,
  sortear: Sorteador = Math.random,
): [CartaDoDesafio, CartaDoDesafio] | null {
  const comValor = cartas.filter((c) => valor(c) !== null);
  for (let tentativa = 0; tentativa < 30; tentativa++) {
    const [a, b] = sortearVarios(comValor, 2, sortear);
    if (!a || !b) return null;
    const va = valor(a)!;
    const vb = valor(b)!;
    if (Math.abs(va - vb) / Math.max(va, vb, 0.01) >= folga) return [a, b];
  }
  return null;
}
