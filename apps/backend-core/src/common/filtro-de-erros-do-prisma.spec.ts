/**
 * filtro-de-erros-do-prisma.spec.ts — conflito e "não existe" não são 500.
 *
 * Sem filtro, violação de chave única (P2002) e registro sumido (P2025) subiam
 * como `500 Internal server error`: a tela mostrava "erro inesperado" para um
 * "isso já está lá", e o log de erro enchia de ruído. O teste sobe a aplicação
 * com o filtro registrado como no `AppModule` e confere o status HTTP.
 */

import { Controller, Get, Param, type INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { FiltroDeErrosDoPrisma } from './filtro-de-erros-do-prisma.js';

@Controller('falha')
class RotaQueFalha {
  @Get(':codigo')
  falhar(@Param('codigo') codigo: string) {
    throw new Prisma.PrismaClientKnownRequestError(`falha ${codigo}`, {
      code: codigo,
      clientVersion: 'teste',
    });
  }
}

describe('FiltroDeErrosDoPrisma', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [RotaQueFalha],
      providers: [{ provide: APP_FILTER, useClass: FiltroDeErrosDoPrisma }],
    }).compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('P2002 (chave única) vira 409', async () => {
    const r = await request(app.getHttpServer()).get('/falha/P2002');
    expect(r.status).toBe(409);
    expect(r.body.message).toBe('Já existe um registro com estes dados.');
  });

  it('P2025 (registro não encontrado) vira 404', async () => {
    await request(app.getHttpServer()).get('/falha/P2025').expect(404);
  });

  it('código sem tradução segura continua 500 — traduzir o desconhecido esconderia defeito', async () => {
    await request(app.getHttpServer()).get('/falha/P2003').expect(500);
  });
});
