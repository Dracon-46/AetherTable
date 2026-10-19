/**
 * decks.controller.spec.ts — criar e clonar deck têm balde próprio, estreito.
 *
 * ─── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * `POST /decks` e `POST /decks/:id/clone` herdavam o balde do deckbuilder (60
 * a cada 5 s), dimensionado para cliques de quantidade. Cada chamada destas é
 * um deck NOVO no banco: um script criava centenas por minuto.
 *
 * A aplicação sobe de verdade (guard global e baldes reais), e só o JWT é
 * trocado por um dublê que já deixa a conta na requisição.
 */

import { type ExecutionContext, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { BALDES_GLOBAIS } from '../common/limites.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { DecksController, LIMITE_CRIACAO_DE_DECK } from './decks.controller.js';
import { DecksService } from './decks.service.js';
import { GeradorDeDeckService } from './gerador/gerador-de-deck.service.js';
import { SugestoesDeCartasService } from './gerador/sugestoes.service.js';

const DECK = '7d2e8a10-4b6c-4f1e-9a3b-2c5d7e9f1a2b';

describe('DecksController — balde de criação de deck', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const modulo = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([...BALDES_GLOBAIS])],
      controllers: [DecksController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        {
          provide: DecksService,
          useValue: {
            createDeck: jest.fn().mockResolvedValue({ id: 'novo' }),
            clonarDeck: jest.fn().mockResolvedValue({ id: 'clone' }),
            getDecks: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: GeradorDeDeckService, useValue: {} },
        { provide: SugestoesDeCartasService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest<{ user: unknown }>().user = { sub: 'u1', username: 'a' };
          return true;
        },
      })
      .compile();

    app = modulo.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const limite = LIMITE_CRIACAO_DE_DECK.curto.limit;

  it(`POST /decks: ${limite} em 10 s passam, o seguinte leva 429`, async () => {
    const status: number[] = [];
    for (let i = 0; i <= limite; i++) {
      status.push((await request(app.getHttpServer()).post('/decks').send({ name: 'x' })).status);
    }
    expect(status.slice(0, limite).every((s) => s === 201)).toBe(true);
    expect(status[limite]).toBe(429);
  });

  it(`POST /decks/:id/clone: ${limite} em 10 s passam, o seguinte leva 429`, async () => {
    const status: number[] = [];
    for (let i = 0; i <= limite; i++) {
      status.push((await request(app.getHttpServer()).post(`/decks/${DECK}/clone`)).status);
    }
    expect(status.slice(0, limite).every((s) => s === 201)).toBe(true);
    expect(status[limite]).toBe(429);
  });

  it('a leitura da lista continua no balde folgado do deckbuilder', async () => {
    const status: number[] = [];
    for (let i = 0; i <= limite; i++) {
      status.push((await request(app.getHttpServer()).get('/decks')).status);
    }
    expect(status.every((s) => s === 200)).toBe(true);
  });
});
