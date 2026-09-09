# API Specification (REST)

| Campo                       | Valor                                                                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                      | `DOC-030`                                                                                                                                                                                                               |
| **Versão**                  | 1.1                                                                                                                                                                                                                     |
| **Status**                  | Estável                                                                                                                                                                                                                 |
| **Última revisão**          | 2026-08-20                                                                                                                                                                                                              |
| **Documentos relacionados** | [readme.md](readme.md) · [modelo_de_dados.md](modelo_de_dados.md) · [integracoes_externas_scryfall.md](integracoes_externas_scryfall.md) · [especificacao_websocket_e_eventos.md](especificacao_websocket_e_eventos.md) |

---

## 1. Visão geral

A comunicação entre o frontend (SPA) e o backend principal para dados **não voláteis** (cadastro,
login, decks, salas) usa arquitetura **RESTful** servida por NestJS.

> **Fronteira importante:** esta API **nunca** altera estado de partida. Toda mutação de mesa passa
> pelo WebSocket ([especificacao_websocket_e_eventos.md](especificacao_websocket_e_eventos.md)).
> Se um endpoint REST puder mudar o que está na mesa, ele está no lugar errado.

### 1.1 Convenções

| Item              | Valor                                                 |
| ----------------- | ----------------------------------------------------- |
| Base URL          | `https://api.aethertable.app/api/v1`                  |
| Formato           | JSON, `Content-Type: application/json; charset=utf-8` |
| Autenticação      | `Authorization: Bearer <access_token>`                |
| TLS               | Obrigatório, 1.3                                      |
| Datas             | ISO 8601 UTC (`2026-08-20T14:30:00Z`)                 |
| IDs               | UUID v4 em string                                     |
| Paginação         | `?page=1&limit=50` (máx. 100)                         |
| Ordenação         | `?sort=updatedAt&order=desc`                          |
| Idempotência      | `Idempotency-Key` aceito em `POST` de criação         |
| Documentação viva | Swagger em `/api/v1/docs` (gerado pelo NestJS)        |

### 1.2 Envelope de resposta

**Sucesso simples**

```json
{ "id": "...", "name": "..." }
```

**Sucesso paginado**

```json
{
  "data": [/* ... */],
  "meta": { "page": 1, "limit": 50, "total": 137, "totalPages": 3 }
}
```

**Erro** — sempre o mesmo formato, com código **estável** para o cliente ramificar:

```json
{
  "error": "DECK_NOT_FOUND",
  "message": "Deck não encontrado ou sem permissão de acesso.",
  "statusCode": 404,
  "details": {},
  "requestId": "req_01HX..."
}
```

### 1.3 Códigos de erro

| Código                      | HTTP | Significado                                        |
| --------------------------- | ---- | -------------------------------------------------- |
| `VALIDATION_FAILED`         | 400  | _Payload_ inválido; `details` traz erros por campo |
| `UNAUTHENTICATED`           | 401  | Token ausente, expirado ou inválido                |
| `OAUTH_STATE_MISMATCH`      | 401  | `state`/PKCE inválido no _callback_                |
| `FORBIDDEN`                 | 403  | Autenticado, mas sem permissão                     |
| `DECK_NOT_FOUND`            | 404  | Deck inexistente ou de outro usuário               |
| `ROOM_NOT_FOUND`            | 404  | Sala inexistente ou encerrada                      |
| `ROOM_FULL`                 | 409  | Sala no limite de jogadores do formato (`RN03`)    |
| `USERNAME_TAKEN`            | 409  | Nome de usuário em uso                             |
| `EMAIL_IN_USE`              | 409  | E-mail já cadastrado                               |
| `PAYLOAD_TOO_LARGE`         | 413  | Decklist acima de 64 KB ou 1.000 linhas            |
| `RATE_LIMITED`              | 429  | Limite excedido; header `Retry-After` presente     |
| `CARD_PROVIDER_UNAVAILABLE` | 503  | Scryfall indisponível após _retries_               |
| `NO_CAPACITY`               | 503  | Nenhum game node com vaga                          |
| `INTERNAL_ERROR`            | 500  | Falha inesperada; `requestId` para suporte         |

