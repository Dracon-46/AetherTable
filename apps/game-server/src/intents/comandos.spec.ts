/**
 * comandos.spec.ts — a janela de arrependimento não pode virar uma segunda
 * tentativa. Estes testes fixam as duas metades da regra: o que ela restaura, e
 * o que ela se recusa a restaurar.
 *
 * Eram os testes de `JornalUndo` (`services/undo.spec.ts`). Mudaram de arquivo
 * porque mudou de dono: quem captura e restaura agora é o comando, e o que o
 * histórico faz é executar e desfazer o último. As asserções são as mesmas.
 */

import type { z } from 'zod';
import { ZONES, zoneOrderKey } from '@aethertable/shared-types';

import { Card } from '../schema/Card';
import { Player } from '../schema/Player';
import { RoomState } from '../schema/RoomState';
import { ZoneOrderList } from '../schema/ZoneOrderList';
import { JANELA_UNDO_MS, NAO_REVERSIVEIS } from '../services/undo';
import { ComandoDeIntencao, HistoricoDeComandos } from './comandos';
import type { IntentContext, IntentHandler } from './registry';

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

function ctxDe(state: RoomState, sid = 'p1'): IntentContext {
  return {
    state,
    client: { sessionId: sid },
    clients: [],
    send: () => {},
    broadcast: () => {},
    log: () => {},
    desfazer: () => null,
    expulsar: () => {},
  } as unknown as IntentContext;
}

/**
 * Um comando com a mutação que o teste quiser. O handler é de mentira porque o
 * que está sob teste é o par capturar/restaurar — não o que a intenção faz.
 */
function comandoQue(state: RoomState, tipo: string, mutacao: () => void) {
  const handler = {
    schema: {} as z.ZodTypeAny,
    autoriza: 'QUALQUER_JOGADOR',
    executa: mutacao,
  } as unknown as IntentHandler<z.ZodTypeAny>;
  return new ComandoDeIntencao(tipo, handler, ctxDe(state), {}, state);
}

describe('HistoricoDeComandos', () => {
  it('restaura propriedade de carta alterada', () => {
    const { state, c } = mesa();
    const historico = new HistoricoDeComandos();

    historico.executar(
      comandoQue(state, 'INTENT_TAP', () => {
        c.isTapped = true;
      }),
    );

    expect(historico.desfazer('p1')).toBe('INTENT_TAP');
    expect(c.isTapped).toBe(false);
  });

  it('restaura vida e contadores do jogador', () => {
    const { state, p } = mesa();
    const historico = new HistoricoDeComandos();

    historico.executar(
      comandoQue(state, 'INTENT_SET_LIFE', () => {
        p.life = 12;
        p.poison = 5;
      }),
    );

    historico.desfazer('p1');
    expect(p.life).toBe(40);
    expect(p.poison).toBe(0);
  });

  it('restaura a ordem das zonas depois de uma troca de zona', () => {
    const { state, c } = mesa();
    const historico = new HistoricoDeComandos();
    const mao = state.zoneOrder.get(zoneOrderKey('p1', 'HAND'))!.items;

    historico.executar(
      comandoQue(state, 'INTENT_CHANGE_ZONE', () => {
        mao.push('c1');
        c.zone = 'HAND';
      }),
    );

    historico.desfazer('p1');
    expect(c.zone).toBe('BATTLEFIELD');
    expect(mao.length).toBe(0);
  });

  it('o snapshot sai ANTES da mutação — é o comando que garante a ordem', () => {
    // A regressão que o padrão fecha: enquanto capturar e executar eram duas
    // chamadas na Room, inverter as linhas fazia o undo virar um no-op mudo.
    const { state, c } = mesa();
    const historico = new HistoricoDeComandos();

    historico.executar(
      comandoQue(state, 'INTENT_SET_NOTE', () => {
        c.note = 'depois';
      }),
    );

    expect(c.note).toBe('depois');
    historico.desfazer('p1');
    expect(c.note).toBe('');
  });

  it('NÃO registra ação aleatória — desfazer um sorteio é uma segunda tentativa', () => {
    const { state, c } = mesa();
    const historico = new HistoricoDeComandos();

    historico.executar(
      comandoQue(state, 'INTENT_TAP', () => {
        c.isTapped = true;
      }),
    );
    // Uma ação irreversível invalida o passado.
    historico.executar(comandoQue(state, 'INTENT_SHUFFLE', () => {}));

    expect(historico.desfazer('p1')).toBeNull();
    expect(c.isTapped).toBe(true);
  });

  it('a ação irreversível continua acontecendo — ela só não entra no histórico', () => {
    const { state, p } = mesa();
    const historico = new HistoricoDeComandos();

    historico.executar(
      comandoQue(state, 'INTENT_SHUFFLE', () => {
        p.mulliganCount = 1;
      }),
    );

    expect(p.mulliganCount).toBe(1);
  });

  it('recusa fora da janela de 10 s', () => {
    const { state, c } = mesa();
    const historico = new HistoricoDeComandos();

    historico.executar(
      comandoQue(state, 'INTENT_TAP', () => {
        c.isTapped = true;
      }),
    );

    expect(historico.desfazer('p1', Date.now() + JANELA_UNDO_MS + 1)).toBeNull();
    expect(c.isTapped).toBe(true);
  });

  it('não empilha: um undo consome o único comando guardado', () => {
    const { state, c } = mesa();
    const historico = new HistoricoDeComandos();

    historico.executar(
      comandoQue(state, 'INTENT_TAP', () => {
        c.isTapped = true;
      }),
    );
    historico.desfazer('p1');

    expect(historico.desfazer('p1')).toBeNull();
  });

  it('o histórico é por jogador: o undo de um não mexe no do outro', () => {
    const { state, c } = mesa();
    const historico = new HistoricoDeComandos();
    const outra = new Card();
    outra.id = 'c2';
    outra.ownerId = 'p2';
    outra.controllerId = 'p2';
    outra.zone = 'BATTLEFIELD';
    state.cards.set('c2', outra);

    historico.executar(
      comandoQue(state, 'INTENT_TAP', () => {
        c.isTapped = true;
        outra.isTapped = true;
      }),
    );

    historico.desfazer('p1');
    expect(c.isTapped).toBe(false);
    // A carta de p2 continua virada: o undo de p1 não reescreve a mesa alheia.
    expect(outra.isTapped).toBe(true);
  });

  it('trata revelação e olhada como irreversíveis', () => {
    for (const intent of ['INTENT_REVEAL', 'INTENT_PEEK', 'INTENT_SEARCH_ZONE', 'INTENT_SCRY']) {
      expect(NAO_REVERSIVEIS.has(intent)).toBe(true);
    }
  });

  it('esquecer apaga o que aquele jogador tinha para desfazer', () => {
    const { state, c } = mesa();
    const historico = new HistoricoDeComandos();

    historico.executar(
      comandoQue(state, 'INTENT_TAP', () => {
        c.isTapped = true;
      }),
    );
    historico.esquecer('p1');

    expect(historico.desfazer('p1')).toBeNull();
  });
});
