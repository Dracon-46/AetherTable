/**
 * importacao.spec.ts — o que o import entende de uma lista colada.
 *
 * Cada bloco é um defeito confirmado do parser antigo, que morava dentro de
 * `importDeckList` sem teste nenhum:
 *
 *  - a linha "Sideboard" era pulada, mas as cartas DEPOIS dela iam para o MAIN;
 *  - "Commander", "Deck" e o "About" do Arena iam à Scryfall como nome de carta;
 *  - "4 Forest (ZNR)" + "6 Forest (M21)" viravam 4 + 4;
 *  - os marcadores do Archidekt e do Moxfield grudavam no nome;
 *  - "2000000000 Forest" era gravado assim.
 *
 * As listas abaixo são a forma real de cada exportador, não texto inventado.
 */

import { BoardType } from '@prisma/client';
import {
  MAXIMO_DE_COPIAS,
  analisarListaDeImportacao,
  casarResultados,
  pedidosAScryfall,
} from './importacao.js';

const ler = (texto: string) => analisarListaDeImportacao(texto);

describe('importação — cabeçalhos mudam a seção', () => {
  it('as cartas depois de "Sideboard" entram na RESERVA, não no main', () => {
    const { linhas } = ler(
      '4 Lightning Bolt\n20 Mountain\n\nSideboard\n2 Pyroblast\n1 Smash to Smithereens',
    );
    expect(linhas.map((l) => [l.nome, l.boardType])).toEqual([
      ['Lightning Bolt', BoardType.MAIN],
      ['Mountain', BoardType.MAIN],
      ['Pyroblast', BoardType.SIDEBOARD],
      ['Smash to Smithereens', BoardType.SIDEBOARD],
    ]);
  });

  it.each(['Sideboard', 'SIDEBOARD:', 'Sideboard:', '// Sideboard', 'Sideboard (15)'])(
    'reconhece a variação "%s"',
    (cabecalho) => {
      const { linhas } = ler(`1 Island\n${cabecalho}\n1 Negate`);
      expect(linhas.find((l) => l.nome === 'Negate')?.boardType).toBe(BoardType.SIDEBOARD);
    },
  );

  it('"Commander"/"Commanders" abrem a zona de comando; "Deck" volta ao main', () => {
    const { linhas } = ler(
      "Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Sol Ring\nCommanders\n1 Thrasios, Triton Hero",
    );
    expect(linhas.map((l) => l.boardType)).toEqual([
      BoardType.COMMANDER,
      BoardType.MAIN,
      BoardType.COMMANDER,
    ]);
  });

  it('"Mainboard" é o main e "Maybeboard"/"Considering" vão para o maybeboard', () => {
    const { linhas } = ler(
      'Mainboard\n1 Sol Ring\nMaybeboard\n1 Mana Vault\nConsidering\n1 Grim Monolith',
    );
    expect(linhas.map((l) => l.boardType)).toEqual([
      BoardType.MAIN,
      BoardType.MAYBEBOARD,
      BoardType.MAYBEBOARD,
    ]);
  });

  it('cabeçalho NÃO vai à Scryfall como nome de carta', () => {
    const { linhas } = ler('Commander\n1 Atraxa\nDeck\n1 Sol Ring\nSideboard\n1 Negate');
    const nomes = pedidosAScryfall(linhas).map((p) => p.name);
    expect(nomes).toEqual(['Atraxa', 'Sol Ring', 'Negate']);
  });

  it('o "About" do Arena e a linha "Name" são ignorados', () => {
    const arena = 'About\nName Mono Vermelho\n\nDeck\n4 Lightning Bolt\n\nSideboard\n2 Abrade';
    const { linhas, recusadas } = ler(arena);
    expect(linhas.map((l) => l.nome)).toEqual(['Lightning Bolt', 'Abrade']);
    expect(recusadas).toEqual([]);
  });

  it('"Companion" vai para a reserva, que é onde as regras o põem', () => {
    const { linhas } = ler('Companion\n1 Lurrus of the Dream-Den\nDeck\n4 Ragavan');
    expect(linhas[0]?.boardType).toBe(BoardType.SIDEBOARD);
  });
});

describe('importação — marcadores de exportador saem do nome', () => {
  it('categorias e etiquetas do Archidekt', () => {
    const { linhas } = ler('1x Sol Ring (c21) 263 [Ramp,Artifact] ^Have,#37d67a^');
    expect(linhas[0]).toMatchObject({ quantidade: 1, nome: 'Sol Ring', set: 'c21' });
  });

  it('a categoria do Archidekt que diz o board vale como board', () => {
    const { linhas } = ler(
      "1x Atraxa, Praetors' Voice (2xm) 190 [Commander{top}]\n1x Mana Vault (2xm) 256 [Maybeboard{noDeck}{noPrice}]",
    );
    expect(linhas.map((l) => l.boardType)).toEqual([BoardType.COMMANDER, BoardType.MAYBEBOARD]);
  });

  it('o foil do Moxfield (*F*) e o etched (*E*)', () => {
    const { linhas } = ler('1 Sol Ring (C21) 263 *F*\n1 Arcane Signet (CMR) 297 *E*');
    expect(linhas.map((l) => l.nome)).toEqual(['Sol Ring', 'Arcane Signet']);
  });

  it('o *CMDR* do TappedOut marca o comandante', () => {
    const { linhas } = ler("1x Atraxa, Praetors' Voice *CMDR*\n1x Sol Ring");
    expect(linhas[0]).toMatchObject({
      nome: "Atraxa, Praetors' Voice",
      boardType: BoardType.COMMANDER,
    });
    expect(linhas[1]?.boardType).toBe(BoardType.MAIN);
  });

  it('"[C21]" sem coleção entre parênteses continua sendo código de coleção', () => {
    expect(ler('1 Sol Ring [C21]').linhas[0]).toMatchObject({ nome: 'Sol Ring', set: 'C21' });
  });

  it('"[Ramp]" sozinho é categoria, não coleção', () => {
    const { linhas } = ler('1 Sol Ring [Ramp]');
    expect(linhas[0]).toMatchObject({ nome: 'Sol Ring' });
    expect(linhas[0]?.set).toBeUndefined();
  });
});

