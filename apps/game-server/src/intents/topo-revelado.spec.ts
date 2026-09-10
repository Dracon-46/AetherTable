/**
 * topo-revelado.spec.ts — o modo "jogar com o topo do grimório revelado".
 *
 * O relato foi "revelar o topo não tá funcionando", e havia dois defeitos
 * empilhados: a pilha do grimório era desenhada com o verso fixo (corrigido no
 * cliente) e não existia MODO nenhum — só a revelação avulsa de
 * `INTENT_REVEAL_TOP`, que a primeira compra desfazia.
 *
 * O risco deste modo não é a carta não aparecer. É o contrário: uma carta que
 * DEIXOU de ser o topo continuar revelada para a mesa. Por isso quase todos os
 * testes abaixo verificam o que fica ESCONDIDO, e não o que fica visível.
 *
 * A reaplicação vive num ponto só — `aplicarTopoRevelado`, chamada no fim do
 * despacho de intenção em `AetherRoom` — e é ela que estes testes exercitam
 * diretamente, simulando o que o despacho faz.
 */

import { REGISTRY, aplicarTopoRevelado } from './registry';
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

/** Faz o que o despacho de `AetherRoom` faz: executa e reaplica o modo. */
function despachar(intent: keyof typeof REGISTRY, state: RoomState, sid: string, payload: unknown) {
  const ctx = contexto(state, sid);
  REGISTRY[intent].executa(ctx, payload as never);
  aplicarTopoRevelado(ctx, sid);
}

const topoDoGrimorio = (state: RoomState, sid: string) => {
  const lista = state.zoneOrder.get(zoneOrderKey(sid, 'LIBRARY'))!.items;
  return lista[lista.length - 1]!;
};
const revelada = (state: RoomState, id: string) => state.cards.get(id)!.revealedTo === 'ALL';

describe('modo topo revelado — ligar e desligar', () => {
  it('ligado, revela a carta do topo', () => {
    const state = montarMesa(['eu']);
    encher(state, 'eu', 'LIBRARY', 5);
    const topo = topoDoGrimorio(state, 'eu');

    despachar('INTENT_SET_TOP_REVEALED', state, 'eu', { ligado: true });

    expect(state.players.get('eu')!.topoRevelado).toBe(true);
    expect(revelada(state, topo)).toBe(true);
    expect(state.players.get('eu')!.topoReveladoId).toBe(topo);
  });

  it('desligado, ESCONDE de volta', () => {
    const state = montarMesa(['eu']);
    encher(state, 'eu', 'LIBRARY', 5);
    const topo = topoDoGrimorio(state, 'eu');

    despachar('INTENT_SET_TOP_REVEALED', state, 'eu', { ligado: true });
    despachar('INTENT_SET_TOP_REVEALED', state, 'eu', { ligado: false });

    expect(revelada(state, topo)).toBe(false);
    expect(state.players.get('eu')!.topoReveladoId).toBe('');
  });

  it('ligar duas vezes não muda nada (idempotente)', () => {
    const state = montarMesa(['eu']);
    encher(state, 'eu', 'LIBRARY', 5);
    despachar('INTENT_SET_TOP_REVEALED', state, 'eu', { ligado: true });
    const primeiro = state.players.get('eu')!.topoReveladoId;
    despachar('INTENT_SET_TOP_REVEALED', state, 'eu', { ligado: true });
    expect(state.players.get('eu')!.topoReveladoId).toBe(primeiro);
  });

  it('com o grimório vazio, ligar não quebra nem revela nada', () => {
    const state = montarMesa(['eu']);
    despachar('INTENT_SET_TOP_REVEALED', state, 'eu', { ligado: true });
    expect(state.players.get('eu')!.topoRevelado).toBe(true);
    expect(state.players.get('eu')!.topoReveladoId).toBe('');
  });
});