### 1.4 Rate limiting (`NFR-04`)

| Escopo                                | Limite      | Chave   |
| ------------------------------------- | ----------- | ------- |
| Global                                | 100 req/min | IP      |
| `POST /auth/login` e `/auth/register` | 5 req/min   | IP      |
| `POST /rooms`                         | 3 req/hora  | usuário |
| `POST /decks/import`                  | 10 req/min  | usuário |
| `GET /cards/search`                   | 30 req/min  | usuário |

Headers em toda resposta: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

---

## 2. Autenticação e usuário

### 2.1 `POST /auth/register`

Cria conta com e-mail e senha.

```json
// requisição
{ "email": "jogador@exemplo.com", "username": "planeswalker42", "password": "senha-forte-aqui" }
```

```json
// 201
{
  "user": {
    "id": "...",
    "username": "planeswalker42",
    "email": "jogador@exemplo.com",
    "avatarUrl": null
  },
  "accessToken": "eyJ...",
  "expiresIn": 900
}
```

O _refresh token_ vem em cookie `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`.

**Validação:** e-mail RFC 5322; `username` `^[a-zA-Z0-9_]{3,32}$`; senha mínima de 10 caracteres,
verificada contra lista de senhas vazadas comuns. Hash **Argon2id**.

**Erros:** `EMAIL_IN_USE`, `USERNAME_TAKEN`, `VALIDATION_FAILED`, `RATE_LIMITED`.

### 2.2 `POST /auth/login`

```json
{ "email": "jogador@exemplo.com", "password": "..." }
```

Resposta idêntica à de registro. Falha retorna `401 UNAUTHENTICATED` com mensagem genérica —
**nunca** revela se o e-mail existe (evita enumeração de contas).

### 2.3 `GET /auth/oauth/:provider`

`provider` ∈ {`google`, `discord`}. Redireciona ao provedor com `state` aleatório e PKCE.

### 2.4 `GET /auth/oauth/:provider/callback`

Troca o código por identidade, faz `upsert` do usuário, emite tokens e redireciona ao frontend.

**Erros:** `OAUTH_STATE_MISMATCH`, `EMAIL_IN_USE` (quando o e-mail já pertence a outra conta e o
usuário não confirmou a vinculação — `CDU01` A1).

### 2.5 `POST /auth/refresh`

Sem corpo — usa o cookie. Retorna novo `accessToken` e **rotaciona** o _refresh token_.
Reuso de um _refresh_ já rotacionado invalida toda a família de tokens e retorna `401`.

### 2.6 `POST /auth/logout`

Revoga o _refresh token_ atual e limpa o cookie. `204`.

### 2.7 `GET /users/me`

```json
{
  "id": "...",
  "username": "planeswalker42",
  "displayName": "Arthur",
  "email": "jogador@exemplo.com",
  "avatarUrl": "https://...",
  "role": "USER",
  "stats": { "decksCount": 12, "roomsCreated": 34, "matchesPlayed": 58 },
  "linkedProviders": ["DISCORD"]
}
```

### 2.8 `GET /users/:username`

Perfil público: `username`, `displayName`, `avatarUrl`, `stats`, `createdAt`. **Sem e-mail.**

### 2.9 `PATCH /users/me`

Campos aceitos: `displayName`, `avatarUrl`.

### 2.10 `GET` e `PUT /users/me/preferences`

```json
{
  "keybindings": { "tap": "t", "draw": "d", "shuffle": "s", "untapAll": "u" },
  "theme": "DARK",
  "playmatUrl": null,
  "voiceMode": "VAD",
  "pttKey": null,
  "masterVolume": 80,
  "language": "pt-BR"
}
```

### 2.11 `DELETE /users/me`

Exige `{ "confirmation": "<username>" }` no corpo. Aplica _soft delete_, invalida todas as sessões e
agenda o expurgo em 30 dias (`RF13`, `DOC-023` §7).

