/**
 * mesa-relatada.spec.ts — os defeitos de mesa relatados por jogador, um por um.
 *
 * Cada bloco aqui é um relato ("radiação não funciona", "dano de comandante
 * não funciona", "não consigo expulsar ninguém"…) reduzido ao estado que o
 * provava. Os testes que existiam passavam com os defeitos no lugar porque
 * exercitavam o handler que NENHUMA tela chamava — por isso aqui o caminho é
 * sempre o que a interface emite.
 */

import { PLAYER_COUNTERS, ZONES, zoneOrderKey } from '@aethertable/shared-types';
import { REGISTRY } from './registry';
import type { IntentContext } from './registry';
import { RoomState } from '../schema/RoomState';
import { Player } from '../schema/Player';
import { Card } from '../schema/Card';
import { ZoneOrderList } from '../schema/ZoneOrderList';

interface Mesa {
  state: RoomState;
  enviados: Array<{ event: string; payload: unknown }>;
  expulsos: string[];
}

function montarMesa(assentos: string[], gameType = 'COMMANDER'): Mesa {
  const state = new RoomState();
  state.phase = 'PLAYING';
  state.gameType = gameType;
  state.maxSeats = 8;
  assentos.forEach((id, indice) => {
    const p = new Player();
    p.id = id;
    p.name = id.toUpperCase();
    p.seat = indice;
    p.connected = true;
    state.players.set(id, p);
    for (const zone of ZONES) state.zoneOrder.set(zoneOrderKey(id, zone), new ZoneOrderList());
  });
  return { state, enviados: [], expulsos: [] };
}

function poe(mesa: Mesa, id: string, dono: string, zona: string, extra: Partial<Card> = {}): Card {
  const c = new Card();
  c.id = id;
  c.ownerId = dono;
  c.controllerId = dono;
  c.zone = zona;
  c.scryfallId = `scry-${id}`;
  Object.assign(c, extra);
  mesa.state.cards.set(c.id, c);
  mesa.state.zoneOrder.get(zoneOrderKey(dono, zona as never))?.items.push(c.id);
  return c;
}

function executar(mesa: Mesa, intent: keyof typeof REGISTRY, sid: string, payload: unknown) {
  const ctx = {
    state: mesa.state,
    client: { sessionId: sid } as IntentContext['client'],
    clients: [] as unknown as IntentContext['clients'],
    send: (event: string, p: unknown) => mesa.enviados.push({ event, payload: p }),
    broadcast: () => {},
    log: () => {},
    desfazer: () => null,
    expulsar: (alvo: string) => mesa.expulsos.push(alvo),
  } as IntentContext;
  REGISTRY[intent].executa(ctx, payload as never);
}

const jogador = (mesa: Mesa, id: string) => mesa.state.players.get(id)!;
const erros = (mesa: Mesa) => mesa.enviados.filter((e) => e.event === 'error');

// ═══════════════════════════════════════════════════════════════════════════

describe('contadores de jogador — o caminho que a interface usa', () => {
  const CAMPO = {
    POISON: 'poison',
    ENERGY: 'energy',
    EXPERIENCE: 'experience',
    RAD: 'rad',
    TICKET: 'ticket',
  } as const;

  /** Radiação e Ingresso caíam num `default: return` e não respondiam. */
  it.each(PLAYER_COUNTERS)('ADD_PLAYER_COUNTER %s muda o campo', (tipo) => {
    const mesa = montarMesa(['a', 'b']);
    executar(mesa, 'INTENT_ADD_PLAYER_COUNTER', 'a', { name: tipo, amount: 3 });
    expect(jogador(mesa, 'a')[CAMPO[tipo]]).toBe(3);
  });

  it.each(PLAYER_COUNTERS)('ADD e SET dão o mesmo estado para %s', (tipo) => {
    const um = montarMesa(['a']);
    const outro = montarMesa(['a']);
    executar(um, 'INTENT_ADD_PLAYER_COUNTER', 'a', { name: tipo, amount: 4 });
    executar(outro, 'INTENT_SET_PLAYER_COUNTER', 'a', { type: tipo, delta: 4 });
    expect(jogador(um, 'a')[CAMPO[tipo]]).toBe(jogador(outro, 'a')[CAMPO[tipo]]);
  });

  it('10 de veneno pelo ADD eliminam', () => {
    const mesa = montarMesa(['a', 'b', 'c']);
    executar(mesa, 'INTENT_ADD_PLAYER_COUNTER', 'a', { name: 'POISON', amount: 10 });
    expect(jogador(mesa, 'a').eliminationReason).toBe('POISON');
  });

  it('reiniciar zera radiação, ingresso, velocidade e o Anel, e volta à vida do formato', () => {
    const mesa = montarMesa(['a', 'b'], 'MODERN');
    const a = jogador(mesa, 'a');
    Object.assign(a, { rad: 5, ticket: 2, speed: 3, ringLevel: 2, life: 7 });

    executar(mesa, 'INTENT_RESET_MATCH', 'a', {});

    expect([a.rad, a.ticket, a.speed, a.ringLevel]).toEqual([0, 0, 0, 0]);
    // Modern começa com 20 — antes toda mesa voltava a 40.
    expect(a.life).toBe(20);
  });
});

