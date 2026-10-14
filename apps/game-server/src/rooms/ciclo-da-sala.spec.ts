/**
 * ciclo-da-sala.spec.ts — entrar, sair, ser removido, escolher grimório.
 *
 * Não havia teste nenhum no nível da Room: tudo o que acontece em
 * `removerJogador`, `expulsar` e `provisionarDeck` passava sem rede. Cada caso
 * abaixo é um defeito que a auditoria confirmou ali.
 *
 * A Room é montada de verdade, com o mínimo de dublê: a listagem do matchmaker
 * (que só existe com o servidor rodando) e o `fetch` da API Core.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'segredo-de-teste-com-16+';

import { ZONES, zoneOrderKey } from '@aethertable/shared-types';
import type * as ModuloDaSala from './AetherRoom';
import jwt from 'jsonwebtoken';
import { Espectador } from '../schema/Espectador';
import { Player } from '../schema/Player';
import type { RoomState } from '../schema/RoomState';
import { Card } from '../schema/Card';
import { ZoneOrderList } from '../schema/ZoneOrderList';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AetherRoom } = require('./AetherRoom') as typeof ModuloDaSala;

/** O que o teste toca da Room — inclusive o que é privado nela. */
type Sala = {
  state: RoomState;
  onCreate(opcoes: unknown): void;
  setPatchRate(ms: number | null): void;
  removerJogador(sid: string): void;
  expulsar(sid: string): void;
  provisionarDeck(sid: string, deckId: string): Promise<void>;
  contasBanidas: Set<string>;
  onAuth(cliente: unknown, opcoes: { seatToken: string }): Promise<unknown>;
  agendarFimDaVotacao(): void;
  clock: { setTimeout(cb: () => void, ms: number): { clear(): void } };
};

