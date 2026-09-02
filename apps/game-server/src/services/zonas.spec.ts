/**
 * zonas.spec.ts — mutação de zona é a prioridade nº 2 do plano de testes
 * (DOC-052 §1.1): estado errado significa partida corrompida, e diferente de
 * um vazamento, ninguém percebe na hora.
 *
 * Os casos abaixo são exatamente os que DOC-052 §2.1 enumera.
 */

import { REGISTRY } from '../intents/registry';
import type { IntentContext, IntentHandler } from '../intents/registry';
import type { z } from 'zod';
import { RoomState } from '../schema/RoomState';
import { Player } from '../schema/Player';
import { Card } from '../schema/Card';
import { ZoneOrderList } from '../schema/ZoneOrderList';
import { ZONES, zoneOrderKey, type Zone } from '@aethertable/shared-types';

function mesa() {
  const state = new RoomState();
  for (const id of ['p1', 'p2']) {
    const p = new Player();
    p.id = id;
    p.userId = `u-${id}`;
    p.name = id === 'p1' ? 'Gaspare' : 'Rival';
    p.seat = id === 'p1' ? 0 : 1;
    state.players.set(id, p);
    for (const z of ZONES) state.zoneOrder.set(zoneOrderKey(id, z), new ZoneOrderList());
  }
  return state;
}

function carta(state: RoomState, id: string, dono: string, zona: Zone) {
  const c = new Card();
  c.id = id;
  c.ownerId = dono;
  c.controllerId = dono;
  c.zone = zona;
  c.scryfallId = `sc-${id}`;
  state.cards.set(id, c);
  const lista = state.zoneOrder.get(zoneOrderKey(dono, zona))?.items;
  if (zona !== 'BATTLEFIELD') lista?.push(id);
  return c;
}

/** Contexto mínimo: os handlers só falam com o estado através dele. */
function ctxDe(state: RoomState, sid: string) {
  const enviados: Array<{ evento: string; payload: unknown }> = [];
  const ctx: IntentContext = {
    state,
    client: { sessionId: sid } as never,
    clients: [],
    send: (evento, payload) => enviados.push({ evento, payload: payload as unknown }),
    broadcast: (evento, payload) => enviados.push({ evento, payload: payload as unknown }),
    log: () => {},
    desfazer: () => null,
    // A Room e quem sabe expulsar (ver `IntentContext.expulsar`): num contexto
    // de teste nao ha socket para derrubar.
    expulsar: () => {},
  };
  return { ctx, enviados };
}

/**
 * Dispara uma intenção como a Room dispara.
 *
 * O genérico de `IntentHandler` é apagado aqui de propósito — é o mesmo motivo
 * documentado em `registrarIntencoes`: ao indexar a tabela, o TypeScript
 * intersecta TODOS os payloads possíveis e o resultado é `never`, que nenhum
 * valor satisfaz. A correlação real entre `schema` e `executa` é garantida pelo
 * `satisfies` na declaração do REGISTRY.
 */
const executar = (nome: keyof typeof REGISTRY, ctx: IntentContext, payload: unknown) => {
  const h = REGISTRY[nome] as IntentHandler<z.ZodTypeAny>;
  h.executa(ctx, h.schema.parse(payload));
};

const ordem = (state: RoomState, sid: string, z: Zone) =>
  Array.from(state.zoneOrder.get(zoneOrderKey(sid, z))!.items);

/**
 * Ids de carta são UUID de verdade porque o schema Zod das intenções exige
 * (`z.string().uuid()`). Usar "a"/"b" faria todo teste falhar na validação
 * antes de chegar ao handler — e o teste estaria medindo o Zod, não a mutação.
 */
const uuid = (n: number) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const ID = {
  a: uuid(1),
  b: uuid(2),
  c: uuid(3),
  cmd: uuid(4),
  tk1: uuid(5),
  tk2: uuid(6),
  fora: uuid(9),
};

