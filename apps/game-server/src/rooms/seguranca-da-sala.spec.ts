/**
 * seguranca-da-sala.spec.ts — a porta de entrada da sala e os freios dela.
 *
 * Cada caso fixa um achado da revisão de segurança do game-server: passe
 * universal (A1), matchmaker sem autenticação (C2), ordem do grimório pelo
 * decklist (C1), flood de mensagens (M3), amplificação contra a API (M4), o
 * resumo perdido no deploy (M5) e o timer que derrubava o processo.
 *
 * A Room é montada de verdade, como em `ciclo-da-sala.spec.ts`, com dublê só
 * para o que só existe com o servidor rodando (listagem do matchmaker, `fetch`).
 */

import { ZONES, zoneOrderKey } from '@aethertable/shared-types';
import jwt from 'jsonwebtoken';
import type * as ModuloDaSala from './AetherRoom';
import * as rng from '../services/rng';
import { conexoesAtivas } from '../metrics';
import { Card } from '../schema/Card';
import { Player } from '../schema/Player';
import type { RoomState } from '../schema/RoomState';
import { ZoneOrderList } from '../schema/ZoneOrderList';
import { AUDIENCIA_DA_MESA, AUDIENCIA_DA_VOZ } from './passes';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AetherRoom } = require('./AetherRoom') as typeof ModuloDaSala;

const SEGREDO = process.env.JWT_SECRET!;

interface Sala {
  state: RoomState;
  onCreate(opcoes: unknown): void;
  setPatchRate(ms: number | null): void;
  onJoin(cliente: unknown, opcoes: unknown, auth: unknown): void;
  onLeave(cliente: unknown, consentido: boolean): Promise<void>;
  onDispose(): Promise<void>;
  removerJogador(sid: string): void;
  provisionarDeck(sid: string, deckId: string): Promise<void>;
  contasBanidas: Set<string>;
  deckIdPorSessao: Map<string, string>;
  allowReconnection(cliente: unknown, s: number): Promise<unknown>;
  broadcast(tipo: string, payload?: unknown): void;
  clock: { setTimeout(cb: () => void, ms: number): { clear(): void }; tick(): void };
  onMessageHandlers: Record<string, { callback(cliente: unknown, payload: unknown): void }>;
}

function montarSala(assentos: string[] = []): Sala {
  const sala = new AetherRoom() as unknown as Sala;
  (sala as unknown as { listing: unknown }).listing = {
    updateOne: async () => {},
    save: async () => {},
    remove: () => {},
  };
  (sala as unknown as { roomId: string }).roomId = 'sala-teste';
  sala.onCreate({ roomCode: 'ABC123' });
  sala.setPatchRate(null);
  assentos.forEach((id, indice) => {
    const p = new Player();
    p.id = id;
    p.userId = `conta-${id}`;
    p.name = id.toUpperCase();
    p.seat = indice;
    p.connected = true;
    sala.state.players.set(id, p);
    for (const zona of ZONES) sala.state.zoneOrder.set(zoneOrderKey(id, zona), new ZoneOrderList());
  });
  return sala;
}

function cliente(sessionId: string) {
  return { sessionId, send: jest.fn(), leave: jest.fn(), view: undefined as unknown };
}

let emitidos = 0;
/** Claims de um passe já validado — o que o `onAuth` estático entrega. */
function claims(extra: Record<string, unknown> = {}) {
  emitidos += 1;
  return {
    sub: `conta-${emitidos}`,
    username: 'Fulano',
    roomId: 'ABC123',
    jti: `jti-${emitidos}`,
    ...extra,
  };
}

/** Um passe de mesa como a API Core emite (`joinMatch`/`spectateMatch`). */
function passeDaApi(payload: Record<string, unknown>, opcoes: jwt.SignOptions = {}) {
  return jwt.sign(payload, SEGREDO, {
    audience: AUDIENCIA_DA_MESA,
    expiresIn: '1d',
    jwtid: `jti-${(emitidos += 1)}`,
    ...opcoes,
  });
}

const enviados = (c: ReturnType<typeof cliente>, tipo: string) =>
  c.send.mock.calls.filter(([t]) => t === tipo).map(([, p]) => p as Record<string, unknown>);

afterEach(() => {
  jest.restoreAllMocks();
});

