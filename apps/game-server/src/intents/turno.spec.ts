/**
 * turno.spec.ts — de quem e a vez e o unico combinado que a mesa tem.
 *
 * Nao existe motor de regras aqui: o marcador de turno e VISUAL (F29). E
 * justamente por isso ele nao pode ser de todo mundo. Enquanto
 * `INTENT_PASS_TURN` era `QUALQUER_JOGADOR` sem checagem nenhuma, qualquer
 * pessoa empurrava o turno a qualquer momento — inclusive por cima da jogada
 * de outra. Um marcador que qualquer um mexe nao marca nada.
 */

import { REGISTRY } from './registry';
import { RoomState } from '../schema/RoomState';
import { Player } from '../schema/Player';
import type { IntentContext } from './registry';

interface Enviado {
  event: string;
  payload: unknown;
}

function montarMesa(assentos: string[], vez: string) {
  const state = new RoomState();
  assentos.forEach((id, indice) => {
    const p = new Player();
    p.id = id;
    p.name = id.toUpperCase();
    p.seat = indice;
    state.players.set(id, p);
  });
  state.activePlayerId = vez;
  state.turn = 1;
  return state;
}

function contexto(state: RoomState, sessionId: string, enviados: Enviado[]): IntentContext {
  return {
    state,
    client: { sessionId } as IntentContext['client'],
    clients: [] as unknown as IntentContext['clients'],
    send: (event, payload) => enviados.push({ event, payload }),
    broadcast: () => {},
    log: () => {},
    desfazer: () => null,
  } as IntentContext;
}

const passar = (state: RoomState, sid: string) => {
  const enviados: Enviado[] = [];
  REGISTRY.INTENT_PASS_TURN.executa(contexto(state, sid, enviados), {});
  return enviados;
};

describe('INTENT_PASS_TURN', () => {
  it('quem esta na vez passa para o proximo assento', () => {
    const state = montarMesa(['a', 'b', 'c'], 'a');

    expect(passar(state, 'a')).toHaveLength(0);
    expect(state.activePlayerId).toBe('b');
  });

  it('RECUSA quem nao esta na vez, e diz de quem e', () => {
    const state = montarMesa(['a', 'b', 'c'], 'a');

    const enviados = passar(state, 'c');

    // A vez nao andou: o estado e o que importa, o erro e so a explicacao.
    expect(state.activePlayerId).toBe('a');
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.event).toBe('error');
    const payload = enviados[0]!.payload as { code: string; message: string };
    expect(payload.code).toBe('NOT_YOUR_TURN');
    // Sem o nome, o jogador recusado nao sabe de quem cobrar.
    expect(payload.message).toContain('A');
  });

  /**
   * Antes do primeiro START_MATCH e depois de um RESET_MATCH o campo fica
   * vazio. Exigir "so quem esta na vez" ali travaria a mesa para sempre:
   * ninguem esta na vez, entao ninguem poderia comecar.
   */
  it('com a mesa sem vez definida, qualquer um destrava a rotacao', () => {
    const state = montarMesa(['a', 'b', 'c'], '');

    const enviados = passar(state, 'c');

    expect(enviados).toHaveLength(0);
    expect(state.activePlayerId).not.toBe('');
  });

  it('a volta completa incrementa o numero do turno', () => {
    const state = montarMesa(['a', 'b'], 'a');
    const turnoInicial = state.turn;

    passar(state, 'a'); // a -> b
    passar(state, 'b'); // b -> a, fecha a volta

    expect(state.activePlayerId).toBe('a');
    expect(state.turn).toBeGreaterThan(turnoInicial);
  });

  it('nao faz nada numa mesa sem jogadores', () => {
    const state = new RoomState();
    expect(() => passar(state, 'fantasma')).not.toThrow();
  });
});

/**
 * As acoes que MEXEM NA MESA INTEIRA precisam do mesmo dono.
 *
 * `INTENT_START_MATCH` checava anfitriao; as duas que desfazem o trabalho dele
 * nao checavam nada. `INTENT_RESET_MATCH` apagava vida, contadores e campo de
 * todo mundo, e `INTENT_SET_TURN_ORDER` reescrevia os assentos — o que e uma
 * escalada de privilegio, porque o assento 0 E o anfitriao: bastava se colocar
 * no indice 0 para herdar as duas.
 */
describe('acoes reservadas ao anfitriao', () => {
  const executar = (intent: 'INTENT_RESET_MATCH' | 'INTENT_SET_TURN_ORDER', sid: string) => {
    const state = montarMesa(['anfitriao', 'convidado'], 'anfitriao');
    state.phase = 'PLAYING';
    state.players.get('convidado')!.life = 12;

    const enviados: Enviado[] = [];
    const payload = intent === 'INTENT_SET_TURN_ORDER' ? { order: ['convidado', 'anfitriao'] } : {};
    REGISTRY[intent].executa(contexto(state, sid, enviados), payload as never);
    return { state, enviados };
  };

  it('um convidado NAO zera a partida dos outros', () => {
    const { state, enviados } = executar('INTENT_RESET_MATCH', 'convidado');

    expect(state.phase).toBe('PLAYING');
    expect(state.players.get('convidado')!.life).toBe(12);
    expect((enviados[0]!.payload as { code: string }).code).toBe('NOT_HOST');
  });

  it('o anfitriao zera a partida', () => {
    const { state, enviados } = executar('INTENT_RESET_MATCH', 'anfitriao');

    expect(state.phase).toBe('WAITING');
    expect(state.players.get('convidado')!.life).toBe(40);
    expect(enviados).toHaveLength(0);
  });

  it('um convidado NAO se promove a anfitriao reescrevendo os assentos', () => {
    const { state, enviados } = executar('INTENT_SET_TURN_ORDER', 'convidado');

    // Continua no assento 1: nao herdou START_MATCH nem RESET_MATCH.
    expect(state.players.get('convidado')!.seat).toBe(1);
    expect(state.players.get('anfitriao')!.seat).toBe(0);
    expect((enviados[0]!.payload as { code: string }).code).toBe('NOT_HOST');
  });

  it('o anfitriao reordena os assentos', () => {
    const { state, enviados } = executar('INTENT_SET_TURN_ORDER', 'anfitriao');

    expect(state.players.get('convidado')!.seat).toBe(0);
    expect(enviados).toHaveLength(0);
  });
});
