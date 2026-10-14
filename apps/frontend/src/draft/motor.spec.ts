/**
 * motor.spec.ts — a roda do draft.
 *
 * O que estes casos fixam: o pacote tem 14 cartas sem repetição e sem básico,
 * com a raridade certa; a roda anda para a esquerda, depois para a direita,
 * depois para a esquerda; ao fim, cada lugar tem 42 cartas; o robô se
 * compromete com duas cores; e os básicos fecham exatamente o que falta.
 */

import {
  CARTAS_POR_PACOTE,
  comecarDraft,
  coresDoRobo,
  escolher,
  escolhaDoRobo,
  LUGARES,
  montarPacote,
  RODADAS,
  sugerirBasicos,
  type CartaDeDraft,
} from './motor';
import { listaDoDeck } from './colecoes';

jest.mock('../lib/fetcher', () => ({ api: jest.fn(), ApiError: class extends Error {} }));

/** Sorteador determinístico (LCG): repetível e sem viés óbvio. */
function sorteador(semente = 7) {
  let x = semente;
  return () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
}

const COR = ['W', 'U', 'B', 'R', 'G'];
const carta = (i: number, rarity: string, extra: Partial<CartaDeDraft> = {}): CartaDeDraft => ({
  id: `${rarity}-${i}`,
  name: `${rarity} ${i}`,
  rarity,
  colors: [COR[i % 5]!],
  type_line: 'Creature — Teste',
  cmc: (i % 6) + 1,
  set: 'tst',
  ...extra,
});

const COLECAO: CartaDeDraft[] = [
  ...Array.from({ length: 80 }, (_, i) => carta(i, 'common')),
  ...Array.from({ length: 40 }, (_, i) => carta(i, 'uncommon')),
  ...Array.from({ length: 20 }, (_, i) => carta(i, 'rare')),
  ...Array.from({ length: 8 }, (_, i) => carta(i, 'mythic')),
  carta(0, 'common', { id: 'basico', name: 'Plains', type_line: 'Basic Land — Plains' }),
];

it('o pacote: 14 cartas, sem repetir, sem básico, 1 rara/mítica e 3 incomuns', () => {
  const pacote = montarPacote(COLECAO, sorteador());
  expect(pacote).toHaveLength(CARTAS_POR_PACOTE);
  expect(new Set(pacote.map((c) => c.id)).size).toBe(CARTAS_POR_PACOTE);
  expect(pacote.some((c) => c.name === 'Plains')).toBe(false);
  expect(pacote.filter((c) => c.rarity === 'rare' || c.rarity === 'mythic')).toHaveLength(1);
  expect(pacote.filter((c) => c.rarity === 'uncommon')).toHaveLength(3);
});

it('a roda passa para a esquerda na 1ª rodada e para a direita na 2ª', () => {
  const s = sorteador();
  let estado = comecarDraft(COLECAO, s);
  // O pacote que o lugar 7 tinha chega ao lugar 0 na esquerda (0 recebe de 7).
  const doLugar7 = estado.pacotes[7]!.map((c) => c.id);
  estado = escolher(estado, 0, COLECAO, s);
  expect(doLugar7).toEqual(expect.arrayContaining(estado.pacotes[0]!.map((c) => c.id)));

  for (let i = 1; i < CARTAS_POR_PACOTE; i++) estado = escolher(estado, 0, COLECAO, s);
  expect(estado.rodada).toBe(1);
  // Direita: o lugar 0 recebe do lugar 1.
  const doLugar1 = estado.pacotes[1]!.map((c) => c.id);
  estado = escolher(estado, 0, COLECAO, s);
  expect(doLugar1).toEqual(expect.arrayContaining(estado.pacotes[0]!.map((c) => c.id)));
});

it('ao fim, cada lugar tem 42 cartas e o draft terminou', () => {
  const s = sorteador(3);
  let estado = comecarDraft(COLECAO, s);
  for (let i = 0; i < RODADAS * CARTAS_POR_PACOTE; i++) estado = escolher(estado, 0, COLECAO, s);
  expect(estado.terminou).toBe(true);
  expect(estado.escolhidas).toHaveLength(LUGARES);
  for (const e of estado.escolhidas) expect(e).toHaveLength(RODADAS * CARTAS_POR_PACOTE);
  // Escolher depois do fim não muda nada.
  expect(escolher(estado, 0, COLECAO, s)).toBe(estado);
});

it('o robô pega a rara no começo e se compromete com duas cores depois', () => {
  const pacote = [carta(1, 'common'), carta(2, 'rare'), carta(3, 'uncommon')];
  expect(escolhaDoRobo(pacote, [], () => 0)).toBe(1);

  const escolhidas = [
    carta(0, 'common'),
    carta(5, 'common'),
    carta(1, 'common'),
    carta(6, 'common'),
  ];
  expect(coresDoRobo(escolhidas).sort()).toEqual(['U', 'W']);
  // Comprometido com W/U, a comum branca vence a incomum vermelha.
  const naCor = carta(10, 'common', { colors: ['W'] });
  const foraDaCor = carta(3, 'uncommon', { colors: ['R'] });
  expect(escolhaDoRobo([foraDaCor, naCor], escolhidas, () => 0)).toBe(1);
});

it('os básicos fecham exatamente o que falta, proporcional às cores', () => {
  const magicas = [
    ...Array.from({ length: 15 }, (_, i) => carta(i, 'common', { colors: ['G'] })),
    ...Array.from({ length: 8 }, (_, i) => carta(i, 'common', { colors: ['B'] })),
  ];
  const b = sugerirBasicos(magicas, 17);
  expect(b['G']! + b['B']!).toBe(17);
  expect(b['G']!).toBeGreaterThan(b['B']!);
});

it('a lista do deck agrupa cópias, fixa a coleção e põe a reserva na seção dela', () => {
  const c = carta(1, 'common');
  const texto = listaDoDeck([c, c], [carta(2, 'rare')], { W: 8, U: 0 }, 'tst');
  expect(texto).toBe('2 common 1 (TST)\n8 Plains (TST)\n\nSideboard\n1 rare 2 (TST)');
});
