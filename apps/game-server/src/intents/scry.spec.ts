/**
 * scry.spec.ts — a ordem que o jogador escolhe é a ordem que o grimório fica.
 *
 * ─── O DEFEITO QUE ESTES CASOS FIXAM ───────────────────────────────────────
 *
 * O relato foi "o scry não tá funcionando, se eu trocar a ordem das cartas não
 * vai". E não ia mesmo: o topo do grimório é o FIM do array (ver `topoDe`), o
 * cliente manda `topOrder` na ordem da TELA — de cima para baixo, a primeira
 * sendo a que o jogador quer comprar primeiro — e o servidor emendava a lista
 * direto no fim. Resultado: a última carta da escolha ficava no topo.
 *
 * Reordenar fazia exatamente o contrário do pedido.
 *
 * ─── POR QUE NINGUÉM PEGOU ANTES ───────────────────────────────────────────
 *
 * Com scry 1 não existe ordem para inverter, e é o caso mais comum. O defeito
 * só aparece de scry 2 para cima — que é justamente quando ordenar é o ponto
 * inteiro da mecânica. Um teste com uma carta só passa com o código errado, e
 * por isso todo caso aqui usa três.
 *
 * A asserção é sempre sobre a ORDEM DE COMPRA, nunca sobre índices do array:
 * é o que o jogador percebe, e é a única formulação que continua verdadeira se
 * a convenção de topo mudar de ponta um dia.
 */

import { REGISTRY } from './registry';
import { RoomState } from '../schema/RoomState';
import { Player } from '../schema/Player';
import { Card } from '../schema/Card';
import { ZoneOrderList } from '../schema/ZoneOrderList';
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

function encher(state: RoomState, dono: string, zona: string, quantidade: number): string[] {
  const lista = state.zoneOrder.get(zoneOrderKey(dono, zona as never))!.items;
  const ids: string[] = [];
  for (let i = 0; i < quantidade; i += 1) {
    const c = new Card();
    c.id = `${dono}-${zona}-${i}`;
    c.ownerId = dono;
    c.controllerId = dono;
    c.zone = zona;
    c.scryfallId = `scry-${i}`;
    state.cards.set(c.id, c);
    lista.push(c.id);
    ids.push(c.id);
  }
  return ids;
}

function contexto(state: RoomState, sessionId: string): IntentContext {
  return {
    state,
    client: { sessionId } as IntentContext['client'],
    clients: [] as unknown as IntentContext['clients'],
    send: () => {},
    broadcast: () => {},
    log: () => {},
    desfazer: () => null,
    expulsar: () => {},
  } as IntentContext;
}

const grimorioDe = (state: RoomState, sid: string) =>
  Array.from(state.zoneOrder.get(zoneOrderKey(sid, 'LIBRARY'))!.items);

const cemiterioDe = (state: RoomState, sid: string) =>
  Array.from(state.zoneOrder.get(zoneOrderKey(sid, 'GRAVEYARD'))!.items);

/**
 * A ordem em que as cartas SERIAM COMPRADAS, de cima para baixo.
 *
 * O topo é o fim do array, então comprar é ler de trás para frente. Escrever
 * isso uma vez aqui deixa cada teste falar a língua do jogador em vez da língua
 * da estrutura de dados.
 */
const ordemDeCompra = (state: RoomState, sid: string) => grimorioDe(state, sid).reverse();

function executar(nome: string, ctx: IntentContext, payload: unknown) {
  const handler = REGISTRY[nome as keyof typeof REGISTRY]!;
  (handler.executa as (c: IntentContext, p: unknown) => void)(ctx, payload);
}

