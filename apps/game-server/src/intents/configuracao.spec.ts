/**
 * configuracao.spec.ts — as regras que a MESA combina, e quem pode mudá-las.
 *
 * Segue o desenho de `sala.spec.ts`: cada teste fixa um "não pode", que é o
 * tipo de regra que some numa refatoração sem nada quebrar visivelmente.
 *
 * O caso que mais importa aqui não é nenhum dos "não pode": é o sorteio de
 * quem começa. Até esta fatia, `INTENT_START_MATCH` fazia
 * `activePlayerId = eu.id` — QUEM CLICOU COMEÇAVA — e como só o anfitrião pode
 * clicar, isso era uma vantagem silenciosa dele em todas as partidas. Ninguém
 * na mesa tinha combinado isso e nada na tela dizia que era assim.
 */

import { REGISTRY, espectadorBarrado, haAssentoLivre } from './registry';
import { RoomState } from '../schema/RoomState';
import { Player } from '../schema/Player';
import { Card } from '../schema/Card';
import { Espectador } from '../schema/Espectador';
import { ZoneOrderList } from '../schema/ZoneOrderList';
import { zoneOrderKey, ZONES } from '@aethertable/shared-types';
import type { IntentContext } from './registry';
import * as rng from '../services/rng';

interface Enviado {
  event: string;
  payload: unknown;
}

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

/** Mesa pronta para começar: todos com grimório e todos prontos. */
function mesaProntaParaIniciar(ids: string[]) {
  const state = montarMesa(ids);
  state.phase = 'WAITING';
  for (const id of ids) {
    encher(state, id, 'LIBRARY', 40);
    state.players.get(id)!.ready = true;
  }
  return state;
}

// ═══════════════════════════════════════════════════════════════════════════

describe('INTENT_SET_ROOM_CONFIG — só o anfitrião, e só antes de começar', () => {
  it('recusa quem não é anfitrião', () => {
    // A ordem de assentos VIVE nos assentos, e o assento 0 é o anfitrião. Sem
    // esta trava, qualquer convidado reescreveria as regras da mesa.
    const state = montarMesa(['eu', 'voce']);
    const enviados = executar('INTENT_SET_ROOM_CONFIG', state, 'voce', {
      tipoDeMulligan: 'LIVRE',
    });

    expect(codigoDoErro(enviados)).toBe('NOT_HOST');
    expect(state.tipoDeMulligan).toBe('COMMANDER');
  });

  it('recusa fora de WAITING, com CONFIG_LOCKED', () => {
    // Trocar o tipo de mulligan com a partida em andamento é mudar a regra no
    // meio do jogo — sobre decisões que os outros já tomaram.
    const state = montarMesa(['eu', 'voce']);
    state.phase = 'PLAYING';

    const enviados = executar('INTENT_SET_ROOM_CONFIG', state, 'eu', { cronometroDeTurno: 60 });

    expect(codigoDoErro(enviados)).toBe('CONFIG_LOCKED');
    expect(state.cronometroDeTurno).toBe(0);
  });

  it('grava só o que veio no payload — é um formulário parcial', () => {
    const state = montarMesa(['eu', 'voce']);
    executar('INTENT_SET_ROOM_CONFIG', state, 'eu', { sideboardPermitido: true });

    expect(state.sideboardPermitido).toBe(true);
    // Não tocado: continua no padrão.
    expect(state.tipoDeMulligan).toBe('COMMANDER');
    expect(state.cronometroDeTurno).toBe(0);
  });

  it('recusa jogadorInicial que não está mais na mesa', () => {
    // Sem esta checagem a partida começaria apontando para um assento que saiu:
    // ninguém teria a vez, e ninguém conseguiria passar o turno.
    const state = montarMesa(['eu', 'voce']);
    const enviados = executar('INTENT_SET_ROOM_CONFIG', state, 'eu', {
      jogadorInicial: 'fantasma',
    });

    expect(codigoDoErro(enviados)).toBe('INVALID_PAYLOAD');
    expect(state.jogadorInicial).toBe('');
  });

  it('aceita `` como jogadorInicial — significa "sortear"', () => {
    const state = montarMesa(['eu', 'voce']);
    executar('INTENT_SET_ROOM_CONFIG', state, 'eu', { jogadorInicial: 'voce' });
    expect(state.jogadorInicial).toBe('voce');

    executar('INTENT_SET_ROOM_CONFIG', state, 'eu', { jogadorInicial: '' });
    expect(state.jogadorInicial).toBe('');
  });
});

