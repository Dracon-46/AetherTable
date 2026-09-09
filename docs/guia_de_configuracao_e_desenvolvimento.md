# Guia de Desenvolvimento (Setup Local)

| Campo                       | Valor                                                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                      | `DOC-054`                                                                                                                                                                   |
| **Versão**                  | 1.1                                                                                                                                                                         |
| **Status**                  | Estável                                                                                                                                                                     |
| **Última revisão**          | 2026-08-20                                                                                                                                                                  |
| **Documentos relacionados** | [readme.md](readme.md) · [stack_tecnologico.md](stack_tecnologico.md) · [devops_e_infraestrutura.md](devops_e_infraestrutura.md) · [modelo_de_dados.md](modelo_de_dados.md) |

Este documento orienta novos desenvolvedores sobre como rodar a stack completa do AetherTable em
suas máquinas locais.

> **Caminho rápido:** §2 (pré-requisitos) → §4 (passo a passo) → §9 (troubleshooting). Cerca de 15
> minutos na primeira vez.

---

## 1. O que você vai rodar

| Serviço        | Porta    | O que é                                   |
| -------------- | -------- | ----------------------------------------- |
| `frontend`     | **3030** | Next.js — interface e mesa em Canvas      |
| `backend-core` | **3333** | NestJS — API REST (auth, decks, salas)    |
| `game-server`  | **2567** | Colyseus — WebSocket de estado da partida |
| PostgreSQL     | 5432     | Banco (via Docker)                        |
| Redis          | 6379     | Cache e presença (via Docker)             |
| LiveKit        | 7880     | SFU de voz (opcional)                     |

---

## 2. Pré-requisitos

| Item                 | Versão                                      | Verificação                            |
| -------------------- | ------------------------------------------- | -------------------------------------- |
| **Node.js**          | v22.x LTS (mínimo v18)                      | `node -v`                              |
| **pnpm**             | 9.x — recomendado para monorepos            | `pnpm -v`                              |
| **Docker + Compose** | Recente                                     | `docker -v` · `docker compose version` |
| **Git**              | Qualquer                                    | `git -v`                               |
| **LiveKit CLI**      | Opcional — só para trabalhar no chat de voz | `livekit-server --version`             |

```bash
# instalar pnpm via corepack (já vem com o Node)
corepack enable
corepack prepare pnpm@latest --activate
```

O Docker é necessário para rodar PostgreSQL e Redis localmente **sem poluir o sistema operacional**.

---

## 3. Estrutura do monorepo

```
/aethertable
├── /apps
│   ├── /frontend       Next.js · React Konva · Tailwind · Zustand
│   ├── /backend-core   NestJS · Prisma · API REST
│   └── /game-server    Node.js · Colyseus · WebSocket
├── /packages
│   ├── /shared-types   Interfaces TS comuns: ICard, IPlayer, payloads de intenção
│   ├── /scryfall-client Cliente com fila de 100 ms e cache
│   └── /ui             Componentes React genéricos
├── docker-compose.yml
├── pnpm-workspace.yaml
├── turbo.json
└── .env.example
```

### 3.1 Por que `shared-types` importa

Frontend e três serviços de backend falam do **mesmo** objeto `Card`. Duplicar a definição garante
divergência silenciosa. Com o tipo compartilhado, mudar um campo **quebra a compilação** de quem não
acompanhou — que é exatamente o comportamento desejado (`ADR-007`).

**Regra:** nunca redefinir um tipo de domínio localmente. Se falta um campo, adicione em
`shared-types`.

---

## 4. Passo a passo de execução

### Passo 1 — Clonar e subir a infraestrutura

```bash
git clone <url-do-repo> aethertable
cd aethertable
docker compose up -d
```

Isso inicia o **PostgreSQL na porta 5432** e o **Redis na porta 6379**.

```bash
docker compose ps    # confirmar que ambos estão "healthy"
```

