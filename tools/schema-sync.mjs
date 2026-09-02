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
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

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

// `resolve()` devolve o caminho com o separador NATIVO — no Windows, barra
// invertida. Procurar aqui pelo literal com barra normal fazia o `lastIndexOf`
// devolver -1; somado ao comprimento da marca, o slice cortava a string em 30
// caracteres e produzia algo como `C:\Users\Fulano\Downlo`. O erro que chegava
// ao usuário era um MODULE_NOT_FOUND apontando esse caminho picotado, sem
// nenhuma pista de que a causa era o separador — e derrubava junto o
// `mirror.spec.ts`, que é justamente a defesa contra mirror defasado.
const marca = `${sep}node_modules${sep}@colyseus${sep}schema${sep}`;
const corte = entrada.lastIndexOf(marca);
if (corte < 0) {
  console.error(`Não encontrei a raiz de @colyseus/schema a partir de ${entrada}`);
  process.exit(1);
}
const raizPacote = entrada.slice(0, corte + marca.length);
const codegen = join(raizPacote, 'bin/schema-codegen');

/**
 * Fim de linha não é divergência de schema.
 *
 * O prettier já normalizava aspas e quebras, mas emite LF; num clone no Windows
 * o `core.autocrlf` entrega os arquivos do mirror com CRLF. A comparação de
 * texto cru então acusava os CINCO schemas como defasados numa árvore recém
 * clonada e intocada — `pnpm test` falhava na primeira execução, antes de
 * qualquer alteração.
 *
 * É o mesmo alarme falso que o parágrafo abaixo descreve, pela mesma razão: o
 * que o `@colyseus/schema` serializa é a ORDEM e o TIPO dos campos, e nenhum
 * dos dois muda com o byte que termina a linha. Um guard que grita sem motivo
 * ensina a ser ignorado justo quando tiver razão.
 */
const normalizar = (texto) => texto.replace(/\r\n/g, '\n');

/** Config do prettier do repositório, resolvida a partir do destino do mirror. */
const prettierConfig = (await resolveConfig(join(DESTINO, 'Player.ts'))) ?? {};

const saida = mkdtempSync(join(tmpdir(), 'aether-schema-'));

try {
  execFileSync(process.execPath, [codegen, ...fontes, '--ts', '--output', saida], {
    stdio: 'pipe',
  });

  const gerados = readdirSync(saida)
    .filter((f) => f.endsWith('.ts'))
    .sort();
  const defasados = [];

  for (const nome of gerados) {
    // O gerador importa `ArraySchema, MapSchema, SetSchema, DataChange` sempre;
    // o lint do repositório rejeita import não usado. Mantemos só o que o
    // arquivo realmente referencia.
    let conteudo = readFileSync(join(saida, nome), 'utf8');
    const usados = ['type', 'Schema', 'ArraySchema', 'MapSchema', 'SetSchema', 'DataChange'].filter(
      (simbolo) => {
        const corpo = conteudo
          .split('\n')
          .filter((l) => !l.startsWith('import '))
          .join('\n');
        return new RegExp(`\\b${simbolo}\\b`).test(corpo);
      },
    );
    conteudo = conteudo.replace(
      /^import \{[^}]*\} from '@colyseus\/schema';$/m,
      `import { ${['Schema', 'type', ...usados.filter((u) => u !== 'Schema' && u !== 'type')].join(', ')} } from '@colyseus/schema';`,
    );

    const destino = join(DESTINO, nome);

    // O gerador emite aspas duplas e quebras próprias; o repositório é prettier
    // com aspas simples. Comparar o texto CRU fazia o `--check` acusar os cinco
    // schemas como defasados por pura formatação — um alarme que dispara em
    // todo `pnpm format` e que, de tanto ser falso, ensina a ignorar o guard
    // justamente quando ele apontar uma divergência de verdade.
    //
    // Normalizar os dois lados pelo mesmo prettier deixa a comparação sobre o
    // que de fato importa: a ORDEM e o TIPO dos campos, que é o que o
    // `@colyseus/schema` serializa por índice.
    conteudo = await format(conteudo, { ...prettierConfig, filepath: destino });

    let atual = null;
    try {
      atual = readFileSync(destino, 'utf8');
    } catch {
      /* arquivo novo */
    }

    if (atual !== null && normalizar(atual) === normalizar(conteudo)) continue;

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