describe('modo topo revelado — o topo ANDA e a revelação acompanha', () => {
  /**
   * Cada caso abaixo é uma intenção que muda o topo. A asserção que importa em
   * todas é a mesma: a carta ANTERIOR não pode continuar revelada dentro do
   * grimório. Foi por causa desta lista que a reaplicação ficou num ponto só.
   */
  const casos: Array<{ nome: string; intent: keyof typeof REGISTRY; payload: unknown }> = [
    { nome: 'comprar', intent: 'INTENT_DRAW', payload: { amount: 1 } },
    { nome: 'moer', intent: 'INTENT_MILL', payload: { amount: 1, target: 'GRAVEYARD' } },
    { nome: 'topo para o fundo', intent: 'INTENT_MOVE_TOP_TO_BOTTOM', payload: { amount: 1 } },
  ];

  for (const caso of casos) {
    it(`${caso.nome}: o topo novo fica revelado e o antigo não`, () => {
      const state = montarMesa(['eu']);
      encher(state, 'eu', 'LIBRARY', 6);
      despachar('INTENT_SET_TOP_REVEALED', state, 'eu', { ligado: true });
      const antigo = state.players.get('eu')!.topoReveladoId;

      despachar(caso.intent, state, 'eu', caso.payload);

      const novo = topoDoGrimorio(state, 'eu');
      expect(novo).not.toBe(antigo);
      expect(revelada(state, novo)).toBe(true);
      // A antiga só continua revelada se tiver SAÍDO do grimório — aí a
      // revelação é problema da zona nova, e `aplicarEfeitosDeZona` já limpou.
      const cartaAntiga = state.cards.get(antigo)!;
      if (cartaAntiga.zone === 'LIBRARY') expect(cartaAntiga.revealedTo).toBe('');
    });
  }

  it('embaralhar não deixa carta revelada perdida no meio do grimório', () => {
    const state = montarMesa(['eu']);
    encher(state, 'eu', 'LIBRARY', 8);
    despachar('INTENT_SET_TOP_REVEALED', state, 'eu', { ligado: true });

    despachar('INTENT_SHUFFLE', state, 'eu', { zone: 'LIBRARY' });

    const topo = topoDoGrimorio(state, 'eu');
    const lista = state.zoneOrder.get(zoneOrderKey('eu', 'LIBRARY'))!.items;
    for (const id of Array.from(lista)) {
      // Exatamente uma revelada, e é a do topo.
      expect(revelada(state, id)).toBe(id === topo);
    }
  });

  it('comprar a última carta não deixa `topoReveladoId` apontando para o vazio', () => {
    const state = montarMesa(['eu']);
    encher(state, 'eu', 'LIBRARY', 1);
    despachar('INTENT_SET_TOP_REVEALED', state, 'eu', { ligado: true });

    despachar('INTENT_DRAW', state, 'eu', { amount: 1 });

    expect(state.players.get('eu')!.topoReveladoId).toBe('');
  });

  it('a carta comprada NÃO chega revelada na mão', () => {
    // `aplicarEfeitosDeZona` limpa as concessões ao trocar de zona. Sem isso, o
    // modo vazaria a mão inteira, uma carta por compra.
    const state = montarMesa(['eu']);
    encher(state, 'eu', 'LIBRARY', 4);
    despachar('INTENT_SET_TOP_REVEALED', state, 'eu', { ligado: true });
    const comprada = state.players.get('eu')!.topoReveladoId;

    despachar('INTENT_DRAW', state, 'eu', { amount: 1 });

    const c = state.cards.get(comprada)!;
    expect(c.zone).toBe('HAND');
    expect(c.revealedTo).toBe('');
  });
});

describe('modo topo revelado — não atropela o resto da mesa', () => {
  it('desligado, uma intenção qualquer não revela nada', () => {
    const state = montarMesa(['eu']);
    encher(state, 'eu', 'LIBRARY', 5);
    despachar('INTENT_DRAW', state, 'eu', { amount: 1 });
    const lista = state.zoneOrder.get(zoneOrderKey('eu', 'LIBRARY'))!.items;
    for (const id of Array.from(lista)) expect(revelada(state, id)).toBe(false);
  });

  it('o modo de um jogador não mexe no grimório do outro', () => {
    const state = montarMesa(['eu', 'ela']);
    encher(state, 'eu', 'LIBRARY', 4);
    encher(state, 'ela', 'LIBRARY', 4);

    despachar('INTENT_SET_TOP_REVEALED', state, 'eu', { ligado: true });

    const listaDela = state.zoneOrder.get(zoneOrderKey('ela', 'LIBRARY'))!.items;
    for (const id of Array.from(listaDela)) expect(revelada(state, id)).toBe(false);
  });

  it('reaplicar depois de intenção que não toca o grimório não escreve nada', () => {
    const state = montarMesa(['eu']);
    encher(state, 'eu', 'LIBRARY', 4);
    despachar('INTENT_SET_TOP_REVEALED', state, 'eu', { ligado: true });
    const antes = state.players.get('eu')!.topoReveladoId;

    // Duas reaplicações seguidas, sem nada entre elas.
    aplicarTopoRevelado(contexto(state, 'eu'), 'eu');
    aplicarTopoRevelado(contexto(state, 'eu'), 'eu');

    expect(state.players.get('eu')!.topoReveladoId).toBe(antes);
    expect(revelada(state, antes)).toBe(true);
  });

  it('sessão sem jogador (espectador) não quebra a reaplicação', () => {
    const state = montarMesa(['eu']);
    encher(state, 'eu', 'LIBRARY', 3);
    expect(() => aplicarTopoRevelado(contexto(state, 'ninguem'), 'ninguem')).not.toThrow();
  });
});

describe('exilar virado para baixo', () => {
  it('exila com a face para baixo quando pedido', () => {
    const state = montarMesa(['eu']);
    encher(state, 'eu', 'LIBRARY', 3);
    const topo = topoDoGrimorio(state, 'eu');

    despachar('INTENT_MILL', state, 'eu', { amount: 1, target: 'EXILE', faceDown: true });

    const c = state.cards.get(topo)!;
    expect(c.zone).toBe('EXILE');
    expect(c.faceDown).toBe(true);
  });

  it('sem o pedido, exila com a face para cima', () => {
    const state = montarMesa(['eu']);
    encher(state, 'eu', 'LIBRARY', 3);
    const topo = topoDoGrimorio(state, 'eu');

    despachar('INTENT_MILL', state, 'eu', { amount: 1, target: 'EXILE', faceDown: false });

    expect(state.cards.get(topo)!.faceDown).toBe(false);
  });

  it('no CEMITÉRIO o pedido é ignorado — zona pública não esconde conteúdo', () => {
    const state = montarMesa(['eu']);
    encher(state, 'eu', 'LIBRARY', 3);
    const topo = topoDoGrimorio(state, 'eu');

    despachar('INTENT_MILL', state, 'eu', { amount: 1, target: 'GRAVEYARD', faceDown: true });

    const c = state.cards.get(topo)!;
    expect(c.zone).toBe('GRAVEYARD');
    expect(c.faceDown).toBe(false);
  });
});