describe('o onAuth estático — antes de criar sala ou reservar vaga', () => {
  const onAuth = (seatToken: unknown, roomCode: unknown = 'ABC123') =>
    AetherRoom.onAuth('', { seatToken, roomCode }, {} as never);

  /** O access token da API entrava em qualquer sala, sem uso único. */
  it('recusa o access token da API (sem audiência, sem roomId, sem jti)', async () => {
    const acesso = jwt.sign({ sub: 'u1', username: 'X' }, SEGREDO, { expiresIn: '1h' });
    await expect(onAuth(acesso)).rejects.toThrow('INVALID_TOKEN');
  });

  /** O passe de configuração tem a audiência da mesa, mas não tem `sub` nem `jti`. */
  it('recusa o passe de configuração', async () => {
    const config = jwt.sign({ roomId: 'ABC123', cfg: { maxClients: 8 } }, SEGREDO, {
      audience: AUDIENCIA_DA_MESA,
      expiresIn: '15m',
    });
    await expect(onAuth(config)).rejects.toThrow('INVALID_TOKEN');
  });

  /** O `roomCode` decide em que sala o matchmaker procura (ou cria). */
  it('recusa o passe de outra sala, sem nem procurar a sala', async () => {
    const passe = passeDaApi({ sub: 'u1', username: 'X', roomId: 'ABC123' });
    await expect(onAuth(passe, 'ZZZ999')).rejects.toThrow('INVALID_TOKEN');
  });

  it('recusa quem não manda passe nenhum (o `join {}` que listava sala privada)', async () => {
    await expect(AetherRoom.onAuth('', {}, {} as never)).rejects.toThrow('INVALID_TOKEN');
  });

  it('distingue passe expirado de passe inválido', async () => {
    const vencido = passeDaApi({ sub: 'u1', username: 'X', roomId: 'ABC123' }, { expiresIn: -10 });
    await expect(onAuth(vencido)).rejects.toThrow('TOKEN_EXPIRED');
  });

  /**
   * O resultado vira o `authData` do matchmaker, e `reserveSeatFor` usa
   * `authData.sessionId` como id da sessão se existir.
   */
  it('aceita o passe legítimo e devolve só as claims conhecidas', async () => {
    const passe = passeDaApi({
      sub: 'u1',
      username: 'Ana',
      roomId: 'ABC123',
      spectator: true,
      sessionId: 'escolhido-pelo-token',
    });
    const resultado = (await onAuth(passe)) as unknown as Record<string, unknown>;
    expect(resultado).toMatchObject({
      sub: 'u1',
      username: 'Ana',
      roomId: 'ABC123',
      spectator: true,
    });
    expect(resultado.jti).toEqual(expect.any(String));
    expect(resultado).not.toHaveProperty('sessionId');
    expect(resultado).not.toHaveProperty('aud');
  });
});

describe('admissão no onJoin', () => {
  it('o mesmo passe não entra duas vezes', () => {
    const sala = montarSala();
    const passe = claims();
    sala.onJoin(cliente('s1'), {}, passe);
    expect(() => sala.onJoin(cliente('s2'), {}, passe)).toThrow('TOKEN_ALREADY_USED');
  });

  it('conta removida da mesa não volta, nem como plateia', () => {
    const sala = montarSala();
    sala.contasBanidas.add('conta-banida');
    expect(() =>
      sala.onJoin(cliente('s1'), {}, claims({ sub: 'conta-banida', spectator: true })),
    ).toThrow('PLAYER_BLOCKED');
  });

  it('passe cuja sala não é esta é recusado mesmo que chegue ao onJoin', () => {
    const sala = montarSala();
    expect(() => sala.onJoin(cliente('s1'), {}, claims({ roomId: 'OUTRA1' }))).toThrow(
      'INVALID_TOKEN',
    );
  });

  /**
   * A entrada recusada passa pelo `onLeave` (é assim que o Colyseus a desfaz).
   * Antes ela descontava uma conexão que nunca contou e caía no
   * `allowReconnection` de dez minutos.
   */
  it('a entrada recusada não mexe na métrica nem espera reconexão', async () => {
    const sala = montarSala(['a']);
    sala.state.maxSeats = 1;
    const sobe = jest.spyOn(conexoesAtivas, 'inc');
    const desce = jest.spyOn(conexoesAtivas, 'dec');
    const espera = jest.spyOn(sala, 'allowReconnection');
    const recusado = cliente('s9');

    expect(() => sala.onJoin(recusado, {}, claims())).toThrow('ROOM_FULL');
    await sala.onLeave(recusado, false);

    expect(sobe).not.toHaveBeenCalled();
    expect(desce).not.toHaveBeenCalled();
    expect(espera).not.toHaveBeenCalled();
  });

  it('a métrica sobe na admissão e desce na saída', async () => {
    const sala = montarSala();
    const sobe = jest.spyOn(conexoesAtivas, 'inc');
    const desce = jest.spyOn(conexoesAtivas, 'dec');
    const c = cliente('s1');
    sala.onJoin(c, {}, claims({ spectator: true }));
    await sala.onLeave(c, true);
    expect(sobe).toHaveBeenCalledTimes(1);
    expect(desce).toHaveBeenCalledTimes(1);
  });
});

