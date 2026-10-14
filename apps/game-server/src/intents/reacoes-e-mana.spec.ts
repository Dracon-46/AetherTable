/**
 * reacoes-e-mana.spec.ts — dois recursos da mesa que NÃO são jogada.
 *
 * Reação e rastreador de mana têm em comum o que não fazem: a reação não muda
 * estado nem entra no log (o log é a auditoria da partida), e o pool de mana
 * não é consumido nem esvaziado pelo servidor (RN01: não há motor de regras).
 * Os casos abaixo fixam esses "nãos" tanto quanto o que eles fazem.
 */

import { REGISTRY } from './registry';
import * as S from './schemas';
import { RoomState } from '../schema/RoomState';
import { Player } from '../schema/Player';
import type { IntentContext } from './registry';

function mesa(ids: string[]) {
  const state = new RoomState();
  ids.forEach((id, i) => {
    const p = new Player();
    p.id = id;
    p.name = id.toUpperCase();
    p.seat = i;
    state.players.set(id, p);
  });
  return state;
}

function contexto(state: RoomState, sid: string) {
  const transmitidos: Array<{ evento: string; payload: unknown }> = [];
  const logs: unknown[] = [];
  const ctx = {
    state,
    client: { sessionId: sid } as IntentContext['client'],
    clients: [] as unknown as IntentContext['clients'],
    send: () => {},
    broadcast: (evento: string, payload: unknown) => transmitidos.push({ evento, payload }),
    log: (l: unknown) => logs.push(l),
    desfazer: () => null,
    expulsar: () => {},
  } as unknown as IntentContext;
  return { ctx, transmitidos, logs };
}

function executar(nome: string, ctx: IntentContext, payload: unknown) {
  const handler = REGISTRY[nome as keyof typeof REGISTRY]!;
  (handler.executa as (c: IntentContext, p: unknown) => void)(ctx, payload);
}

describe('INTENT_REACTION', () => {
  it('vira um broadcast com quem reagiu, e nada no log', () => {
    const { ctx, transmitidos, logs } = contexto(mesa(['ana', 'bia']), 'ana');

    executar('INTENT_REACTION', ctx, { tipo: 'UAU' });

    expect(transmitidos).toEqual([
      { evento: 'reaction', payload: { actorId: 'ana', tipo: 'UAU' } },
    ]);
    expect(logs).toHaveLength(0);
  });

  it('o schema recusa reação que não existe', () => {
    expect(S.ReactionIntent.safeParse({ tipo: 'POLEGAR' }).success).toBe(true);
    expect(S.ReactionIntent.safeParse({ tipo: 'XINGAMENTO' }).success).toBe(false);
  });
});

describe('INTENT_MANA_POOL', () => {
  it('soma e tira por cor, sem passar de 0 nem de 99', () => {
    const state = mesa(['ana']);
    const { ctx } = contexto(state, 'ana');
    const pool = () => Object.fromEntries(state.players.get('ana')!.manaPool.entries());

    executar('INTENT_MANA_POOL', ctx, { acao: 'AJUSTAR', cor: 'R', delta: 3 });
    executar('INTENT_MANA_POOL', ctx, { acao: 'AJUSTAR', cor: 'G', delta: 1 });
    expect(pool()).toEqual({ R: 3, G: 1 });

    executar('INTENT_MANA_POOL', ctx, { acao: 'AJUSTAR', cor: 'R', delta: -10 });
    // Zero sai do mapa: "zerado" e "vazio" são a mesma coisa aqui.
    expect(pool()).toEqual({ G: 1 });

    executar('INTENT_MANA_POOL', ctx, { acao: 'AJUSTAR', cor: 'C', delta: 99 });
    executar('INTENT_MANA_POOL', ctx, { acao: 'AJUSTAR', cor: 'C', delta: 5 });
    expect(pool().C).toBe(99);
  });

  it('limpar esvazia o pool inteiro', () => {
    const state = mesa(['ana']);
    const { ctx } = contexto(state, 'ana');
    executar('INTENT_MANA_POOL', ctx, { acao: 'AJUSTAR', cor: 'U', delta: 2 });
    executar('INTENT_MANA_POOL', ctx, { acao: 'AJUSTAR', cor: 'B', delta: 4 });

    executar('INTENT_MANA_POOL', ctx, { acao: 'LIMPAR' });

    expect(state.players.get('ana')!.manaPool.size).toBe(0);
  });

  it('só mexe no pool de quem pediu — não existe alvo no payload', () => {
    const state = mesa(['ana', 'bia']);
    executar('INTENT_MANA_POOL', contexto(state, 'bia').ctx, {
      acao: 'AJUSTAR',
      cor: 'W',
      delta: 2,
    });

    expect(state.players.get('ana')!.manaPool.size).toBe(0);
    expect(state.players.get('bia')!.manaPool.get('W')).toBe(2);
    // Um `playerId` enfiado no payload é ignorado pelo zod, não obedecido.
    const comAlvo = S.ManaPoolIntent.safeParse({
      acao: 'AJUSTAR',
      cor: 'W',
      delta: 1,
      playerId: 'ana',
    });
    expect(comAlvo.success && 'playerId' in comAlvo.data).toBe(false);
  });

  it('o schema recusa cor inventada e delta absurdo', () => {
    expect(S.ManaPoolIntent.safeParse({ acao: 'AJUSTAR', cor: 'X', delta: 1 }).success).toBe(false);
    expect(S.ManaPoolIntent.safeParse({ acao: 'AJUSTAR', cor: 'R', delta: 500 }).success).toBe(
      false,
    );
    expect(S.ManaPoolIntent.safeParse({ acao: 'LIMPAR' }).success).toBe(true);
  });
});