<details>
<summary><code>docker-compose.yml</code> de referência</summary>

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
      POSTGRES_DB: aethertable_db
    ports: ['5432:5432']
    volumes: ['pgdata:/var/lib/postgresql/data']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      retries: 10

volumes:
  pgdata:
```

</details>

### Passo 2 — Instalar dependências

```bash
pnpm install
```

### Passo 3 — Variáveis de ambiente

Copie os arquivos `.env.example` para `.env` em `apps/frontend`, `apps/backend-core` e
`apps/game-server`.

```bash
cp apps/frontend/.env.example      apps/frontend/.env
cp apps/backend-core/.env.example  apps/backend-core/.env
cp apps/game-server/.env.example   apps/game-server/.env
```

Certifique-se de configurar a `DATABASE_URL` apontando para o container Docker:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/aethertable_db"
```

**Variáveis completas:**

`apps/backend-core/.env`

```env
NODE_ENV=development
PORT=3333
DATABASE_URL="postgresql://postgres:password@localhost:5432/aethertable_db"
REDIS_URL="redis://localhost:6379"

JWT_SECRET="troque-por-uma-string-longa-e-aleatoria"
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=604800

# OAuth — opcional em dev; sem isso, use login por e-mail/senha
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
OAUTH_REDIRECT_BASE="http://localhost:3333/api/v1/auth/oauth"

SCRYFALL_USER_AGENT="AetherTable-dev/1.0 (seu-email@exemplo.com)"

# Espelho da Scryfall (rotas /api/v1/cards/*). O navegador nunca fala com
# scryfall.io: quem precisa alcançar a Scryfall é o SERVIDOR. Numa rede que
# filtra o domínio, aponte estas duas para um espelho liberado.
# SCRYFALL_API_URL="https://api.scryfall.com"
# SCRYFALL_IMAGE_URL="https://cards.scryfall.io"
CARD_IMAGE_CACHE_MB=64

# LiveKit — opcional
LIVEKIT_URL="ws://localhost:7880"
LIVEKIT_API_KEY="devkey"
LIVEKIT_API_SECRET="secret"

CORS_ORIGINS="http://localhost:3030"
```

`apps/game-server/.env`

```env
NODE_ENV=development
PORT=2567
REDIS_URL="redis://localhost:6379"
JWT_SECRET="a-MESMA-string-do-backend-core"
BACKEND_CORE_URL="http://localhost:3333"
PUBLIC_WS_URL="ws://localhost:2567"
# Origens que podem ler `GET /salas` (a vitrine de mesas públicas) do
# navegador. Mesma variável e mesmo formato do backend-core, para o deploy
# configurar as duas pontas com um valor só. O WebSocket não precisa de CORS;
# a vitrine é a primeira rota deste processo chamada por `fetch` de outra
# origem, e sem isto ela fica permanentemente vazia.
CORS_ORIGINS="http://localhost:3030"
```

`apps/frontend/.env`

```env
NEXT_PUBLIC_API_URL="http://localhost:3333/api/v1"
NEXT_PUBLIC_WS_URL="ws://localhost:2567"
NEXT_PUBLIC_LIVEKIT_URL="ws://localhost:7880"
```

> **Atenção:** `JWT_SECRET` precisa ser **idêntico** no `backend-core` e no `game-server`. O game
> server valida o token de assento emitido pela API; segredos diferentes produzem
> "token inválido" no _handshake_ — e é o erro nº 1 de quem monta o ambiente pela primeira vez.

### Passo 4 — Executar as migrações do banco

```bash
pnpm --filter backend-core prisma migrate dev
```

E popular com dados de teste:

```bash
pnpm --filter backend-core prisma db seed
```

O seed cria 4 usuários de teste (`jogador1@teste.com` … `jogador4@teste.com`, senha `teste1234`) com
dois decks de Commander cada — suficiente para abrir uma mesa de 4 sozinho, em quatro abas.

### Passo 5 — Iniciar os servidores em modo de desenvolvimento

