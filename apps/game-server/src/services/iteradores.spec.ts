/**
 * iteradores.spec.ts — o que o padrão Iterator passou a garantir sozinho.
 *
 * Os casos aqui NÃO repetem `zonas.spec.ts`: lá o que se verifica é o efeito da
 * intenção sobre o estado; aqui é o contrato da travessia — quem para quando,
 * quem tira da zona e quem não tira, e as duas armadilhas que só o agregado
 * conhece (topo é o fim do array, e reordenar não pode usar `splice` com itens).
 */

import { ArraySchema } from '@colyseus/schema';
import { ZONES, zoneOrderKey, type Zone } from '@aethertable/shared-types';

import { Card } from '../schema/Card';
import { Player } from '../schema/Player';
import { RoomState } from '../schema/RoomState';
import { ZoneOrderList } from '../schema/ZoneOrderList';
import { MesaDeAssentos, ZonaDeCartas } from './iteradores';

function mesa(ids: string[] = ['p1', 'p2']) {
  const state = new RoomState();
  ids.forEach((id, i) => {
    const p = new Player();
    p.id = id;
    p.userId = `u-${id}`;
    p.name = id.toUpperCase();
    p.seat = i;
    state.players.set(id, p);
    for (const z of ZONES) state.zoneOrder.set(zoneOrderKey(id, z), new ZoneOrderList());
  });
  return state;
}

/** Enche a zona do fundo para o topo: o último id é o topo. */
function encher(state: RoomState, dono: string, zona: Zone, quantos: number) {
  const criados: string[] = [];
  for (let i = 0; i < quantos; i += 1) {
    const id = `${dono}-${zona}-${i}`;
    const c = new Card();
    c.id = id;
    c.ownerId = dono;
    c.controllerId = dono;
    c.zone = zona;
    c.scryfallId = `sc-${id}`;
    state.cards.set(id, c);
    state.zoneOrder.get(zoneOrderKey(dono, zona))!.items.push(id);
    criados.push(id);
  }
  return criados;
}

const zonaDe = (state: RoomState, dono: string, zona: Zone) => ZonaDeCartas.de(state, dono, zona)!;

const lista = (state: RoomState, dono: string, zona: Zone) =>
  Array.from(state.zoneOrder.get(zoneOrderKey(dono, zona))!.items);

describe('ZonaDeCartas — o agregado', () => {
  it('devolve null quando a zona não existe para aquele jogador', () => {
    const state = mesa();
    expect(ZonaDeCartas.de(state, 'fantasma', 'LIBRARY')).toBeNull();
  });

  it('o topo é o FIM do array (DOC-032 §2)', () => {
    const state = mesa();
    const ids = encher(state, 'p1', 'LIBRARY', 3);

    expect(zonaDe(state, 'p1', 'LIBRARY').idsDoTopo(2)).toEqual([ids[2], ids[1]]);
  });
});

describe('travessia de leitura', () => {
  it('não tira nada da zona', () => {
    const state = mesa();
    encher(state, 'p1', 'LIBRARY', 5);
    const grimorio = zonaDe(state, 'p1', 'LIBRARY');

    const vistas = [...grimorio.percorrer('TOPO', 3)];

    expect(vistas).toHaveLength(3);
    expect(grimorio.tamanho).toBe(5);
  });

  it('respeita o limite, e para antes quando a zona acaba', () => {
    const state = mesa();
    encher(state, 'p1', 'LIBRARY', 2);
    const grimorio = zonaDe(state, 'p1', 'LIBRARY');

    expect([...grimorio.percorrer('TOPO', 10)]).toHaveLength(2);
  });

  it('pula id órfão — carta que deixou de existir não interrompe a travessia', () => {
    // Uma ficha que sai do campo é apagada de `state.cards`, mas o id continua
    // na lista da zona de destino. Era o `if (!c) continue` de cada handler.
    const state = mesa();
    const ids = encher(state, 'p1', 'GRAVEYARD', 3);
    state.cards.delete(ids[1]!);

    const vistas = [...zonaDe(state, 'p1', 'GRAVEYARD').percorrer('FUNDO')].map((c) => c.id);

    expect(vistas).toEqual([ids[0], ids[2]]);
  });
});

