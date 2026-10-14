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

**Erro do Prisma não é 500** (`FiltroDeErrosDoPrisma`, global). Chave única violada (`P2002`) vira
`409` "Já existe um registro com estes dados." e registro que sumiu entre a leitura e a escrita
(`P2025`) vira `404` "O registro não existe mais.". Antes os dois subiam como `500`: a tela dizia
"erro inesperado" para um "já está lá", e o log de erro enchia de ruído. Qualquer outro código do
Prisma continua `500` — traduzir o que não se entende esconderia um defeito.

### 1.4 Rate limiting (`NFR-04`)

| Escopo                            | Limite                                            | Chave   |
| --------------------------------- | ------------------------------------------------- | ------- |
| Global                            | 10 req/5 s (`curto`) e 120 req/min (`longo`)      | IP      |
| `/internal/*` (game-server)       | **fora** dos baldes globais (`SEM_LIMITE_GLOBAL`) | —       |
| `POST /auth/login`                | 5 req/min, 20 req/15 min                          | IP      |
| `POST /auth/register`             | 3 req/min, 10 req/hora                            | IP      |
| `POST /auth/senha`                | 2 req/10 s, 5 req/min                             | IP      |
| `POST /auth/senha/esqueci`        | 3 req/min, 10 req/hora                            | IP      |
| `POST /auth/senha/redefinir`      | 5 req/min, 20 req/hora                            | IP      |
| `POST /auth/excluir-conta`        | 2 req/10 s, 5 req/min                             | IP      |
| `POST /explorar/decks/:id/curtir` | 10 req/10 s, 60 req/min                           | IP      |
| `POST /explorar/decks/:id/copiar` | 3 req/10 s, 20 req/min                            | IP      |
| `POST /rooms`                     | 3 req/hora                                        | usuário |
| `POST /decks/import`              | 10 req/min                                        | usuário |
| `GET /cards/search`               | 30 req/min                                        | usuário |

`/auth/senha/esqueci` é o mais apertado dos três de senha por um motivo que não é força bruta: cada
pedido bem-sucedido dispara um **e-mail para um endereço que quem pede escolhe**. Sem limite, a rota
é um canhão de spam remetido pelo nosso domínio, e o preço não é a fatura do provedor — é o domínio
entrar em lista de bloqueio e nenhum e-mail do AetherTable chegar a lugar nenhum depois.

As rotas internas (`GET /internal/decks/:id` e `POST /internal/matches/summary`) saem dos baldes
porque todo pedido delas vem do **mesmo IP**, o do nó do game-server: uma mesa de oito começando são
oito decks em segundos, o `429` virava "Seu grimório não pôde ser carregado" com um deck válido, e
um resumo de partida recusado se perdia (o `onDispose` não tenta de novo). Quem as protege é o
segredo do `InternalApiGuard`. `@SkipThrottle()` sem argumento só pula o balde `default`, que não
existe aqui — por isso `common/limites.ts` define os baldes **e** o pulo que nomeia `curto` e
`longo`, derivado da mesma lista.

Headers em toda resposta: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

### 1.5 O que a API aceita como sessão

Assinatura válida não basta. A `JwtStrategy` responde `401` quando:

| Situação                                                                         | Mensagem                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------ |
| o token tem `aud`, ou carrega `roomId`, `spectator` ou `cfg` (passe de mesa, §5) | "Este token não é uma sessão da API."      |
| a conta não existe mais ou tem `deletedAt` (banida, apagada)                     | "Esta conta foi encerrada."                |
| `suspendedUntil` no futuro                                                       | "Sua conta está suspensa."                 |
| o `jti` está na denylist (logout, §2.10)                                         | "Sessão encerrada. Entre de novo."         |
| o `iat` é anterior a `User.tokensValidosApos` (com 1 s de folga)                 | "Sua sessão foi encerrada. Entre de novo." |