describe('dano de comandante', () => {
  it('tira vida junto — marcar +5 e continuar com 40 era o "não funciona"', () => {
    const mesa = montarMesa(['a', 'b']);
    executar(mesa, 'INTENT_SET_COMMANDER_DAMAGE', 'a', { fromPlayerId: 'b', delta: 5 });
    expect(jogador(mesa, 'a').life).toBe(35);

    // Corrigir o clique errado devolve a vida.
    executar(mesa, 'INTENT_SET_COMMANDER_DAMAGE', 'a', { fromPlayerId: 'b', delta: -2 });
    expect(jogador(mesa, 'a').life).toBe(37);
    expect(jogador(mesa, 'a').commanderDamage.get('b')).toBe(3);
  });

  /** Regra 903.10a: cada comandante conta separado. */
  it('parceiros contam separado: 11 de um e 10 do outro não eliminam', () => {
    const mesa = montarMesa(['a', 'b', 'c']);
    poe(mesa, '11111111-1111-4111-8111-111111111111', 'b', 'COMMAND', { isCommander: true });
    poe(mesa, '22222222-2222-4222-8222-222222222222', 'b', 'COMMAND', { isCommander: true });
    jogador(mesa, 'a').life = 99;

    executar(mesa, 'INTENT_SET_COMMANDER_DAMAGE', 'a', {
      fromPlayerId: 'b',
      delta: 11,
      commanderId: '11111111-1111-4111-8111-111111111111',
    });
    executar(mesa, 'INTENT_SET_COMMANDER_DAMAGE', 'a', {
      fromPlayerId: 'b',
      delta: 10,
      commanderId: '22222222-2222-4222-8222-222222222222',
    });
    expect(jogador(mesa, 'a').eliminated).toBe(false);

    executar(mesa, 'INTENT_SET_COMMANDER_DAMAGE', 'a', {
      fromPlayerId: 'b',
      delta: 10,
      commanderId: '11111111-1111-4111-8111-111111111111',
    });
    expect(jogador(mesa, 'a').eliminationReason).toBe('COMMANDER');
  });

  it('o comandante de outro jogador não serve de chave', () => {
    const mesa = montarMesa(['a', 'b', 'c']);
    poe(mesa, '33333333-3333-4333-8333-333333333333', 'c', 'COMMAND', { isCommander: true });
    executar(mesa, 'INTENT_SET_COMMANDER_DAMAGE', 'a', {
      fromPlayerId: 'b',
      delta: 4,
      commanderId: '33333333-3333-4333-8333-333333333333',
    });
    expect(jogador(mesa, 'a').commanderDamage.get('b')).toBe(4);
  });

  /** O 21 de quem saiu deixava o jogador eliminado para sempre. */
  it('dano de quem saiu da mesa ainda pode ser corrigido', () => {
    const mesa = montarMesa(['a', 'b', 'c']);
    executar(mesa, 'INTENT_SET_COMMANDER_DAMAGE', 'a', { fromPlayerId: 'b', delta: 21 });
    expect(jogador(mesa, 'a').eliminated).toBe(true);

    mesa.state.players.delete('b');
    executar(mesa, 'INTENT_SET_COMMANDER_DAMAGE', 'a', { fromPlayerId: 'b', delta: -21 });
    expect(jogador(mesa, 'a').eliminated).toBe(false);
  });
});