describe('SetRoomConfigIntent — o que o schema recusa antes do handler', () => {
  const schema = REGISTRY.INTENT_SET_ROOM_CONFIG.schema;

  it('recusa cronômetro fora da lista fechada', () => {
    // Número livre convida ao `1`, e um cronômetro de um segundo transforma o
    // aviso — a única coisa que ele faz — em ruído permanente na mesa.
    expect(schema.safeParse({ cronometroDeTurno: 1 }).success).toBe(false);
    expect(schema.safeParse({ cronometroDeTurno: 45 }).success).toBe(false);
    expect(schema.safeParse({ cronometroDeTurno: 90 }).success).toBe(false);
  });

  it('aceita os valores da lista, inclusive o 0 de "desligado"', () => {
    for (const v of [0, 60, 120, 180, 300]) {
      expect(schema.safeParse({ cronometroDeTurno: v }).success).toBe(true);
    }
  });

  it('recusa tipo de mulligan inventado e campo desconhecido', () => {
    expect(schema.safeParse({ tipoDeMulligan: 'PARIS' }).success).toBe(false);
    expect(schema.safeParse({ vantagemDoAnfitriao: true }).success).toBe(false);
  });
});

describe('INTENT_START_MATCH — quem começa', () => {
  afterEach(() => jest.restoreAllMocks());

  it('respeita o jogadorInicial escolhido pelo anfitrião', () => {
    const state = mesaProntaParaIniciar(['eu', 'voce', 'ela']);
    state.jogadorInicial = 'ela';

    executar('INTENT_START_MATCH', state, 'eu', {});

    expect(state.phase).toBe('PLAYING');
    expect(state.activePlayerId).toBe('ela');
  });

  it('com ordemPelosAssentos, começa no assento 0 — sem sorteio', () => {
    const state = mesaProntaParaIniciar(['eu', 'voce', 'ela']);
    state.ordemPelosAssentos = true;
    const sorteio = jest.spyOn(rng, 'sortear');

    executar('INTENT_START_MATCH', state, 'eu', {});

    expect(state.activePlayerId).toBe('eu');
    expect(sorteio).not.toHaveBeenCalled();
  });

  it('sem nenhum dos dois, SORTEIA — e o sorteio passa pelo CSPRNG (RN06)', () => {
    const state = mesaProntaParaIniciar(['eu', 'voce', 'ela']);
    // Devolve o último assento: se o handler tivesse voltado ao antigo
    // `activePlayerId = eu.id`, o teste passaria por acaso com 'eu'.
    const sorteio = jest
      .spyOn(rng, 'sortear')
      .mockImplementation((itens) => itens[itens.length - 1] as never);

    executar('INTENT_START_MATCH', state, 'eu', {});

    expect(sorteio).toHaveBeenCalledTimes(1);
    expect(state.activePlayerId).toBe('ela');
  });

  it('liga o cronômetro do primeiro turno', () => {
    // Sem isto o cronômetro só apareceria depois do primeiro PASS_TURN, e o
    // turno inicial — que costuma ser o mais longo — ficaria de fora.
    const state = mesaProntaParaIniciar(['eu', 'voce']);
    const antes = Date.now();

    executar('INTENT_START_MATCH', state, 'eu', {});

    expect(state.turnoIniciadoEm).toBeGreaterThanOrEqual(antes);
  });
});

describe('INTENT_PASS_TURN — o cronômetro reinicia a cada turno', () => {
  it('marca turnoIniciadoEm ao passar a vez', () => {
    const state = mesaProntaParaIniciar(['eu', 'voce']);
    state.phase = 'PLAYING';
    state.activePlayerId = 'eu';
    state.turnoIniciadoEm = 1;

    executar('INTENT_PASS_TURN', state, 'eu', {});

    expect(state.activePlayerId).toBe('voce');
    expect(state.turnoIniciadoEm).toBeGreaterThan(1);
  });
});

describe('tipoDeMulligan', () => {
  /** Mesa em jogo, turno 1, sete na mão e resto no grimório. */
  function mesaEmJogo() {
    const state = montarMesa(['eu', 'voce']);
    state.phase = 'PLAYING';
    state.turn = 1;
    encher(state, 'eu', 'HAND', 7);
    encher(state, 'eu', 'LIBRARY', 40);
    return state;
  }

  it('LIVRE ignora o teto de sete mulligans', () => {
    const state = mesaEmJogo();
    state.tipoDeMulligan = 'LIVRE';
    state.players.get('eu')!.mulliganCount = 9;

    const enviados = executar('INTENT_MULLIGAN', state, 'eu', {});

    expect(codigoDoErro(enviados)).toBeUndefined();
    expect(state.players.get('eu')!.mulliganCount).toBe(10);
  });

  it('LIVRE ignora keptHand e o turno passado', () => {
    const state = mesaEmJogo();
    state.tipoDeMulligan = 'LIVRE';
    state.turn = 6;
    state.players.get('eu')!.keptHand = true;

    expect(codigoDoErro(executar('INTENT_MULLIGAN', state, 'eu', {}))).toBeUndefined();
  });

  it('LIVRE continua exigindo PLAYING', () => {
    // A linha que o escape NÃO pode furar: o mulligan devolve a mão ao grimório
    // e embaralha. Na sala de espera isso seria um jeito de embaralhar o deck
    // de graça antes de a partida existir.
    const state = mesaEmJogo();
    state.tipoDeMulligan = 'LIVRE';
    state.phase = 'WAITING';

    expect(codigoDoErro(executar('INTENT_MULLIGAN', state, 'eu', {}))).toBe('MULLIGAN_CLOSED');
  });

  it('COMMANDER mantém o teto de sete', () => {
    const state = mesaEmJogo();
    state.players.get('eu')!.mulliganCount = 7;

    expect(codigoDoErro(executar('INTENT_MULLIGAN', state, 'eu', {}))).toBe('MULLIGAN_CLOSED');
  });
});

