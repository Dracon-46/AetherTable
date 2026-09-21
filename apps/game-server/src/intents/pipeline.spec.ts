/**
 * pipeline.spec.ts — cada barreira do despacho, sozinha.
 *
 * Antes da corrente, exercitar o limite de sorteios ou a barreira de espectador
 * exigia subir uma Room do Colyseus inteira; o resultado é que nenhuma das seis
 * tinha teste próprio. O que este arquivo cobre é justamente o que a Room não
 * cobria: a ORDEM em que elas valem, e o fato de que uma recusa não deixa o
 * pedido seguir adiante.
 */

import { z } from 'zod';
import { ZONES, zoneOrderKey } from '@aethertable/shared-types';

import { Espectador } from '../schema/Espectador';
import { Player } from '../schema/Player';
import { RoomState } from '../schema/RoomState';
import { ZoneOrderList } from '../schema/ZoneOrderList';
import { RateLimiter, type IntentContext, type IntentHandler } from './registry';
import {
  correnteDaMesa,
  type ObservadorDeDespacho,
  type Pedido,
  type SalaDoDespacho,
} from './pipeline';

function mesa() {
  const state = new RoomState();
  const p = new Player();
  p.id = 'p1';
  p.userId = 'u-p1';
  p.name = 'Gaspare';
  p.seat = 0;
  state.players.set('p1', p);
  for (const z of ZONES) state.zoneOrder.set(zoneOrderKey('p1', z), new ZoneOrderList());
  return state;
}

function plateia(state: RoomState, sid: string) {
  const e = new Espectador();
  e.id = sid;
  e.name = 'Quem assiste';
  state.espectadores.set(sid, e);
}

/** Uma bancada: estado, corrente montada e tudo que os elos produziram. */
function bancada(state = mesa()) {
  const enviados: Array<{ evento: string; payload: { code?: string } }> = [];
  const recusas: string[] = [];
  const executados: string[] = [];
  const falhas: string[] = [];

  const client = {
    sessionId: 'p1',
    send: (evento: string, payload: unknown) =>
      enviados.push({ evento, payload: payload as { code?: string } }),
  };

  const sala: SalaDoDespacho = {
    state,
    contextoPara: () => ({ state, client, clients: [] }) as unknown as IntentContext,
    antesDaMutacao: () => {},
    depoisDaMutacao: () => {},
  };

  const observador: ObservadorDeDespacho = {
    aceita: (tipo) => executados.push(tipo),
    recusada: (motivo) => recusas.push(motivo),
    falhou: (tipo) => falhas.push(tipo),
  };

  const corrente = correnteDaMesa({
    sala,
    observador,
    limitePadrao: new RateLimiter(3),
    limiteDeSorteio: new RateLimiter(1),
    intencoesDeSorteio: new Set(['INTENT_ROLL_DICE']),
    mensagemDeSorteio: 'Calma com os sorteios.',
  });

  /** Handler de mentira: registra que foi chamado, e com qual payload. */
  const chamadas: unknown[] = [];
  const handler: IntentHandler<z.ZodTypeAny> = {
    schema: z.object({ sides: z.number().int().positive() }),
    autoriza: 'QUALQUER_JOGADOR',
    executa: (_ctx, payload) => {
      chamadas.push(payload);
    },
  };

  const enviar = (tipo = 'INTENT_ROLL_DICE', payload: unknown = { sides: 6 }, quem = client) =>
    corrente.tratar({ tipo, client: quem, payload, handler } as unknown as Pedido);

  return { state, enviar, enviados, recusas, executados, falhas, chamadas, handler, client };
}

const codigos = (enviados: Array<{ payload: { code?: string } }>) =>
  enviados.map((e) => e.payload.code);

describe('a corrente aceita o que é válido', () => {
  it('executa o handler uma vez, com o payload já parseado', () => {
    const b = bancada();

    b.enviar();

    expect(b.chamadas).toEqual([{ sides: 6 }]);
    expect(b.executados).toEqual(['INTENT_ROLL_DICE']);
    expect(b.enviados).toHaveLength(0);
  });
});

describe('cada elo recusa o seu caso — e nada segue adiante', () => {
  it('limite geral: acima do teto, descarta com RATE_LIMITED', () => {
    const b = bancada();

    // O teto da bancada é 3/s, e o de sorteio é 1 — para isolar o elo geral, o
    // tipo usado aqui não é sorteio.
    for (let i = 0; i < 4; i += 1) b.enviar('INTENT_TAP');

    expect(b.recusas).toEqual(['rate_limit']);
    expect(codigos(b.enviados)).toEqual(['RATE_LIMITED']);
    expect(b.chamadas).toHaveLength(3);
  });

  it('teto de sorteio: vale só para a família de sorteio', () => {
    const b = bancada();

    b.enviar('INTENT_ROLL_DICE');
    b.enviar('INTENT_ROLL_DICE');

    expect(b.recusas).toEqual(['too_many_rolls']);
    expect(b.chamadas).toHaveLength(1);
  });

  it('espectador é barrado antes de o payload ser validado', () => {
    // A prova de que a ordem é essa: o payload abaixo é inválido. Se a
    // validação viesse antes, o código seria INVALID_PAYLOAD.
    const state = mesa();
    plateia(state, 'p1');
    const b = bancada(state);

    b.enviar('INTENT_ROLL_DICE', { sides: 'muitos' });

    expect(codigos(b.enviados)).toEqual(['SPECTATOR']);
    expect(b.recusas).toEqual(['spectator']);
  });

  it('chat é a única exceção do espectador', () => {
    const state = mesa();
    plateia(state, 'p1');
    const b = bancada(state);

    b.enviar('INTENT_CHAT');

    expect(b.recusas).toEqual([]);
    expect(b.chamadas).toHaveLength(1);
  });

  it('payload fora do schema não chega ao handler', () => {
    const b = bancada();

    b.enviar('INTENT_ROLL_DICE', { sides: -1 });

    expect(codigos(b.enviados)).toEqual(['INVALID_PAYLOAD']);
    expect(b.chamadas).toHaveLength(0);
  });

  it('autorização de dono: sem entityId conhecido, ENTITY_NOT_FOUND', () => {
    const b = bancada();
    b.handler.autoriza = 'OWNER';

    b.enviar('INTENT_TAP');

    expect(codigos(b.enviados)).toEqual(['ENTITY_NOT_FOUND']);
    expect(b.chamadas).toHaveLength(0);
  });

  it('a mensagem de erro nunca vaza o motivo interno para o cliente', () => {
    const b = bancada();
    b.handler.executa = () => {
      throw new Error('carta Black Lotus não encontrada no grimório');
    };

    b.enviar();

    expect(codigos(b.enviados)).toEqual(['INTERNAL']);
    expect(JSON.stringify(b.enviados)).not.toContain('Black Lotus');
    expect(b.falhas).toEqual(['INTENT_ROLL_DICE']);
  });
});

describe('a invariante que a corrente torna verificável', () => {
  it('handler que explode não derruba a sala: o próximo pedido ainda passa', () => {
    const b = bancada();
    b.handler.executa = () => {
      throw new Error('boom');
    };
    b.enviar('INTENT_TAP');

    b.handler.executa = () => {
      b.chamadas.push('ok');
    };
    b.enviar('INTENT_TAP');

    expect(b.chamadas).toEqual(['ok']);
  });
});
