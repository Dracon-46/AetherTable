/**
 * sorteios.spec.ts — o esqueleto da família de sorteio, e o que cada subclasse
 * acrescenta a ele.
 *
 * O primeiro bloco testa o METODO-TEMPLATE com uma subclasse de mentira: é o
 * único jeito de verificar a ORDEM dos passos, que é justamente o que a
 * classe-base existe para garantir. Os demais verificam que cada intenção real
 * continua fazendo o que fazia antes de virar subclasse.
 */

import { z } from 'zod';
import { ZONES, zoneOrderKey, type LogEvent, type Zone } from '@aethertable/shared-types';

import { Card } from '../schema/Card';
import { Player } from '../schema/Player';
import { RoomState } from '../schema/RoomState';
import { ZoneOrderList } from '../schema/ZoneOrderList';
import { criarLog } from '../services/log';
import {
  AcaoDeSorteio,
  DescartarAoAcaso,
  GirarMoeda,
  RolarDado,
  SortearCarta,
  SortearJogador,
} from './sorteios';
import type { IntentContext } from './registry';

function mesa(ids = ['p1', 'p2']) {
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

function ctxDe(state: RoomState, sid = 'p1') {
  const enviados: Array<{ evento: string; payload: unknown }> = [];
  const transmitidos: Array<{ evento: string; payload: unknown }> = [];
  const logs: LogEvent[] = [];
  const ctx = {
    state,
    client: { sessionId: sid },
    clients: [],
    send: (evento: string, payload: unknown) => enviados.push({ evento, payload }),
    broadcast: (evento: string, payload: unknown) => transmitidos.push({ evento, payload }),
    log: (entrada: LogEvent) => logs.push(entrada),
    desfazer: () => null,
    expulsar: () => {},
  } as unknown as IntentContext;
  return { ctx, enviados, transmitidos, logs };
}

const listaDe = (state: RoomState, sid: string, zona: Zone) =>
  Array.from(state.zoneOrder.get(zoneOrderKey(sid, zona))!.items);

describe('o método-template', () => {
  /** Subclasse de mentira: só anota em que ordem foi chamada. */
  class Espia extends AcaoDeSorteio<z.ZodTypeAny, number> {
    readonly schema = z.object({});
    readonly passos: string[] = [];
    resultado: number | null = 7;
    pode = true;

    protected override permitido(): boolean {
      this.passos.push('permitido');
      return this.pode;
    }
    protected override sortear(): number | null {
      this.passos.push('sortear');
      return this.resultado;
    }
    protected override aplicar(): void {
      this.passos.push('aplicar');
    }
    protected override anunciar(): void {
      this.passos.push('anunciar');
    }
    protected override narrar(ctx: IntentContext): LogEvent {
      this.passos.push('narrar');
      return criarLog('DICE', ctx.client.sessionId, 'espiã');
    }
  }

  it('roda os cinco passos na ordem, e registra no log por último', () => {
    const { ctx, logs } = ctxDe(mesa());
    const espia = new Espia();

    espia.executa(ctx, {});

    expect(espia.passos).toEqual(['permitido', 'sortear', 'aplicar', 'anunciar', 'narrar']);
    expect(logs).toHaveLength(1);
  });

  it('`permitido` falso interrompe antes do sorteio', () => {
    const { ctx, logs } = ctxDe(mesa());
    const espia = new Espia();
    espia.pode = false;

    espia.executa(ctx, {});

    expect(espia.passos).toEqual(['permitido']);
    expect(logs).toHaveLength(0);
  });

  it('sorteio sem resultado não aplica, não anuncia e não registra', () => {
    const { ctx, logs } = ctxDe(mesa());
    const espia = new Espia();
    espia.resultado = null;

    espia.executa(ctx, {});

    expect(espia.passos).toEqual(['permitido', 'sortear']);
    expect(logs).toHaveLength(0);
  });
});

describe('dado e moeda', () => {
  it('o dado transmite o resultado e registra no log', () => {
    const { ctx, transmitidos, logs } = ctxDe(mesa());

    new RolarDado().executa(ctx, { sides: 20 });

    expect(transmitidos).toHaveLength(1);
    const payload = transmitidos[0]!.payload as { sides: number; result: number };
    expect(transmitidos[0]!.evento).toBe('dice');
    expect(payload.sides).toBe(20);
    expect(payload.result).toBeGreaterThanOrEqual(1);
    expect(payload.result).toBeLessThanOrEqual(20);
    expect(logs).toHaveLength(1);
  });

  it('a moeda transmite CARA ou COROA — e não só escreve no log', () => {
    const { ctx, transmitidos, logs } = ctxDe(mesa());

    new GirarMoeda().executa(ctx, {});

    expect(transmitidos[0]!.evento).toBe('coin');
    expect(['CARA', 'COROA']).toContain((transmitidos[0]!.payload as { result: string }).result);
    expect(logs).toHaveLength(1);
  });
});

describe('sorteio de jogador', () => {
  it('escolhe alguém da mesa e anuncia pelo log, sem evento próprio', () => {
    const state = mesa(['p1', 'p2', 'p3']);
    const { ctx, transmitidos, logs } = ctxDe(state);

    new SortearJogador().executa(ctx, {});

    expect(transmitidos).toHaveLength(0);
    expect(logs).toHaveLength(1);
    expect(['P1', 'P2', 'P3'].some((n) => logs[0]!.text.includes(n))).toBe(true);
  });

  it('mesa vazia: nada acontece', () => {
    const { ctx, logs } = ctxDe(mesa([]));

    new SortearJogador().executa(ctx, {});

    expect(logs).toHaveLength(0);
  });
});

describe('sorteio de carta', () => {
  it('a identidade vai SÓ para o dono — um broadcast aqui vazaria a mão', () => {
    const state = mesa();
    const ids = encher(state, 'p1', 'HAND', 3);
    const { ctx, enviados, transmitidos, logs } = ctxDe(state);

    new SortearCarta().executa(ctx, { zone: 'HAND' });

    expect(transmitidos).toHaveLength(0);
    expect(enviados[0]!.evento).toBe('revealToOwner');
    const cartas = (enviados[0]!.payload as { cards: Array<{ id: string }> }).cards;
    expect(ids).toContain(cartas[0]!.id);
    // O log é público e por isso é neutro: diz a zona, nunca a carta.
    expect(logs[0]!.text).not.toContain(cartas[0]!.id);
  });

  it('zona vazia: nada é enviado', () => {
    const { ctx, enviados, logs } = ctxDe(mesa());

    new SortearCarta().executa(ctx, { zone: 'HAND' });

    expect(enviados).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });
});

describe('descarte ao acaso', () => {
  it('move a quantidade pedida para o cemitério, sem repetir carta', () => {
    const state = mesa();
    encher(state, 'p1', 'HAND', 5);
    const { ctx, logs } = ctxDe(state);

    new DescartarAoAcaso().executa(ctx, { amount: 2 });

    expect(listaDe(state, 'p1', 'HAND')).toHaveLength(3);
    const cemiterio = listaDe(state, 'p1', 'GRAVEYARD');
    expect(cemiterio).toHaveLength(2);
    expect(new Set(cemiterio).size).toBe(2);
    expect(state.players.get('p1')!.handCount).toBe(3);
    expect(logs[0]!.text).toContain('2 carta(s)');
  });

  it('pedir mais do que existe descarta o que existe', () => {
    const state = mesa();
    encher(state, 'p1', 'HAND', 2);
    const { ctx } = ctxDe(state);

    new DescartarAoAcaso().executa(ctx, { amount: 9 });

    expect(listaDe(state, 'p1', 'HAND')).toHaveLength(0);
    expect(listaDe(state, 'p1', 'GRAVEYARD')).toHaveLength(2);
  });

  it('mão vazia: nada acontece, e nada vai para o log', () => {
    const { ctx, logs } = ctxDe(mesa());

    new DescartarAoAcaso().executa(ctx, { amount: 1 });

    expect(logs).toHaveLength(0);
  });
});
