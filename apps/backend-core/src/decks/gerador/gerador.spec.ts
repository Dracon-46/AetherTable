/**
 * gerador.spec.ts — o deck aleatório sai jogável, e em volta do comandante.
 *
 * O que estes casos fixam:
 *
 *   - o tema é lido do comandante: tribo pelo tipo, mecânica pelo texto, e
 *     tipo genérico (Human) só se o texto o citar;
 *   - o molde é respeitado: exatamente 100 cartas, 36 terrenos, singleton,
 *     nenhum Game Changer, o comandante no comando e os básicos na proporção
 *     da demanda de cada cor (com pelo menos um de cada);
 *   - pool magro (comandante sem tema) não deixa o deck com menos de 100.
 */

import { temasDoComandante, subtiposDe } from './temas.js';
import { dividirBasicos, montarDeck, MOLDE, type Candidata, type Pools } from './montagem.js';

const GHALTA: Candidata = {
  id: 'ghalta',
  oracle_id: 'o-ghalta',
  name: 'Ghalta, Primal Hunger',
  type_line: 'Legendary Creature — Elder Dinosaur',
  oracle_text:
    'This spell costs {X} less to cast, where X is the total power of creatures you control.\nTrample',
  mana_cost: '{10}{G}{G}',
  color_identity: ['G'],
};

const KILLIAN: Candidata = {
  id: 'killian',
  oracle_id: 'o-killian',
  name: 'Killian, Decisive Mentor',
  type_line: 'Legendary Creature — Human Warlock',
  oracle_text:
    'Whenever you cast a spell that targets a creature, put a +1/+1 counter on it and draw a card.',
  mana_cost: '{1}{W}{B}',
  color_identity: ['W', 'B'],
};

/** Gera `n` candidatas com nomes distintos — um pool de verdade tem centenas. */
function pool(prefixo: string, n: number, extra: Partial<Candidata> = {}): Candidata[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefixo}-${i}`,
    oracle_id: `o-${prefixo}-${i}`,
    name: `${prefixo} ${i}`,
    mana_cost: '{1}{W}',
    ...extra,
  }));
}

function poolsCheios(): Pools {
  return {
    terrenosUteis: pool('terreno', 40),
    ramp: pool('ramp', 40),
    compra: pool('compra', 40),
    remocao: pool('remocao', 40),
    limpeza: pool('limpeza', 20),
    temaCriaturas: pool('tema-criatura', 60, { mana_cost: '{B}{B}' }),
    temaOutras: pool('tema-outra', 60),
    criaturas: pool('criatura', 80),
    outras: pool('outra', 80),
  };
}

const BASICOS = { W: 'plains', U: 'island', B: 'swamp', R: 'mountain', G: 'forest', C: 'wastes' };
/** Sorteador determinístico: sempre o primeiro da janela. */
const primeiro = () => 0;

describe('temasDoComandante', () => {
  it('tribo pelo tipo do comandante (Dinosaur é tribo de verdade)', () => {
    expect(temasDoComandante(GHALTA).map((t) => t.consulta)).toContain('t:dinosaur');
  });

  it('mecânica pelo texto: marcadores +1/+1 e compra', () => {
    const consultas = temasDoComandante(KILLIAN).map((t) => t.consulta);
    expect(consultas).toContain('o:"+1/+1 counter"');
    // Human não é estratégia: não vira tema só por estar no tipo.
    expect(consultas).not.toContain('t:human');
  });

  it('"non-Human" no texto NÃO vira tribo Human (Kinnan)', () => {
    const kinnan: Candidata = {
      id: 'kinnan',
      name: 'Kinnan, Bonder Prodigy',
      type_line: 'Legendary Creature — Human Druid',
      oracle_text: 'You may put a non-Human creature card from among them onto the battlefield.',
      color_identity: ['G', 'U'],
    };
    expect(temasDoComandante(kinnan).map((t) => t.consulta)).not.toContain('t:human');
  });

  it('no máximo três temas', () => {
    const tudo: Candidata = {
      ...KILLIAN,
      oracle_text: 'token sacrifice graveyard artifact enchantment +1/+1 counter flying discard',
    };
    expect(temasDoComandante(tudo).length).toBeLessThanOrEqual(3);
  });

  it('lê o subtipo das duas faces', () => {
    expect(
      subtiposDe({
        name: 'x',
        card_faces: [
          { type_line: 'Legendary Creature — Human Werewolf' },
          { type_line: 'Legendary Creature — Werewolf' },
        ],
      }),
    ).toEqual(['Human', 'Werewolf']);
  });
});

describe('montarDeck', () => {
  it('cem cartas, 36 terrenos, singleton e o comandante no comando', () => {
    const { linhas, contagem } = montarDeck(KILLIAN, poolsCheios(), BASICOS, primeiro);

    expect(linhas.reduce((s, l) => s + l.quantity, 0)).toBe(100);
    expect(linhas.filter((l) => l.boardType === 'COMMANDER')).toEqual([
      { scryfallId: 'killian', quantity: 1, boardType: 'COMMANDER' },
    ]);
    const terrenos = (contagem['terrenos não básicos'] ?? 0) + (contagem['terrenos básicos'] ?? 0);
    expect(terrenos).toBe(MOLDE.terrenos);
    // Singleton: fora os básicos, cada id aparece uma vez, com quantidade 1.
    const naoBasicos = linhas.filter((l) => !Object.values(BASICOS).includes(l.scryfallId));
    expect(new Set(naoBasicos.map((l) => l.scryfallId)).size).toBe(naoBasicos.length);
    expect(naoBasicos.every((l) => l.quantity === 1)).toBe(true);
  });

  it('nunca escolhe Game Changer', () => {
    const pools = poolsCheios();
    pools.ramp = [...pool('gc', 30, { game_changer: true }), ...pools.ramp];
    const { linhas } = montarDeck(KILLIAN, pools, BASICOS, primeiro);
    expect(linhas.some((l) => l.scryfallId.startsWith('gc-'))).toBe(false);
  });

  it('pool magro (sem tema) ainda fecha cem cartas', () => {
    const pools = poolsCheios();
    pools.temaCriaturas = [];
    pools.temaOutras = [];
    pools.limpeza = pool('limpeza', 1);
    const { linhas } = montarDeck(GHALTA, pools, BASICOS, primeiro);
    expect(linhas.reduce((s, l) => s + l.quantity, 0)).toBe(100);
  });

  it('comandante monocolor recebe só básicos da cor dele', () => {
    const { linhas } = montarDeck(GHALTA, poolsCheios(), BASICOS, primeiro);
    const basicos = linhas.filter((l) => Object.values(BASICOS).includes(l.scryfallId));
    expect(basicos.map((l) => l.scryfallId)).toEqual(['forest']);
  });
});

describe('dividirBasicos', () => {
  it('segue a demanda de cada cor, com pelo menos um de cada', () => {
    const partes = dividirBasicos(['W', 'B'], 28, ['{B}{B}{B}', '{B}{B}', '{1}{W}']);
    expect(partes.W! + partes.B!).toBe(28);
    expect(partes.B!).toBeGreaterThan(partes.W!);
    expect(partes.W!).toBeGreaterThanOrEqual(1);
  });

  it('comandante incolor recebe Wastes', () => {
    expect(dividirBasicos([], 30, [])).toEqual({ C: 30 });
  });
});
