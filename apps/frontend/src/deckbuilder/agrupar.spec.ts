/**
 * agrupar.spec.ts — a ordem, os grupos e a lista exportada do deckbuilder.
 *
 * Três defeitos que estes casos fixam:
 *
 *   - a carta mandada para a reserva continuava agrupada com as do deck
 *     principal, e "quantas criaturas eu tenho" contava as que nem vão à mesa;
 *   - a ordem era fixa (alfabética), e "onde está o dinheiro deste deck" pedia
 *     levar a lista para outro site;
 *   - não existia exportar: o deck entrava pelo importador e não saía mais.
 */

import { agruparCartas, exportarLista, ordenarParaExibir } from './agrupar';
import type { DeckCarta } from './useDecks';

const carta = (c: Partial<DeckCarta> & Pick<DeckCarta, 'id' | 'name'>): DeckCarta => ({
  scryfallId: `sf-${c.id}`,
  quantity: 1,
  boardType: 'MAIN',
  typeLine: 'Creature — Dinosaur',
  ...c,
});

const DECK: DeckCarta[] = [
  carta({
    id: 'cmd',
    name: 'Pantlaza, Sun-Favored',
    boardType: 'COMMANDER',
    priceUsd: '5.93',
    set: 'LCC',
  }),
  carta({ id: 'a', name: 'Zacama', priceUsd: '12.00', cmc: 9, rarity: 'mythic', set: 'RIX' }),
  carta({
    id: 'b',
    name: 'Birds of Paradise',
    priceUsd: '8.50',
    cmc: 1,
    rarity: 'rare',
    set: 'M12',
  }),
  carta({
    id: 'c',
    name: 'Forest',
    typeLine: 'Basic Land — Forest',
    quantity: 10,
    priceUsd: '0.10',
    set: 'LCI',
  }),
  carta({
    id: 'd',
    name: 'Hornswoggle',
    typeLine: 'Instant',
    boardType: 'SIDEBOARD',
    priceUsd: '0.25',
    set: 'RIX',
  }),
];

describe('agruparCartas', () => {
  it('a reserva vira grupo próprio, e não entra na conta das criaturas', () => {
    const grupos = agruparCartas(DECK, 'tipo');
    const nomes = grupos.map((g) => g.nome);

    expect(nomes[nomes.length - 1]).toBe('Reserva');
    expect(grupos.find((g) => g.nome === 'Mágicas')).toBeUndefined();
    expect(grupos.find((g) => g.nome === 'Reserva')!.cartas.map((c) => c.name)).toEqual([
      'Hornswoggle',
    ]);
  });

  it('sem agrupamento, a reserva continua separada do deck principal', () => {
    const grupos = agruparCartas(DECK, 'nenhum');
    expect(grupos.map((g) => g.nome)).toEqual(['Todas as Cartas', 'Reserva']);
  });

  it('cada grupo traz o preço somado pela quantidade', () => {
    const terrenos = agruparCartas(DECK, 'tipo').find((g) => g.nome === 'Terrenos')!;
    // Dez Forests a US$ 0,10.
    expect(terrenos.preco).toBeCloseTo(1);
  });

  it('agrupa por raridade, comandante à parte', () => {
    const nomes = agruparCartas(DECK, 'raridade').map((g) => g.nome);
    expect(nomes.slice(0, 3)).toEqual(['Comandante', 'Mítica', 'Rara']);
  });
});

describe('ordenarParaExibir', () => {
  it('por preço, a mais cara primeiro — e o comandante continua no topo', () => {
    const nomes = ordenarParaExibir(DECK, 'preco').map((c) => c.name);
    expect(nomes[0]).toBe('Pantlaza, Sun-Favored');
    expect(nomes.slice(1, 3)).toEqual(['Zacama', 'Birds of Paradise']);
  });

  it('por valor de mana, a curva sobe', () => {
    const semComandante = ordenarParaExibir(DECK, 'cmc').filter((c) => c.boardType !== 'COMMANDER');
    expect(semComandante[0]!.name).toBe('Birds of Paradise');
  });
});

describe('exportarLista', () => {
  it('separa comandante, deck e reserva como os importadores esperam', () => {
    expect(exportarLista(DECK)).toBe(
      [
        'Commander',
        '1 Pantlaza, Sun-Favored',
        '',
        'Deck',
        '1 Birds of Paradise',
        '10 Forest',
        '1 Zacama',
        '',
        'Sideboard',
        '1 Hornswoggle',
      ].join('\n'),
    );
  });

  it('com a coleção, cada linha leva (SET) para manter a impressão escolhida', () => {
    expect(exportarLista(DECK, { comEdicao: true })).toContain('1 Zacama (RIX)');
  });

  it('um deck só com o principal sai sem cabeçalho nenhum', () => {
    const so = DECK.filter((c) => c.boardType === 'MAIN');
    expect(exportarLista(so).split('\n')[0]).toBe('1 Birds of Paradise');
  });
});
