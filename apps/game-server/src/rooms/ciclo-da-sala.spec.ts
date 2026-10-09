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
    jest
      .spyOn(global, 'fetch')
      .mockImplementation((() =>
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