describe('importação — quantidade fica em 1–99', () => {
  it('recusa 2000000000 cópias em vez de gravá-las', () => {
    const { linhas, recusadas } = ler('2000000000 Forest\n1 Sol Ring');
    expect(linhas.map((l) => l.nome)).toEqual(['Sol Ring']);
    expect(recusadas).toEqual([`Forest: quantidade 2000000000 fora de 1–${MAXIMO_DE_COPIAS}`]);
  });

  it('recusa zero cópias', () => {
    expect(ler('0 Forest').recusadas).toHaveLength(1);
  });

  it('99 ainda é aceito', () => {
    expect(ler('99 Relentless Rats').linhas[0]?.quantidade).toBe(99);
  });
});

describe('importação — linhas repetidas não se perdem nem colidem', () => {
  const forest = (id: string, set: string) => ({ id, name: 'Forest', set });

  it('"4 Forest (ZNR)" + "6 Forest (M21)" mantém as duas quantidades', () => {
    const { linhas } = ler('4 Forest (ZNR)\n6 Forest (M21)');
    // A ordem da resposta não é garantida (o cache responde primeiro): a M21
    // vir antes era o caso em que o casamento por nome trocava as quantidades.
    const r = casarResultados(linhas, [forest('m21-forest', 'm21'), forest('znr-forest', 'znr')]);
    expect(r.linhasDoDeck).toEqual(
      expect.arrayContaining([
        { scryfallId: 'znr-forest', quantity: 4, boardType: BoardType.MAIN },
        { scryfallId: 'm21-forest', quantity: 6, boardType: BoardType.MAIN },
      ]),
    );
    expect(r.linhasDoDeck).toHaveLength(2);
    expect(r.recusadas).toEqual([]);
  });

  it('a mesma impressão em duas linhas vira UMA linha somada — senão a chave única estoura', () => {
    const { linhas } = ler('2 Sol Ring (C21)\n1 Sol Ring (C21)');
    const r = casarResultados(linhas, [{ id: 'sol', name: 'Sol Ring', set: 'c21' }]);
    expect(r.linhasDoDeck).toEqual([{ scryfallId: 'sol', quantity: 3, boardType: BoardType.MAIN }]);
    expect(r.importadas).toBe(2);
  });

  it('a mesma carta no main e na reserva continua em duas linhas', () => {
    const { linhas } = ler('3 Negate\nSideboard\n2 Negate');
    const r = casarResultados(linhas, [{ id: 'negate', name: 'Negate', set: 'm20' }]);
    expect(r.linhasDoDeck).toEqual([
      { scryfallId: 'negate', quantity: 3, boardType: BoardType.MAIN },
      { scryfallId: 'negate', quantity: 2, boardType: BoardType.SIDEBOARD },
    ]);
  });

  it('duas linhas válidas que somam acima de 99 são recusadas, não gravadas', () => {
    const { linhas } = ler('60 Forest\n60 Forest');
    const r = casarResultados(linhas, [forest('f', 'fdn')]);
    expect(r.linhasDoDeck).toEqual([]);
    expect(r.recusadas[0]).toMatch(/120 cópias somadas/);
  });

  it('o mesmo pedido repetido vai à Scryfall uma vez só', () => {
    const { linhas } = ler('1 Forest\n1 Forest\nSideboard\n1 Forest');
    expect(pedidosAScryfall(linhas)).toEqual([{ name: 'Forest' }]);
  });

  it('a face da frente casa com o nome canônico da dupla face', () => {
    const { linhas } = ler('4 Delver of Secrets');
    const r = casarResultados(linhas, [
      { id: 'delver', name: 'Delver of Secrets // Insectile Aberration', set: 'isd' },
    ]);
    expect(r.linhasDoDeck).toEqual([
      { scryfallId: 'delver', quantity: 4, boardType: BoardType.MAIN },
    ]);
  });

  it('o que a Scryfall não achou aparece em "não encontradas"', () => {
    const { linhas } = ler('1 Sol Ring\n1 Carta Que Não Existe (XYZ)');
    const r = casarResultados(linhas, [{ id: 'sol', name: 'Sol Ring', set: 'c21' }]);
    expect(r.recusadas).toEqual(['Carta Que Não Existe (XYZ)']);
  });
});