function montarSala(assentos: string[]): Sala {
  const sala = new AetherRoom() as unknown as Sala;
  (sala as unknown as { listing: unknown }).listing = {
    updateOne: async () => {},
    save: async () => {},
    remove: () => {},
  };
  // O matchmaker preenche o id antes do `onCreate`; aqui não há matchmaker.
  (sala as unknown as { roomId: string }).roomId = 'sala-teste';
  sala.onCreate({});
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

afterEach(() => {
  jest.restoreAllMocks();
});

describe('quem sai da sala', () => {
  /** A vez ficava com o jogador removido e todo mundo recebia NOT_YOUR_TURN. */
  it('a vez passa para quem herdou o assento', () => {
    const sala = montarSala(['a', 'b', 'c']);
    sala.state.activePlayerId = 'b';
    sala.removerJogador('b');
    expect(sala.state.activePlayerId).toBe('c');
  });

  it('se o último da ordem sai na vez dele, a vez volta ao primeiro', () => {
    const sala = montarSala(['a', 'b', 'c']);
    sala.state.activePlayerId = 'c';
    sala.removerJogador('c');
    expect(sala.state.activePlayerId).toBe('a');
  });

  /** A vivo, C eliminado, B sai: só eliminação chamava a verificação de fim. */
  it('o último oponente vivo saindo encerra a partida', () => {
    const sala = montarSala(['a', 'b', 'c']);
    sala.state.phase = 'PLAYING';
    sala.state.players.get('c')!.eliminated = true;
    sala.removerJogador('b');
    expect(sala.state.phase).toBe('CLOSING');
  });

  it('carta alheia que ele controlava volta para o dono', () => {
    const sala = montarSala(['a', 'b']);
    const c = new Card();
    c.id = 'roubada';
    c.ownerId = 'a';
    c.controllerId = 'b';
    c.zone = 'BATTLEFIELD';
    sala.state.cards.set(c.id, c);
    sala.removerJogador('b');
    expect(c.controllerId).toBe('a');
  });
});

describe('um contra um', () => {
  /** O oponente fechar a aba deixava a partida aberta para sempre, sem vencedor. */
  it('o único oponente saindo dá a vitória a quem ficou', () => {
    const sala = montarSala(['a', 'b']);
    (sala as unknown as { augeDeJogadores: number }).augeDeJogadores = 2;
    sala.state.phase = 'PLAYING';
    sala.removerJogador('b');
    expect(sala.state.phase).toBe('CLOSING');
  });

  it('a mesa solo não termina sozinha', () => {
    const sala = montarSala(['a']);
    (sala as unknown as { augeDeJogadores: number }).augeDeJogadores = 1;
    sala.state.phase = 'PLAYING';
    sala.removerJogador('fantasma');
    expect(sala.state.phase).toBe('PLAYING');
  });
});

describe('remover alguém desconectado', () => {
  /**
   * O Colyseus já tirou o cliente de `this.clients`: o `leave` não tinha em
   * quem agir, e o removido seguia ocupando a vaga pela janela de reconexão.
   */
  it('a vaga abre na hora e a conta fica bloqueada', () => {
    const sala = montarSala(['a', 'g']);
    sala.state.players.get('g')!.connected = false;
    sala.expulsar('g');
    expect(sala.state.players.has('g')).toBe(false);
    expect(sala.contasBanidas.has('conta-g')).toBe(true);
  });
});

describe('escolher grimório', () => {
  const deck = (n: number) => ({
    name: `deck-${n}`,
    cards: [{ scryfallId: 'aaaaaaaa-0000-4000-8000-000000000001', quantity: n, boardType: 'MAIN' }],
  });

  /** Duas escolhas seguidas empilhavam as duas respostas no mesmo grimório. */
  it('só a última escolha vale, mesmo que a primeira responda depois', async () => {
    const sala = montarSala(['a']);
    let liberarPrimeira: (v: unknown) => void = () => {};
    const respostas = [
      new Promise((r) => (liberarPrimeira = r)).then(() => ({
        ok: true,
        json: async () => deck(60),
      })),
      Promise.resolve({ ok: true, json: async () => deck(99) }),
    ];
    jest.spyOn(global, 'fetch').mockImplementation((() => respostas.shift()) as never);

    const primeira = sala.provisionarDeck('a', '11111111-0000-4000-8000-000000000001');
    await sala.provisionarDeck('a', '11111111-0000-4000-8000-000000000002');
    liberarPrimeira(null);
    await primeira;

    expect(sala.state.zoneOrder.get(zoneOrderKey('a', 'LIBRARY'))!.items.length).toBe(99);
  });

  it('a resposta que chega depois de o jogador sair não cria cartas órfãs', async () => {
    const sala = montarSala(['a', 'b']);
    let liberar: (v: unknown) => void = () => {};
    jest.spyOn(global, 'fetch').mockImplementation((() =>
      new Promise((r) => (liberar = r)).then(() => ({
        ok: true,
        json: async () => deck(99),
      }))) as never);

    const emVoo = sala.provisionarDeck('b', '11111111-0000-4000-8000-000000000003');
    sala.removerJogador('b');
    liberar(null);
    await emVoo;

    expect(Array.from(sala.state.cards.values()).some((c) => c.ownerId === 'b')).toBe(false);
  });
});

describe('plateia e votação', () => {
  /** `maxClients` soma assentos e plateia: sem teto próprio, cabiam 18 espectadores. */
  it('a plateia tem teto próprio de 10', async () => {
    const sala = montarSala(['a']);
    sala.state.roomCode = 'ABC123';
    for (let i = 0; i < 10; i += 1) {
      sala.state.espectadores.set(`e${i}`, new Espectador());
    }
    const passe = jwt.sign(
      { sub: 'conta-x', username: 'X', roomId: 'ABC123', spectator: true },
      process.env.JWT_SECRET!,
    );
    await expect(sala.onAuth({}, { seatToken: passe })).rejects.toThrow('ROOM_FULL');
  });

  /** O painel decidia sumir pelo relógio do navegador; quem fecha agora é o servidor. */
  it('a votação vencida é encerrada pelo servidor', () => {
    const sala = montarSala(['a', 'b', 'c']);
    let disparar: () => void = () => {};
    sala.clock.setTimeout = (cb) => {
      disparar = cb;
      return { clear: () => {} };
    };
    sala.state.votacaoAlvo = 'c';
    sala.state.votacaoAutor = 'a';
    sala.state.votacaoSim = 'a';
    sala.state.votacaoExpiraEm = Date.now() - 1;

    sala.agendarFimDaVotacao();
    disparar();

    expect(sala.state.votacaoAlvo).toBe('');
  });
});

describe('histórico de partidas', () => {
  /**
   * O resumo era só duração e contas: quem venceu, com que deck e comandante,
   * ninguém guardava. E quem sai antes do fim leva o próprio estado embora —
   * a foto dele precisa ser tirada ANTES do `delete`.
   */
  it('o resumo leva vencedor, quem começou e a foto de quem saiu antes', async () => {
    const sala = montarSala(['a', 'b', 'c']);
    const interna = sala as unknown as {
      inicioDaPartida: number;
      quemComecou: string;
      registrarParticipantes(): void;
      registrarResumoDaPartida(): Promise<void>;
    };
    sala.state.phase = 'PLAYING';
    sala.state.turnoIniciadoEm = Date.now();
    sala.state.turn = 7;
    interna.inicioDaPartida = Date.now() - 60_000;
    interna.quemComecou = 'conta-b';
    interna.registrarParticipantes();

    const comandante = new Card();
    comandante.id = 'cmd';
    comandante.ownerId = 'c';
    comandante.isCommander = true;
    comandante.scryfallId = 'scry-c';
    sala.state.cards.set(comandante.id, comandante);
    sala.state.players.get('c')!.deckName = 'Deck do C';
    sala.state.players.get('c')!.life = 13;

    const b = sala.state.players.get('b')!;
    b.eliminated = true;
    b.eliminationReason = 'POISON';

    // C sai com A vivo e B fora: a partida termina e A vence.
    sala.removerJogador('c');
    expect(sala.state.phase).toBe('CLOSING');

    const enviado = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 201 }));
    await interna.registrarResumoDaPartida();

    const corpo = JSON.parse(String(enviado.mock.calls[0]![1]!.body)) as {
      turnos: number;
      detalhes: Array<Record<string, unknown>>;
    };
    expect(corpo.turnos).toBe(7);
    const de = (conta: string) => corpo.detalhes.find((d) => d.userId === conta);
    expect(de('conta-a')).toMatchObject({ venceu: true, saiuAntes: false });
    expect(de('conta-b')).toMatchObject({
      venceu: false,
      comecou: true,
      motivoDaEliminacao: 'POISON',
    });
    expect(de('conta-c')).toMatchObject({
      saiuAntes: true,
      comandanteId: 'scry-c',
      nomeDoDeck: 'Deck do C',
      vidaFinal: 13,
    });
  });
});