describe('passe de voz', () => {
  it('quem entra recebe o passe de voz desta sala, com a audiência da voz', () => {
    const sala = montarSala();
    const c = cliente('s1');
    sala.onJoin(c, {}, claims({ sub: 'conta-ana' }));

    const [passe] = enviados(c, 'passe-de-voz');
    const voz = jwt.verify(passe!.token as string, SEGREDO, {
      algorithms: ['HS256'],
      audience: AUDIENCIA_DA_VOZ,
    }) as jwt.JwtPayload;
    expect(voz).toMatchObject({ sub: 'conta-ana', roomId: 'ABC123', spectator: false });
    expect(voz.jti).toEqual(expect.any(String));
    // Seis horas, e não a validade de um dia do passe da mesa.
    expect(voz.exp! - voz.iat!).toBe(6 * 3600);
  });

  it('a plateia recebe o passe marcado como espectador', () => {
    const sala = montarSala();
    const c = cliente('s1');
    sala.onJoin(c, {}, claims({ spectator: true }));
    const [passe] = enviados(c, 'passe-de-voz');
    expect(jwt.decode(passe!.token as string)).toMatchObject({ spectator: true, roomId: 'ABC123' });
  });

  /** O passe vai ao cliente NOVO — o antigo mandaria por fora da fila do JOIN. */
  it('quem reconecta recebe um passe novo', async () => {
    const sala = montarSala();
    const antigo = cliente('s1');
    sala.onJoin(antigo, {}, claims({ sub: 'conta-bia' }));
    const novo = cliente('s1');
    jest.spyOn(sala, 'allowReconnection').mockResolvedValue(novo);

    await sala.onLeave(antigo, false);

    const [passe] = enviados(novo, 'passe-de-voz');
    expect(
      jwt.verify(passe!.token as string, SEGREDO, { audience: AUDIENCIA_DA_VOZ }),
    ).toMatchObject({
      sub: 'conta-bia',
      roomId: 'ABC123',
      spectator: false,
    });
  });

  /** O passe da mesa não vale como passe de voz, e vice-versa. */
  it('o passe de voz não entra na mesa', async () => {
    const sala = montarSala();
    const c = cliente('s1');
    sala.onJoin(c, {}, claims());
    const [passe] = enviados(c, 'passe-de-voz');
    await expect(
      AetherRoom.onAuth('', { seatToken: passe!.token, roomCode: 'ABC123' }, {} as never),
    ).rejects.toThrow('INVALID_TOKEN');
  });
});

describe('saída de quem não tem assento (M2)', () => {
  /** Caía no `allowReconnection(600 s)`, e ao reconectar era derrubado de novo, em ciclo. */
  it('não espera reconexão', async () => {
    const sala = montarSala(['a']);
    const espera = jest.spyOn(sala, 'allowReconnection');
    await sala.onLeave(cliente('fantasma'), false);
    expect(espera).not.toHaveBeenCalled();
  });
});

