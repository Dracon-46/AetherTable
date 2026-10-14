/**
 * cartas.spec.ts — as regras dos desafios.
 *
 * O que estes casos fixam: o palpite perdoa acento, caixa e face de carta
 * dupla; a dica de texto não entrega o nome; a grade confere a carta digitada
 * com a mesma regra que usou para garantir resposta; e o par comparado nunca
 * é cara-ou-coroa.
 */

import {
  atendeCasa,
  COLUNAS,
  LINHAS,
  nomeConfere,
  normalizarNome,
  sortearPar,
  sortearVarios,
  textoSemNome,
  type CartaDoDesafio,
} from './cartas';
import { pistasDaArte, pistasDaEscada } from './Adivinhacao';

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);
jest.mock('../lib/fetcher', () => ({ api: jest.fn(), ApiError: class extends Error {} }));
jest.mock('../canvas/textureCache', () => ({ cardImageUrl: () => '' }));

const criterio = (lista: typeof LINHAS, id: string) => lista.find((c) => c.id === id)!;

const SERRA: CartaDoDesafio = {
  id: 's',
  name: 'Serra Angel',
  type_line: 'Creature — Angel',
  colors: ['W'],
  cmc: 5,
  keywords: ['Flying', 'Vigilance'],
  power: '4',
  oracle_text: 'Flying, vigilance',
};

describe('nomes', () => {
  it('perdoa acento, caixa, pontuação e o Æ', () => {
    expect(normalizarNome('  ÆTHER Vial! ')).toBe('aether vial');
    expect(nomeConfere({ name: 'Aether Vial' }, 'æther vial')).toBe(true);
  });

  it('carta dupla aceita o nome inteiro ou o de uma face', () => {
    const carta = { name: 'Delver of Secrets // Insectile Aberration' };
    expect(nomeConfere(carta, 'Delver of Secrets')).toBe(true);
    expect(nomeConfere(carta, 'insectile aberration')).toBe(true);
    expect(nomeConfere(carta, 'Delver')).toBe(false);
  });

  it('a dica de texto troca o nome (e o nome curto) por ~', () => {
    const atraxa: CartaDoDesafio = {
      id: 'a',
      name: "Atraxa, Praetors' Voice",
      oracle_text: "Flying\nAt the beginning of your end step, proliferate. Atraxa's power…",
    };
    expect(textoSemNome(atraxa)).not.toMatch(/Atraxa/);
    expect(textoSemNome(atraxa)).toContain("~'s power");
  });
});

describe('grade de criaturas', () => {
  it('confere cor e coluna na carta digitada', () => {
    expect(atendeCasa(SERRA, criterio(LINHAS, 'cor-W'), criterio(COLUNAS, 'voar'))).toBe(true);
    expect(atendeCasa(SERRA, criterio(LINHAS, 'cor-U'), criterio(COLUNAS, 'voar'))).toBe(false);
    expect(atendeCasa(SERRA, criterio(LINHAS, 'cor-W'), criterio(COLUNAS, 'barata'))).toBe(false);
  });

  it('não-criatura nunca vale, mesmo atendendo aos dois critérios', () => {
    const encantamento = { ...SERRA, type_line: 'Enchantment' };
    expect(atendeCasa(encantamento, criterio(LINHAS, 'cor-W'), criterio(COLUNAS, 'voar'))).toBe(
      false,
    );
  });

  it('cada critério tem um trecho de busca — é com ele que a grade garante resposta', () => {
    for (const c of [...LINHAS, ...COLUNAS]) expect(c.consulta.length).toBeGreaterThan(2);
  });
});

describe('sorteios', () => {
  it('sortearVarios não repete', () => {
    const tres = sortearVarios([1, 2, 3, 4, 5], 3);
    expect(new Set(tres).size).toBe(3);
  });

  const comRank = (ranks: number[]): CartaDoDesafio[] =>
    ranks.map((r, i) => ({ id: String(i), name: String(i), edhrec_rank: r }));
  const rank = (c: CartaDoDesafio) => c.edhrec_rank ?? null;

  it('o par comparado tem diferença mínima entre os valores', () => {
    const par = sortearPar(comRank([10, 10.5, 20]), rank, 0.15);
    expect(par).not.toBeNull();
    const [a, b] = par!.map((c) => c.edhrec_rank!);
    expect(Math.abs(a! - b!) / Math.max(a!, b!)).toBeGreaterThanOrEqual(0.15);
  });

  it('sem par possível, devolve null em vez de travar', () => {
    expect(sortearPar(comRank([1, 1, 1]), rank, 0.1)).toBeNull();
  });
});

describe('pistas', () => {
  it('a escada sobe da cor até a arte', () => {
    const pistas = pistasDaEscada({ ...SERRA, color_identity: ['W'] });
    expect(pistas.map((p) => p.rotulo)[0]).toBe('Identidade de cor');
    expect(pistas[0]!.conteudo).toBe('branco');
    expect(pistas.at(-1)!.conteudo).toBe('ARTE');
  });

  it('"adivinhe a carta" começa pela arte', () => {
    expect(pistasDaArte(SERRA)[0]!.conteudo).toBe('ARTE');
    expect(pistasDaArte(SERRA)).toHaveLength(3);
  });
});