describe('prazo do mulligan', () => {
  type ComPrazo = Sala & {
    encerrarMulliganPorTempo(): void;
    agendarFimDoMulligan(): void;
  };

  function comMao(sala: Sala, dono: string, n: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const c = new Card();
      c.id = `${dono}-mao-${i}`;
      c.ownerId = dono;
      c.controllerId = dono;
      c.zone = 'HAND';
      sala.state.cards.set(c.id, c);
      sala.state.zoneOrder.get(zoneOrderKey(dono, 'HAND'))!.items.push(c.id);
      ids.push(c.id);
    }
    return ids;
  }

  /** London com dois mulligans: devia duas ao fundo e não escolheu a tempo. */
  it('quem não decidiu fica com a mão, e o que devia vai ao fundo ao acaso', () => {
    const sala = montarSala(['a', 'b']) as ComPrazo;
    sala.state.phase = 'PLAYING';
    sala.state.tipoDeMulligan = 'LONDON';
    sala.state.mulliganExpiraEm = Date.now() - 1;
    const a = sala.state.players.get('a')!;
    a.mulliganCount = 2;
    comMao(sala, 'a', 7);
    const b = sala.state.players.get('b')!;
    b.keptHand = true;
    comMao(sala, 'b', 7);

    sala.encerrarMulliganPorTempo();

    expect(a.keptHand).toBe(true);
    expect(sala.state.zoneOrder.get(zoneOrderKey('a', 'HAND'))!.items.length).toBe(5);
    expect(sala.state.zoneOrder.get(zoneOrderKey('a', 'LIBRARY'))!.items.length).toBe(2);
    // Quem já tinha decidido não é tocado.
    expect(sala.state.zoneOrder.get(zoneOrderKey('b', 'HAND'))!.items.length).toBe(7);
    expect(sala.state.mulliganExpiraEm).toBe(0);
  });

  it('antes do prazo, nada acontece', () => {
    const sala = montarSala(['a']) as ComPrazo;
    sala.state.phase = 'PLAYING';
    sala.state.mulliganExpiraEm = Date.now() + 60_000;
    comMao(sala, 'a', 7);
    sala.encerrarMulliganPorTempo();
    expect(sala.state.players.get('a')!.keptHand).toBe(false);
  });

  it('todo mundo decidindo antes do prazo apaga o relógio', () => {
    const sala = montarSala(['a', 'b']) as ComPrazo;
    sala.state.phase = 'PLAYING';
    sala.state.mulliganExpiraEm = Date.now() + 60_000;
    sala.state.players.forEach((p) => (p.keptHand = true));
    sala.agendarFimDoMulligan();
    expect(sala.state.mulliganExpiraEm).toBe(0);
  });
});
