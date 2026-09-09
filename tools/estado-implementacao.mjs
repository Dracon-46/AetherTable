// Gera docs/estado_de_implementacao.md a partir do código, não da memória.
import { readFileSync, writeFileSync } from 'node:fs';
import { format, resolveConfig } from 'prettier';

const registry = readFileSync('apps/game-server/src/intents/registry.ts', 'utf8');
const tabela = registry.slice(registry.indexOf('export const REGISTRY = {'));
const noRegistry = [...tabela.matchAll(/^\s{2}(INTENT_[A-Z_]+),$/gm)].map((m) => m[1]);

/**
 * NEM TODO HANDLER MORA NO REGISTRY.
 *
 * O REGISTRY exige handler SÍNCRONO (DOC-021 §7): um `await` no caminho crítico
 * segura a fila de mensagens da sala inteira. As poucas intenções que precisam
 * de I/O — hoje `INTENT_SET_DECK`, que busca o decklist na API Core — são
 * registradas direto na Room, ao lado de `provisionarDeck`.
 *
 * Esta ferramenta existe para apontar intenção emitida pelo cliente e
 * descartada em silêncio pelo Colyseus. Se ela lesse só o REGISTRY, apontaria
 * essas como lacuna — e um relatório que dá alarme falso é um relatório que
 * as pessoas param de ler, o que devolve o problema original.
 */
const sala = readFileSync('apps/game-server/src/rooms/AetherRoom.ts', 'utf8');
const naSala = [...sala.matchAll(/this\.onMessage\('(INTENT_[A-Z_]+)'/g)].map((m) => m[1]);

const implementadas = [...new Set([...noRegistry, ...naSala])].sort();

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

const DESTINO = 'docs/estado_de_implementacao.md';
const conteudo = `# Estado de Implementação das Intenções

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
`;

/**
 * A SAIDA E FORMATADA ANTES DE IR PARA O DISCO.
 *
 * Sem isto, `pnpm docs:estado` gerava um markdown que o `format:check` recusava
 * — entao rodar a ferramenta QUEBRAVA a bateria, e a saida era ou rodar o
 * prettier a mao depois, ou nao rodar a ferramenta. As duas ruins: a segunda
 * deixa o documento defasado, que e exatamente o que ele existe para nao ser.
 *
 * O `schema-sync.mjs` ja resolvia isso do mesmo jeito, pelo mesmo motivo.
 */
const opcoes = (await resolveConfig(DESTINO)) ?? {};
writeFileSync(DESTINO, await format(conteudo, { ...opcoes, parser: 'markdown' }));

console.log(
  `contrato=${todas.length} servidor=${implementadas.length} cliente=${emitidas.size} sem-handler=${semHandler.length}`,
);

/**
 * ─── ELE PRECISA FALHAR, E NAO SO CONTAR ────────────────────────────────────
 *
 * Ate aqui esta ferramenta so IMPRIMIA o placar e saia com codigo 0. Rodada no
 * CI, ela regenerava o documento e passava — inclusive com intencoes emitidas
 * pelo cliente que o servidor nao conhece, que e exatamente o que ela existe
 * para pegar.
 *
 * E o defeito mais silencioso do contrato: o Colyseus DESCARTA em silencio uma
 * mensagem sem handler registrado. Nao ha excecao, nao ha log, nao ha teste que
 * pegue — o botao simplesmente nao faz nada, e a leitura natural de quem esta
 * na mesa e "o jogo travou".
 */
if (semHandler.length > 0) {
  console.error(
    [
      '',
      'INTENCAO EMITIDA SEM HANDLER NO SERVIDOR:',
      ...semHandler.map((i) => `  - ${i}`),
      '',
      'O Colyseus descarta essas mensagens em SILENCIO. Registre o handler no',
      'REGISTRY (ou na Room, se precisar de I/O), ou remova o emissor de',
      'apps/frontend/src/net/intents.ts.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