---

## 3. Gestão de decks

### 3.1 `GET /decks`

Query: `page`, `limit`, `sort` (`updatedAt`|`name`|`createdAt`), `order`, `favorite`, `format`, `q`.

```json
{
  "data": [
    {
      "id": "...",
      "name": "Atraxa Superfriends",
      "commander": {
        "scryfallId": "...",
        "name": "Atraxa, Praetors' Voice",
        "imageSmall": "https://..."
      },
      "format": "COMMANDER",
      "cardCount": 100,
      "colorIdentity": ["W", "U", "B", "G"],
      "isFavorite": true,
      "isPublic": false,
      "warnings": [],
      "updatedAt": "2026-08-19T22:11:00Z"
    }
  ],
  "meta": { "page": 1, "limit": 50, "total": 12, "totalPages": 1 }
}
```

O `commander` já vem hidratado do `card_cache` — a listagem não deve exigir chamada extra à Scryfall.

### 3.2 `GET /decks/:id`

Deck completo com cartas hidratadas:

```json
{
  "id": "...",
  "name": "Atraxa Superfriends",
  "format": "COMMANDER",
  "commanderId": "...",
  "cardCount": 100,
  "warnings": [
    { "code": "CARD_BANNED", "scryfallId": "...", "cardName": "Golos, Tireless Pilgrim" },
    { "code": "COUNT_MISMATCH", "expected": 100, "actual": 99 }
  ],
  "cards": [
    {
      "scryfallId": "...",
      "quantity": 1,
      "isCommander": false,
      "boardType": "MAIN",
      "card": {
        "name": "Sol Ring",
        "manaCost": "{1}",
        "cmc": 1,
        "typeLine": "Artifact",
        "colorIdentity": [],
        "legalCommander": "legal",
        "layout": "normal",
        "imageSmall": "https://...",
        "imageNormal": "https://...",
        "faces": null
      }
    }
  ]
}
```

Acesso: dono sempre; terceiros apenas se `isPublic = true`. Caso contrário `404 DECK_NOT_FOUND` —
**não** `403`, para não revelar a existência do deck.

### 3.3 `POST /decks/import` — endpoint crítico

```json
{
  "list": "1x Sol Ring\n1x Mana Crypt\n1 Arcane Signet (eld) 331\n\nCommander\n1 Atraxa, Praetors' Voice",
  "name": "Atraxa Superfriends",
  "format": "COMMANDER",
  "dryRun": false
}
```

**Processamento** (detalhado em `DOC-035` §4):

1. Valida tamanho (≤ 64 KB, ≤ 1.000 linhas).
2. _Parsing_ linha a linha com detecção de seção e marcador `#!Commander`.
3. Agrupa por nome, somando quantidades.
4. Consulta `card_cache`; o que faltar vai a `POST /cards/collection` da Scryfall em lotes de **75**.
5. Grava as cartas novas no `card_cache`.
6. Persiste **apenas** `scryfall_id`, `quantity`, `is_commander`, `board_type` (`FR-04`).
7. Calcula avisos (`RN05`) e retorna.

```json
// 201
{
  "deck": { "id": "...", "name": "Atraxa Superfriends", "cardCount": 99 },
  "resolved": 97,
  "notFound": [{ "line": 14, "text": "1x Sol Rng", "suggestions": ["Sol Ring"] }],
  "warnings": [
    { "code": "COUNT_MISMATCH", "expected": 100, "actual": 99 },
    { "code": "CARD_BANNED", "cardName": "..." },
    { "code": "COLOR_IDENTITY", "cardName": "...", "outside": ["R"] }
  ]
}
```

`dryRun: true` executa a resolução e devolve o mesmo corpo **sem persistir** — usado pelo Deckbuilder
para pré-visualizar antes de salvar.

**Erros:** `PAYLOAD_TOO_LARGE`, `VALIDATION_FAILED`, `CARD_PROVIDER_UNAVAILABLE`, `RATE_LIMITED`.

