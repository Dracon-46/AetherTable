/**
 * borda-http.spec.ts — o que o processo HTTP recusa antes do Colyseus (C2).
 *
 * O limite de corpo é testado contra um servidor HTTP de verdade, numa porta
 * efêmera, com um ouvinte que imita o do Colyseus: acumula o corpo inteiro e só
 * responde no `end`. É exatamente o comportamento que tornava o corpo sem teto
 * um problema.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { matchMaker } from '@colyseus/core';
import {
  LIMITE_DO_CORPO_DO_MATCHMAKE,
  METODOS_DO_MATCHMAKER,
  cabecalhosCorsDoMatchmaker,
  limitarCorpoDoMatchmake,
  restringirMatchmaker,
  senhaDoBasic,
} from './borda-http';

const OFICIAL = 'https://site.oficial';
const PERMITIDAS = new Set(['http://localhost:3030', OFICIAL]);

describe('CORS do matchmaker', () => {
  it('reflete a origem permitida', () => {
    expect(cabecalhosCorsDoMatchmaker('http://localhost:3030', PERMITIDAS, OFICIAL)).toMatchObject({
      'Access-Control-Allow-Origin': 'http://localhost:3030',
      Vary: 'Origin',
    });
  });

  /** O padrão do Colyseus refletia QUALQUER origem, com credenciais. */
  it('não reflete origem desconhecida — e não deixa o curinga do Colyseus valer', () => {
    const cabecalhos = cabecalhosCorsDoMatchmaker('https://atacante.example', PERMITIDAS, OFICIAL);
    expect(cabecalhos['Access-Control-Allow-Origin']).toBe(OFICIAL);
  });

  it('a origem "null" (iframe em sandbox, file://) não casa', () => {
    expect(
      cabecalhosCorsDoMatchmaker('null', PERMITIDAS, OFICIAL)['Access-Control-Allow-Origin'],
    ).toBe(OFICIAL);
  });
});

describe('métodos do matchmaker', () => {
  const originais = {
    exposedMethods: matchMaker.controller.exposedMethods,
    getCorsHeaders: matchMaker.controller.getCorsHeaders,
  };
  afterAll(() => Object.assign(matchMaker.controller, originais));

  /** `create` abria sala sem passe; `join {}` devolvia a listagem de sala privada. */
  it('só joinOrCreate e reconnect ficam expostos', async () => {
    restringirMatchmaker(PERMITIDAS, OFICIAL);
    expect(matchMaker.controller.exposedMethods).toEqual([...METODOS_DO_MATCHMAKER]);
    for (const metodo of ['create', 'join', 'joinById']) {
      await expect(matchMaker.controller.invokeMethod(metodo, 'aether', {})).rejects.toThrow(
        /invalid method/,
      );
    }
  });

  it('o gancho de CORS do Colyseus passa a usar a lista da plataforma', () => {
    restringirMatchmaker(PERMITIDAS, OFICIAL);
    const req = { headers: { origin: 'https://atacante.example' } } as http.IncomingMessage;
    expect(matchMaker.controller.getCorsHeaders(req)['Access-Control-Allow-Origin']).toBe(OFICIAL);
  });
});

describe('limite do corpo do matchmake', () => {
  let servidor: http.Server;
  let porta: number;
  /** Quanto o "Colyseus" de mentira chegou a acumular, por requisição. */
  let acumulado: number[];

  beforeEach(async () => {
    acumulado = [];
    servidor = http.createServer();
    // O ouvinte que o Colyseus instala: empilha tudo e responde no `end`.
    servidor.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
      const pedacos: Buffer[] = [];
      req.on('data', (p: Buffer) => pedacos.push(p));
      req.on('end', () => {
        const total = Buffer.concat(pedacos).length;
        acumulado.push(total);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(String(total));
      });
    });
    limitarCorpoDoMatchmake(servidor, LIMITE_DO_CORPO_DO_MATCHMAKE);
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    porta = (servidor.address() as AddressInfo).port;
  });

  afterEach(async () => {
    servidor.closeAllConnections();
    await new Promise((r) => servidor.close(r));
  });

  /** Manda um POST; `emPedacos` tira o Content-Length (chunked), como faria quem mente. */
  function enviar(caminho: string, bytes: number, emPedacos = false): Promise<number> {
    return new Promise((resolve) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: porta,
          method: 'POST',
          path: caminho,
          headers: emPedacos ? { 'Transfer-Encoding': 'chunked' } : { 'Content-Length': bytes },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      // Conexão derrubada no meio do envio também é recusa: o servidor pode
      // fechar o socket enquanto o cliente ainda escreve o corpo.
      req.on('error', () => resolve(-1));
      const pedaco = Buffer.alloc(1024, 'a');
      for (let enviado = 0; enviado < bytes; enviado += pedaco.length) {
        req.write(pedaco.subarray(0, Math.min(pedaco.length, bytes - enviado)));
      }
      req.end();
    });
  }

  it('o pedido legítimo passa inteiro', async () => {
    expect(await enviar('/matchmake/joinOrCreate/aether', 600)).toBe(200);
    expect(acumulado).toEqual([600]);
  });

  it('Content-Length acima do teto é recusado sem ler o corpo', async () => {
    // Só o cabeçalho declara o tamanho; o corpo nem chega a ser mandado. A
    // resposta tem de vir mesmo assim — o servidor não espera corpo nenhum.
    const status = await new Promise<number>((resolve) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: porta,
          method: 'POST',
          path: '/matchmake/joinOrCreate/aether',
          headers: { 'Content-Length': 64 * 1024 },
        },
        (res) => {
          resolve(res.statusCode ?? 0);
          req.destroy();
        },
      );
      req.on('error', () => {});
      req.write('{"a":');
    });
    expect(status).toBe(413);
    expect(acumulado).toEqual([]);
  });

  it('corpo em pedaços acima do teto é cortado antes do Colyseus terminar de ler', async () => {
    const status = await enviar('/matchmake/joinOrCreate/aether', 256 * 1024, true);
    expect([413, -1]).toContain(status);
    expect(acumulado).toEqual([]);
  });

  it('o resto do servidor HTTP não tem esse limite', async () => {
    expect(await enviar('/salas', 64 * 1024)).toBe(200);
    expect(acumulado).toEqual([64 * 1024]);
  });
});

describe('senha do Basic', () => {
  const basic = (credencial: string) => `Basic ${Buffer.from(credencial).toString('base64')}`;

  /** O `split(':')` pegava só até o segundo `:` — senha com `:` nunca conferia. */
  it('a senha pode conter dois-pontos', () => {
    expect(senhaDoBasic(basic('admin:se:nh:a'))).toBe('se:nh:a');
  });

  it('sem dois-pontos, ou sem Basic, não há senha', () => {
    expect(senhaDoBasic(basic('so-usuario'))).toBeNull();
    expect(senhaDoBasic('Bearer abc')).toBeNull();
    expect(senhaDoBasic(undefined)).toBeNull();
  });
});