describe('o despachante', () => {
  const mandar = (sala: Sala, c: ReturnType<typeof cliente>, tipo: string, payload: unknown) =>
    sala.onMessageHandlers[tipo]!.callback(c, payload);

  it('quem não é jogador nem plateia não age na mesa', () => {
    const sala = montarSala(['a']);
    const intruso = cliente('intruso');
    mandar(sala, intruso, 'INTENT_SET_LIFE', { delta: -5 });
    expect(enviados(intruso, 'error')[0]).toMatchObject({ code: 'NOT_AUTHORIZED' });
  });

  it('o chat tem cota própria: dez a cada dez segundos', () => {
    const sala = montarSala(['a']);
    const transmitido = jest.spyOn(sala, 'broadcast');
    const a = cliente('a');
    for (let i = 0; i < 12; i += 1) mandar(sala, a, 'INTENT_CHAT', { text: `oi ${i}` });

    expect(transmitido.mock.calls.filter(([t]) => t === 'chat')).toHaveLength(10);
    // Um aviso só, e não um por mensagem descartada.
    expect(enviados(a, 'warning')).toHaveLength(1);
  });

  /** Cada descarte custava um `warning` de volta: o servidor espelhava o flood. */
  it('acima de 300 descartes na janela, a conexão cai com 4002', () => {
    const sala = montarSala(['a']);
    const a = cliente('a');
    for (let i = 0; i < 340; i += 1) mandar(sala, a, 'INTENT_PING', { x: 0, y: 0 });

    expect(a.leave).toHaveBeenCalledWith(4002);
    expect(enviados(a, 'warning')).toHaveLength(1);
  });
});

describe('escolher grimório (M4)', () => {
  const deck = {
    name: 'D',
    cards: [
      { scryfallId: 'aaaaaaaa-0000-4000-8000-000000000001', quantity: 60, boardType: 'MAIN' },
    ],
  };
  const resposta = () => Promise.resolve({ ok: true, json: async () => deck });
  const ID = (n: number) => `11111111-0000-4000-8000-00000000000${n}`;

  it('uma busca a cada dois segundos, e a ÚLTIMA escolha sai quando a janela abre', async () => {
    const sala = montarSala(['a']);
    const busca = jest.spyOn(global, 'fetch').mockImplementation(resposta as never);
    let disparar: () => void = () => {};
    sala.clock.setTimeout = (cb) => {
      disparar = cb;
      return { clear: () => {} };
    };
    const a = cliente('a');
    const escolher = (id: string) =>
      sala.onMessageHandlers.INTENT_SET_DECK!.callback(a, { deckId: id });

    escolher(ID(1));
    escolher(ID(2));
    escolher(ID(3));
    expect(busca).toHaveBeenCalledTimes(1);

    // A janela abre: só a última escolha vai à API.
    const agora = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(agora + 2_500);
    disparar();
    await Promise.resolve();
    expect(busca).toHaveBeenCalledTimes(2);
    expect(busca.mock.calls[1]![0] as string).toContain(ID(3));
  });

  it('a busca tem prazo e sempre leva o dono', async () => {
    const sala = montarSala(['a']);
    const busca = jest.spyOn(global, 'fetch').mockImplementation(resposta as never);
    await sala.provisionarDeck('a', ID(1));

    const [url, opcoes] = busca.mock.calls[0]!;
    expect(new URL(url as string).searchParams.get('ownerId')).toBe('conta-a');
    expect(opcoes!.signal).toBeInstanceOf(AbortSignal);
  });

  /** Sem `ownerId`, a API entregava o decklist de qualquer id. */
  it('assento sem conta não busca deck nenhum', async () => {
    const sala = montarSala(['a']);
    sala.state.players.get('a')!.userId = '';
    const busca = jest.spyOn(global, 'fetch');
    await sala.provisionarDeck('a', ID(1));
    expect(busca).not.toHaveBeenCalled();
  });
});