### 3.4 `POST /decks`

Cria deck vazio ou com cartas já resolvidas (`{ scryfallId, quantity, boardType, isCommander }`).

### 3.5 `PUT /decks/:id`

Substitui metadados e lista de cartas em **uma transação**. `card_count` é recalculado na mesma
transação.

### 3.6 `PATCH /decks/:id`

Atualização parcial: `name`, `description`, `isFavorite`, `isPublic`, `commanderId`.

### 3.7 `POST /decks/:id/duplicate`

Cria cópia independente com o nome sufixado por " (cópia)".

### 3.8 `DELETE /decks/:id`

`204`. Remoção definitiva; `DeckCard` cai por `CASCADE`.

### 3.9 `GET /decks/:id/export`

Query `format=text` (padrão) ou `json`. Em `text`, retorna `text/plain`:

```
1 Sol Ring (C21) 263
1 Arcane Signet (eld) 331

Commander
1 Atraxa, Praetors' Voice (2xm) 190
```

---

## 4. Cartas (proxy da Scryfall)

Todo acesso à Scryfall passa por aqui, para centralizar cache e fila de 100 ms (`DOC-035` §3).

### 4.1 `GET /cards/search`

Query: `q` (sintaxe Scryfall), `page`, `unique`, `order`.
Responde do `card_cache` quando possível; cai para a Scryfall quando necessário.

### 4.2 `GET /cards/autocomplete?q=sol`

```json
{ "data": ["Sol Ring", "Sol Talisman", "Solemn Simulacrum"] }
```

### 4.3 `GET /cards/:scryfallId`

Uma carta hidratada. Serve do cache; em _miss_, busca e grava.

### 4.4 `GET /cards/:scryfallId/printings`

Todas as impressões da mesma carta (`unique=prints`), para o seletor de arte (`F04`).

### 4.5 `GET /cards/tokens?q=...`

Fichas oficiais para o gerador de tokens (`F10`).

---

## 5. Salas (matchmaking / lobbies)

> **Esta seção descrevia um contrato que nunca existiu** (`POST /rooms`, com
> senha de sala, `allowSpectators` e `wsUrl` por nó). O que está implementado é
> o que segue. A divergência importa porque um documento desatualizado é pior
> que um ausente: o ausente manda ler o código; o desatualizado faz confiar
> numa rota que responde 404.

O prefixo real é **`/matches`**, e ele reflete a fronteira do §1: esta API
**nunca** altera estado de partida. Ela só emite os passes que autorizam a
entrada. Quem conhece o estado é o game-server.

### 5.1 `POST /matches/create`

Corpo **opcional** — sem ele, a sala nasce em `CONFIG_DE_SALA_PADRAO`.

```json
{
  "nome": "Mesa do Gaspare",
  "gameType": "commander",
  "visibilidade": "PUBLICA",
  "comunicacao": "QUALQUER",
  "idioma": "pt-BR",
  "maxClients": 4,
  "nivelDePoder": 3
}
```

```json
// 201
{
  "roomCode": "7C60D5",
  "config": { "nome": "Mesa do Gaspare", "maxClients": 4, "...": "..." },
  "configToken": "eyJ..."
}
```

**`configToken` é o que impede o navegador de reescrever a configuração.**

As opções da sala chegavam ao `onCreate` do Colyseus escritas pelo cliente e
sem assinatura: dava para abrir uma mesa de Duel Commander com oito assentos
editando um número na querystring. Este passe é a configuração já normalizada e
**assinada**, vinculada ao `roomCode`, com TTL de 15 minutos. O cliente o
devolve no `join`, que o embute no seat token — e o game-server passa a confiar
só no que a API autorizou.

Ele é um passe próprio, e não a config direto no seat token, porque o seat
token nasce no `join` e não aqui. Para ele já sair com a configuração dentro
seria preciso consultar uma tabela `Match` que não existe e não vai existir
(ADR-006, RN12: o estado da sala vive na RAM do game node).

