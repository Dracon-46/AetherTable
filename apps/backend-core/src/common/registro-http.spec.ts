/**
 * registro-http.spec.ts — credencial não vai para o log.
 *
 * ─── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * O `pino-http` gravava os cabeçalhos inteiros: o JWT de cada sessão, o
 * `INTERNAL_API_TOKEN` de toda chamada do game-server e os passes da mesa e da
 * voz. Quem lesse o log saía com sessões vivas e com o segredo interno.
 *
 * O teste passa uma requisição HTTP de verdade pelo `pino-http` de verdade,
 * com as opções que a aplicação usa, e lê a linha que ele escreveu.
 */

import { Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import pinoHttp from 'pino-http';
import request from 'supertest';
import { CENSURA, opcoesDoRegistroHttp } from './registro-http.js';

async function linhaDoLog(cabecalhos: Record<string, string>) {
  const linhas: string[] = [];
  const destino = new Writable({
    write(pedaco: Buffer, _codificacao, pronto) {
      linhas.push(pedaco.toString());
      pronto();
    },
  });
  const registrar = pinoHttp(opcoesDoRegistroHttp('production'), destino);

  await request((req: IncomingMessage, res: ServerResponse) => {
    registrar(req, res);
    res.setHeader('set-cookie', 'sessao=segredo-do-cookie');
    res.end('ok');
  })
    .get('/qualquer')
    .set(cabecalhos);

  const ultima = linhas.at(-1);
  if (!ultima) throw new Error('o pino-http não escreveu nada');
  return JSON.parse(ultima) as {
    req: { headers: Record<string, string> };
    res: { headers: Record<string, string> };
  };
}

describe('registro HTTP — cabeçalhos com credencial saem censurados', () => {
  it('JWT, cookie, segredo interno e passes viram [redacted]', async () => {
    const { req, res } = await linhaDoLog({
      authorization: 'Bearer eyJ.sessao.viva',
      cookie: 'a=b',
      'x-internal-token': 'segredo-interno',
      'x-passe-de-mesa': 'eyJ.passe.mesa',
      'x-passe-de-voz': 'eyJ.passe.voz',
    });

    expect(req.headers.authorization).toBe(CENSURA);
    expect(req.headers.cookie).toBe(CENSURA);
    expect(req.headers['x-internal-token']).toBe(CENSURA);
    expect(req.headers['x-passe-de-mesa']).toBe(CENSURA);
    expect(req.headers['x-passe-de-voz']).toBe(CENSURA);
    expect(res.headers['set-cookie']).toBe(CENSURA);
  });

  it('o resto dos cabeçalhos continua no log — é o que se usa para investigar', async () => {
    const { req } = await linhaDoLog({ 'user-agent': 'game-server/1.0' });
    expect(req.headers['user-agent']).toBe('game-server/1.0');
  });
});