describe('remover por votação', () => {
  it('todos os outros concordando, o alvo sai', () => {
    const mesa = montarMesa(['a', 'b', 'c']);
    executar(mesa, 'INTENT_VOTE_KICK', 'a', { playerId: 'c', aceitar: true });
    expect(mesa.expulsos).toEqual([]);
    expect(mesa.state.votacaoAlvo).toBe('c');

    executar(mesa, 'INTENT_VOTE_KICK', 'b', { playerId: 'c', aceitar: true });
    expect(mesa.expulsos).toEqual(['c']);
    expect(mesa.state.votacaoAlvo).toBe('');
  });

  it('um "não" encerra a votação', () => {
    const mesa = montarMesa(['a', 'b', 'c', 'd']);
    executar(mesa, 'INTENT_VOTE_KICK', 'a', { playerId: 'd', aceitar: true });
    executar(mesa, 'INTENT_VOTE_KICK', 'b', { playerId: 'd', aceitar: false });
    executar(mesa, 'INTENT_VOTE_KICK', 'c', { playerId: 'd', aceitar: true });

    expect(mesa.expulsos).toEqual([]);
    // O "sim" de c abriu uma votação NOVA, que ainda precisa de a e b.
    expect(mesa.state.votacaoAutor).toBe('c');
  });

  it('o alvo não vota, e quem caiu não trava a votação', () => {
    const mesa = montarMesa(['a', 'b', 'c', 'd']);
    jogador(mesa, 'd').connected = false;
    executar(mesa, 'INTENT_VOTE_KICK', 'a', { playerId: 'c', aceitar: true });
    executar(mesa, 'INTENT_VOTE_KICK', 'c', { playerId: 'c', aceitar: false });
    expect(mesa.state.votacaoAlvo).toBe('c');
    expect(erros(mesa)).toHaveLength(1);

    executar(mesa, 'INTENT_VOTE_KICK', 'b', { playerId: 'c', aceitar: true });
    expect(mesa.expulsos).toEqual(['c']);
  });

  it('votação vencida não vale', () => {
    const mesa = montarMesa(['a', 'b', 'c']);
    executar(mesa, 'INTENT_VOTE_KICK', 'a', { playerId: 'c', aceitar: true });
    mesa.state.votacaoExpiraEm = Date.now() - 1;
    executar(mesa, 'INTENT_VOTE_KICK', 'b', { playerId: 'c', aceitar: true });

    expect(mesa.expulsos).toEqual([]);
    expect(mesa.state.votacaoAutor).toBe('b');
  });
});

describe('cópia de carta', () => {
  it('copiar o morph do oponente não revela nada — a cópia nem nasce', () => {
    const mesa = montarMesa(['a', 'b']);
    poe(mesa, '44444444-4444-4444-8444-444444444444', 'b', 'BATTLEFIELD', { faceDown: true });
    executar(mesa, 'INTENT_COPY_CARD', 'a', { entityId: '44444444-4444-4444-8444-444444444444' });
    expect(mesa.state.cards.size).toBe(1);
  });

  it('a cópia é uma FICHA de quem copiou, não uma carta do dono do original', () => {
    const mesa = montarMesa(['a', 'b']);
    poe(mesa, '55555555-5555-4555-8555-555555555555', 'b', 'BATTLEFIELD');
    executar(mesa, 'INTENT_COPY_CARD', 'a', { entityId: '55555555-5555-4555-8555-555555555555' });

    const copia = Array.from(mesa.state.cards.values()).find((c) => c.isCopy)!;
    expect(copia.ownerId).toBe('a');
    expect(copia.controllerId).toBe('a');
    expect(copia.isToken).toBe(true);
    expect(copia.scryfallId).toBe('scry-55555555-5555-4555-8555-555555555555');
  });
});