describe('provisionamento (C1)', () => {
  const linha = (n: number, quantidade = 1, boardType = 'MAIN') => ({
    scryfallId: `aaaaaaaa-0000-4000-8000-00000000000${n}`,
    quantity: quantidade,
    boardType,
  });

  /**
   * As cartas eram criadas na ordem do decklist e só os ids eram embaralhados:
   * o mapa `cards` chega a todo cliente na ordem de inserção, e quem conhecia
   * o decklist casava cada id com a linha — e lia o grimório inteiro.
   *
   * O embaralhar vira um "inverte" determinístico: com ele, a ordem do decklist
   * (1, 2, 3, 4) e a ordem do grimório (4, 3, 2, 1) são diferentes, e o teste
   * vê qual das duas a inserção segue.
   */
  it('as cartas nascem na ordem do grimório, e não na do decklist', async () => {
    const sala = montarSala(['a']);
    jest.spyOn(rng, 'embaralhar').mockImplementation((itens) => itens.reverse());
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'D', cards: [linha(1), linha(2), linha(3), linha(4)] }),
    } as never);

    await sala.provisionarDeck('a', '11111111-0000-4000-8000-000000000001');

    const inseridas = Array.from(sala.state.cards.values())
      .filter((c) => c.zone === 'LIBRARY')
      .map((c) => c.id);
    const grimorio = Array.from(sala.state.zoneOrder.get(zoneOrderKey('a', 'LIBRARY'))!.items);
    expect(inseridas).toEqual(grimorio);
    // E não a ordem do decklist.
    const identidade = inseridas.map((id) => sala.state.cards.get(id)!.scryfallId.slice(-1));
    expect(identidade).toEqual(['4', '3', '2', '1']);
  });

  /** Cem linhas de 99 cartas viravam dez mil cartas — muito além do buffer da sala. */
  it('grimório grande demais é recusado sem apagar o anterior', async () => {
    const sala = montarSala(['a']);
    const anterior = new Card();
    anterior.id = 'carta-anterior';
    anterior.ownerId = 'a';
    anterior.zone = 'LIBRARY';
    sala.state.cards.set(anterior.id, anterior);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'D', cards: [linha(1, 99), linha(2, 99), linha(3, 99)] }),
    } as never);

    await sala.provisionarDeck('a', '11111111-0000-4000-8000-000000000001');

    expect(sala.state.cards.size).toBe(1);
    expect(sala.state.cards.has('carta-anterior')).toBe(true);
  });
});

describe('quem sai da mesa (limpeza)', () => {
  it('some das concessões, das permissões de zona e do mapa de decks', () => {
    const sala = montarSala(['a', 'b', 'c']);
    const c = new Card();
    c.id = 'carta-da-a';
    c.ownerId = 'a';
    c.controllerId = 'a';
    c.zone = 'HAND';
    c.revealedTo = 'b,c';
    c.peekedBy = 'b';
    c.lockedBy = 'b';
    sala.state.cards.set(c.id, c);
    sala.state.players.get('a')!.sharedZones.set('HAND', 'b');
    sala.deckIdPorSessao.set('b', 'deck-b');

    sala.removerJogador('b');

    expect(c.revealedTo).toBe('c');
    expect(c.peekedBy).toBe('');
    expect(c.lockedBy).toBe('');
    expect(sala.state.players.get('a')!.sharedZones.has('HAND')).toBe(false);
    expect(sala.deckIdPorSessao.has('b')).toBe(false);
  });
});

describe('fim da sala', () => {
  /**
   * O `onDispose` disparava o resumo com `void`, e o deploy derrubava o
   * processo com o `fetch` em voo. O Colyseus espera o que ele devolve.
   */
  it('o onDispose só termina quando o resumo da partida foi enviado', async () => {
    const sala = montarSala(['a', 'b']);
    sala.state.turnoIniciadoEm = Date.now();
    (sala as unknown as { registrarParticipantes(): void }).registrarParticipantes();
    let liberar: () => void = () => {};
    const busca = jest
      .spyOn(global, 'fetch')
      .mockImplementation(
        () => new Promise((r) => (liberar = () => r(new Response(null, { status: 201 })))) as never,
      );

    let terminou = false;
    const fim = Promise.resolve(sala.onDispose()).then(() => (terminou = true));
    await new Promise((r) => setImmediate(r));
    expect(busca).toHaveBeenCalledTimes(1);
    expect(terminou).toBe(false);

    liberar();
    await fim;
    expect(terminou).toBe(true);
    expect(busca.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
  });

  /** Uma exceção num `clock.setTimeout` virava `uncaughtException` e derrubava o nó. */
  it('exceção num timer vira log, e não derruba o processo', () => {
    const sala = montarSala(['a']);
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    sala.clock.setTimeout(() => {
      throw new Error('falha no timer');
    }, 0);
    expect(() => sala.clock.tick()).not.toThrow();
    expect(log).toHaveBeenCalled();
  });
});
