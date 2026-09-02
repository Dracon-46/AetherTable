/**
 * sala.spec.ts — as regras que decidem QUANDO uma ação é possível.
 *
 * Todas as intenções cobertas aqui já existiam como "qualquer jogador, a
 * qualquer momento". O que faltava não era a ação, era a janela: mulligan
 * depois de a partida ter começado, início de partida com metade da mesa ainda
 * escolhendo deck, e visibilidade de zona oculta concedida sem que o dono
 * dissesse nada.
 *
 * Cada teste aqui fixa um "não pode" — que é o tipo de regra que some numa
 * refatoração sem que nada quebre visivelmente.
 */

import { REGISTRY, RateLimiter } from './registry';
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

/** Mesa com N assentos, todos com as listas de zona já criadas. */
function montarMesa(assentos: string[]) {
  const state = new RoomState();
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

/** Põe `quantidade` cartas de `dono` na `zona`, e devolve os ids. */
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

function contexto(state: RoomState, sessionId: string, enviados: Enviado[]): IntentContext {
  return {
    state,
    client: { sessionId } as IntentContext['client'],
    clients: [] as unknown as IntentContext['clients'],
    send: (event, payload) => enviados.push({ event, payload }),
    broadcast: () => {},
    log: () => {},
    desfazer: () => null,
    expulsar: () => {},
  } as IntentContext;
}

function executar(intent: keyof typeof REGISTRY, state: RoomState, sid: string, payload: unknown) {
  const enviados: Enviado[] = [];
  REGISTRY[intent].executa(contexto(state, sid, enviados), payload as never);
  return enviados;
}

const codigoDoErro = (enviados: Enviado[]) =>
  enviados.length > 0 ? (enviados[0]!.payload as { code?: string }).code : undefined;

// ═══════════════════════════════════════════════════════════════════════════

describe('INTENT_MULLIGAN — a janela fecha', () => {
  /** Mesa em jogo, turno 1, sete na mão e resto no grimório. */
  function mesaEmJogo() {
    const state = montarMesa(['eu', 'voce']);
    state.phase = 'PLAYING';
    state.turn = 1;
    encher(state, 'eu', 'HAND', 7);
    encher(state, 'eu', 'LIBRARY', 40);
    return state;
  }

  it('vale no turno 1, antes de qualquer jogada', () => {
    const state = mesaEmJogo();

    const enviados = executar('INTENT_MULLIGAN', state, 'eu', {});

    expect(enviados).toHaveLength(0);
    expect(state.players.get('eu')!.mulliganCount).toBe(1);
    expect(state.zoneOrder.get(zoneOrderKey('eu', 'HAND'))!.items.length).toBe(7);
  });

  it('NÃO vale depois de o jogador declarar que ficou com a mão', () => {
    const state = mesaEmJogo();
    state.players.get('eu')!.keptHand = true;

    const enviados = executar('INTENT_MULLIGAN', state, 'eu', {});

    expect(codigoDoErro(enviados)).toBe('MULLIGAN_CLOSED');
    expect(state.players.get('eu')!.mulliganCount).toBe(0);
  });

  it('NÃO vale depois do primeiro turno', () => {
    const state = mesaEmJogo();
    state.turn = 2;

    expect(codigoDoErro(executar('INTENT_MULLIGAN', state, 'eu', {}))).toBe('MULLIGAN_CLOSED');
  });

  /**
   * O caso que o limite de turno não pega: a mesa ainda está no turno 1 e o
   * jogador já baixou terreno. Dali em diante a mão já informou uma decisão, e
   * trocá-la é reescrever o que os outros viram acontecer.
   */
  it('NÃO vale se o jogador já tem carta no campo, mesmo no turno 1', () => {
    const state = mesaEmJogo();
    encher(state, 'eu', 'BATTLEFIELD', 1);

    expect(codigoDoErro(executar('INTENT_MULLIGAN', state, 'eu', {}))).toBe('MULLIGAN_CLOSED');
  });

  it('NÃO vale na sala de espera — não há mão inicial ainda', () => {
    const state = mesaEmJogo();
    state.phase = 'WAITING';

    expect(codigoDoErro(executar('INTENT_MULLIGAN', state, 'eu', {}))).toBe('MULLIGAN_CLOSED');
  });

  it('INTENT_KEEP_HAND fecha a janela', () => {
    const state = mesaEmJogo();

    executar('INTENT_KEEP_HAND', state, 'eu', {});

    expect(state.players.get('eu')!.keptHand).toBe(true);
    expect(codigoDoErro(executar('INTENT_MULLIGAN', state, 'eu', {}))).toBe('MULLIGAN_CLOSED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('INTENT_START_MATCH — a mesa inteira decide quando começa', () => {
  function salaDeEspera() {
    const state = montarMesa(['anfitriao', 'convidado']);
    state.phase = 'WAITING';
    encher(state, 'anfitriao', 'LIBRARY', 60);
    encher(state, 'convidado', 'LIBRARY', 60);
    return state;
  }

  it('RECUSA enquanto alguém não confirmou', () => {
    const state = salaDeEspera();

    const enviados = executar('INTENT_START_MATCH', state, 'anfitriao', {});

    expect(codigoDoErro(enviados)).toBe('NOT_ALL_READY');
    expect(state.phase).toBe('WAITING');
    // Ninguém comprou: a mão inicial sai só quando a partida começa de verdade.
    expect(state.zoneOrder.get(zoneOrderKey('anfitriao', 'HAND'))!.items.length).toBe(0);
  });

  it('RECUSA quem está sem grimório, mesmo com todos prontos', () => {
    const state = salaDeEspera();
    state.players.get('convidado')!.ready = true;
    // O convidado marcou pronto e depois trocou de deck: a lista ficou vazia.
    state.zoneOrder.get(zoneOrderKey('convidado', 'LIBRARY'))!.items.splice(0);

    expect(codigoDoErro(executar('INTENT_START_MATCH', state, 'anfitriao', {}))).toBe('NO_DECK');
    expect(state.phase).toBe('WAITING');
  });

  it('começa quando todos confirmaram, e compra sete para cada um', () => {
    const state = salaDeEspera();
    state.players.get('convidado')!.ready = true;

    const enviados = executar('INTENT_START_MATCH', state, 'anfitriao', {});

    expect(enviados).toHaveLength(0);
    expect(state.phase).toBe('PLAYING');
    expect(state.zoneOrder.get(zoneOrderKey('anfitriao', 'HAND'))!.items.length).toBe(7);
    expect(state.zoneOrder.get(zoneOrderKey('convidado', 'HAND'))!.items.length).toBe(7);
    // O clique do anfitrião vale como o "pronto" dele.
    expect(state.players.get('anfitriao')!.ready).toBe(true);
  });

  it('um convidado NÃO inicia a partida por cima da sala de espera', () => {
    const state = salaDeEspera();

    expect(codigoDoErro(executar('INTENT_START_MATCH', state, 'convidado', {}))).toBe('NOT_HOST');
    expect(state.phase).toBe('WAITING');
  });
});

describe('INTENT_SET_READY', () => {
  it('NÃO deixa ficar pronto sem grimório', () => {
    const state = montarMesa(['a', 'b']);
    state.phase = 'WAITING';

    expect(codigoDoErro(executar('INTENT_SET_READY', state, 'b', { ready: true }))).toBe('NO_DECK');
    expect(state.players.get('b')!.ready).toBe(false);
  });

  it('aceita com grimório provisionado, e aceita desmarcar', () => {
    const state = montarMesa(['a', 'b']);
    state.phase = 'WAITING';
    encher(state, 'b', 'LIBRARY', 60);

    executar('INTENT_SET_READY', state, 'b', { ready: true });
    expect(state.players.get('b')!.ready).toBe(true);

    executar('INTENT_SET_READY', state, 'b', { ready: false });
    expect(state.players.get('b')!.ready).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('INTENT_KICK_PLAYER', () => {
  it('só o anfitrião remove alguém', () => {
    const state = montarMesa(['anfitriao', 'a', 'b']);
    const expulsos: string[] = [];
    const enviados: Enviado[] = [];
    const ctx = {
      ...contexto(state, 'a', enviados),
      expulsar: (sid: string) => expulsos.push(sid),
    } as IntentContext;

    REGISTRY.INTENT_KICK_PLAYER.executa(ctx, { playerId: 'b' } as never);

    expect(expulsos).toHaveLength(0);
    expect(codigoDoErro(enviados)).toBe('NOT_HOST');
  });

  it('o anfitrião remove, e não consegue remover a si mesmo', () => {
    const state = montarMesa(['anfitriao', 'a']);
    const expulsos: string[] = [];
    const ctx = (sid: string) =>
      ({ ...contexto(state, sid, []), expulsar: (x: string) => expulsos.push(x) }) as IntentContext;

    REGISTRY.INTENT_KICK_PLAYER.executa(ctx('anfitriao'), { playerId: 'a' } as never);
    expect(expulsos).toEqual(['a']);

    // Sair da própria sala é INTENT_LEAVE. Se o assento 0 pudesse se expulsar,
    // a sala ficaria sem ninguém que pudesse iniciar a partida.
    REGISTRY.INTENT_KICK_PLAYER.executa(ctx('anfitriao'), { playerId: 'anfitriao' } as never);
    expect(expulsos).toEqual(['a']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('ver a zona oculta de outro jogador exige consentimento (RN13)', () => {
  function mesaComMao() {
    const state = montarMesa(['dono', 'curioso']);
    state.phase = 'PLAYING';
    encher(state, 'dono', 'HAND', 3);
    return state;
  }

  it('pedir NÃO concede nada', () => {
    const state = mesaComMao();

    executar('INTENT_REQUEST_VIEW', state, 'curioso', {
      targetPlayerId: 'dono',
      zone: 'HAND',
    });

    const mao = state.zoneOrder.get(zoneOrderKey('dono', 'HAND'))!.items;
    mao.forEach((id) => expect(state.cards.get(id)!.revealedTo).toBe(''));
    expect(state.players.get('dono')!.sharedZones.get('HAND')).toBeUndefined();
  });

  it('recusar NÃO concede nada', () => {
    const state = mesaComMao();

    executar('INTENT_RESPOND_VIEW', state, 'dono', {
      requesterId: 'curioso',
      zone: 'HAND',
      accept: false,
    });

    const mao = state.zoneOrder.get(zoneOrderKey('dono', 'HAND'))!.items;
    mao.forEach((id) => expect(state.cards.get(id)!.revealedTo).toBe(''));
  });

  it('aceitar concede sobre a ZONA, não sobre aquelas cartas', () => {
    const state = mesaComMao();

    executar('INTENT_RESPOND_VIEW', state, 'dono', {
      requesterId: 'curioso',
      zone: 'HAND',
      accept: true,
    });

    const mao = state.zoneOrder.get(zoneOrderKey('dono', 'HAND'))!.items;
    mao.forEach((id) => expect(state.cards.get(id)!.revealedTo).toContain('curioso'));

    // A permissão fica no jogador: é o que faz a carta comprada DEPOIS também
    // ser visível, em vez de a permissão evaporar na primeira compra.
    expect(state.players.get('dono')!.sharedZones.get('HAND')).toBe('curioso');
  });

  it('revogar apaga dos dois lugares', () => {
    const state = mesaComMao();
    executar('INTENT_RESPOND_VIEW', state, 'dono', {
      requesterId: 'curioso',
      zone: 'HAND',
      accept: true,
    });

    executar('INTENT_REVOKE_VIEW', state, 'dono', { viewerId: 'curioso', zone: 'HAND' });

    const mao = state.zoneOrder.get(zoneOrderKey('dono', 'HAND'))!.items;
    mao.forEach((id) => expect(state.cards.get(id)!.revealedTo).toBe(''));
    expect(state.players.get('dono')!.sharedZones.get('HAND')).toBeUndefined();
  });

  /**
   * `revealedTo === 'ALL'` veio de "revelar para a mesa", não desta permissão.
   * Revogar a permissão de uma pessoa não pode desfazer uma revelação pública —
   * seria esconder de novo algo que a mesa inteira já viu.
   */
  it('revogar NÃO desfaz uma revelação pública', () => {
    const state = mesaComMao();
    const mao = state.zoneOrder.get(zoneOrderKey('dono', 'HAND'))!.items;
    state.cards.get(mao[0]!)!.revealedTo = 'ALL';

    executar('INTENT_REVOKE_VIEW', state, 'dono', { viewerId: 'curioso', zone: 'HAND' });

    expect(state.cards.get(mao[0]!)!.revealedTo).toBe('ALL');
  });

  it('não existe caminho para pedir a si mesmo nem a um jogador ausente', () => {
    const state = mesaComMao();

    expect(() =>
      executar('INTENT_REQUEST_VIEW', state, 'curioso', {
        targetPlayerId: 'curioso',
        zone: 'HAND',
      }),
    ).not.toThrow();
    expect(() =>
      executar('INTENT_RESPOND_VIEW', state, 'dono', {
        requesterId: 'fantasma',
        zone: 'HAND',
        accept: true,
      }),
    ).not.toThrow();

    const mao = state.zoneOrder.get(zoneOrderKey('dono', 'HAND'))!.items;
    mao.forEach((id) => expect(state.cards.get(id)!.revealedTo).toBe(''));
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('INTENT_GIVE_CARD — mandar uma permanente para a mesa de outro', () => {
  it('passa o controle e zera a posição (a coordenada é relativa à faixa)', () => {
    const state = montarMesa(['eu', 'voce']);
    const [id] = encher(state, 'eu', 'BATTLEFIELD', 1);
    const carta = state.cards.get(id!)!;
    carta.x = 400;
    carta.y = 200;

    executar('INTENT_GIVE_CARD', state, 'eu', { entityId: id, targetPlayerId: 'voce' });

    expect(carta.controllerId).toBe('voce');
    expect(carta.x).toBe(0);
    expect(carta.y).toBe(0);
    // O DONO nunca muda: a carta volta para o cemitério dele ao morrer.
    expect(carta.ownerId).toBe('eu');
  });

  it('não envia carta que não está no campo', () => {
    const state = montarMesa(['eu', 'voce']);
    const [id] = encher(state, 'eu', 'HAND', 1);

    executar('INTENT_GIVE_CARD', state, 'eu', { entityId: id, targetPlayerId: 'voce' });

    expect(state.cards.get(id!)!.controllerId).toBe('eu');
  });

  it('não envia para quem não está na mesa', () => {
    const state = montarMesa(['eu', 'voce']);
    const [id] = encher(state, 'eu', 'BATTLEFIELD', 1);

    executar('INTENT_GIVE_CARD', state, 'eu', { entityId: id, targetPlayerId: 'fantasma' });

    expect(state.cards.get(id!)!.controllerId).toBe('eu');
  });
});

// ═══════════════════════════════════════════════════════════════════════════

/**
 * O freio dos SORTEIOS.
 *
 * Dado e moeda passavam de sobra no limite geral de 30 intenções/s — cada
 * rolagem é uma intenção perfeitamente válida. Só que cada uma custa um
 * broadcast para a mesa inteira e uma linha de log em todos os clientes: é a
 * única família de ações em que uma pessoa sozinha gera trabalho para todas as
 * outras sem mudar estado nenhum. Daí a janela própria, bem mais estreita.
 */
describe('RateLimiter com janela própria (sorteios)', () => {
  it('deixa passar até o teto e barra o excedente dentro da janela', () => {
    const limitador = new RateLimiter(5, 8000);
    const t0 = 1_000_000;

    for (let i = 0; i < 5; i += 1) {
      expect(limitador.permitir('a', t0 + i)).toBe(true);
    }
    expect(limitador.permitir('a', t0 + 6)).toBe(false);
    expect(limitador.permitir('a', t0 + 7)).toBe(false);
  });

  it('libera de novo quando a janela vira', () => {
    const limitador = new RateLimiter(5, 8000);
    const t0 = 1_000_000;

    for (let i = 0; i < 6; i += 1) limitador.permitir('a', t0 + i);

    expect(limitador.permitir('a', t0 + 8000)).toBe(true);
  });

  it('a rajada de um jogador não afeta os outros', () => {
    const limitador = new RateLimiter(5, 8000);
    const t0 = 1_000_000;

    for (let i = 0; i < 10; i += 1) limitador.permitir('a', t0 + i);

    expect(limitador.permitir('b', t0 + 11)).toBe(true);
  });
});
