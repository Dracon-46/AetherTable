#!/usr/bin/env node
/**
 * sem-atribuicao-de-ia.mjs — recusa mensagem de commit com atribuição a
 * ferramenta.
 *
 * ─── POR QUE ISTO É CÓDIGO E NÃO UMA LINHA NUM DOCUMENTO ────────────────────
 *
 * Já era regra escrita. O DOC-091 §5 diz, com todas as letras, que
 * `Co-Authored-By` de assistente, "Generated with" e emoji de robô não entram
 * numa mensagem de commit. O histórico inteiro já foi limpo disso uma vez — 28
 * commits reescritos.
 *
 * E voltou. Uma instrução de ferramenta sobrescreveu a regra do projeto no
 * meio de uma sessão, quatro commits saíram assinados e chegaram ao remoto
 * antes de alguém notar.
 *
 * Essa é a diferença entre uma regra e uma trava: a regra depende de quem
 * escreve o commit lembrar dela e ter permissão de segui-la. A trava não
 * depende de ninguém. Um documento que já foi desobedecido uma vez não fica
 * mais persuasivo na segunda.
 *
 * ─── ONDE ELE RODA ─────────────────────────────────────────────────────────
 *
 *   commit-msg   uma mensagem por vez, no momento em que ela é escrita
 *   pre-push     todos os commits que estão indo, porque `--no-verify` num
 *                commit isolado não pode ser o suficiente para publicar
 *   CI           última rede, para o que chegou por outro caminho
 *
 * Uso:
 *   node tools/sem-atribuicao-de-ia.mjs --arquivo .git/COMMIT_EDITMSG
 *   node tools/sem-atribuicao-de-ia.mjs --range origin/main..HEAD
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * O que é recusado, e por quê cada padrão está aqui.
 *
 * `Co-Authored-By` só é barrado quando o co-autor é uma FERRAMENTA: co-autoria
 * entre pessoas é legítima e comum em pair programming, e barrá-la junto
 * ensinaria a usar `--no-verify` por hábito — que desliga a trava inteira.
 */
const PADROES = [
  {
    re: /^\s*co-authored-by:.*(claude|anthropic|copilot|chatgpt|openai|gemini|cursor|codeium|devin)/im,
    nome: 'Co-Authored-By de ferramenta',
  },
  { re: /generated with .*(claude|copilot|chatgpt|cursor|ai\b)/i, nome: '"Generated with"' },
  { re: /^\s*claude-session:/im, nome: 'Claude-Session' },
  { re: /🤖/u, nome: 'emoji de robô' },
  { re: /\bassisted by (an )?ai\b/i, nome: '"assisted by AI"' },
];

/** Devolve os nomes dos padrões encontrados na mensagem. */
function violacoes(mensagem) {
  return PADROES.filter((p) => p.re.test(mensagem)).map((p) => p.nome);
}

function explicar(onde, achados) {
  console.error('');
  console.error('\x1b[31m─── ATRIBUIÇÃO A FERRAMENTA NA MENSAGEM DE COMMIT ───────────\x1b[0m');
  console.error('');
  console.error(`  ${onde}`);
  for (const a of achados) console.error(`    - ${a}`);
  console.error('');
  console.error('  O autor do commit é quem RESPONDE pelo código, e responder por');
  console.error('  ele é o que a autoria significa. Uma ferramenta não responde');
  console.error('  por nada. Ver DOC-091 §5.');
  console.error('');
  console.error('  Para corrigir a mensagem do último commit:');
  console.error('    git commit --amend');
  console.error('');
}

const args = process.argv.slice(2);
const idxArquivo = args.indexOf('--arquivo');
const idxRange = args.indexOf('--range');

if (idxArquivo >= 0) {
  const caminho = args[idxArquivo + 1];
  const mensagem = readFileSync(caminho, 'utf8');
  const achados = violacoes(mensagem);
  if (achados.length > 0) {
    explicar('Nesta mensagem:', achados);
    process.exit(1);
  }
  process.exit(0);
}

if (idxRange >= 0) {
  const range = args[idxRange + 1];
  let saida = '';
  try {
    // `%x00` separa os commits: uma mensagem tem quebras de linha, então
    // qualquer separador textual comum apareceria dentro de uma delas.
    saida = execFileSync('git', ['log', '--format=%H%x1f%B%x00', range], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    // Range inválido (branch nova sem base, clone raso): não é violação, e
    // recusar aqui bloquearia o primeiro push de qualquer branch.
    process.exit(0);
  }

  const sujos = [];
  for (const bloco of saida.split('\0')) {
    if (!bloco.trim()) continue;
    const [hash, mensagem = ''] = bloco.split('\x1f');
    const achados = violacoes(mensagem);
    if (achados.length > 0) {
      sujos.push({ hash: hash.trim().slice(0, 8), achados, titulo: mensagem.split('\n')[0] });
    }
  }

  if (sujos.length > 0) {
    for (const s of sujos) {
      explicar(`${s.hash}  ${s.titulo}`, s.achados);
    }
    console.error(`  ${sujos.length} commit(s) em ${range}.`);
    console.error('');
    console.error('  Para limpar um intervalo inteiro:');
    console.error('    git rebase -i <base>   e edite as mensagens');
    console.error('');
    process.exit(1);
  }
  process.exit(0);
}

console.error('uso: --arquivo <caminho> | --range <a..b>');
process.exit(2);
