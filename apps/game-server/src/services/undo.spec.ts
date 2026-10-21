/**
 * undo.spec.ts — o MEMENTO em si, sem o Command em volta.
 *
 * `intents/comandos.spec.ts` cobre o que o desfazer restaura pela mesa. Aqui
 * ficam as garantias do padrão: a foto é uma cópia (não muda junto com a
 * mesa), o caretaker só enxerga os metadados, e o originador recusa a foto que
 * não é dele.
 */

import { ZONES, zoneOrderKey } from '@aethertable/shared-types';

import { Card } from '../schema/Card';
import { Player } from '../schema/Player';
import { RoomState } from '../schema/RoomState';
import { ZoneOrderList } from '../schema/ZoneOrderList';
import { RecorteDoJogador, type MementoDoRecorte } from './undo';

function mesa() {
  const state = new RoomState();
  for (const sid of ['p1', 'p2']) {
    const p = new Player();
    p.id = sid;
    p.userId = `u-${sid}`;
    p.name = sid;
    state.players.set(sid, p);
    for (const zona of ZONES) state.zoneOrder.set(zoneOrderKey(sid, zona), new ZoneOrderList());
  }

  const c = new Card();
  c.id = 'c1';
  c.ownerId = 'p1';
  c.controllerId = 'p1';
  c.zone = 'BATTLEFIELD';
  state.cards.set('c1', c);
  state.zoneOrder.get(zoneOrderKey('p1', 'BATTLEFIELD'))!.items.push('c1');

  return { state, p1: state.players.get('p1')!, c };
}

describe('RecorteDoJogador (originator) e MementoDoRecorte', () => {
  it('salvar e restaurar devolvem o recorte ao que era', () => {
    const { state, p1, c } = mesa();
    const recorte = new RecorteDoJogador(state, 'p1');

    const memento = recorte.salvar('INTENT_TAP');
    c.isTapped = true;
    c.counters.set('+1/+1', 3);
    p1.life = 7;
    p1.commanderDamage.set('p2', 21);

    recorte.restaurar(memento);
    expect(c.isTapped).toBe(false);
    expect(c.counters.size).toBe(0);
    expect(p1.life).toBe(40);
    expect(p1.commanderDamage.size).toBe(0);
  });

  it('a foto é uma CÓPIA: mexer na mesa depois de salvar não muda o que volta', () => {
    // Guardar a referência do `MapSchema` em vez de copiar faria a foto andar
    // junto com a mesa, e o "desfazer" restauraria o estado já mutado.
    const { state, c } = mesa();
    c.counters.set('carga', 1);
    const recorte = new RecorteDoJogador(state, 'p1');

    const memento = recorte.salvar('INTENT_SET_COUNTER');
    c.counters.set('carga', 5);
    state.zoneOrder.get(zoneOrderKey('p1', 'BATTLEFIELD'))!.items.splice(0);

    recorte.restaurar(memento);
    expect(c.counters.get('carga')).toBe(1);
    expect(Array.from(state.zoneOrder.get(zoneOrderKey('p1', 'BATTLEFIELD'))!.items)).toEqual([
      'c1',
    ]);
  });

  it('o caretaker só enxerga autor, tipo e quando', () => {
    const { state } = mesa();
    const memento: MementoDoRecorte = new RecorteDoJogador(state, 'p1').salvar('INTENT_TAP', 1234);

    expect(memento.autor).toBe('p1');
    expect(memento.tipo).toBe('INTENT_TAP');
    expect(memento.em).toBe(1234);
    // @ts-expect-error — o conteúdo não faz parte da interface estreita.
    void memento.cartas;
  });

  it('recusa a foto de OUTRO jogador', () => {
    const { state } = mesa();
    const doP2 = new RecorteDoJogador(state, 'p2').salvar('INTENT_TAP');

    expect(() => new RecorteDoJogador(state, 'p1').restaurar(doP2)).toThrow(/não é deste recorte/);
  });

  it('recusa a foto de OUTRA mesa — os ids lá significam outras cartas', () => {
    const outraMesa = mesa().state;
    const { state } = mesa();
    const deOutraMesa = new RecorteDoJogador(outraMesa, 'p1').salvar('INTENT_TAP');

    expect(() => new RecorteDoJogador(state, 'p1').restaurar(deOutraMesa)).toThrow(
      /não é deste recorte/,
    );
  });

  it('recusa um memento montado à mão com o formato certo', () => {
    const { state, c } = mesa();
    const forjado = {
      autor: 'p1',
      tipo: 'INTENT_TAP',
      em: Date.now(),
      cartas: [['c1', { zone: 'GRAVEYARD' }]],
      zonas: [],
      jogador: null,
    } as MementoDoRecorte;

    expect(() => new RecorteDoJogador(state, 'p1').restaurar(forjado)).toThrow(
      /não é deste recorte/,
    );
    expect(c.zone).toBe('BATTLEFIELD');
  });

  it('não fotografa carta que não é do jogador nem está sob controle dele', () => {
    const { state } = mesa();
    const alheia = new Card();
    alheia.id = 'c2';
    alheia.ownerId = 'p2';
    alheia.controllerId = 'p2';
    alheia.zone = 'BATTLEFIELD';
    state.cards.set('c2', alheia);
    const recorte = new RecorteDoJogador(state, 'p1');

    const memento = recorte.salvar('INTENT_TAP');
    alheia.isTapped = true;
    recorte.restaurar(memento);

    expect(alheia.isTapped).toBe(true);
  });
});