describe('travessia que retira', () => {
  it('só tira quando o consumidor pede a próxima carta', () => {
    // Se o iterador adiantasse a primeira carta no construtor, `retirar(...)`
    // sozinho já teria comprado — e a carta sumiria sem ir para lugar nenhum.
    const state = mesa();
    encher(state, 'p1', 'LIBRARY', 4);
    const grimorio = zonaDe(state, 'p1', 'LIBRARY');

    const travessia = grimorio.retirar('TOPO', 2);
    expect(grimorio.tamanho).toBe(4);

    travessia.proximo();
    expect(grimorio.tamanho).toBe(3);
  });

  it('tira do topo, na ordem do topo para baixo', () => {
    const state = mesa();
    const ids = encher(state, 'p1', 'LIBRARY', 4);
    const grimorio = zonaDe(state, 'p1', 'LIBRARY');

    const tiradas = [...grimorio.retirar('TOPO', 2)].map((c) => c.id);

    expect(tiradas).toEqual([ids[3], ids[2]]);
    expect(lista(state, 'p1', 'LIBRARY')).toEqual([ids[0], ids[1]]);
  });

  it('ao acaso tira cartas distintas e esvazia a zona pedida', () => {
    const state = mesa();
    encher(state, 'p1', 'HAND', 5);
    const mao = zonaDe(state, 'p1', 'HAND');

    const tiradas = [...mao.retirar('ACASO', 3)].map((c) => c.id);

    expect(new Set(tiradas).size).toBe(3);
    expect(mao.tamanho).toBe(2);
  });

  it('pedir mais do que existe esvazia a zona e para', () => {
    const state = mesa();
    encher(state, 'p1', 'LIBRARY', 2);
    const grimorio = zonaDe(state, 'p1', 'LIBRARY');

    expect([...grimorio.retirar('TOPO', 7)]).toHaveLength(2);
    expect(grimorio.tamanho).toBe(0);
  });
});

describe('reordenar', () => {
  /**
   * ─── A REGRESSÃO QUE MOTIVA O MÉTODO ────────────────────────────────────
   *
   * `ArraySchema.splice(0, length, ...ids)` deixa a lista com o conteúdo certo
   * e quebra o `pop()` a partir dali: ele passa a devolver `undefined` sem
   * encolher a lista. Quem embaralhasse e comprasse em seguida comprava zero
   * cartas — em silêncio, porque `pop()` não lança.
   */
  it('mantém o pop funcionando depois de reescrever a ordem', () => {
    const itens = new ArraySchema<string>();
    for (let i = 0; i < 5; i += 1) itens.push(`c${i}`);

    // O jeito quebrado, para o teste provar que o problema existe:
    const espelho = new ArraySchema<string>();
    for (let i = 0; i < 5; i += 1) espelho.push(`c${i}`);
    espelho.splice(0, espelho.length, ...Array.from(espelho).reverse());
    expect(espelho.pop()).toBeUndefined();

    // E o jeito do agregado:
    const state = mesa();
    const ids = encher(state, 'p1', 'LIBRARY', 5);
    const grimorio = zonaDe(state, 'p1', 'LIBRARY');
    grimorio.reordenar([...ids].reverse());

    expect([...grimorio.retirar('TOPO', 1)]).toHaveLength(1);
    expect(grimorio.tamanho).toBe(4);
    expect(itens.length).toBe(5);
  });
});

describe('IteradorDeTurno — a vez na mesa', () => {
  it('gira em círculo e avisa quando deu a volta', () => {
    const state = mesa(['p1', 'p2', 'p3']);
    state.activePlayerId = 'p1';
    const rotacao = new MesaDeAssentos(state).aPartirDaVez();

    expect(rotacao.proximo()!.id).toBe('p2');
    expect(rotacao.deuVolta()).toBe(false);
    expect(rotacao.proximo()!.id).toBe('p3');
    expect(rotacao.deuVolta()).toBe(false);
    expect(rotacao.proximo()!.id).toBe('p1');
    expect(rotacao.deuVolta()).toBe(true);
  });

  it('sem ninguém na vez, começa no assento 0 — é o que destrava a mesa', () => {
    const state = mesa(['p1', 'p2']);
    state.activePlayerId = '';

    expect(new MesaDeAssentos(state).aPartirDaVez().proximo()!.id).toBe('p1');
  });

  it('a ordem é a dos assentos, não a de entrada no mapa', () => {
    const state = mesa(['p1', 'p2', 'p3']);
    state.players.get('p1')!.seat = 2;
    state.players.get('p3')!.seat = 0;
    state.activePlayerId = 'p3';

    expect(new MesaDeAssentos(state).aPartirDaVez().proximo()!.id).toBe('p2');
  });

  it('mesa vazia não tem próximo', () => {
    const state = mesa([]);
    const mesaVazia = new MesaDeAssentos(state);

    expect(mesaVazia.vazia).toBe(true);
    expect(mesaVazia.aPartirDaVez().proximo()).toBeUndefined();
  });
});
