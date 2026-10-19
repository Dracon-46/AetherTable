/**
 * limites.spec.ts — o game-server não pode bater no rate limit dos jogadores.
 *
 * ─── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * As rotas internas (`internal/decks/:id` e `internal/matches/summary`)
 * passavam pelo mesmo balde global por IP que protege a navegação: 10
 * requisições em 5 s. Todo pedido delas vem do MESMO IP — o do nó do jogo —,
 * então uma mesa de oito começando junta já encostava no teto, e a partir do
 * décimo primeiro deck vinha 429: "Seu grimório não pôde ser carregado".
 *
 * O teste sobe a aplicação de verdade (guard global, módulo de throttler com
 * os baldes reais) e faz pela HTTP o que o game-server faz. O controle no fim
 * prova que o balde está ligado: sem ele, o teste das rotas internas passaria
 * também num ambiente sem rate limit nenhum, e não provaria nada.
 */

import { Controller, Get, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { BALDES_GLOBAIS } from './limites.js';
import { InternalDecksController } from '../decks/decks.controller.js';
import { DecksService } from '../decks/decks.service.js';
import { InternalMatchesController } from '../matches/matches.controller.js';
import { MatchesService } from '../matches/matches.service.js';

const SEGREDO = 'segredo-interno-de-teste';
const DECK = '7d2e8a10-4b6c-4f1e-9a3b-2c5d7e9f1a2b';
const DONO = '0b6c1f9e-3a5d-4c2b-9e8f-1a2b3c4d5e6f';
/** O deck de um formato sem regra de tamanho: passa pela validação da rota. */
const DECK_VALIDO = { id: DECK, formatId: 'freeform', cardCount: 0, cards: [] };
/** Acima dos 10 do balde curto, com folga. */
const RAJADA = 15;

@Controller('controle')
class RotaComum {
  @Get()
  ok() {
    return { ok: true };
  }
}

const getDeckById = jest.fn().mockResolvedValue(DECK_VALIDO);

describe('rate limit — rotas internas ficam fora do balde global por IP', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([...BALDES_GLOBAIS])],
      controllers: [InternalDecksController, InternalMatchesController, RotaComum],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        {
          provide: DecksService,
          useValue: { getDeckById: getDeckById },
        },
        {
          provide: MatchesService,
          useValue: { registrarResumo: jest.fn().mockResolvedValue({ id: 'r', duplicado: false }) },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (chave: string) => (chave === 'INTERNAL_API_TOKEN' ? SEGREDO : undefined),
          },
        },
      ],
    }).compile();

    app = modulo.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it(`${RAJADA} buscas de deck seguidas do game-server não levam 429`, async () => {
    const status: number[] = [];
    for (let i = 0; i < RAJADA; i++) {
      const r = await request(app.getHttpServer())
        .get(`/internal/decks/${DECK}?ownerId=${DONO}`)
        .set('x-internal-token', SEGREDO);
      status.push(r.status);
    }
    expect(status.every((s) => s === 200)).toBe(true);
  });

  it(`${RAJADA} resumos de partida seguidos não levam 429`, async () => {
    const status: number[] = [];
    for (let i = 0; i < RAJADA; i++) {
      const r = await request(app.getHttpServer())
        .post('/internal/matches/summary')
        .set('x-internal-token', SEGREDO)
        .send({ roomCode: 'ABC123', playerCount: 4, durationSeconds: 600, participantes: [] });
      status.push(r.status);
    }
    expect(status.every((s) => s === 201)).toBe(true);
  });

  it('o segredo continua sendo exigido', async () => {
    await request(app.getHttpServer()).get(`/internal/decks/${DECK}?ownerId=${DONO}`).expect(401);
  });

  /**
   * `ownerId` era opcional, e sem ele a rota devolvia o deck de qualquer dono
   * por um caminho que nem hidratava as cartas. O game-server passou a mandá-lo
   * sempre; sem ele (ou fora do formato), é 400.
   */
  it('sem ownerId, ou com ownerId que não é UUID, é 400', async () => {
    getDeckById.mockClear();
    await request(app.getHttpServer())
      .get(`/internal/decks/${DECK}`)
      .set('x-internal-token', SEGREDO)
      .expect(400);
    await request(app.getHttpServer())
      .get(`/internal/decks/${DECK}?ownerId=qualquer`)
      .set('x-internal-token', SEGREDO)
      .expect(400);
    expect(getDeckById).not.toHaveBeenCalled();
  });

  it('com ownerId, confere o dono e exige a hidratação das cartas', async () => {
    getDeckById.mockClear();
    await request(app.getHttpServer())
      .get(`/internal/decks/${DECK}?ownerId=${DONO}`)
      .set('x-internal-token', SEGREDO)
      .expect(200);
    expect(getDeckById).toHaveBeenCalledWith(DONO, DECK, { exigirHidratacao: true });
  });

  it('controle: uma rota comum leva 429 depois de 10 em 5 s', async () => {
    const status: number[] = [];
    for (let i = 0; i < 11; i++) {
      status.push((await request(app.getHttpServer()).get('/controle')).status);
    }
    expect(status.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(status[10]).toBe(429);
  });
});
