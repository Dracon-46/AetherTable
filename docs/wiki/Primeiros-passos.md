# Primeiros passos

O guia completo, com cada variável de ambiente explicada, está em
[`docs/guia_de_configuracao_e_desenvolvimento.md`](https://github.com/Dracon-46/AetherTable/blob/main/docs/guia_de_configuracao_e_desenvolvimento.md).
Esta página é o caminho curto.

## Requisitos

- **Node 22** (a versão exata está no `.nvmrc`: `nvm use` ou `fnm use` resolvem);
- **pnpm 9**, pelo Corepack, que já vem com o Node: `corepack enable`;
- **Docker**, para o Postgres e o Redis locais.

## Do clone à mesa aberta

```bash
git clone https://github.com/Dracon-46/AetherTable.git
cd AetherTable

docker compose up -d                       # Postgres (5432) e Redis (6379), só em localhost
pnpm install

cp .env.example .env                       # e os .env.example de cada app em apps/*/
#   JWT_SECRET precisa ser IGUAL no backend-core e no game-server

pnpm --filter backend-core exec prisma generate
pnpm --filter @aethertable/shared-types build
pnpm db:migrate                            # cria as tabelas
pnpm db:seed                               # 4 contas de teste com decks prontos

pnpm dev                                   # os três serviços
```

| Endereço                          | O quê                              |
| --------------------------------- | ---------------------------------- |
| http://localhost:3030             | o site                             |
| http://localhost:3333/api/v1/docs | Swagger da API (só em dev)         |
| http://localhost:2567/colyseus    | monitor das salas (pede senha)     |
| http://localhost:2567/playground  | playground do Colyseus (só em dev) |

Para conferir: entre com `jogador1@teste.com` / `teste1234`, crie uma partida,
abra o convite numa janela anônima com `jogador2@teste.com` e mova uma carta. Se
ela se mover na outra janela, o ambiente está certo.

> As portas **3000 a 3020** são reservadas neste ambiente. `pnpm dev:kill`
> derruba o que sobrar e libera 3030, 3333 e 2567.

## Comandos do dia a dia

| Comando                   | Para quê                                                            |
| ------------------------- | ------------------------------------------------------------------- |
| `pnpm dev`                | os três serviços em modo de desenvolvimento                         |
| `pnpm verificar`          | **a bateria completa** — rode antes de subir                        |
| `pnpm verificar --rapido` | a bateria sem build e sem formatação, para o laço de edição         |
| `pnpm lint:fix`           | aplica as correções automáticas do ESLint                           |
| `pnpm format`             | formata tudo com o Prettier                                         |
| `pnpm schema:sync`        | regenera o espelho de schema do cliente depois de mexer no servidor |
| `pnpm docs:estado`        | regenera a paridade de intenções (contrato × servidor × cliente)    |
| `pnpm test:e2e`           | E2E no Chromium (Playwright)                                        |

## Quando algo dá errado

| Sintoma                                           | Causa provável                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| `Invalid seat token` ao entrar na sala            | `JWT_SECRET` diferente entre API e game-server                              |
| tipos de `@aethertable/shared-types` não resolvem | o pacote não foi compilado: `pnpm --filter @aethertable/shared-types build` |
| vitrine de mesas sempre vazia                     | `CORS_ORIGINS` faltando no **game-server**                                  |
| porta em uso                                      | processo antigo vivo: `pnpm dev:kill`                                       |
| mesa sem imagem e sem erro                        | a rede bloqueia `scryfall.io`; veja o guia, §9                              |

A tabela completa está no §9 do
[guia de desenvolvimento](https://github.com/Dracon-46/AetherTable/blob/main/docs/guia_de_configuracao_e_desenvolvimento.md#9-troubleshooting).