`config` volta **normalizada** por `normalizarConfigDeSala`, de
`@aethertable/shared-types` — a mesma função que o formulário chamou antes de
enviar. `maxClients` sai limitado pela faixa do formato, não por uma lista
fixa; `nivelDePoder` vira `null` em formato sem zona de comando.

**Não existe senha de sala.** `visibilidade: "PRIVADA"` significa **não
listada** — o `seatToken` já governa a entrada (assinado, uso único via `jti`,
vinculado ao `roomCode`). Uma senha seria um segundo caminho de autenticação
para o mesmo recurso, mais fraco que o primeiro.

**Erros:** `FORBIDDEN` (o interruptor de mesas está desligado — DOC-061 §5),
`VALIDATION_FAILED`.

### 5.2 `POST /matches/:roomCode/join`

```json
{ "deckId": "...", "configToken": "eyJ..." }
```

```json
// 201
{ "seatToken": "eyJ...", "roomCode": "7C60D5", "config": { "...": "..." } }
```

Os dois campos são opcionais:

- **`deckId`** — o grimório passou a ser escolhido **dentro** da sala de espera
  (`INTENT_SET_DECK`), onde dá para ver quem sentou antes de decidir. Quando
  vem, a validação de formato roda aqui, que é onde a mensagem de erro ainda é
  útil — antes de qualquer conexão.
- **`configToken`** — só o criador tem um. Quem entra pelo código não manda
  nada: a configuração daquela sala já está no `RoomState`. Um passe inválido,
  expirado ou de outra sala é **ignorado em silêncio** — o pior caso é perder o
  reforço, nunca perder o assento.

O `seatToken` vale **1 dia**, e não 60 s. O motivo está no código: ele viaja na
URL da mesa, e é essa URL que as pessoas mandam no grupo e reabrem depois do
jantar. Isso **não** o torna reutilizável — o `jti` continua sendo consumido na
primeira entrada (`FR-20`); o que muda é até quando a primeira entrada é aceita.

**Erros:** `DECK_NOT_FOUND`, `VALIDATION_FAILED` (deck irregular para o formato,
com o motivo no corpo).

### 5.3 `POST /matches/:roomCode/spectate`

Sem corpo. Emite um seat token com a claim `spectator: true`, sem `deckId` e
sem `cfg`.

```json
// 201
{ "seatToken": "eyJ...", "roomCode": "7C60D5", "spectator": true }
```

**Rota própria, e não uma flag no `join`.** A diferença entre assistir e jogar
decide quem ocupa o último assento de uma mesa cheia, e isso não pode ser um
booleano que o navegador manda: bastaria enviá-lo como `false`. Com rotas
separadas, o que autoriza cada caso é a claim assinada — e o game-server só
olha o token.

Ela também **não valida deck**, e isso é o ponto: `join` gasta uma ida à
Scryfall para hidratar o decklist e conferir banimentos. Quem vai assistir não
tem deck para validar.

### 5.4 `GET /matches/:roomCode/voice-token`

Passe do LiveKit. Devolve `{ token: null, motivo }` — e não um 403 — quando a
voz está desligada na plataforma: o cliente já trata token ausente como "esta
mesa não tem voz" e monta a partida sem o LiveKit. Um 403 faria a tela mostrar
falha de conexão numa mesa perfeitamente jogável.

### 5.5 `GET /salas` — **no game-server, não nesta API**

A vitrine de mesas públicas é servida pelo **game-server** (mesmo host e porta
do WebSocket, em HTTP), porque é lá que o `matchMaker` sabe quais salas existem
— e não há tabela de salas para esta API consultar.

```json
{
  "salas": [
    {
      "roomCode": "7C60D5",
      "nome": "Mesa do Gaspare",
      "gameType": "commander",
      "comunicacao": "QUALQUER",
      "idioma": "pt-BR",
      "nivelDePoder": 3,
      "ocupacao": 2,
      "maxSeats": 4,
      "emPartida": false,
      "cheia": false
    }
  ]
}
```