describe('jogar virada e no campo de outro jogador', () => {
  it('da mão para o campo virada: a face já sai escondida', () => {
    const mesa = montarMesa(['a', 'b']);
    const c = poe(mesa, '66666666-6666-4666-8666-666666666666', 'a', 'HAND');
    executar(mesa, 'INTENT_CHANGE_ZONE', 'a', {
      entityId: c.id,
      targetZone: 'BATTLEFIELD',
      faceDown: true,
    });
    expect(c.zone).toBe('BATTLEFIELD');
    expect(c.faceDown).toBe(true);
  });

  it('da mão para o campo de outro jogador: o dono não muda, o controle sim', () => {
    const mesa = montarMesa(['a', 'b']);
    const c = poe(mesa, '77777777-7777-4777-8777-777777777777', 'a', 'HAND');
    executar(mesa, 'INTENT_CHANGE_ZONE', 'a', {
      entityId: c.id,
      targetZone: 'BATTLEFIELD',
      controllerId: 'b',
      faceDown: true,
    });
    expect(c.ownerId).toBe('a');
    expect(c.controllerId).toBe('b');
    expect(c.faceDown).toBe(true);
  });

  it('virada que vai para o cemitério volta a face para cima', () => {
    const mesa = montarMesa(['a']);
    const c = poe(mesa, '88888888-8888-4888-8888-888888888888', 'a', 'BATTLEFIELD', {
      faceDown: true,
    });
    executar(mesa, 'INTENT_CHANGE_ZONE', 'a', { entityId: c.id, targetZone: 'GRAVEYARD' });
    expect(c.faceDown).toBe(false);
  });

  it('entregar virada pelo campo passa o controle e esconde a face', () => {
    const mesa = montarMesa(['a', 'b']);
    const c = poe(mesa, '99999999-9999-4999-8999-999999999999', 'a', 'BATTLEFIELD');
    executar(mesa, 'INTENT_GIVE_CARD', 'a', {
      entityId: c.id,
      targetPlayerId: 'b',
      faceDown: true,
      x: 10,
      y: 20,
    });
    expect([c.controllerId, c.faceDown, c.x, c.y]).toEqual(['b', true, 10, 20]);
  });
});

describe('assentos — o quinto jogador', () => {
  it('o anfitrião abre vagas na sala de espera', () => {
    const mesa = montarMesa(['a', 'b', 'c', 'd']);
    mesa.state.phase = 'WAITING';
    mesa.state.maxSeats = 4;
    executar(mesa, 'INTENT_SET_ROOM_CONFIG', 'a', { maxSeats: 6 });
    expect(mesa.state.maxSeats).toBe(6);
  });

  it('vale com a partida andando, para quem chegou atrasado', () => {
    const mesa = montarMesa(['a', 'b', 'c', 'd']);
    mesa.state.maxSeats = 4;
    executar(mesa, 'INTENT_SET_ROOM_CONFIG', 'a', { maxSeats: 5 });
    expect(mesa.state.maxSeats).toBe(5);
  });

  it('não fecha abaixo de quem já está sentado, e só o anfitrião mexe', () => {
    const mesa = montarMesa(['a', 'b', 'c', 'd']);
    executar(mesa, 'INTENT_SET_ROOM_CONFIG', 'a', { maxSeats: 3 });
    expect(mesa.state.maxSeats).toBe(8);
    executar(mesa, 'INTENT_SET_ROOM_CONFIG', 'b', { maxSeats: 5 });
    expect(mesa.state.maxSeats).toBe(8);
  });
});

describe('ficha que sai do campo', () => {
  /** O topo do cemitério é lido da ORDEM; o id órfão deixava a pilha com topo vazio. */
  it('some do estado E da ordem do cemitério', () => {
    const mesa = montarMesa(['a']);
    poe(mesa, 'aaaaaaaa-0000-4000-8000-000000000001', 'a', 'GRAVEYARD', { isToken: false });
    const ficha = poe(mesa, 'aaaaaaaa-0000-4000-8000-000000000002', 'a', 'BATTLEFIELD', {
      isToken: true,
    });

    executar(mesa, 'INTENT_CHANGE_ZONE', 'a', { entityId: ficha.id, targetZone: 'GRAVEYARD' });

    expect(mesa.state.cards.has(ficha.id)).toBe(false);
    const cemiterio = Array.from(mesa.state.zoneOrder.get(zoneOrderKey('a', 'GRAVEYARD'))!.items);
    expect(cemiterio).toEqual(['aaaaaaaa-0000-4000-8000-000000000001']);
  });
});

