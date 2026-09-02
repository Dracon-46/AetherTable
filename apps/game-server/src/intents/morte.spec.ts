/**
 * morte.spec.ts — as quatro condições de derrota de Magic.
 *
 * ─── O QUE ESTES TESTES FIXAM ──────────────────────────────────────────────
 *
 * O motor nasceu sem nenhuma delas, por decisão de projeto: RN01 dizia que
 * "vida <= 0 NÃO elimina ninguém" e que o sandbox só exibe marcadores. Na
 * prática isso deixava 21 de dano de comandante como um número vermelho, o
 * veneno chegando a 10 sem efeito, e — o pior dos quatro — comprar de um
 * grimório vazio comprando MENOS cartas em silêncio, sem erro e sem log.
 *
 * A decisão foi revertida. O que estes testes protegem é a forma da reversão,
 * que é onde estaria o estrago se ela fosse feita errado:
 *
 *   - a eliminação é DERIVADA e reversível (um clique errado se desfaz);
 *   - `decked` é a exceção pegajosa (tentar comprar sem ter é um EVENTO);
 *   - dano de comandante conta POR ORIGEM, nunca somado;
 *   - o eliminado NUNCA sai da sala — é o único pedaço de RN01 que sobreviveu.
 */

import { REGISTRY } from './registry';
import { RoomState } from '../schema/RoomState';
import { Player } from '../schema/Player';
import { Card } from '../schema/Card';
import { ZoneOrderList } from '../schema/ZoneOrderList';
import { zoneOrderKey, ZONES } from '@aethertable/shared-types';
import type { IntentContext } from './registry';

interface Enviado {
  event: string;
  payload: unknown;
}

