#!/usr/bin/env node
/**
 * schema-sync.mjs — mantém o mirror de schema do frontend em sincronia com o
 * game-server.
 *
 * POR QUE ESTA FERRAMENTA EXISTE
 *
 * `@colyseus/schema` serializa POR ÍNDICE DE CAMPO. Se o servidor declara um
 * campo que o mirror do cliente não tem — ou os declara em ordem diferente —
 * todo campo posterior é decodificado no offset errado. Não há erro, não há
 * aviso: o cliente simplesmente recebe lixo.
 *
 * Foi exatamente isso que aconteceu com `Player.mulliganCount`: o servidor
 * ganhou o campo, o mirror não, e a mesa parou de receber cartas.
 *
 * Uso:
 *   node tools/schema-sync.mjs            regenera o mirror
 *   node tools/schema-sync.mjs --check    falha se o mirror estiver defasado
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGEM = join(raiz, 'apps/game-server/src/schema');
const DESTINO = join(raiz, 'apps/frontend/src/net/schema');
const CHECK = process.argv.includes('--check');

const fontes = readdirSync(ORIGEM)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts') && f !== 'visibility.ts')
  .sort()
  .map((f) => join(ORIGEM, f));

/**
 * `@colyseus/schema` é dependência do game-server, não da raiz. Com
 * `node-linker=isolated` (ver .npmrc) ele NÃO existe em node_modules/ da raiz:
 * a resolução precisa partir do workspace que o declara.
 */
const requireDoServer = createRequire(join(raiz, 'apps/game-server/package.json'));
// `@colyseus/schema` bloqueia `./package.json` no campo `exports`, então
// resolvemos o entrypoint e subimos até a raiz do pacote.
const entrada = requireDoServer.resolve('@colyseus/schema');
const raizPacote = entrada.slice(0, entrada.lastIndexOf('/node_modules/@colyseus/schema/') + '/node_modules/@colyseus/schema/'.length);
const codegen = join(raizPacote, 'bin/schema-codegen');

const saida = mkdtempSync(join(tmpdir(), 'aether-schema-'));

try {
  execFileSync(
    process.execPath,
    [
      codegen,
      ...fontes,
      '--ts',
      '--output',
      saida,
    ],
    { stdio: 'pipe' },
  );

  const gerados = readdirSync(saida).filter((f) => f.endsWith('.ts')).sort();
  const defasados = [];

  for (const nome of gerados) {
    // O gerador importa `ArraySchema, MapSchema, SetSchema, DataChange` sempre;
    // o lint do repositório rejeita import não usado. Mantemos só o que o
    // arquivo realmente referencia.
    let conteudo = readFileSync(join(saida, nome), 'utf8');
    const usados = ['type', 'Schema', 'ArraySchema', 'MapSchema', 'SetSchema', 'DataChange'].filter(
      (simbolo) => {
        const corpo = conteudo.split('\n').filter((l) => !l.startsWith('import ')).join('\n');
        return new RegExp(`\\b${simbolo}\\b`).test(corpo);
      },
    );
    conteudo = conteudo.replace(
      /^import \{[^}]*\} from '@colyseus\/schema';$/m,
      `import { ${['Schema', 'type', ...usados.filter((u) => u !== 'Schema' && u !== 'type')].join(', ')} } from '@colyseus/schema';`,
    );

    const destino = join(DESTINO, nome);
    let atual = null;
    try {
      atual = readFileSync(destino, 'utf8');
    } catch {
      /* arquivo novo */
    }

    if (atual === conteudo) continue;

    defasados.push(nome);
    if (!CHECK) {
      writeFileSync(destino, conteudo);
      console.log(`atualizado: apps/frontend/src/net/schema/${nome}`);
    }
  }

  if (CHECK) {
    if (defasados.length > 0) {
      console.error(
        `\nMirror de schema DEFASADO: ${defasados.join(', ')}\n` +
          `O servidor e o cliente decodificariam campos em offsets diferentes.\n` +
          `Rode: pnpm schema:sync\n`,
      );
      process.exit(1);
    }
    console.log('mirror de schema em sincronia com o game-server.');
  } else if (defasados.length === 0) {
    console.log('mirror de schema já estava em sincronia.');
  }
} finally {
  rmSync(saida, { recursive: true, force: true });
}