Na raiz do projeto:

```bash
pnpm dev
```

| Serviço                | Endereço                          |
| ---------------------- | --------------------------------- |
| Frontend               | http://localhost:3030             |
| API REST               | http://localhost:3333             |
| Swagger da API         | http://localhost:3333/api/v1/docs |
| WebSocket              | ws://localhost:2567               |
| Monitor do Colyseus    | http://localhost:2567/colyseus    |
| Playground do Colyseus | http://localhost:2567/playground  |

### Passo 6 — Verificar que funciona

1. Abra http://localhost:3030 e entre com `jogador1@teste.com` / `teste1234`.
2. Vá em "Meus Decks" — dois decks devem aparecer.
3. Clique em "Criar Partida", escolha um deck e entre.
4. A mesa deve renderizar com 7 cartas na mão e o grimório com 92/93.
5. Copie o link de convite, abra em janela anônima e entre com `jogador2@teste.com`.
6. Mova uma carta em uma janela e confirme que ela se move na outra.

Se o passo 6 funciona, o ambiente está correto.

### Passo 7 — Encerrar

`Ctrl+C` no terminal do `pnpm dev` derruba tudo. Isso **não** era verdade antes: o Windows não tem
process group, então o sinal chegava ao turbo e os netos — o node que o `nest start --watch`
reexecuta a cada save, o filho do `tsx watch`, os workers do `next dev` — sobreviviam segurando
3030/3333/2567.

O sintoma era traiçoeiro. Na subida seguinte o Next escorregava sozinho para 3031, o game-server
morria com `EADDRINUSE` e o navegador continuava falando com o processo velho: código de ontem
respondendo por cima do código de hoje.

`pnpm dev` agora passa por `tools/dev.mjs`, que mata a árvore do turbo e depois varre as portas —
duas etapas porque cada uma pega o que a outra perde (o `taskkill /T` não enxerga o neto já
reparentado). Se algo escapar mesmo assim, ou se você fechar a janela do console no braço:

```bash
pnpm dev:kill              # derruba o que sobrou
pnpm dev:kill --dry-run    # só lista, não mata
```

---

## 5. Voz local (opcional)

Só necessário se você vai trabalhar no chat de voz.

```bash
# via Docker
docker run --rm -p 7880:7880 -p 7881:7881 -p 50000-50100:50000-50100/udp \
  -e LIVEKIT_KEYS="devkey: secret" \
  livekit/livekit-server --dev

# ou via CLI
livekit-server --dev
```

As credenciais de desenvolvimento (`devkey` / `secret`) já estão nos `.env.example`. **Nunca** use
essas chaves em produção.

---

## 6. Scripts disponíveis

| Comando                       | O que faz                                |
| ----------------------------- | ---------------------------------------- |
| `pnpm dev`                    | Todos os serviços em modo watch          |
| `pnpm dev --filter frontend`  | Só o frontend                            |
| `pnpm build`                  | Build de tudo                            |
| `pnpm test`                   | Unitários + integração                   |
| `pnpm test:watch`             | Watch dos testes                         |
| `pnpm test:e2e`               | Playwright (exige serviços rodando)      |
| `pnpm lint` / `pnpm lint:fix` | ESLint                                   |
| `pnpm typecheck`              | `tsc --noEmit` em todos os pacotes       |
| `pnpm db:migrate`             | Migração de desenvolvimento              |
| `pnpm db:reset`               | **Apaga** e recria o banco com seed      |
| `pnpm db:studio`              | Prisma Studio — inspeção visual do banco |
| `pnpm load-test`              | Cenário k6 de carga                      |

---

## 7. Fluxo de trabalho

### 7.1 Branches e commits

```
main ──────────────────────────────►  produção
  └─ feat/nome-da-feature
  └─ fix/descricao-do-bug
  └─ docs/o-que-mudou
```

Padrão **Conventional Commits**:

```
feat(game-server): adiciona intent de transferência de controle
fix(deckbuilder): corrige parser para cartas de dupla face
docs(readme): atualiza mapa de assuntos
test(schema): cobre auditoria de zona oculta
chore(deps): atualiza colyseus para 0.16.3
```

### 7.2 Antes de abrir PR

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Os hooks do Husky rodam lint e format no `pre-commit`; ainda assim, rode a suíte antes de pedir revisão.

### 7.3 Checklist de revisão

- [ ] Tipos de domínio vêm de `shared-types`?
- [ ] **Campo novo no `Schema` tem `@filter` quando necessário?** ← bloqueante
- [ ] Nenhum `Math.random()` no game server?
- [ ] Intenção nova tem _schema_ Zod e verificação de autorização?
- [ ] Nenhum I/O dentro de _handler_ de intenção?
- [ ] Log de ação em zona oculta usa a variante neutra?
- [ ] Teste unitário acompanhando a mudança?
- [ ] Migração é compatível para trás?

---

## 8. Trabalhando em cada camada

### 8.1 Frontend — a mesa

| Tarefa                        | Onde                                             |
| ----------------------------- | ------------------------------------------------ |
| Adicionar sprite ou efeito    | `src/canvas/sprites/`, `src/canvas/layers/`      |
| Ajustar câmera, zoom, culling | `src/canvas/camera.ts`                           |
| Painel de UI novo             | `src/overlay/`                                   |
| Emitir intenção               | `src/net/intents.ts` (tipado por `shared-types`) |
| Estado local                  | `src/store/uiStore.ts`                           |

**Erro clássico:** transformar cada carta em um componente React reativo ao store. Isso derruba a taxa
de quadros. Sprites são atualizados pelo `CanvasRenderer`, fora do ciclo de render do React
(`DOC-040` §3.2).

### 8.2 Game server — o estado

| Tarefa               | Onde                                         |
| -------------------- | -------------------------------------------- |
| Nova intenção        | `src/intents/` + registro em `registry.ts`   |
| Novo campo de estado | `src/schema/` — **avalie o `@filter`**       |
| Aleatoriedade        | `src/services/rng.ts` (nunca em outro lugar) |
| Mensagem de log      | `src/services/log.ts`                        |

Use o **Playground do Colyseus** (`http://localhost:2567/playground`) para disparar intenções à mão e
inspecionar o estado sem passar pelo frontend. É a ferramenta mais útil para desenvolver o motor.

### 8.3 Backend core — a API

| Tarefa             | Onde                                              |
| ------------------ | ------------------------------------------------- |
| Novo endpoint      | `src/<modulo>/` com controller, service e DTO Zod |
| Mudança de schema  | `prisma/schema.prisma` + `prisma migrate dev`     |
| Chamada à Scryfall | **Sempre** via `packages/scryfall-client`         |

Nunca chame `api.scryfall.com` direto de um service: passaria por cima da fila de 100 ms e do
`User-Agent` (`DOC-035` §3).

---

## 9. Troubleshooting

