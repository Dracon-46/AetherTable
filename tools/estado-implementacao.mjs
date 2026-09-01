// Gera docs/estado_de_implementacao.md a partir do código, não da memória.
import { readFileSync, writeFileSync } from 'node:fs';

const registry = readFileSync('apps/game-server/src/intents/registry.ts', 'utf8');
const tabela = registry.slice(registry.indexOf('export const REGISTRY = {'));
const implementadas = [...tabela.matchAll(/^\s{2}(INTENT_[A-Z_]+),$/gm)].map((m) => m[1]).sort();

const pendentes = [
  ...registry.matchAll(/\{ intent: '(INTENT_[A-Z_]+)', motivo: '([^']+)' \}/g),
].map((m) => ({ intent: m[1], motivo: m[2] }));

const contrato = readFileSync('packages/shared-types/src/intents.ts', 'utf8');
const mapa = contrato.slice(contrato.indexOf('export interface IntentPayloadMap'));
const todas = [...mapa.matchAll(/^\s{2}(INTENT_[A-Z_]+):/gm)].map((m) => m[1]).sort();

const emissores = readFileSync('apps/frontend/src/net/intents.ts', 'utf8');
const emitidas = new Set([...emissores.matchAll(/'(INTENT_[A-Z_]+)'/g)].map((m) => m[1]));

const semHandler = [...emitidas].filter((i) => !implementadas.includes(i)).sort();
const naoEmitidas = implementadas.filter((i) => !emitidas.has(i)).sort();
const semImplementacao = todas.filter(
  (i) => !implementadas.includes(i) && !pendentes.some((p) => p.intent === i),
);

const linha = (i) =>
  `| \`${i}\` | ${implementadas.includes(i) ? '✅' : '—'} | ${emitidas.has(i) ? '✅' : '—'} |`;

writeFileSync(
  'docs/estado_de_implementacao.md',
  `# Estado de Implementação das Intenções

| Campo | Valor |
|---|---|
| **ID** | \`DOC-090\` |
| **Gerado por** | \`node tools/estado-implementacao.mjs\` |
| **Fontes** | \`packages/shared-types/src/intents.ts\` · \`apps/game-server/src/intents/registry.ts\` · \`apps/frontend/src/net/intents.ts\` |

> **Este arquivo é gerado.** Não edite à mão: rode \`pnpm docs:estado\`.

## 1. Por que este documento existe

O contrato de intenções ([\`especificacao_websocket_e_eventos.md\`](especificacao_websocket_e_eventos.md))
e o catálogo de ações ([\`catalogo_de_acoes_da_mesa.md\`](catalogo_de_acoes_da_mesa.md)) dizem o que o
sistema **deve** fazer. Nenhum dos dois dizia o que ele **faz**.

A consequência apareceu em produção: o cliente emitia 35 intenções e o servidor
implementava 20. Colyseus descarta mensagem sem handler em silêncio — sem erro,
sem log, sem exceção. O jogador clicava em "Passar turno" e nada acontecia, e
não havia nenhum lugar onde essa lacuna estivesse escrita.

As três colunas abaixo vêm do próprio código. A divergência entre elas é
justamente o tipo de defeito que não aparece em nenhum teste de unidade.

## 2. Cobertura

- Contrato (\`IntentPayloadMap\`): **${todas.length}** intenções
- Implementadas no servidor: **${implementadas.length}**
- Emitidas pelo cliente: **${emitidas.size}**
- Emitidas SEM handler no servidor: **${semHandler.length}** ${semHandler.length === 0 ? '(nenhuma — é o que se quer)' : `→ ${semHandler.join(', ')}`}

## 3. Tabela

| Intenção | Servidor | Cliente |
|---|:--:|:--:|
${todas.map(linha).join('\n')}

## 4. Pendências declaradas

Todas são prioridade C (*could*) / V2 no catálogo e exigem estrutura de domínio
nova — não apenas um handler. Ficam listadas em \`INTENCOES_PENDENTES\`
(\`registry.ts\`) para que a lacuna seja explícita e verificável.

| Intenção | Motivo |
|---|---|
${pendentes.map((p) => `| \`${p.intent}\` | ${p.motivo} |`).join('\n')}

## 5. Implementadas sem gesto no cliente

Existem no servidor e ainda não têm superfície na interface. Não são defeito:
são pontos de extensão prontos.

${naoEmitidas.length === 0 ? '_Nenhuma._' : naoEmitidas.map((i) => `- \`${i}\``).join('\n')}

## 6. Fora do contrato, sem plano

${semImplementacao.length === 0 ? '_Nenhuma._' : semImplementacao.map((i) => `- \`${i}\``).join('\n')}
`,
);

console.log(
  `contrato=${todas.length} servidor=${implementadas.length} cliente=${emitidas.size} sem-handler=${semHandler.length}`,
);
