/**
 * olhada.spec.ts — "olhar X do topo" mostra as cartas e deixa rearrumá-las.
 *
 * ─── O DEFEITO QUE ESTES CASOS FIXAM ───────────────────────────────────────
 *
 * "Olhar X do topo" e "olhar o fundo" concediam a olhada e mandavam as cartas
 * ao dono, mas o evento não dizia POR QUE elas chegavam — a busca (tutor) e o
 * sorteio usavam o mesmo `revealToOwner`. O cliente guardava tudo num buffer
 * que tela nenhuma lia. Agora o evento carrega o motivo e a ponta, e a
 * arrumação do que foi visto tem intenção própria (`INTENT_ARRANGE_PEEKED`).
 *
 * As asserções falam em ORDEM DE COMPRA, como no `scry.spec.ts`: é o que o
 * jogador percebe, e continua verdadeiro se a convenção do topo mudar.
 */

import { randomUUID } from 'node:crypto';
import { REGISTRY } from './registry';
import * as S from './schemas';
import { RoomState } from '../schema/RoomState';
import { Player } from '../schema/Player';
import { Card } from '../schema/Card';
import { ZoneOrderList } from '../schema/ZoneOrderList';
import { contem } from '../schema/visibility';
import { zoneOrderKey, ZONES } from '@aethertable/shared-types';
import type { IntentContext } from './registry';

function montarMesa(assentos: string[]) {
  const state = new RoomState();
  state.maxSeats = Math.max(assentos.length, 4);
  assentos.forEach((id, indice) => {
    const p = new Player();
    p.id = id;
    p.name = id.toUpperCase();
    p.seat = indice;
    state.players.set(id, p);
    for (const zone of ZONES) {
      state.zoneOrder.set(zoneOrderKey(id, zone), new ZoneOrderList());
    }
  });
  return state;
}

/** Ids reais (UUID): o `entityId` do zod recusa qualquer outra coisa. */
function encher(state: RoomState, dono: string, quantidade: number): string[] {
  const lista = state.zoneOrder.get(zoneOrderKey(dono, 'LIBRARY'))!.items;
  const ids: string[] = [];
  for (let i = 0; i < quantidade; i += 1) {
    const c = new Card();
    c.id = randomUUID();
    c.ownerId = dono;
    c.controllerId = dono;
    c.zone = 'LIBRARY';
    c.scryfallId = `sf-${dono}-${i}`;
    state.cards.set(c.id, c);
    lista.push(c.id);
    ids.push(c.id);
  }
  return ids;
}

interface Enviado {
  tipo: string;
  payload: Record<string, unknown>;
}

