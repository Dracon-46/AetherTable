/**
 * pilha.spec.ts — a zona STACK, que existia no contrato e nada usava.
 *
 * O que estes casos fixam:
 *
 *   - a ordem da pilha é da MESA: a resposta do oponente fica por cima da
 *     mágica que ela responde, mesmo com cada dono tendo a própria lista em
 *     `zoneOrder`;
 *   - a cópia de uma mágica (Twincast) é uma ficha que vive na pilha e deixa
 *     de existir ao sair dela — a regra "ficha some fora do campo" ganhou a
 *     pilha como exceção, e só ela;
 *   - conjurar o comandante PELA PILHA cobra o imposto uma vez, na saída da
 *     zona de comando, e não de novo quando a pilha resolve.
 */

import { randomUUID } from 'node:crypto';
import { REGISTRY } from './registry';
import { RoomState } from '../schema/RoomState';
import { Player } from '../schema/Player';
import { Card } from '../schema/Card';
import { ZoneOrderList } from '../schema/ZoneOrderList';
import { zoneOrderKey, ZONES } from '@aethertable/shared-types';
import type { IntentContext } from './registry';

function mesa(ids: string[]) {
  const state = new RoomState();
  ids.forEach((id, i) => {
    const p = new Player();
    p.id = id;
    p.name = id.toUpperCase();
    p.seat = i;
    state.players.set(id, p);
    for (const zone of ZONES) state.zoneOrder.set(zoneOrderKey(id, zone), new ZoneOrderList());
  });
  return state;
}

function carta(state: RoomState, dono: string, zona: string, extra: Partial<Card> = {}): Card {
  const c = new Card();
  c.id = randomUUID();
  c.ownerId = dono;
  c.controllerId = dono;
  c.zone = zona;
  c.scryfallId = `sf-${c.id.slice(0, 6)}`;
  Object.assign(c, extra);
  state.cards.set(c.id, c);
  state.zoneOrder.get(zoneOrderKey(dono, zona as never))?.items.push(c.id);
  return c;
}

function contexto(state: RoomState, sid: string): IntentContext {
  return {
    state,
    client: { sessionId: sid } as IntentContext['client'],
    clients: [],
    send: () => {},
    broadcast: () => {},
    log: () => {},
    desfazer: () => null,
    expulsar: () => {},
  };
}

function executar(nome: string, ctx: IntentContext, payload: unknown) {
  const handler = REGISTRY[nome as keyof typeof REGISTRY];
  (handler.executa as (c: IntentContext, p: unknown) => void)(ctx, payload);
}

const pilha = (state: RoomState) =>
  [...state.cards.values()].filter((c) => c.zone === 'STACK').sort((a, b) => b.zIndex - a.zIndex);

describe('a pilha da mesa', () => {
  it('a resposta do oponente fica POR CIMA da mágica que ela responde', () => {
    const state = mesa(['ana', 'bia']);
    const bolt = carta(state, 'ana', 'HAND');
    const counter = carta(state, 'bia', 'HAND');

    executar('INTENT_CHANGE_ZONE', contexto(state, 'ana'), {
      entityId: bolt.id,
      targetZone: 'STACK',
    });
    executar('INTENT_CHANGE_ZONE', contexto(state, 'bia'), {
      entityId: counter.id,
      targetZone: 'STACK',
    });

    expect(pilha(state).map((c) => c.id)).toEqual([counter.id, bolt.id]);
  });

  it('copiar uma mágica na pilha cria uma ficha de quem copiou, no topo', () => {
    const state = mesa(['ana', 'bia']);
    const bolt = carta(state, 'ana', 'HAND');
    executar('INTENT_CHANGE_ZONE', contexto(state, 'ana'), {
      entityId: bolt.id,
      targetZone: 'STACK',
    });

    // Twincast da Bia na mágica da Ana.
    executar('INTENT_COPY_CARD', contexto(state, 'bia'), { entityId: bolt.id, destino: 'STACK' });

    const [topo] = pilha(state);
    expect(topo!.id).not.toBe(bolt.id);
    expect(topo).toMatchObject({ isCopy: true, isToken: true, ownerId: 'bia', zone: 'STACK' });
    expect(topo!.scryfallId).toBe(bolt.scryfallId);
  });

  it('a cópia some quando sai da pilha; a ficha que ENTRA na pilha não', () => {
    const state = mesa(['ana']);
    const bolt = carta(state, 'ana', 'HAND');
    const ctx = contexto(state, 'ana');
    executar('INTENT_CHANGE_ZONE', ctx, { entityId: bolt.id, targetZone: 'STACK' });
    executar('INTENT_COPY_CARD', ctx, { entityId: bolt.id, destino: 'STACK' });
    const copia = pilha(state)[0]!;

    expect(state.cards.has(copia.id)).toBe(true);
    executar('INTENT_CHANGE_ZONE', ctx, { entityId: copia.id, targetZone: 'GRAVEYARD' });
    expect(state.cards.has(copia.id)).toBe(false);
    // A original continua — e vai para o cemitério normalmente.
    executar('INTENT_CHANGE_ZONE', ctx, { entityId: bolt.id, targetZone: 'GRAVEYARD' });
    expect(state.cards.get(bolt.id)!.zone).toBe('GRAVEYARD');
  });

  it('comandante pela pilha: imposto na saída do comando, e não de novo ao resolver', () => {
    const state = mesa(['ana']);
    const cmd = carta(state, 'ana', 'COMMAND', { isCommander: true });
    const ctx = contexto(state, 'ana');

    executar('INTENT_CHANGE_ZONE', ctx, { entityId: cmd.id, targetZone: 'STACK' });
    expect(state.players.get('ana')!.commanderTax).toBe(2);

    executar('INTENT_CHANGE_ZONE', ctx, { entityId: cmd.id, targetZone: 'BATTLEFIELD' });
    expect(state.players.get('ana')!.commanderTax).toBe(2);
  });

  it('copiar sem dizer o destino continua criando a cópia no campo', () => {
    const state = mesa(['ana']);
    const criatura = carta(state, 'ana', 'BATTLEFIELD');
    executar('INTENT_COPY_CARD', contexto(state, 'ana'), {
      entityId: criatura.id,
      destino: 'BATTLEFIELD',
    });
    const copias = [...state.cards.values()].filter((c) => c.isCopy);
    expect(copias).toHaveLength(1);
    expect(copias[0]!.zone).toBe('BATTLEFIELD');
  });
});
