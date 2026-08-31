/**
 * undo.spec.ts — a janela de arrependimento não pode virar uma segunda
 * tentativa. Estes testes fixam as duas metades da regra: o que ela restaura, e
 * o que ela se recusa a restaurar.
 */

import { JornalUndo, NAO_REVERSIVEIS, JANELA_UNDO_MS } from './undo';
import { RoomState } from '../schema/RoomState';
import { Player } from '../schema/Player';
import { Card } from '../schema/Card';
import { ZoneOrderList } from '../schema/ZoneOrderList';
import { ZONES, zoneOrderKey } from '@aethertable/shared-types';

function mesa() {
  const state = new RoomState();
  const p = new Player();
  p.id = 'p1';
  p.userId = 'u1';
  p.name = 'Gaspare';
  state.players.set('p1', p);
  for (const zona of ZONES) state.zoneOrder.set(zoneOrderKey('p1', zona), new ZoneOrderList());

  const c = new Card();
  c.id = 'c1';
  c.ownerId = 'p1';
  c.controllerId = 'p1';
  c.zone = 'BATTLEFIELD';
  state.cards.set('c1', c);

  return { state, p, c };
}

describe('JornalUndo', () => {
  it('restaura propriedade de carta alterada', () => {
    const { state, c } = mesa();
    const jornal = new JornalUndo();

    jornal.registrar(state, 'p1', 'INTENT_TAP');
    c.isTapped = true;

    expect(jornal.desfazer(state, 'p1')).toBe('INTENT_TAP');
    expect(c.isTapped).toBe(false);
  });

  it('restaura vida e contadores do jogador', () => {
    const { state, p } = mesa();
    const jornal = new JornalUndo();

    jornal.registrar(state, 'p1', 'INTENT_SET_LIFE');
    p.life = 12;
    p.poison = 5;

    jornal.desfazer(state, 'p1');
    expect(p.life).toBe(40);
    expect(p.poison).toBe(0);
  });

  it('restaura a ordem das zonas depois de uma troca de zona', () => {
    const { state, c } = mesa();
    const jornal = new JornalUndo();
    const mao = state.zoneOrder.get(zoneOrderKey('p1', 'HAND'))!.items;

    jornal.registrar(state, 'p1', 'INTENT_CHANGE_ZONE');
    mao.push('c1');
    c.zone = 'HAND';

    jornal.desfazer(state, 'p1');
    expect(c.zone).toBe('BATTLEFIELD');
    expect(mao.length).toBe(0);
  });

  it('NÃO registra ação aleatória — desfazer um sorteio é uma segunda tentativa', () => {
    const { state, c } = mesa();
    const jornal = new JornalUndo();

    jornal.registrar(state, 'p1', 'INTENT_TAP');
    c.isTapped = true;
    // Uma ação irreversível invalida o passado.
    jornal.registrar(state, 'p1', 'INTENT_SHUFFLE');

    expect(jornal.desfazer(state, 'p1')).toBeNull();
    expect(c.isTapped).toBe(true);
  });

  it('recusa fora da janela de 10 s', () => {
    const { state, c } = mesa();
    const jornal = new JornalUndo();

    jornal.registrar(state, 'p1', 'INTENT_TAP');
    c.isTapped = true;

    expect(jornal.desfazer(state, 'p1', Date.now() + JANELA_UNDO_MS + 1)).toBeNull();
    expect(c.isTapped).toBe(true);
  });

  it('não empilha: um undo consome o único snapshot', () => {
    const { state, c } = mesa();
    const jornal = new JornalUndo();

    jornal.registrar(state, 'p1', 'INTENT_TAP');
    c.isTapped = true;
    jornal.desfazer(state, 'p1');

    expect(jornal.desfazer(state, 'p1')).toBeNull();
  });

  it('trata revelação e olhada como irreversíveis', () => {
    for (const intent of ['INTENT_REVEAL', 'INTENT_PEEK', 'INTENT_SEARCH_ZONE', 'INTENT_SCRY']) {
      expect(NAO_REVERSIVEIS.has(intent)).toBe(true);
    }
  });

  it('só toca o recorte do próprio jogador', () => {
    const { state } = mesa();
    const outra = new Card();
    outra.id = 'c2';
    outra.ownerId = 'p2';
    outra.controllerId = 'p2';
    outra.zone = 'BATTLEFIELD';
    state.cards.set('c2', outra);

    const jornal = new JornalUndo();
    jornal.registrar(state, 'p1', 'INTENT_TAP');
    outra.isTapped = true;

    jornal.desfazer(state, 'p1');
    // A carta de p2 continua virada: o undo de p1 não reescreve a mesa alheia.
    expect(outra.isTapped).toBe(true);
  });
});