**Passe de mesa não é sessão.** O `seatToken`, o passe de espectador e o `configToken` são assinados
com o mesmo `JWT_SECRET` e carregam `sub`, e a estratégia só conferia o `sub`: o link
`/play/CODE?token=...` colado no grupo dava a quem o abrisse a API inteira **como o dono do link** —
apagar decks, trocar o perfil. Os três passes saem agora com `aud: "aethertable-mesa"`
(`auth/passe-de-mesa.ts`); o access token não tem audiência, então qualquer `aud` é recusado. As
claims de mesa derrubam também os passes emitidos antes da mudança, que vivem até um dia sem `aud`.
Um segredo separado foi descartado: exigiria deploy coordenado com o game-server, que verifica o
passe com `JWT_SECRET` e não confere `aud`.

**Suspensão e banimento valem na próxima requisição**, não no próximo login. Antes só o corte de
sessão era lido, e quem já tinha token seguia jogando e editando decks até ele expirar. A situação
da conta vem na **mesma** consulta do corte (`RevogacaoService.estadoDaConta`), sem custo extra.

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

Os dois `409` trazem `message` legível ("Este e-mail já está cadastrado.", "Este nome de usuário já
está em uso.") ao lado do `error`. O corpo era só `{ error }`, e a tela — que mostra `message` —
dizia "Falha ao registrar" sem apontar qual campo.

### 2.2 `POST /auth/login`

```json
{ "email": "jogador@exemplo.com", "password": "..." }
```

Resposta idêntica à de registro. Falha retorna `401 UNAUTHENTICATED` com mensagem genérica —
**nunca** revela se o e-mail existe (evita enumeração de contas).

### 2.3 `GET /auth/google` e `GET /auth/discord`

Redireciona ao provedor. **O caminho é `/auth/<provedor>`, não `/auth/oauth/:provider`** — este
documento descrevia a segunda forma, que nunca existiu no código.

**Provedor não configurado neste servidor redireciona para `<FRONTEND_URL>/?erro=indisponivel`** — e
não para um erro de API, porque isto é navegação (ver §2.4). As estratégias só são registradas quando
`<PROVEDOR>_CLIENT_ID` **e** `<PROVEDOR>_CLIENT_SECRET` existem; antes disso o backend subia com
credenciais de exemplo e o usuário terminava numa página de erro do próprio Google. Ver §2.5.

A URL de callback registrada no console do provedor é derivada de `API_PUBLIC_URL`:

```
<API_PUBLIC_URL>/auth/google/callback
<API_PUBLIC_URL>/auth/discord/callback
```

### 2.4 `GET /auth/google/callback` e `GET /auth/discord/callback`

Troca o código por identidade, cria ou vincula o usuário, emite o access token e **redireciona ao
frontend com o token no FRAGMENTO**: `<FRONTEND_URL>/dashboard#token=<jwt>`. O fragmento não viaja
no `Referer` nem em log de proxy; quem o lê é `OAuthTokenCapture`, que grava a sessão e apaga o
fragmento com `replaceState`.

**O e-mail precisa estar verificado pelo provedor.** Sem vínculo prévio, a identidade é casada com
uma conta local **pelo e-mail** — então um provedor que não confirme a posse do endereço seria um
caminho de tomada de conta: bastaria criar uma conta Discord declarando o e-mail da vítima. O Google
sempre verifica; o Discord permite conta com e-mail não confirmado, e é justamente esse o caso
recusado. Ausência do campo conta como **não verificado** (falha fechada).

Uma conta criada por OAuth recebe `emailVerifiedAt` — a primeira e única fonte legítima desse campo
no sistema.

**Falha é NAVEGAÇÃO, não JSON.** Qualquer erro no fluxo redireciona para `<FRONTEND_URL>/?erro=<código>`;
a tela de entrada traduz o código. Antes, o usuário terminava olhando
`{"statusCode":401,"message":"Unauthorized"}` numa página em branco.

| Código                 | Quando                                                         |
| ---------------------- | -------------------------------------------------------------- |
| `indisponivel`         | provedor sem credenciais neste servidor                        |
| `sem_email`            | o provedor não expôs e-mail utilizável                         |
| `email_nao_verificado` | o provedor não confirmou a posse do e-mail                     |
| `email_em_uso`         | o e-mail pertence a outra conta e o vínculo não foi confirmado |
| `recusado`             | a pessoa cancelou na tela de autorização do provedor           |
| `falhou`               | qualquer outra falha                                           |

A **mensagem** nunca viaja na URL, só o código: desenhar texto arbitrário vindo da querystring
transformaria a tela de login numa página de phishing hospedada no domínio certo.

### 2.5 `GET /auth/provedores`

```json
{ "google": true, "discord": false }
```

Pública e sem corpo. Existe porque a tela de login desenhava os dois botões em **todo** ambiente,
enquanto `render.yaml` nunca declarou as credenciais: em produção, clicar levava a uma página de
erro do provedor. Um botão na tela passa a ser a promessa de que aquele caminho funciona.

### 2.6 `POST /auth/senha`

Troca a **própria** senha, autenticado. Exige a senha atual.

```json
{ "senhaAtual": "...", "novaSenha": "ao menos 8 caracteres" }
```

Responde `200` com `{ accessToken, expiresIn }`. A troca derruba **todas as outras sessões** da conta
(`User.tokensValidosApos`) e devolve um token novo para esta — sem isso, trocar a senha deslogaria
quem trocou, no meio de uma partida.

Conta de OAuth não tem senha para conferir e recebe `400` explícito.

**Senha atual errada é `400`, não `401`.** O `fetcher` do frontend trata todo `401` como sessão
expirada e desloga: errar a senha atual nos Ajustes mandava a pessoa para o login com "Sua sessão
expirou". A sessão está boa; o que está errado é um campo do formulário.

**Limite:** 2 req/10 s e 5 req/min por IP. A rota diz se a senha atual confere, então é um oráculo de
senha para quem já tem o token.

### 2.7 `POST /auth/senha/esqueci`

```json
{ "email": "jogador@exemplo.com" }
```

**`202` sempre**, com o mesmo corpo:

```json
{ "mensagem": "Se houver uma conta com este e-mail, o link de redefinição chegará em instantes." }
```

Conta inexistente, banida, suspensa e de OAuth saem todas com a **mesma** resposta. Distingui-las
transformaria a rota num verificador de cadastro público — útil para phishing dirigido e para cruzar
vazamentos de outras plataformas (§8, "Enumeração de contas").

A conta **de OAuth** recebe um e-mail diferente, dizendo que ela entra por Google ou Discord e não
tem senha. Isso vai para a caixa de entrada do dono do endereço, que já sabe disso — o que seria
vazamento é dizer na tela.

O token tem 256 bits de CSPRNG, vale **30 minutos**, é de **uso único**, e cada pedido novo invalida
os anteriores da mesma conta. A tabela guarda o **SHA-256** do token, nunca o texto.

**Limite:** 3 req/min e 10 req/hora por IP. Cada pedido dispara um e-mail para um endereço que **quem
pede** escolhe: sem limite, a rota é um canhão de spam remetido pelo nosso domínio, e o preço é o
domínio entrar em lista de bloqueio.

**`503` quando o envio de e-mail não está configurado** (`RESEND_API_KEY` ausente em produção). A
alternativa — responder "enviamos" sem ter enviado — foi recusada: ninguém descobriria. Falha de
**entrega** (provedor fora do ar) não muda a resposta, pelo mesmo motivo que os outros casos não
mudam: seria um `503` só para e-mails que existem.

### 2.8 `POST /auth/senha/redefinir`

```json
{ "token": "<do link do e-mail>", "novaSenha": "ao menos 8 caracteres" }
```

`204`. **Não devolve sessão**, e a diferença para §2.6 é deliberada: quem chega por aqui esqueceu a
senha ou perdeu o controle da conta, e emitir sessão a partir do link do e-mail transformaria o
e-mail no próprio fator de autenticação. A tela manda entrar com a senha nova.

Derruba **todas** as sessões da conta. As três causas de recusa — token inexistente, já usado e
vencido — devolvem o **mesmo** `400`: distingui-las contaria a quem tenta se ele acertou um token e
apenas chegou tarde.

**O consumo é atômico.** Dentro da transação, um `updateMany` marca `usedAt` só se `usedAt` ainda é
nulo e `expiresAt` não passou; a senha só é trocada se ele contou **uma** linha. Antes o uso único
era conferido na leitura e a marcação era incondicional: dois pedidos com o mesmo link — dois
cliques, ou a vítima e o invasor lendo a mesma caixa de entrada — passavam juntos e os dois
gravavam senha.

**Limite:** 5 req/min e 20 req/hora por IP.

### 2.9 `POST /auth/refresh` — **não implementado**

> Descrito abaixo como projetado, e **não existe no código**. Não há refresh token no sistema: o
> access token vale 24 h (`JWT_ACCESS_TTL`) e a sessão morre quando ele expira. `JWT_REFRESH_TTL` foi
> removido do `render.yaml` por isso. O `expiresIn: 900` do exemplo de §2.1 é do mesmo projeto e
> também não corresponde ao valor real.

Sem corpo — usa o cookie. Retorna novo `accessToken` e **rotaciona** o _refresh token_.
Reuso de um _refresh_ já rotacionado invalida toda a família de tokens e retorna `401`.

### 2.10 `POST /auth/logout`

Revoga o access token desta sessão gravando o `jti` na denylist (`revoked_tokens`). `204`.

### 2.11 `GET /users/me`

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

### 2.12 `GET /users/:username`

Perfil público: `username`, `displayName`, `avatarUrl`, `stats`, `createdAt`. **Sem e-mail.**

### 2.13 `PATCH /users/me`

Campos aceitos: `displayName`, `avatarUrl`.

`displayName` aceita até 48 caracteres, e `""`, só espaços ou `null` gravam `null` — "sem nome de
exibição", e a mesa cai no `username`. Era `min(1)`: a conta sem nome de exibição reenviava `""` a
cada salvamento de Perfil e Ajustes, e qualquer mudança (tema, idioma, cosmético) falhava com "Dados
inválidos" por um campo que a pessoa nem tocou.

### 2.14 As preferências viajam no `GET /users/me` e no `PATCH /users/me`

Não há rota `/users/me/preferences` separada, e não é omissão: as preferências são lidas no mesmo
instante que o perfil (a casca autenticada precisa das duas coisas para desenhar a primeira tela) e
uma segunda rota seria uma segunda requisição no caminho de entrada da Taverna.

`GET /users/me` devolve `preference` junto do perfil:

```json
{
  "id": "…",
  "username": "planeswalker42",
  "supporterTier": "FREE",
  "preference": {
    "theme": "DARK",
    "language": "pt-BR",
    "sleeveId": "aether-classic",
    "playmatId": "mesa-padrao",
    "borderId": null,
    "titleId": null,
    "petId": null,
    "cosmeticosDeOponentes": true,
    "keybindings": { "COMPRAR": "d", "EMBARALHAR": "s", "REVELAR_TOPO": "r" },
    "preferenciasDeMesa": {
      "fatorCarta": 1.2,
      "alinharNaGrade": true,
      "anexosDesativados": false,
      "custoDeManaNaMao": true,
      "seguirTurno": false,
      "contornoDasZonas": true,
      "trilhoAberto": true,
      "barraAberta": false,
      "logAberto": false,
      "vidaModo": "minha",
      "boardView": "ALL"
    }
  }
}
```

`PATCH /users/me` aceita qualquer subconjunto desses campos. Duas regras que valem para as duas
colunas JSONB (`keybindings` e `preferenciasDeMesa`):

1. **o objeto é substituído inteiro, não mesclado.** O cliente sempre envia o conjunto completo, e
   um merge parcial criaria a dúvida de como voltar uma entrada ao padrão — chave ausente
   significaria "não mexa" e a ação nunca poderia ficar sem tecla.
2. **a validação é contra o CATÁLOGO em `@aethertable/shared-types`**, não contra uma lista escrita
   à mão aqui: chave que não existe é `400`. O valor é validado por abuso (tamanho, caractere de
   controle) e não por gramática — quem decide o que é um valor aceitável é a função de normalização
   que as duas pontas usam.

### 2.15 `POST /auth/excluir-conta`

A pessoa apaga a própria conta, autenticada. (O `DELETE /users/me` desenhado aqui antes nunca existiu.)

```json
{ "confirmacao": "<nome de usuário exato>", "senha": "obrigatória se a conta tem senha" }
```

Responde `204`. A conta é **apagada na hora**, com o mesmo `user.delete` do expurgo do backoffice:
decks, cartas, preferências, cosméticos, curtidas, contas OAuth e tokens de redefinição caem em
`CASCADE`; a participação em partidas e a auditoria ficam com `userId` NULL. O JWT de qualquer
sessão deixa de valer porque a conta não existe mais. Não há soft delete nem espera de 30 dias: quem
pediu a exclusão já fez o pedido.

Nome errado ou senha errada são `400` (não `401`, pelo mesmo motivo da troca de senha). O último
administrador ativo recebe `403`. Conta banida não chega aqui: ela não loga.

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
2. _Parsing_ linha a linha com detecção de seção e de marcadores de exportador (abaixo).
3. Agrupa por **impressão + board**, somando quantidades.
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

> **No código** a rota é `POST /decks/:id/import`, corpo `{ "decklist": "..." }` (até 20.000
> caracteres), e substitui as cartas do deck. Responde `{ success, imported, notFound }`, onde
> `notFound` traz as cartas não achadas **e** as linhas recusadas, com o motivo.

O _parser_ (`decks/importacao.ts`) corrige quatro defeitos que conviviam no serviço:

| Regra                    | O que faz                                                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cabeçalho muda de seção  | `Deck`/`Main`, `Sideboard`/`Side`, `Companion` (vai para a reserva), `Commander`, `Maybeboard`/`Maybe`/`Considering`; aceita `SIDEBOARD:`, `// Sideboard`, `Sideboard (15)`. O `About` do MTGA é ignorado. Antes, a reserva entrava no MAIN e "Commander" ia à Scryfall como nome de carta |
| Marcadores de exportador | `*F*` e `*CMDR*` (este vai para COMMANDER), etiquetas `^...^` e categorias `[Ramp,Artifact]` do Archidekt saem do nome; `[Commander]`, `[Sideboard]`, `[Maybeboard]` e `{noDeck}` escolhem o board. `[C21]` sozinho continua sendo coleção                                                 |
| Nome repetido            | "4 Forest (ZNR)" + "6 Forest (M21)" mantém as duas quantidades — antes virava 4 + 4. Linhas da mesma impressão no mesmo board são somadas, em vez de baterem na chave única do `createMany` (500)                                                                                          |
| Teto de 99 cópias        | Linha fora de 1–99 é recusada; duas linhas que somam mais de 99 também. "2000000000 Forest" era gravado e travava o game-server ao criar as cartas                                                                                                                                         |

### 3.4 `POST /decks`

Cria deck vazio ou com cartas já resolvidas (`{ scryfallId, quantity, boardType, isCommander }`).

No código o corpo é `{ name?, formatId? }`. `formatId` é validado contra o **catálogo de formatos**
(`formatoExiste`, de `@aethertable/shared-types`) e responde `400` "Formato desconhecido." fora
dele. A regex anterior (`^[a-z0-9-]+$`) recusava os ids com sublinhado — `duel_commander`,
`commander_1v1`, `historic_brawl`, `tiny_leaders` — e deixava passar qualquer id inventado.

### 3.5 `PUT /decks/:id`

Substitui metadados e lista de cartas em **uma transação**. `card_count` é recalculado na mesma
transação.

### 3.6 `PATCH /decks/:id`

Atualização parcial: `name`, `description`, `isFavorite`, `isPublic`, `commanderId`.

### 3.7 `POST /decks/:id/clone`

Cria cópia independente do próprio deck, linha a linha e na mesma impressão, com o nome sufixado por
" (cópia)". Nasce privada e fora dos favoritos. (O nome desenhado antes era `/duplicate`.)

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

### 3.10 Cartas de um deck

| Rota                                        | Corpo                                   |
| ------------------------------------------- | --------------------------------------- |
| `POST /decks/:id/cards`                     | `{ scryfallId, quantity?, boardType? }` |
| `PATCH /decks/:id/cards/:cardId/quantity`   | `{ delta }` (−99 a 99)                  |
| `PATCH /decks/:id/cards/:cardId/printing`   | `{ scryfallId }`                        |
| `PATCH /decks/:id/cards/:cardId/board-type` | `{ boardType }`                         |
| `DELETE /decks/:id/cards/:cardId`           | —                                       |

**`scryfallId` é gravado em minúsculas.** UUID não diferencia caixa, mas a chave única e a
hidratação diferenciam: um id em maiúsculas virava uma segunda linha da mesma carta e, na
hidratação, não casava com o id da Scryfall — a carta vinha sem nome e com `isBanned: false`, um
jeito de entrar na mesa com carta banida. A leitura também compara em minúsculas, para as linhas
gravadas antes.

**Teto de 99 cópias por carta em todo caminho de escrita** — adicionar, mudar quantidade, juntar e
importar. Acima dele a rota responde `400` "Máximo de 99 cópias por carta" e nada é gravado. O
schema documenta `1..99`, mas nenhuma migração criou o `CHECK`: quem segura o teto é o código.

**Quantidade e `cardCount` mudam por incremento relativo, na mesma transação.** Adicionar é `upsert`
com `increment`; mudar quantidade é `increment: delta`, e a decisão de apagar (≤ 0) ou recusar (> 99)
sai do valor que o próprio `update` devolveu; remover decrementa a quantidade que o `delete`
apagou. Antes, dois `+1` concorrentes liam o mesmo 3 e gravavam 4 enquanto o contador subia para 5 —
e a mesa recusava um deck correto.

**Mover para onde a carta já está junta as cópias.** Trocar o board ou a impressão para uma
combinação que o deck já tem soma as quantidades na linha existente e apaga a de origem
(`cardCount` não muda). Se juntas passarem de 99, `400` "A carta já está lá, e juntas passariam de
99 cópias.". Antes o `update` batia na chave única e respondia `500`.

---

### 3.11 Explorar — decks públicos

Prefixo próprio porque `/decks/publicos` cairia no `GET /decks/:id` (`ParseUUIDPipe`). Só aparece
deck com `isPublic` de conta ativa; deck privado e deck inexistente respondem o mesmo `404`. O dono
aparece pelo nome de usuário, nunca pelo id.

| Rota                              | O que faz                                                            |
| --------------------------------- | -------------------------------------------------------------------- |
| `GET /explorar/decks`             | Lista paginada (24). Query: `busca`, `formato`, `ordem=curtidos      | recentes`, `curtidos=1`, `pagina`                                      |
| `GET /explorar/decks/:id`         | O deck hidratado como no editor, com `dono`, `curtido` e `likeCount` |
| `POST /explorar/decks/:id/curtir` | `{ "curtir": true                                                    | false }` — destino explícito, idempotente. Não se curte o próprio deck |
| `POST /explorar/decks/:id/copiar` | Copia o deck para a conta de quem pediu, privado                     |

A curtida tem chave composta `(deck, conta)` no banco e `decks.like_count` é mantido na mesma transação.

### 3.12 Decks iniciais — os pré-montados oficiais

Prefixo próprio pelo mesmo motivo do Explorar. As listas são dados do repositório
(`decks-iniciais.dados.ts`), geradas do MTGJSON (licença MIT) por `tools/decks-iniciais.mjs`: a API
não depende de serviço externo para servi-las.

| Rota                                | O que faz                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| `GET /decks-iniciais`               | A vitrine: código, nome, coleção, comandantes e cores — sem as cem cartas        |
| `POST /decks-iniciais/:codigo/usar` | Copia a lista para a conta (Commander, privado) ou devolve a cópia que já existe |

A cópia é reconhecida pelo nome e pela descrição de origem: escolher o mesmo deck inicial duas vezes
na sala de espera não cria dois decks. Limite: 3 req/10 s e 20 req/min.

### 3.13 `POST /decks/aleatorio` — deck montado em volta de um comandante sorteado

Sorteia um comandante entre os ~700 mais jogados do EDHREC (sem parceiro, sem Game Changer) e monta um
deck de Commander em volta dele, gravado na conta (privado):

| Papel           | Quantas                                             | Busca na Scryfall (dentro da identidade)                 |
| --------------- | --------------------------------------------------- | -------------------------------------------------------- |
| Terrenos        | 36: não básicos (2–12, conforme as cores) + básicos | `t:land -t:basic produces:<cores>`                       |
| Ramp            | 10                                                  | `otag:ramp -t:land`                                      |
| Compra          | 10                                                  | `otag:draw -t:land`                                      |
| Remoção         | 8                                                   | `otag:removal -otag:sweeper -t:land`                     |
| Limpeza de mesa | 3                                                   | `otag:sweeper`                                           |
| Tema (o resto)  | 20 criaturas + o que sobrar                         | tribo e mecânicas lidas do tipo e do texto do comandante |

Cada papel sorteia entre as mais jogadas (três vezes o que pede), sempre singleton e sem Game Changer
(mesa casual). Os básicos seguem a demanda de cor dos custos, com ao menos um de cada cor. Total sempre
100; se faltar um básico da Scryfall, a rota recusa em vez de gravar deck incompleto. Limite: 2 a cada
20 s e 15 por hora — cada pedido são ~11 buscas na Scryfall.

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

Por viajar na URL, ele sai com `aud: "aethertable-mesa"` — assim como o `configToken` e o passe de
espectador — e a API o recusa como sessão (§1.5).

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

**Exige o passe da mesa no header `X-Passe-De-Mesa`.** O passe de voz saía
para qualquer conta e qualquer código, e a vitrine pública LISTA os códigos:
uma conta qualquer entrava no canal de voz de uma mesa alheia, ouvia e falava.
O passe da mesa (seat token ou passe de espectador) é verificado com a
audiência `aethertable-mesa` e precisa ter `sub` = a conta e `roomId` = a
sala; sem isso a resposta é `{ token: null }`. Passe de espectador recebe
`canPublish: false` — a plateia ouve e não fala.

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

### 5.6 `GET /matches/historico`

As partidas da conta, mais recentes primeiro, 20 por página (RN12, revista em
14/10/2026). Querystring:

| Parâmetro   | Valores                                             | Padrão  |
| ----------- | --------------------------------------------------- | ------- |
| `resultado` | `todas`, `vitorias`, `derrotas`, `sem-vencedor`     | `todas` |
| `formato`   | id do formato (`commander`…), sem diferenciar caixa | —       |
| `pagina`    | 1 a 1000                                            | `1`     |

```json
{
  "total": 37,
  "pagina": 1,
  "porPagina": 20,
  "partidas": [
    {
      "id": "…",
      "terminouEm": "2026-10-14T21:40:00.000Z",
      "duracaoSegundos": 3900,
      "formato": "COMMANDER",
      "rodadas": 11,
      "jogadores": 4,
      "resultado": "VITORIA",
      "participantes": [
        {
          "nome": "Gaspare",
          "usuario": "gaspare",
          "souEu": true,
          "deckId": "…",
          "nomeDoDeck": "Atraxa Superfriends",
          "comandanteId": "<scryfallId>",
          "bracket": 3,
          "vidaFinal": 12,
          "venceu": true,
          "comecou": false,
          "saiuAntes": false,
          "motivoDaEliminacao": null
        }
      ]
    }
  ]
}
```

- `resultado` é `SEM_VENCEDOR` quando ninguém venceu (mesa desfeita, todos
  saíram). `derrotas` filtra partidas COM vencedor que não foi a conta.
- `deckId` só vem preenchido na linha da própria conta — é o que abre "Abrir o
  deck". O dos outros é sempre `null`.
- O nome vem da conta na leitura; conta excluída aparece como `"Conta excluída"`
  com `usuario: null`.
- `bracket` é a estimativa do deck NO MOMENTO da partida: editar o deck depois
  não reescreve o histórico.

### 5.7 `GET /matches/historico/estatisticas`

Os números do topo da tela de histórico:

```json
{
  "partidas": 37,
  "vitorias": 11,
  "taxaDeVitoria": 0.297,
  "duracaoMediaSegundos": 3420,
  "comandanteMaisJogado": { "comandanteId": "<scryfallId>", "partidas": 9 }
}
```

O resumo de cada partida chega por `POST /internal/matches/summary`, vindo do
game-server: além de duração e participantes, ele agora traz `formato`,
`turnos` e `detalhes[]` (assento, deck, comandante, vida final, venceu,
começou, saiu antes, motivo da eliminação). Tudo opcional — game-server antigo
continua sendo aceito, e a partida conta sem os detalhes.

---

## 6. Moderação

| Endpoint                              | Descrição                                         |
| ------------------------------------- | ------------------------------------------------- |
| `POST /moderation/blocks`             | `{ "username": "..." }` — bloqueia                |
| `DELETE /moderation/blocks/:username` | Desbloqueia                                       |
| `GET /moderation/blocks`              | Lista bloqueados                                  |
| `POST /moderation/reports`            | `{ "username", "reason", "details", "roomCode" }` |

`reason` ∈ {`HARASSMENT`, `CHEATING`, `SPAM`, `HATE_SPEECH`, `OTHER`}.

### 6.1 `POST /admin/usuarios/:id/redefinir-senha`

Só administrador (o resto do painel está em `DOC-061`).

```json
{ "motivo": "ao menos 8 caracteres", "novaSenha": "opcional, 8–200 caracteres" }
```

| `novaSenha` | Resposta                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| ausente     | `{ senhaTemporaria, username }` — gerada pelo servidor (18 bytes de CSPRNG em base64url), mostrada **uma única vez** |
| presente    | `{ senhaTemporaria: null, username }` — quem escolheu já a conhece, e devolvê-la só a faria passar por mais um log   |

Nos dois casos **todas** as sessões da conta caem (`User.tokensValidosApos`), e a auditoria
(`USER_PASSWORD_RESET`) registra `metadata.escolhidaPeloAdmin: boolean` — **nunca** a senha. A regra
de tamanho é a **mesma** do cadastro: uma regra mais frouxa aqui viraria o caminho para burlar a de lá.

> **Decisão revertida.** A decisão anterior era "o admin redefine, mas não escolhe": o corpo só tinha
> o `motivo`, porque deixar o admin digitar expõe a senha no formulário e no corpo da requisição, e
> ele fica sabendo a credencial de outra pessoa. Os riscos continuam valendo
> ([plano_de_seguranca_e_ameacas_threat_model.md](plano_de_seguranca_e_ameacas_threat_model.md)); a
> decisão mudou **a pedido do operador** — quem perdeu o acesso pede uma senha que consiga anotar, e
> ditar 24 caracteres de base64url por telefone não é procedimento que alguém siga. Por isso
> `novaSenha` é opcional e o padrão continua sendo a senha gerada.

### 6.2 Travas do painel administrativo

| Onde                                                                | Comportamento                                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /admin/usuarios/:id/suspender` e `/banir`                     | Gravam `tokensValidosApos` junto de `suspendedUntil`/`deletedAt`: as sessões abertas caem na hora (§1.5). Antes a punição só valia no próximo login                                                                              |
| `ADMIN_EMAILS` (no boot)                                            | Só promove conta com `emailVerifiedAt` — hoje gravado pelo login com Google ou Discord. Sem ele, loga o motivo e o que fazer (entrar uma vez pelo provedor com esse e-mail e reiniciar). Quem já é `ADMIN` não é tocado          |
| `PATCH /admin/cosmeticos/:id`                                       | Mudar `nome` ou `minTier` de item autoral reescreve também `parametros` (`nome`, `tier`). Antes o painel mostrava o item gratuito com o cadeado fechado na mesa. Se o item deixar de ser válido (nome autoral cabe em 48), `400` |
| `POST /admin/denuncias/:id/assumir` e `/resolver`                   | `403` "Esta denúncia é contra você. Outro moderador precisa analisá-la." quando o denunciado é quem age — antes um moderador podia arquivar a denúncia contra ele mesmo                                                          |
| Auditoria (`ip`)                                                    | Vem de `req.ip` (`trust proxy: 1`), não do primeiro endereço de `X-Forwarded-For`: o proxy do Render acrescenta ao cabeçalho que recebe, e o próprio admin investigado escrevia o "IP de origem"                                 |
| Booleanos (`incluirApagados`, `apenasSuspensos`, `ativo`, `ligado`) | Aceitam `true`/`false` ou as strings `"true"`/`"false"`; o resto é `400`. `z.coerce.boolean()` transformava `"false"` em `true`                                                                                                  |

A promoção por `ADMIN_EMAILS` exige e-mail confirmado porque o cadastro por senha não confirma o
endereço, e os e-mails de `ADMIN_EMAILS` não são segredo: quem se cadastrasse antes do dono com
aquele endereço viraria `ADMIN` no próximo boot. A condição vai também no `WHERE` do `updateMany`.

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