| Problema                                   | Causa provável                                                   | Solução                                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **`Invalid seat token` ao entrar na sala** | `JWT_SECRET` diferente entre `backend-core` e `game-server`      | Igualar os dois `.env`                                                                                         |
| `ECONNREFUSED 5432`                        | Postgres não subiu                                               | `docker compose up -d` e conferir `docker compose ps`                                                          |
| `Prisma migrate` falha                     | Banco inexistente ou credenciais erradas                         | Conferir `DATABASE_URL`; `pnpm db:reset`                                                                       |
| Frontend não conecta ao WS                 | `NEXT_PUBLIC_WS_URL` errado                                      | Deve ser `ws://localhost:2567`                                                                                 |
| Cartas sem imagem                          | `SCRYFALL_USER_AGENT` vazio ou _rate limit_                      | Preencher o `User-Agent`; aguardar                                                                             |
| Mesa toda em branco, sem erro no console   | A rede bloqueia `scryfall.io` — e o **backend** também está nela | Apontar `SCRYFALL_API_URL`/`SCRYFALL_IMAGE_URL` para um espelho liberado, ou rodar a API fora da rede filtrada |
| `429` da Scryfall                          | Fila de 100 ms sendo ignorada                                    | Verificar se a chamada passa pelo `scryfall-client`                                                            |
| Voz não conecta                            | LiveKit local não está rodando                                   | Subir o LiveKit ou ignorar (a mesa funciona sem voz)                                                           |
| Porta em uso                               | Outro processo na 3030/3333/2567                                 | `pnpm dev:kill` (ver Passo 7)                                                                                  |
| Tipos não resolvem                         | `shared-types` não compilado                                     | `pnpm build --filter shared-types`                                                                             |
| FPS baixo em dev                           | _Source maps_ e HMR pesam                                        | Medir performance sempre com `pnpm build && pnpm start`                                                        |
| Erro de CORS                               | Origem não permitida                                             | Incluir `http://localhost:3030` em `CORS_ORIGINS`                                                              |
| Vitrine de mesas sempre vazia              | `CORS_ORIGINS` ausente **no game-server**                        | A rota `/salas` é do game-server, não da API. Confira a variável nos dois `.env`                               |
| Mudança no `Schema` não reflete            | Cliente com versão antiga do serializador                        | Reiniciar frontend e game server juntos                                                                        |
| `pnpm install` reclamando de peer deps     | Divergência de versão no workspace                               | `pnpm install --force` e conferir o `pnpm-lock.yaml`                                                           |

---

## 10. Testando com 4 jogadores sozinho

O cenário mais importante do produto exige 4 conexões. Como fazer só na sua máquina:

| Abordagem                  | Como                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **4 perfis do navegador**  | Abrir 4 janelas anônimas/perfis diferentes e entrar com `jogador1..4@teste.com`. Cada perfil tem cookies próprios |
| **Playwright**             | `pnpm test:e2e` sobe 4 contextos automaticamente                                                                  |
| **Playground do Colyseus** | Conectar clientes falsos direto no estado, sem UI                                                                 |
| **Script de carga**        | `pnpm load-test` para volume                                                                                      |

Janelas anônimas do **mesmo** navegador compartilham sessão entre si em alguns casos — use perfis
separados ou navegadores diferentes se aparecer comportamento estranho de login.

---

## 11. Onde ler mais

| Assunto                             | Documento                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| O que estamos construindo e por quê | [documento_de_visao_do_projeto.md](documento_de_visao_do_projeto.md)                                   |
| Todas as funcionalidades            | [documento_de_funcionalidades.md](documento_de_funcionalidades.md)                                     |
| Arquitetura e decisões              | [documento_de_arquitetura_de_software_sad.md](documento_de_arquitetura_de_software_sad.md)             |
| Protocolo WebSocket                 | [especificacao_websocket_e_eventos.md](especificacao_websocket_e_eventos.md)                           |
| Schema do estado                    | [especificacao_do_motor_sandbox.md](especificacao_do_motor_sandbox.md)                                 |
| Comportamento do motor              | [especificacao_do_motor_de_estado_state_machine.md](especificacao_do_motor_de_estado_state_machine.md) |
| Endpoints REST                      | [especificacao_da_api_backend.md](especificacao_da_api_backend.md)                                     |
| Banco de dados                      | [modelo_de_dados.md](modelo_de_dados.md)                                                               |
| Frontend e Canvas                   | [especificacao_tecnica_do_frontend_ui_ux.md](especificacao_tecnica_do_frontend_ui_ux.md)               |
| Design system                       | [guia_de_ui_e_design_system.md](guia_de_ui_e_design_system.md)                                         |
| Testes                              | [plano_de_testes_e_qualidade.md](plano_de_testes_e_qualidade.md)                                       |
| **Índice geral de tudo**            | [readme.md](readme.md)                                                                                 |