describe('mutação de zona (DOC-052 §2.1)', () => {
  it('comprar tira do FIM do grimório e põe na mão, atualizando as contagens', () => {
    const state = mesa();
    carta(state, ID.a, 'p1', 'LIBRARY');
    carta(state, ID.b, 'p1', 'LIBRARY');
    const { ctx } = ctxDe(state, 'p1');

    executar('INTENT_DRAW', ctx, { amount: 1 });

    // Topo do grimório = fim do array (DOC-032 §2).
    expect(ordem(state, 'p1', 'LIBRARY')).toEqual([ID.a]);
    expect(ordem(state, 'p1', 'HAND')).toEqual([ID.b]);
    expect(state.cards.get(ID.b)!.zone).toBe('HAND');
    expect(state.players.get('p1')!.handCount).toBe(1);
    expect(state.players.get('p1')!.libraryCount).toBe(1);
  });

  it('carta que sai do campo perde virado, marcadores e dano', () => {
    const state = mesa();
    const c = carta(state, ID.a, 'p1', 'BATTLEFIELD');
    c.isTapped = true;
    c.damage = 3;
    c.counters.set('+1/+1', 2);
    const { ctx } = ctxDe(state, 'p1');

    executar('INTENT_CHANGE_ZONE', ctx, { entityId: ID.a, targetZone: 'GRAVEYARD' });

    expect(c.zone).toBe('GRAVEYARD');
    expect(c.isTapped).toBe(false);
    expect(c.damage).toBe(0);
    expect(c.counters.size).toBe(0);
  });

  it('ficha deixa de existir fora do campo', () => {
    const state = mesa();
    const t = carta(state, ID.tk1, 'p1', 'BATTLEFIELD');
    t.isToken = true;
    const { ctx } = ctxDe(state, 'p1');

    executar('INTENT_CHANGE_ZONE', ctx, { entityId: ID.tk1, targetZone: 'GRAVEYARD' });

    expect(state.cards.has(ID.tk1)).toBe(false);
  });

  it('o CONTROLE volta ao dono ao sair do campo', () => {
    const state = mesa();
    const c = carta(state, ID.a, 'p1', 'BATTLEFIELD');

    // p2 rouba a criatura.
    const roubo = ctxDe(state, 'p2');
    c.controllerId = 'p2';
    expect(c.controllerId).toBe('p2');

    // ...e ela morre.
    executar('INTENT_CHANGE_ZONE', roubo.ctx, { entityId: ID.a, targetZone: 'GRAVEYARD' });

    // Sem este reset, p2 mantinha autorização CONTROLLER sobre uma carta que
    // agora está no cemitério de p1.
    expect(c.controllerId).toBe('p1');
    expect(c.ownerId).toBe('p1');
  });

  it('o controle é preservado enquanto a carta continua no campo', () => {
    const state = mesa();
    const c = carta(state, ID.a, 'p1', 'BATTLEFIELD');
    c.controllerId = 'p2';
    const { ctx } = ctxDe(state, 'p2');

    executar('INTENT_RELEASE', ctx, { entityId: ID.a, x: 10, y: 20 });

    expect(c.controllerId).toBe('p2');
  });

  it('marcador negativo zera em vez de virar negativo', () => {
    const state = mesa();
    const c = carta(state, ID.a, 'p1', 'BATTLEFIELD');
    c.counters.set('+1/+1', 3);
    const { ctx } = ctxDe(state, 'p1');

    executar('INTENT_ADD_COUNTER', ctx, { entityId: ID.a, name: '+1/+1', amount: -5 });

    expect(c.counters.get('+1/+1')).toBeUndefined();
  });

  it('a vida PODE ficar negativa — o motor não elimina ninguém (RN01)', () => {
    const state = mesa();
    const { ctx } = ctxDe(state, 'p1');

    executar('INTENT_SET_LIFE', ctx, { delta: -45 });

    expect(state.players.get('p1')!.life).toBe(-5);
    expect(state.players.get('p1')!.conceded).toBe(false);
  });

  it('moer move do topo para o cemitério e recalcula a contagem', () => {
    const state = mesa();
    carta(state, ID.a, 'p1', 'LIBRARY');
    carta(state, ID.b, 'p1', 'LIBRARY');
    carta(state, ID.c, 'p1', 'LIBRARY');
    const { ctx } = ctxDe(state, 'p1');

    executar('INTENT_MILL', ctx, { amount: 2, target: 'GRAVEYARD' });

    expect(ordem(state, 'p1', 'LIBRARY')).toEqual([ID.a]);
    expect(ordem(state, 'p1', 'GRAVEYARD')).toEqual([ID.c, ID.b]);
    expect(state.players.get('p1')!.libraryCount).toBe(1);
  });

  it('conjurar o comandante o tira do comando e cobra a taxa', () => {
    const state = mesa();
    const c = carta(state, ID.cmd, 'p1', 'COMMAND');
    const { ctx } = ctxDe(state, 'p1');

    executar('INTENT_CAST_COMMANDER', ctx, { entityId: ID.cmd });

    expect(c.zone).toBe('BATTLEFIELD');
    expect(ordem(state, 'p1', 'COMMAND')).toEqual([]);
    expect(state.players.get('p1')!.commanderTax).toBe(2);
  });

  it('desvirar tudo só afeta as permanentes de quem pediu', () => {
    const state = mesa();
    const minha = carta(state, ID.a, 'p1', 'BATTLEFIELD');
    const dele = carta(state, ID.b, 'p2', 'BATTLEFIELD');
    minha.isTapped = true;
    dele.isTapped = true;
    const { ctx } = ctxDe(state, 'p1');

    executar('INTENT_UNTAP_ALL', ctx, {});

    expect(minha.isTapped).toBe(false);
    expect(dele.isTapped).toBe(true);
  });

  it('limpar fichas remove só as próprias', () => {
    const state = mesa();
    const minha = carta(state, ID.tk1, 'p1', 'BATTLEFIELD');
    const dele = carta(state, ID.tk2, 'p2', 'BATTLEFIELD');
    minha.isToken = true;
    dele.isToken = true;
    const { ctx } = ctxDe(state, 'p1');

    executar('INTENT_CLEAR_TOKENS', ctx, {});

    expect(state.cards.has(ID.tk1)).toBe(false);
    expect(state.cards.has(ID.tk2)).toBe(true);
  });

  it('reordenar recusa uma lista que não seja permutação da zona', () => {
    const state = mesa();
    carta(state, ID.a, 'p1', 'LIBRARY');
    carta(state, ID.b, 'p1', 'LIBRARY');
    const { ctx, enviados } = ctxDe(state, 'p1');

    executar('INTENT_REORDER', ctx, {
      zone: 'LIBRARY',
      ids: [ID.a, ID.fora],
    });

    // Aceitar carta de fora seria mover carta alheia sem passar por CHANGE_ZONE.
    expect(ordem(state, 'p1', 'LIBRARY')).toEqual([ID.a, ID.b]);
    expect(enviados.some((e) => e.evento === 'error')).toBe(true);
  });
});