describe('mover a seleção em lote', () => {
  const uuid = (i: number) => `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`;

  /** Uma intenção por carta estourava o limite de 30/s e deixava cartas para trás. */
  it('40 fichas vão para o cemitério numa mensagem só', () => {
    const mesa = montarMesa(['a']);
    const ids = Array.from(
      { length: 40 },
      (_, i) => poe(mesa, uuid(i), 'a', 'BATTLEFIELD', { isToken: true }).id,
    );

    executar(mesa, 'INTENT_BATCH_CHANGE_ZONE', 'a', { entityIds: ids, targetZone: 'GRAVEYARD' });

    expect(ids.every((id) => !mesa.state.cards.has(id))).toBe(true);
  });

  it('carta de oponente na seleção é ignorada, as minhas vão', () => {
    const mesa = montarMesa(['a', 'b']);
    const minha = poe(mesa, uuid(1), 'a', 'BATTLEFIELD');
    const dele = poe(mesa, uuid(2), 'b', 'BATTLEFIELD');

    executar(mesa, 'INTENT_BATCH_CHANGE_ZONE', 'a', {
      entityIds: [minha.id, dele.id],
      targetZone: 'HAND',
    });

    expect(minha.zone).toBe('HAND');
    expect(dele.zone).toBe('BATTLEFIELD');
    expect(jogador(mesa, 'a').handCount).toBe(1);
  });

  // O teto é único para os três lotes (MAX_LOTE = 200): eram 60/60/100, e a
  // seleção por laço passava de 60 num campo de fichas com facilidade.
  it('o schema aceita 200 e recusa 201', async () => {
    const { BatchChangeZoneIntent } = await import('./schemas');
    const ids = Array.from({ length: 200 }, (_, i) => uuid(i));
    expect(BatchChangeZoneIntent.safeParse({ entityIds: ids, targetZone: 'EXILE' }).success).toBe(
      true,
    );
    expect(
      BatchChangeZoneIntent.safeParse({ entityIds: [...ids, uuid(200)], targetZone: 'EXILE' })
        .success,
    ).toBe(false);
  });
});

describe('dano de comandante letal depende do formato', () => {
  /** Era 21 fixo: o PDH elimina com 16, e Brawl e Oathbreaker não têm a regra. */
  it('no PDH, 16 de um comandante eliminam', () => {
    const mesa = montarMesa(['a', 'b', 'c'], 'pdh');
    jogador(mesa, 'a').life = 99;
    executar(mesa, 'INTENT_SET_COMMANDER_DAMAGE', 'a', { fromPlayerId: 'b', delta: 16 });
    expect(jogador(mesa, 'a').eliminationReason).toBe('COMMANDER');
  });

  it('no Brawl, dano de comandante não elimina — só a vida', () => {
    const mesa = montarMesa(['a', 'b'], 'brawl');
    jogador(mesa, 'a').life = 99;
    executar(mesa, 'INTENT_SET_COMMANDER_DAMAGE', 'a', { fromPlayerId: 'b', delta: 30 });
    expect(jogador(mesa, 'a').eliminated).toBe(false);
  });

  it('em Commander continua sendo 21', () => {
    const mesa = montarMesa(['a', 'b', 'c']);
    jogador(mesa, 'a').life = 99;
    executar(mesa, 'INTENT_SET_COMMANDER_DAMAGE', 'a', { fromPlayerId: 'b', delta: 20 });
    expect(jogador(mesa, 'a').eliminated).toBe(false);
    executar(mesa, 'INTENT_SET_COMMANDER_DAMAGE', 'a', { fromPlayerId: 'b', delta: 1 });
    expect(jogador(mesa, 'a').eliminationReason).toBe('COMMANDER');
  });
});