describe('INTENT_SCRY_COMMIT', () => {
  it('a primeira carta da escolha é a primeira a ser comprada', () => {
    const state = montarMesa(['ana']);
    const ids = encher(state, 'ana', 'LIBRARY', 8);
    const ctx = contexto(state, 'ana');

    // O topo atual, de cima para baixo: o último do array primeiro.
    const topo3 = [ids[7]!, ids[6]!, ids[5]!];

    // A pessoa inverte: quer comprar ids[5] primeiro, depois ids[6], ids[7].
    const escolha = [ids[5]!, ids[6]!, ids[7]!];
    executar('INTENT_SCRY_COMMIT', ctx, { toBottom: [], topOrder: escolha });

    // Com o defeito, isto voltava exatamente ao contrário: [7, 6, 5].
    expect(ordemDeCompra(state, 'ana').slice(0, 3)).toEqual(escolha);
    expect(topo3).not.toEqual(escolha); // o teste realmente reordenou algo
  });

  it('manter a ordem em que as cartas vieram não muda nada', () => {
    // O caso neutro: confirmar sem mexer. Se este quebrar, o scry passou a
    // embaralhar o topo de quem não decidiu nada — pior que o defeito original.
    const state = montarMesa(['ana']);
    const ids = encher(state, 'ana', 'LIBRARY', 8);
    const antes = ordemDeCompra(state, 'ana');

    const comoVieram = [ids[7]!, ids[6]!, ids[5]!];
    executar('INTENT_SCRY_COMMIT', contexto(state, 'ana'), {
      toBottom: [],
      topOrder: comoVieram,
    });

    expect(ordemDeCompra(state, 'ana')).toEqual(antes);
  });

  it('o que vai para o fundo sai do topo e fica embaixo de tudo', () => {
    const state = montarMesa(['ana']);
    const ids = encher(state, 'ana', 'LIBRARY', 8);

    executar('INTENT_SCRY_COMMIT', contexto(state, 'ana'), {
      toBottom: [ids[7]!],
      topOrder: [ids[6]!, ids[5]!],
    });

    const compra = ordemDeCompra(state, 'ana');
    expect(compra[0]).toBe(ids[6]);
    expect(compra[1]).toBe(ids[5]);
    // Fundo = começo do array = última a ser comprada.
    expect(compra[compra.length - 1]).toBe(ids[7]);
  });

  it('o grimório não ganha nem perde carta', () => {
    // Um splice errado duplica ou engole ids sem lançar, e o sintoma chegaria
    // como "minha carta sumiu" muitos turnos depois.
    const state = montarMesa(['ana']);
    const ids = encher(state, 'ana', 'LIBRARY', 8);

    executar('INTENT_SCRY_COMMIT', contexto(state, 'ana'), {
      toBottom: [ids[7]!],
      topOrder: [ids[5]!, ids[6]!],
    });

    const depois = grimorioDe(state, 'ana');
    expect(depois).toHaveLength(8);
    expect(new Set(depois).size).toBe(8);
    expect([...depois].sort()).toEqual([...ids].sort());
  });

  it('carta que não está no grimório é recusada, e nada é movido', () => {
    const state = montarMesa(['ana']);
    encher(state, 'ana', 'LIBRARY', 8);
    const antes = grimorioDe(state, 'ana');

    let recusa: { code?: string } | null = null;
    const ctx = contexto(state, 'ana');
    (ctx as { send: (t: string, p: unknown) => void }).send = (_t, p) => {
      recusa = p as { code?: string };
    };

    executar('INTENT_SCRY_COMMIT', ctx, { toBottom: [], topOrder: ['carta-de-outra-mesa'] });

    expect(recusa).not.toBeNull();
    expect(recusa!.code).toBe('INVALID_PAYLOAD');
    expect(grimorioDe(state, 'ana')).toEqual(antes);
  });
});

describe('INTENT_SURVEIL_COMMIT', () => {
  it('tem a MESMA ordem de compra que o scry', () => {
    // Os dois handlers são irmãos e divergiram uma vez; um deles ser corrigido
    // sozinho é o jeito mais provável de o defeito voltar pela metade.
    const state = montarMesa(['ana']);
    const ids = encher(state, 'ana', 'LIBRARY', 8);

    const escolha = [ids[5]!, ids[6]!, ids[7]!];
    executar('INTENT_SURVEIL_COMMIT', contexto(state, 'ana'), {
      toGraveyard: [],
      topOrder: escolha,
    });

    expect(ordemDeCompra(state, 'ana').slice(0, 3)).toEqual(escolha);
  });

  it('o que vai para o cemitério sai do grimório e chega lá', () => {
    const state = montarMesa(['ana']);
    const ids = encher(state, 'ana', 'LIBRARY', 8);

    executar('INTENT_SURVEIL_COMMIT', contexto(state, 'ana'), {
      toGraveyard: [ids[7]!],
      topOrder: [ids[6]!, ids[5]!],
    });

    expect(grimorioDe(state, 'ana')).toHaveLength(7);
    expect(grimorioDe(state, 'ana')).not.toContain(ids[7]);
    expect(cemiterioDe(state, 'ana')).toContain(ids[7]);
    expect(ordemDeCompra(state, 'ana')[0]).toBe(ids[6]);
  });
});