describe('nomes de marcador (COUNTER_NAME_PATTERN)', () => {
  it('aceita "+1/+1" e "-1/-1" — os dois contadores mais usados de Magic', () => {
    const state = mesa();
    const c = carta(state, ID.a, 'p1', 'BATTLEFIELD');
    const { ctx } = ctxDe(state, 'p1');

    // O padrão não tinha `/`: a intenção saía do cliente e o servidor
    // devolvia INVALID_PAYLOAD. Todo botão de +1/+1 da mesa era inerte.
    executar('INTENT_ADD_COUNTER', ctx, { entityId: ID.a, name: '+1/+1', amount: 2 });
    executar('INTENT_ADD_COUNTER', ctx, { entityId: ID.a, name: '-1/-1', amount: 1 });

    expect(c.counters.get('+1/+1')).toBe(2);
    expect(c.counters.get('-1/-1')).toBe(1);
  });

  it('continua recusando o que viraria label de métrica ou XSS', () => {
    const state = mesa();
    carta(state, ID.a, 'p1', 'BATTLEFIELD');
    const { ctx } = ctxDe(state, 'p1');

    for (const nome of ['<script>', 'a'.repeat(25), 'COM MAIÚSCULA', 'espaço aqui', '']) {
      expect(() =>
        executar('INTENT_ADD_COUNTER', ctx, { entityId: ID.a, name: nome, amount: 1 }),
      ).toThrow();
    }
  });
});