function montarMesa(assentos: string[]) {
  const state = new RoomState();
  state.phase = 'PLAYING';
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

function encher(state: RoomState, dono: string, zona: string, quantidade: number) {
  const lista = state.zoneOrder.get(zoneOrderKey(dono, zona as never))!.items;
  for (let i = 0; i < quantidade; i += 1) {
    const c = new Card();
    c.id = `${dono}-${zona}-${i}`;
    c.ownerId = dono;
    c.controllerId = dono;
    c.zone = zona;
    state.cards.set(c.id, c);
    lista.push(c.id);
  }
}

function contexto(state: RoomState, sessionId: string, transmitidos: Enviado[]): IntentContext {
  return {
    state,
    client: { sessionId } as IntentContext['client'],
    clients: [] as unknown as IntentContext['clients'],
    send: () => {},
    broadcast: (event, payload) => transmitidos.push({ event, payload }),
    log: () => {},
    desfazer: () => null,
    expulsar: () => {},
  } as IntentContext;
}

function executar(
  intent: keyof typeof REGISTRY,
  state: RoomState,
  sid: string,
  payload: unknown,
): Enviado[] {
  const transmitidos: Enviado[] = [];
  REGISTRY[intent].executa(contexto(state, sid, transmitidos), payload as never);
  return transmitidos;
}

const eliminacoes = (t: Enviado[]) => t.filter((e) => e.event === 'playerEliminated');
const fins = (t: Enviado[]) => t.filter((e) => e.event === 'matchEnded');

// ═══════════════════════════════════════════════════════════════════════════

describe('vida chega a zero', () => {
  it('elimina, e anuncia para a mesa', () => {
    const state = montarMesa(['a', 'b', 'c']);
    state.players.get('a')!.life = 3;

    const t = executar('INTENT_SET_LIFE', state, 'a', { delta: -3 });

    expect(state.players.get('a')!.eliminated).toBe(true);
    expect(state.players.get('a')!.eliminationReason).toBe('LIFE');
    expect(eliminacoes(t)).toHaveLength(1);
    expect((eliminacoes(t)[0]!.payload as { reason: string }).reason).toBe('LIFE');
  });

  it('NÃO remove o jogador da sala — é o que sobrou de RN01', () => {
    const state = montarMesa(['a', 'b', 'c']);
    executar('INTENT_SET_LIFE', state, 'a', { absolute: 0 });

    expect(state.players.has('a')).toBe(true);
    expect(state.players.size).toBe(3);
  });

  /**
   * O caso que torna a eliminação segura de existir: um `-1` a mais com 1 de
   * vida. Se a morte fosse um evento e não um estado derivado, o jogador ficaria
   * eliminado para sempre por um clique.
   */
  it('voltar a vida acima de zero RESSUSCITA', () => {
    const state = montarMesa(['a', 'b', 'c']);
    executar('INTENT_SET_LIFE', state, 'a', { absolute: 0 });
    expect(state.players.get('a')!.eliminated).toBe(true);

    executar('INTENT_SET_LIFE', state, 'a', { absolute: 5 });

    expect(state.players.get('a')!.eliminated).toBe(false);
    expect(state.players.get('a')!.eliminationReason).toBe('');
  });

  it('não anuncia duas vezes o mesmo motivo', () => {
    const state = montarMesa(['a', 'b', 'c']);
    executar('INTENT_SET_LIFE', state, 'a', { absolute: 0 });
    const t = executar('INTENT_SET_LIFE', state, 'a', { delta: -1 });

    expect(eliminacoes(t)).toHaveLength(0);
  });
});

describe('veneno', () => {
  it('10 marcadores eliminam', () => {
    const state = montarMesa(['a', 'b', 'c']);
    const t = executar('INTENT_SET_PLAYER_COUNTER', state, 'a', { type: 'POISON', delta: 10 });

    expect(state.players.get('a')!.eliminated).toBe(true);
    expect(state.players.get('a')!.eliminationReason).toBe('POISON');
    expect(eliminacoes(t)).toHaveLength(1);
  });

  it('9 não eliminam', () => {
    const state = montarMesa(['a', 'b', 'c']);
    executar('INTENT_SET_PLAYER_COUNTER', state, 'a', { type: 'POISON', delta: 9 });
    expect(state.players.get('a')!.eliminated).toBe(false);
  });
});

describe('dano de comandante', () => {
  it('21 de UM MESMO oponente eliminam', () => {
    const state = montarMesa(['a', 'b', 'c']);
    for (let i = 0; i < 21; i += 1) {
      executar('INTENT_SET_COMMANDER_DAMAGE', state, 'a', { fromPlayerId: 'b', delta: 1 });
    }

    expect(state.players.get('a')!.eliminated).toBe(true);
    expect(state.players.get('a')!.eliminationReason).toBe('COMMANDER');
  });

  /**
   * A regra é POR ORIGEM. Somar tudo eliminaria alguém com 15 de um comandante
   * e 15 de outro — que na mesa de verdade está vivo e passando bem.
   */
  it('NÃO soma comandantes diferentes', () => {
    const state = montarMesa(['a', 'b', 'c']);
    executar('INTENT_SET_COMMANDER_DAMAGE', state, 'a', { fromPlayerId: 'b', delta: 15 });
    executar('INTENT_SET_COMMANDER_DAMAGE', state, 'a', { fromPlayerId: 'c', delta: 15 });

    expect(state.players.get('a')!.eliminated).toBe(false);
  });

  it('o anúncio diz de quem foi o comandante', () => {
    const state = montarMesa(['a', 'b', 'c']);
    const t = executar('INTENT_SET_COMMANDER_DAMAGE', state, 'a', {
      fromPlayerId: 'b',
      delta: 21,
    });

    expect((eliminacoes(t)[0]!.payload as { byName?: string }).byName).toBe('B');
  });
});

describe('grimório vazio', () => {
  it('TENTAR comprar sem ter elimina, e o que sobrou ainda vai para a mão', () => {
    const state = montarMesa(['a', 'b', 'c']);
    encher(state, 'a', 'LIBRARY', 1);

    const t = executar('INTENT_DRAW', state, 'a', { amount: 3 });

    expect(state.players.get('a')!.eliminated).toBe(true);
    expect(state.players.get('a')!.eliminationReason).toBe('DECKED');
    expect(eliminacoes(t)).toHaveLength(1);
    // A derrota não apaga a compra parcial.
    expect(state.zoneOrder.get(zoneOrderKey('a', 'HAND'))!.items.length).toBe(1);
  });

  it('comprar exatamente o que tem NÃO elimina', () => {
    const state = montarMesa(['a', 'b', 'c']);
    encher(state, 'a', 'LIBRARY', 3);

    executar('INTENT_DRAW', state, 'a', { amount: 3 });

    expect(state.players.get('a')!.eliminated).toBe(false);
    expect(state.players.get('a')!.decked).toBe(false);
  });

  /**
   * `decked` é PEGAJOSO de propósito: não é "estar sem cartas" que mata, é ter
   * tentado comprar sem ter. Reabastecer o grimório depois não desfaz a derrota
   * — e é por isso que esta condição não pode ser derivada do tamanho da lista,
   * como as outras três.
   */
  it('encher o grimório depois NÃO ressuscita', () => {
    const state = montarMesa(['a', 'b', 'c']);
    encher(state, 'a', 'LIBRARY', 0);
    executar('INTENT_DRAW', state, 'a', { amount: 1 });
    expect(state.players.get('a')!.eliminated).toBe(true);

    encher(state, 'a', 'LIBRARY', 40);
    executar('INTENT_SET_LIFE', state, 'a', { delta: 0 });

    expect(state.players.get('a')!.eliminated).toBe(true);
    expect(state.players.get('a')!.eliminationReason).toBe('DECKED');
  });
});

describe('desistir', () => {
  it('marca como fora do jogo sem sair da sala', () => {
    const state = montarMesa(['a', 'b', 'c']);
    const t = executar('INTENT_CONCEDE', state, 'a', {});

    expect(state.players.get('a')!.eliminated).toBe(true);
    expect(state.players.get('a')!.eliminationReason).toBe('CONCEDED');
    expect(state.players.has('a')).toBe(true);
    expect(eliminacoes(t)).toHaveLength(1);
  });
});

describe('fim de partida', () => {
  it('sobrando um, a partida acaba e ele é anunciado', () => {
    const state = montarMesa(['a', 'b', 'c']);

    executar('INTENT_CONCEDE', state, 'a', {});
    const t = executar('INTENT_CONCEDE', state, 'b', {});

    expect(fins(t)).toHaveLength(1);
    expect((fins(t)[0]!.payload as { winnerName: string }).winnerName).toBe('C');
    expect(state.phase).toBe('CLOSING');
  });

  it('com dois ainda vivos, não acaba', () => {
    const state = montarMesa(['a', 'b', 'c']);
    const t = executar('INTENT_CONCEDE', state, 'a', {});

    expect(fins(t)).toHaveLength(0);
    expect(state.phase).toBe('PLAYING');
  });

  /** Numa sala de um, "você venceu" assim que a partida começa seria absurdo. */
  it('numa mesa de um jogador, não anuncia vitória', () => {
    const state = montarMesa(['a']);
    const t = executar('INTENT_SET_LIFE', state, 'a', { absolute: 40 });

    expect(fins(t)).toHaveLength(0);
  });
});

describe('reiniciar a partida ressuscita a mesa', () => {
  it('zera eliminação, motivo e o grimório vazio', () => {
    const state = montarMesa(['anfitriao', 'b']);
    encher(state, 'anfitriao', 'LIBRARY', 0);
    executar('INTENT_DRAW', state, 'anfitriao', { amount: 1 });
    executar('INTENT_CONCEDE', state, 'b', {});

    executar('INTENT_RESET_MATCH', state, 'anfitriao', {});

    for (const p of state.players.values()) {
      expect(p.eliminated).toBe(false);
      expect(p.eliminationReason).toBe('');
      expect(p.decked).toBe(false);
    }
  });
});