function contexto(state: RoomState, sessionId: string, enviados: Enviado[] = []): IntentContext {
  return {
    state,
    client: { sessionId } as IntentContext['client'],
    clients: [],
    send: (tipo: string, payload: Record<string, unknown>) => enviados.push({ tipo, payload }),
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

const grimorioDe = (state: RoomState, sid: string) =>
  Array.from(state.zoneOrder.get(zoneOrderKey(sid, 'LIBRARY'))!.items);

/** De cima para baixo: o topo é o FIM do array. */
const ordemDeCompra = (state: RoomState, sid: string) => grimorioDe(state, sid).reverse();

/** Quem a carta É, e não o id — que o embaralhar renova. */
const identidades = (state: RoomState, ids: readonly string[]) =>
  ids.map((id) => state.cards.get(id)?.scryfallId);

describe('INTENT_PEEK — o que chega ao dono', () => {
  it('diz que é uma olhada e de que ponta, para o painel saber o que abrir', () => {
    const state = montarMesa(['ana']);
    encher(state, 'ana', 6);
    const enviados: Enviado[] = [];
    executar('INTENT_PEEK', contexto(state, 'ana', enviados), {
      zone: 'LIBRARY',
      amount: 3,
      from: 'BOTTOM',
    });

    const evento = enviados.find((e) => e.tipo === 'revealToOwner');
    expect(evento?.payload).toMatchObject({ motivo: 'PEEK', zone: 'LIBRARY', from: 'BOTTOM' });
    expect((evento?.payload.cards as unknown[]).length).toBe(3);
  });

  it('a busca (tutor) chega marcada como busca, e não abre o painel de olhada', () => {
    const state = montarMesa(['ana']);
    encher(state, 'ana', 4);
    const enviados: Enviado[] = [];
    executar('INTENT_SEARCH_ZONE', contexto(state, 'ana', enviados), { zone: 'LIBRARY' });

    expect(enviados.find((e) => e.tipo === 'revealToOwner')?.payload.motivo).toBe('SEARCH');
  });
});

describe('INTENT_ARRANGE_PEEKED', () => {
  it('reordena o topo: a primeira da lista vira a próxima compra', () => {
    const state = montarMesa(['ana']);
    const ids = encher(state, 'ana', 8);
    const ctx = contexto(state, 'ana');
    executar('INTENT_PEEK', ctx, { zone: 'LIBRARY', amount: 3, from: 'TOP' });

    // Topo de cima para baixo era 7, 6, 5. A pessoa quer 5, 7, 6.
    const escolha = [ids[5]!, ids[7]!, ids[6]!];
    executar('INTENT_ARRANGE_PEEKED', ctx, { ids: escolha, destino: 'TOP', aleatorio: false });

    expect(ordemDeCompra(state, 'ana').slice(0, 3)).toEqual(escolha);
    // O resto do grimório não se mexe.
    expect(ordemDeCompra(state, 'ana').slice(3)).toEqual([ids[4], ids[3], ids[2], ids[1], ids[0]]);
  });

  it('reordenar à mão MANTÉM a olhada: o painel continua mostrando as cartas', () => {
    const state = montarMesa(['ana']);
    const ids = encher(state, 'ana', 5);
    const ctx = contexto(state, 'ana');
    executar('INTENT_PEEK', ctx, { zone: 'LIBRARY', amount: 2, from: 'TOP' });
    executar('INTENT_ARRANGE_PEEKED', ctx, {
      ids: [ids[3]!, ids[4]!],
      destino: 'TOP',
      aleatorio: false,
    });

    expect(contem(state.cards.get(ids[3]!)!.peekedBy, 'ana')).toBe(true);
    expect(contem(state.cards.get(ids[4]!)!.peekedBy, 'ana')).toBe(true);
  });

  it('no fundo, a primeira da lista é a de baixo de todas', () => {
    const state = montarMesa(['ana']);
    const ids = encher(state, 'ana', 6);
    const ctx = contexto(state, 'ana');
    executar('INTENT_PEEK', ctx, { zone: 'LIBRARY', amount: 2, from: 'BOTTOM' });

    // Fundo, de baixo para cima, era 0, 1. A pessoa inverte.
    executar('INTENT_ARRANGE_PEEKED', ctx, {
      ids: [ids[1]!, ids[0]!],
      destino: 'BOTTOM',
      aleatorio: false,
    });

    const compra = ordemDeCompra(state, 'ana');
    expect(compra[compra.length - 1]).toBe(ids[1]);
    expect(compra[compra.length - 2]).toBe(ids[0]);
  });

  it('em ordem aleatória o bloco fica na ponta, e a olhada é revogada', () => {
    const state = montarMesa(['ana']);
    const ids = encher(state, 'ana', 10);
    const ctx = contexto(state, 'ana');
    executar('INTENT_PEEK', ctx, { zone: 'LIBRARY', amount: 4, from: 'TOP' });
    const vistas = [ids[9]!, ids[8]!, ids[7]!, ids[6]!];
    const quem = identidades(state, vistas);

    executar('INTENT_ARRANGE_PEEKED', ctx, { ids: vistas, destino: 'TOP', aleatorio: true });

    // As mesmas quatro CARTAS continuam no topo — só a ordem é do sorteio. Os
    // ids, não: o bloco embaralhado troca de identidade (`renovarIds`), senão
    // a ordem "aleatória" seria a ordem que eu sei.
    const topo = ordemDeCompra(state, 'ana').slice(0, 4);
    expect(new Set(identidades(state, topo))).toEqual(new Set(quem));
    for (const id of vistas) expect(state.cards.has(id)).toBe(false);
    for (const id of topo) expect(contem(state.cards.get(id)!.peekedBy, 'ana')).toBe(false);
    // O resto do grimório não foi embaralhado e mantém os ids.
    expect(ordemDeCompra(state, 'ana').slice(4)).toEqual([
      ids[5],
      ids[4],
      ids[3],
      ids[2],
      ids[1],
      ids[0],
    ]);
  });

  it('mandar o topo olhado para o fundo em ordem aleatória tira o bloco do topo', () => {
    const state = montarMesa(['ana']);
    const ids = encher(state, 'ana', 7);
    const ctx = contexto(state, 'ana');
    executar('INTENT_PEEK', ctx, { zone: 'LIBRARY', amount: 3, from: 'TOP' });
    const vistas = [ids[6]!, ids[5]!, ids[4]!];
    const quem = identidades(state, vistas);

    executar('INTENT_ARRANGE_PEEKED', ctx, { ids: vistas, destino: 'BOTTOM', aleatorio: true });

    expect(new Set(identidades(state, grimorioDe(state, 'ana').slice(0, 3)))).toEqual(
      new Set(quem),
    );
    expect(ordemDeCompra(state, 'ana')[0]).toBe(ids[3]);
  });

  it('recusa carta que o jogador NÃO está olhando, sem mexer no grimório', () => {
    const state = montarMesa(['ana']);
    const ids = encher(state, 'ana', 6);
    const enviados: Enviado[] = [];
    const ctx = contexto(state, 'ana', enviados);
    executar('INTENT_PEEK', ctx, { zone: 'LIBRARY', amount: 1, from: 'TOP' });
    const antes = grimorioDe(state, 'ana');

    // ids[0] está no fundo e ninguém olhou: reordenar às cegas não é olhar.
    executar('INTENT_ARRANGE_PEEKED', ctx, {
      ids: [ids[5]!, ids[0]!],
      destino: 'TOP',
      aleatorio: false,
    });

    expect(grimorioDe(state, 'ana')).toEqual(antes);
    expect(enviados.some((e) => e.tipo === 'error')).toBe(true);
  });

  it('recusa carta do grimório de OUTRO jogador', () => {
    const state = montarMesa(['ana', 'bia']);
    encher(state, 'ana', 3);
    const daBia = encher(state, 'bia', 3);
    const ctxBia = contexto(state, 'bia');
    executar('INTENT_PEEK', ctxBia, { zone: 'LIBRARY', amount: 3, from: 'TOP' });
    const antes = grimorioDe(state, 'bia');

    const enviados: Enviado[] = [];
    executar('INTENT_ARRANGE_PEEKED', contexto(state, 'ana', enviados), {
      ids: [daBia[0]!],
      destino: 'TOP',
      aleatorio: false,
    });

    expect(grimorioDe(state, 'bia')).toEqual(antes);
    expect(enviados.some((e) => e.tipo === 'error')).toBe(true);
  });

  it('o schema aceita ids reais e assume ordem manual quando não dizem nada', () => {
    const ok = S.ArrangePeekedIntent.safeParse({ ids: [randomUUID()], destino: 'TOP' });
    expect(ok.success && ok.data.aleatorio).toBe(false);
    expect(S.ArrangePeekedIntent.safeParse({ ids: ['carta-1'], destino: 'TOP' }).success).toBe(
      false,
    );
    expect(S.ArrangePeekedIntent.safeParse({ ids: [], destino: 'TOP' }).success).toBe(false);
  });
});
