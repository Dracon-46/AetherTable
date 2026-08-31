/**
 * mirror.spec.ts — o mirror de schema do cliente PRECISA bater com o
 * game-server, campo a campo e na mesma ordem.
 *
 * `@colyseus/schema` serializa por ÍNDICE. Um campo a mais no servidor desloca
 * todos os seguintes e o cliente decodifica lixo — sem erro, sem aviso, sem
 * nada no console. Foi assim que `Player.mulliganCount` fez a mesa parar de
 * receber cartas: o bug só aparecia como "as cartas não aparecem".
 *
 * Este teste roda o mesmo gerador que `pnpm schema:sync` e falha se o resultado
 * divergir do que está no repositório.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const RAIZ = join(__dirname, '../../../../..');

describe('mirror de schema Colyseus', () => {
  it('está em sincronia com apps/game-server/src/schema', () => {
    try {
      execFileSync(process.execPath, [join(RAIZ, 'tools/schema-sync.mjs'), '--check'], {
        stdio: 'pipe',
        encoding: 'utf8',
      });
    } catch (erro) {
      const e = erro as { stderr?: string; stdout?: string };
      throw new Error(
        `Mirror de schema defasado.\n${e.stderr ?? ''}${e.stdout ?? ''}\nRode: pnpm schema:sync`,
      );
    }
  });
});
