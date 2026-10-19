# Qualidade e CI

## A bateria: `pnpm verificar`

Um comando roda tudo, na ordem certa, e termina com uma tabela do que passou e
do que falhou. É o mesmo que o hook `pre-push` executa.

| Passo          | O que pega                                                                           |
| -------------- | ------------------------------------------------------------------------------------ |
| `schema:check` | espelho do schema do Colyseus defasado: corrompe o estado sem nenhum erro            |
| `docs:estado`  | intenção que o cliente emite e o servidor não conhece (descartada em silêncio)       |
| `lint`         | promessa sem dono, `any` vazando, hook condicional, `Math.random()` fora do `rng.ts` |
| `typecheck`    | o contrato entre os três apps, **incluindo os testes**                               |
| `test`         | unidade e contrato (Jest)                                                            |
| `build`        | o que o `tsc` não pega (ex.: `useSearchParams` sem `Suspense`)                       |
| `format:check` | diff de formatação escondido no meio de diff de conteúdo                             |

## O padrão do ESLint

Config única em `eslint.config.mjs`, na raiz, herdada por todos os pacotes.

- **Lint com tipos** (`recommendedTypeChecked` + `stylisticTypeChecked` do
  typescript-eslint). Cada arquivo é lido pelo `tsconfig.json` do próprio pacote,
  e as regras sabem o tipo de verdade. É isso que pega `no-floating-promises`
  (promessa sem `await` nem `.catch`), `no-misused-promises`, `no-base-to-string`
  ("[object Object]" na tela) e a família `no-unsafe-*`.
- **Zero aviso tolerado**: todo pacote roda `eslint --max-warnings=0`. Aviso que
  ninguém corrige vira ruído, e o ruído esconde o aviso novo.
- **Exceção é documentada na própria config**, com o porquê. Exemplos:
  `consistent-type-imports` desligado no backend (quebra a injeção do Nest),
  `<img>` liberado para arte de carta (o otimizador da Vercel esgotaria a cota) e
  as regras `no-unsafe-*` desligadas em teste (o dublê é `any` por natureza).
- `eslint-disable` só na linha, com `-- justificativa`.

Formatação é do **Prettier** (`.prettierrc`), não do ESLint. O `pre-commit`
aplica os dois nos arquivos staged.

## Testes

| Tipo               | Onde                                   | Comando                  |
| ------------------ | -------------------------------------- | ------------------------ |
| unidade e contrato | `*.spec.ts(x)` ao lado do código       | `pnpm test`              |
| E2E telas públicas | `apps/frontend/e2e/telas-publicas…`    | `pnpm test:e2e`          |
| E2E multijogador   | `apps/frontend/e2e/mesa-multijogador…` | ver a política de testes |

Regra: comportamento novo vem com o teste que o prova; correção vem com o teste
que falhava antes dela. Mexeu em render, geometria ou conexão da mesa? Rode o E2E
multijogador: todos os defeitos relatados por jogador passaram por um
`pnpm test` verde. Detalhes em
[DOC-092 — Política de Testes](https://github.com/Dracon-46/AetherTable/blob/main/docs/politica_de_testes.md).

## O CI no GitHub Actions

| Workflow           | Quando                                      | O que faz                                              |
| ------------------ | ------------------------------------------- | ------------------------------------------------------ |
| `ci.yml`           | push nas branches do fluxo, todo PR         | a bateria em jobs paralelos, mais as imagens Docker    |
| `codeql.yml`       | push e PR em `main`/`develop`, toda segunda | análise estática de segurança (TypeScript e workflows) |
| `dependencias.yml` | PR contra `main`/`develop`                  | barra dependência nova vulnerável ou com licença GPL   |
| `release.yml`      | push de tag `v*.*.*`                        | cria o Release com a mensagem da tag anotada           |
| `wiki.yml`         | push na `main` que toca `docs/wiki/`        | publica esta Wiki                                      |

Os jobs do `ci.yml`: `atribuicao`, `qualidade`, `testes` (um por pacote),
`build-e2e`, `docker` e **`ci-ok`**, que só passa se todos passaram. A proteção
de branch exige só o `CI ok`: a matriz pode mudar sem ninguém precisar lembrar de
atualizar a regra.

Boas práticas aplicadas ao próprio pipeline:

- `GITHUB_TOKEN` só com leitura; o job que escreve declara a permissão;
- checkout sem credencial persistida (um `postinstall` malicioso não lê o token);
- actions fixadas por **SHA**, não por tag móvel;
- nada de `${{ github.event… }}` dentro de `run:` (vai por `env:`);
- preparo comum numa action composta (`.github/actions/preparar`); pnpm pela
  versão do `packageManager` e Node pelo `.nvmrc`.

## Dependabot

Toda segunda, PRs contra a `develop` para npm, GitHub Actions e imagens Docker.
Minor e patch chegam agrupados num PR por ecossistema; major chega em PR próprio,
porque é a que quebra.

## Configuração do repositório no GitHub

As configurações que não moram em arquivo (proteção de branch, alertas,
varredura de segredos, permissões do Actions, labels) estão escritas em
[`tools/configurar-github.mjs`](https://github.com/Dracon-46/AetherTable/blob/main/tools/configurar-github.mjs),
cada uma com o motivo. Para aplicar ou reaplicar, com o `gh` logado numa conta
admin:

```bash
node tools/configurar-github.mjs --dry-run   # mostra o que faria
node tools/configurar-github.mjs
```

Resumo do que ele garante:

- `main` e `develop`: sem force push e sem exclusão; mudança só por PR com o
  `CI ok` verde (o admin tem bypass para cortar release e hotfix);
- tags `v*` imutáveis;
- merge só por merge commit (`--no-ff`), e a branch apagada depois do merge;
- alertas e correções do Dependabot, varredura de segredos com bloqueio no push
  e relato privado de vulnerabilidade;
- token dos workflows só com leitura por padrão; actions permitidas só as do
  GitHub e as listadas, sempre fixadas por SHA.