Rota **pública**, sem autenticação: é uma vitrine, e o que ela mostra de cada
sala é o que o criador escolheu publicar ao marcá-la como pública. Entrar
continua exigindo o `seatToken`.

Ela **nunca** devolve o `metadata` cru do Colyseus, e o mapeamento campo a
campo é deliberado: metadado é objeto livre, e no dia em que alguém guardar ali
um campo interno ele vazaria para a internet sem que nada no código da rota
mudasse.

`cheia` é `true` para sala lotada ou trancada — e ela **continua na lista**,
como conteúdo assistível. Uma vitrine com poucas mesas e nenhuma cheia parece
uma plataforma vazia.

> **CORS:** o game-server só libera as origens de `CORS_ORIGINS`. Sem essa
> variável em produção a vitrine fica permanentemente vazia e o painel só
> consegue reportar "a lista de mesas está indisponível", sem nada no log que
> aponte para a causa.

---

## 6. Moderação

| Endpoint                              | Descrição                                         |
| ------------------------------------- | ------------------------------------------------- |
| `POST /moderation/blocks`             | `{ "username": "..." }` — bloqueia                |
| `DELETE /moderation/blocks/:username` | Desbloqueia                                       |
| `GET /moderation/blocks`              | Lista bloqueados                                  |
| `POST /moderation/reports`            | `{ "username", "reason", "details", "roomCode" }` |

`reason` ∈ {`HARASSMENT`, `CHEATING`, `SPAM`, `HATE_SPEECH`, `OTHER`}.

---

## 7. Operacional

| Endpoint            | Autenticação | Descrição                                |
| ------------------- | ------------ | ---------------------------------------- |
| `GET /health`       | Pública      | `{ "status": "ok", "version": "1.4.2" }` |
| `GET /health/ready` | Pública      | Verifica Postgres e Redis                |
| `GET /metrics`      | Rede interna | Métricas Prometheus (`NFR-11`)           |
| `GET /api/v1/docs`  | Pública      | Swagger UI                               |

---

## 8. Segurança da API

| Controle             | Implementação                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| TLS                  | 1.3 obrigatório; HSTS com `max-age` de 1 ano                                                   |
| CORS                 | Lista explícita de origens; `credentials: true`                                                |
| CSRF                 | JWT em header `Authorization` (não em cookie de sessão); _refresh_ em cookie `SameSite=Strict` |
| Validação            | Zod em **todo** _payload_, no _pipe_ global do NestJS                                          |
| Sanitização          | `DOMPurify` no cliente; validação estrita de string no servidor                                |
| SQL Injection        | Prisma com _parameterized queries_                                                             |
| Enumeração de contas | Mensagens de erro genéricas em login e em recuperação de senha                                 |
| _Rate limit_         | Redis, por IP e por usuário (§1.4)                                                             |
| Tamanho de corpo     | 1 MB geral; 64 KB em `/decks/import`                                                           |
| Headers              | `X-Content-Type-Options`, `X-Frame-Options: DENY`, CSP restritiva                              |
| Log                  | Estruturado com `requestId`; **nunca** loga senha, token ou corpo de autenticação              |

Detalhes em [seguranca_e_privacidade.md](seguranca_e_privacidade.md) e
[plano_de_seguranca_e_ameacas_threat_model.md](plano_de_seguranca_e_ameacas_threat_model.md).

---

## 9. Versionamento da API

| Regra        | Detalhe                                                               |
| ------------ | --------------------------------------------------------------------- |
| Prefixo      | `/api/v1`                                                             |
| Compatível   | Adicionar campo opcional na resposta ou parâmetro opcional na query   |
| **Quebra**   | Remover/renomear campo, mudar tipo, mudar semântica de código de erro |
| Quebra exige | `/api/v2` com `v1` mantido por, no mínimo, 90 dias                    |
| Depreciação  | Header `Deprecation` e `Sunset` nas respostas da versão antiga        |
