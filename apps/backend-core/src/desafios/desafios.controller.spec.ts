/**
 * desafios.controller.spec.ts — as rotas do progresso pela HTTP.
 *
 * O `PUT` acontece duas vezes por pergunta (ao sortear e ao responder). Com o
 * balde curto global (10 em 5 s), quem responde rápido no "qual é mais cara?"
 * levaria 429 no quinto par e o recorde daquela resposta não chegaria à
 * conta. Estes casos fixam a folga — e que ela tem fim.
 *
 * A aplicação sobe de verdade (guard global e baldes reais); só o JWT é
 * trocado por um dublê que já deixa a conta na requisição.
 */

import { type ExecutionContext, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { BALDES_GLOBAIS, LIMITE_DE_JOGO_EM_CURSO } from '../common/limites.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { DesafiosController } from './desafios.controller.js';
import { DesafiosService } from './desafios.service.js';

describe('DesafiosController', () => {
  let app: INestApplication;
  const registrar = jest.fn();
  const importar = jest.fn();

  beforeEach(async () => {
    registrar.mockReset().mockResolvedValue({ recorde: 1, sequencia: 1, emJogo: false });
    importar.mockReset().mockResolvedValue({});
    const modulo = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([...BALDES_GLOBAIS])],
      controllers: [DesafiosController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        {
          provide: DesafiosService,
          useValue: { listar: jest.fn().mockResolvedValue({}), registrar, importar },
        },
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

  const limite = LIMITE_DE_JOGO_EM_CURSO.curto.limit;

  it(`PUT: ${limite} em 5 s passam (15 perguntas rápidas), o seguinte leva 429`, async () => {
    // O balde global deixaria passar só 10.
    expect(limite).toBeGreaterThan(BALDES_GLOBAIS[0].limit);
    const status: number[] = [];
    for (let i = 0; i <= limite; i++) {
      const r = await request(app.getHttpServer())
        .put('/users/me/desafios/mais-cara')
        .send({ sequencia: i, emJogo: i % 2 === 0 });
      status.push(r.status);
    }
    expect(status.slice(0, limite).every((s) => s === 200)).toBe(true);
    expect(status[limite]).toBe(429);
  });

  it('PUT entrega a conta do TOKEN, a chave e o corpo validado ao serviço', async () => {
    await request(app.getHttpServer())
      .put('/users/me/desafios/escada')
      .send({ sequencia: 3, emJogo: true, recorde: 999 })
      .expect(200);
    expect(registrar).toHaveBeenCalledWith('u1', 'escada', { sequencia: 3, emJogo: true });
  });

  it('PUT com chave fora do formato ou corpo inválido é 400, sem chegar ao serviço', async () => {
    await request(app.getHttpServer())
      .put('/users/me/desafios/Mais_Cara')
      .send({ sequencia: 1, emJogo: false })
      .expect(400);
    await request(app.getHttpServer())
      .put('/users/me/desafios/escada')
      .send({ sequencia: -1, emJogo: false })
      .expect(400);
    expect(registrar).not.toHaveBeenCalled();
  });

  it('POST importar responde 200 com o mapa', async () => {
    importar.mockResolvedValue({ adivinhe: { recorde: 4, sequencia: 0, emJogo: false } });
    const r = await request(app.getHttpServer())
      .post('/users/me/desafios/importar')
      .send({ adivinhe: 4 })
      .expect(200);
    expect(r.body).toEqual({ adivinhe: { recorde: 4, sequencia: 0, emJogo: false } });
    expect(importar).toHaveBeenCalledWith('u1', { adivinhe: 4 });
  });
});