describe('INTENT_FETCH_FROM_SIDEBOARD — a reserva é combinada pela mesa', () => {
  function mesaComReserva() {
    const state = montarMesa(['eu', 'voce']);
    state.phase = 'PLAYING';
    const [carta] = encher(state, 'eu', 'SIDEBOARD', 1);
    return { state, carta: carta! };
  }

  it('recusa quando sideboardPermitido é false', () => {
    const { state, carta } = mesaComReserva();
    // `false` é o padrão: a mesa não joga com reserva a menos que combine.
    expect(state.sideboardPermitido).toBe(false);

    const enviados = executar('INTENT_FETCH_FROM_SIDEBOARD', state, 'eu', {
      entityId: carta,
      to: 'HAND',
    });

    expect(codigoDoErro(enviados)).toBe('SIDEBOARD_LOCKED');
    // A ZONA CONTINUA EXISTINDO: o que a mesa combinou foi o acesso.
    expect(state.cards.get(carta)!.zone).toBe('SIDEBOARD');
  });

  it('permite quando a mesa liberou', () => {
    const { state, carta } = mesaComReserva();
    state.sideboardPermitido = true;

    const enviados = executar('INTENT_FETCH_FROM_SIDEBOARD', state, 'eu', {
      entityId: carta,
      to: 'HAND',
    });

    expect(codigoDoErro(enviados)).toBeUndefined();
    expect(state.cards.get(carta)!.zone).toBe('HAND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('modo espectador', () => {
  function comPlateia() {
    const state = montarMesa(['eu', 'voce']);
    const e = new Espectador();
    e.id = 'olheiro';
    e.name = 'OLHEIRO';
    state.espectadores.set('olheiro', e);
    return state;
  }

  it('espectador não entra em state.players', () => {
    // A separação é o que impede quatro defeitos silenciosos de uma vez —
    // ver o cabeçalho de `Espectador.ts`.
    const state = comPlateia();
    expect(state.players.has('olheiro')).toBe(false);
    expect(state.espectadores.has('olheiro')).toBe(true);
  });

  it('espectador é barrado em toda intenção que mexe na mesa', () => {
    const state = comPlateia();
    for (const intent of [
      'INTENT_START_MATCH',
      'INTENT_MULLIGAN',
      'INTENT_PASS_TURN',
      'INTENT_SET_ROOM_CONFIG',
      'INTENT_MOVE_CARD',
      'INTENT_SET_LIFE',
    ]) {
      expect(espectadorBarrado(state, 'olheiro', intent)).toBe(true);
    }
  });

  it('o chat é a única exceção — comentar é o conteúdo de assistir', () => {
    const state = comPlateia();
    expect(espectadorBarrado(state, 'olheiro', 'INTENT_CHAT')).toBe(false);
  });

  it('quem tem assento não é barrado por nada disso', () => {
    const state = comPlateia();
    expect(espectadorBarrado(state, 'eu', 'INTENT_START_MATCH')).toBe(false);
  });

  it('o chat do espectador sai assinado com o nome dele, não com "Alguem"', () => {
    const state = comPlateia();
    const enviados: Enviado[] = [];
    const ctx = contexto(state, 'olheiro', enviados);
    const transmitidos: Enviado[] = [];
    (ctx as { broadcast: IntentContext['broadcast'] }).broadcast = (event, payload) =>
      transmitidos.push({ event, payload });

    REGISTRY.INTENT_CHAT.executa(ctx, { text: 'boa jogada' } as never);

    expect(transmitidos[0]?.event).toBe('chat');
    expect((transmitidos[0]?.payload as { actorId: string }).actorId).toBe('olheiro');
  });

  it('a lotação conta ASSENTOS, não clientes — plateia não ocupa lugar', () => {
    const state = comPlateia();
    state.maxSeats = 4;
    // Dois jogadores e um espectador numa mesa de quatro: ainda cabe jogador.
    expect(haAssentoLivre(state)).toBe(true);

    for (const id of ['ela', 'ele']) {
      const p = new Player();
      p.id = id;
      p.seat = state.players.size;
      state.players.set(id, p);
    }
    expect(haAssentoLivre(state)).toBe(false);
  });

  it('espectador não é anfitrião nem por acidente', () => {
    // Ele não tem `seat`, então `exigirAnfitriao` nunca o reconhece — e como
    // ele nem chega ao handler (é barrado antes), são duas travas.
    const state = comPlateia();
    const enviados = executar('INTENT_SET_ROOM_CONFIG', state, 'olheiro', {
      tipoDeMulligan: 'LIVRE',
    });
    expect(codigoDoErro(enviados)).toBe('NOT_HOST');
  });
});
