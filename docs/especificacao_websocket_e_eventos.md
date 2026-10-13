# Especificação WebSocket (State Synchronization)

| Campo                       | Valor                                                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                      | `DOC-031`                                                                                                                                                                                                                                                           |
| **Versão**                  | 1.1                                                                                                                                                                                                                                                                 |
| **Status**                  | Estável                                                                                                                                                                                                                                                             |
| **Última revisão**          | 2026-08-20                                                                                                                                                                                                                                                          |
| **Documentos relacionados** | [readme.md](readme.md) · [especificacao_do_motor_sandbox.md](especificacao_do_motor_sandbox.md) · [especificacao_do_motor_de_estado_state_machine.md](especificacao_do_motor_de_estado_state_machine.md) · [seguranca_e_privacidade.md](seguranca_e_privacidade.md) |

---

## 1. Modelo de comunicação

O protocolo de tempo real é gerido pelo **Colyseus**. Em vez de emitir eventos genéricos, o Colyseus
sincroniza um **`Schema`** — uma árvore de estado tipada mantida no servidor.

### 1.1 As duas direções são assimétricas

| Direção                | O que trafega                                                                              | Formato                                              |
| ---------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| **Cliente → Servidor** | Apenas **intenções** (`INTENT_*`). O cliente nunca envia estado.                           | Mensagem nomeada com _payload_ JSON validado por Zod |
| **Servidor → Cliente** | Apenas **patches de estado** (delta binário) e **eventos efêmeros** (log, animação, erro). | Fossil Delta binário + mensagens nomeadas            |

Essa assimetria é a espinha dorsal de `RN07`: **o cliente pede, o servidor decide.**

```
Cliente                              Servidor
  │                                     │
  ├── INTENT_MOVE_CARD {id,x,y} ───────►│
  │                                     ├─ Zod valida
  │                                     ├─ checa lock e controllerId
  │                                     ├─ muta RoomState
  │                                     ├─ Colyseus calcula delta
  │◄────── patch binário ───────────────┤ (para TODOS, filtrado por @filter)
  │◄────── evento "log" ────────────────┤ (quando aplicável)
```

---

## 2. Conexão base

### 2.1 URL e handshake

```
wss://game-node-02.aethertable.app
   → joinById("K7M2QX", { seatToken, deckId })
```

| Etapa            | Detalhe                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| 1. Obter destino | O cliente **não escolhe** o nó. `POST /rooms` ou `/rooms/:id/join` devolve `wsUrl` + `seatToken` (`DOC-030` §5) |
| 2. Conectar      | `client.joinById(roomId, { seatToken, deckId })`                                                                |
| 3. Validar       | `onAuth` verifica assinatura, expiração (60 s), uso único e vínculo `roomId`↔token (`FR-20`)                    |
| 4. Provisionar   | `onJoin` carrega o deck, embaralha a `LIBRARY` com CSPRNG e serve 7 cartas à `HAND`                             |
| 5. Sincronizar   | O cliente recebe o **estado completo** filtrado, depois só deltas                                               |

**Rejeições possíveis no handshake:** `INVALID_TOKEN`, `TOKEN_EXPIRED`, `TOKEN_ALREADY_USED`,
`ROOM_FULL`, `ROOM_CLOSED`, `PLAYER_BLOCKED`, `ALREADY_SEATED`.

| Código               | Quando                                                                                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PLAYER_BLOCKED`     | A **conta** (`sub`) foi removida da mesa — pelo anfitrião ou por votação (`INTENT_VOTE_KICK`) — e não volta pelo resto da vida da sala, nem como espectador. Antes o bloqueio era por `sessionId`, e um seat token novo pelo código da sala sentava o expulso de novo |
| `ALREADY_SEATED`     | A mesma conta já está sentada **e conectada** (duas abas). Se o assento antigo estiver desconectado, ele é liberado e a entrada segue: antes a conta ganhava um segundo assento, e o fantasma do primeiro ocupava a vaga até a janela de reconexão vencer             |
| `TOKEN_ALREADY_USED` | O `jti` só é **consumido depois** de a vaga ser confirmada. Antes ele era marcado logo após a assinatura: quem levava `ROOM_FULL` e tentava de novo quando abria vaga recebia "token já usado" — que parecia defeito, e não lotação                                   |

### 2.2 Parâmetros de conexão

| Parâmetro                  | Valor                                                                             |
| -------------------------- | --------------------------------------------------------------------------------- |
| Protocolo                  | `wss://` — TLS 1.3, sem _fallback_ para `ws://` em produção                       |
| Heartbeat                  | `ping`/`pong` a cada **15 s**; sem `pong` por **45 s** encerra a conexão          |
| Reconexão                  | `allowReconnection(client, RECONNECTION_WINDOW_S)` — janela de **600 s** (`RN10`) |
| Limite de taxa             | **30 intenções/s** por cliente; excedente descartado com evento `warning`         |
| Tamanho máximo de mensagem | 4 KB — intenções são pequenas por natureza                                        |
| Compressão                 | Desabilitada — o payload já é binário compacto                                    |

---

## 3. Contrato cliente → servidor (intenções)

Todas as intenções são validadas com Zod antes de qualquer efeito (`FR-11`). _Payload_ inválido é
**descartado** com evento `error` ao remetente — nunca derruba a sala.

> **Lista canônica de ações:** [catalogo_de_acoes_da_mesa.md](catalogo_de_acoes_da_mesa.md) enumera as
> **131 ações** de mesa e a qual intenção cada uma corresponde. Este documento define o **contrato de
> rede** (payload, validação, resposta); o catálogo define **o que existe**. Não duplique a lista de
> ações aqui — ela muda com o produto, e duas cópias divergem.

### 3.0 Famílias de intenção

| Família               | Prefixo                                                                                                                                                                                                                         | Nº aprox. | Detalhe           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------- |
| Movimento e posição   | `INTENT_GRAB`, `_MOVE_CARD`, `_RELEASE`, `_BRING_TO_FRONT`                                                                                                                                                                      | 4         | §3.1              |
| Zona e grimório       | `INTENT_CHANGE_ZONE`, `_BATCH_CHANGE_ZONE`, `_DRAW`, `_MILL`, `_SHUFFLE`, `_REORDER`, `_MULLIGAN`, `_RETURN_ZONE`, `_MOVE_TOP_TO_BOTTOM`, `_DRAW_UP_TO`                                                                         | 10        | §3.2              |
| **Visibilidade**      | `INTENT_PEEK`, `_SCRY`, `_SCRY_COMMIT`, `_SURVEIL`, `_SURVEIL_COMMIT`, `_REVEAL`, `_REVEAL_ZONE`, `_REVEAL_TOP`, `_UNREVEAL`, `_SEARCH_ZONE`, `_CLOSE_PEEK`, `_ARRANGE_PEEKED`, `_SET_ZONE_VISIBILITY`, `_SET_TOP_REVEALED`     | **14**    | **§3.2.1 — novo** |
| Propriedades de carta | `INTENT_TAP`, `_UNTAP_ALL`, `_TAP_ALL`, `_UPDATE_PROPERTY`, `_TRANSFORM`, `_MELD`, `_ATTACH`, `_DETACH`, `_GROUP`, `_SET_PT`, `_SET_DAMAGE`, `_CLEAR_DAMAGE`, `_SET_NOTE`, `_SET_HIGHLIGHT`, `_SET_CONTROLLER`, `_BATCH_UPDATE` | 16        | §3.3              |
| Contadores            | `INTENT_ADD_COUNTER`, `_SET_COUNTER`, `_CLEAR_COUNTERS`, `_ADD_PLAYER_COUNTER`, `_BATCH_COUNTER`                                                                                                                                | 5         | §3.3.1            |
| Jogador e designações | `INTENT_SET_LIFE`, `_SET_COMMANDER_DAMAGE`, `_TOGGLE_DESIGNATION`, `_SET_COMMANDER_TAX`, `_SET_RING`, `_SET_DAY_NIGHT`, `_SET_SPEED`, `_VENTURE`, `_CONCEDE`, `_SET_TURN_ORDER`, `_SET_MAX_HAND_SIZE`                           | 11        | §3.4              |
| Objetos criados       | `INTENT_CREATE_TOKEN`, `_COPY_CARD`, `_DESTROY_TOKEN`, `_CLEAR_TOKENS`, `_CREATE_EMBLEM`                                                                                                                                        | 5         | §3.5              |
| Aleatoriedade         | `INTENT_ROLL_DICE`, `_FLIP_COIN`, `_RANDOM_PLAYER`, `_RANDOM_CARD`, `_DISCARD_RANDOM`, `_PLANESWALK`, `_DRAW_SCHEME`                                                                                                            | 7         | §3.6              |
| Mesa e comunicação    | `INTENT_CHAT`, `_PING`, `_ARROW`, `_CLEAR_ARROWS`, `_SET_TURN`, `_PASS_TURN`, `_UNDO`                                                                                                                                           | 7         | §3.6              |
| Ciclo e formato       | `INTENT_RESET_MATCH`, `_LEAVE`, `_FETCH_FROM_SIDEBOARD`, `_CAST_COMMANDER`                                                                                                                                                      | 4         | §3.7              |
| **Total**             |                                                                                                                                                                                                                                 | **~80**   |                   |

### 3.0.1 Regra transversal de autorização por família

| Família                         | Quem pode enviar                                                 |
| ------------------------------- | ---------------------------------------------------------------- |
| Visibilidade sobre zona própria | Só o `ownerId` da zona                                           |
| Visibilidade sobre zona alheia  | **Ninguém** — não existe intenção para olhar a mão de outro      |
| Propriedades de carta           | `controllerId`                                                   |
| Zona de carta                   | `controllerId`, e `ownerId` para zonas ocultas                   |
| Contadores de jogador e vida    | Qualquer jogador (reflete a mesa física; o log registra o autor) |
| Aleatoriedade                   | Qualquer jogador                                                 |
| `_RESET_MATCH`                  | Qualquer jogador, com confirmação dos presentes                  |

### 3.1 Movimento e posicionamento

| Intenção                | Payload                       | Efeito no servidor                                               |
| ----------------------- | ----------------------------- | ---------------------------------------------------------------- |
| `INTENT_GRAB`           | `{ entityId }`                | Concede _lock_ de arraste (`isLockedBy = sessionId`), TTL de 5 s |
| `INTENT_MOVE_CARD`      | `{ entityId, x, y }`          | Atualiza `x`/`y`. Aceito só de quem tem o _lock_ (`FR-10`)       |
| `INTENT_RELEASE`        | `{ entityId, x, y, zIndex? }` | Grava posição final e libera o _lock_                            |
| `INTENT_BRING_TO_FRONT` | `{ entityId }`                | Define `zIndex` acima do maior atual da zona                     |

O cliente aplica _throttle_ de **20 mensagens/s** durante o arraste e usa predição otimista local.

**`x`/`y` no campo são fração (0–1) do campo de quem controla, não pixel**, e `(0, 0)` significa "sem
coordenada — centralize" (o cliente nunca envia 0 exato; o mínimo é `0.0001`). O modelo e o porquê
estão em `DOC-032` §3.

### 3.2 Mudança de zona

| Intenção                    | Payload                                                              | Efeito                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `INTENT_CHANGE_ZONE`        | `{ entityId, targetZone, index?, x?, y?, faceDown?, controllerId? }` | Remove da zona atual, injeta na nova, **recalcula visibilidade**. Ver as notas abaixo da tabela                             |
| `INTENT_BATCH_CHANGE_ZONE`  | `{ entityIds[], targetZone }` (1–200)                                | A seleção inteira numa mensagem, pelo mesmo caminho do `CHANGE_ZONE` (ver abaixo)                                           |
| `INTENT_DRAW`               | `{ amount }` (1–100)                                                 | Move `amount` cartas do topo da `LIBRARY` para a `HAND` do remetente                                                        |
| `INTENT_MILL`               | `{ amount, target: "GRAVEYARD" \| "EXILE", faceDown? }`              | Move do topo da `LIBRARY` para a zona indicada; `faceDown` só vale no exílio (no cemitério a carta é pública por definição) |
| `INTENT_MOVE_TOP_TO_BOTTOM` | `{ amount }`                                                         | Move as N do topo para o fundo da `LIBRARY`                                                                                 |
| `INTENT_SHUFFLE_ZONE`       | `{ targetZone: "LIBRARY", keepTop? }`                                | Fisher-Yates com CSPRNG (`RN06`)                                                                                            |
| `INTENT_MULLIGAN`           | `{}`                                                                 | Devolve a mão, embaralha, serve 7; incrementa o contador de mulligans                                                       |
| `INTENT_DRAW_UP_TO`         | `{ target }`                                                         | Compra até ter `target` cartas na mão                                                                                       |
| `INTENT_RETURN_ZONE`        | `{ from, to, shuffle }`                                              | Devolve uma zona inteira (ex.: cemitério → grimório)                                                                        |
| `INTENT_REORDER`            | `{ zone, ids[] }`                                                    | Reordena uma zona ordenada. `ids` tem de ser uma permutação **sem repetição** do conteúdo atual (ver abaixo)                |

**Notas de `INTENT_CHANGE_ZONE`:**

- **`faceDown`** só vale para `BATTLEFIELD` e `EXILE`, e é aplicado **antes** dos efeitos de zona,
  para a carta já chegar escondida no mesmo patch da troca. Antes não existia: o morph era baixado com
  a face para cima e virado depois, e no intervalo entre as duas intenções a identidade já tinha
  chegado em todos os clientes.
- **`controllerId`** só vale para `BATTLEFIELD`: a carta entra sob controle de outro assento (o
  `ownerId` nunca muda). Também é aplicado antes dos efeitos de zona, para que uma carta virada passe
  a ser vista por quem a recebeu.
- Ao ir para `GRAVEYARD` ou `COMMAND`, a carta **vira para cima**: um cemitério com carta virada
  escondia para sempre uma informação pública.
- Tirar carta do **`LIBRARY`** é **irreversível** para o desfazer — ela já foi vista (`DOC-032`
  §3.2).

**`INTENT_BATCH_CHANGE_ZONE`** existe porque a barra de seleção mandava um `CHANGE_ZONE` por carta, e
o limite de 30 intenções/s (§2.2) descartava o excedente em silêncio: 40 fichas para o cemitério
depois de um _board wipe_ moviam 30. As duas intenções passam pelo **mesmo** helper (`trocarDeZona`),
para não divergirem em face, controle e ordem. A autorização é **por carta** — só as que têm
`controllerId === remetente` se movem; o resto da seleção é ignorado, como no `BATCH_UPDATE`. O log é
**uma linha só**, com contagem e destino, nunca nomes ("moveu N carta(s) para o cemitério",
`ZONE_CHANGE_HIDDEN`): a seleção pode conter carta virada.

**Os três lotes têm o mesmo teto, `MAX_LOTE = 200`** (`BATCH_UPDATE`, `BATCH_COUNTER`,
`BATCH_CHANGE_ZONE`). Eram 60, 60 e 100, e a seleção por laço passa de 60 fácil num campo de fichas:
a seleção inteira era recusada com `INVALID_PAYLOAD`.

**`INTENT_REORDER` e `INTENT_SET_TURN_ORDER` recusam ids repetidos.** A checagem era só de contagem:
`[A, A, B]` sobre `[A, B, C]` passava no reorder — C sumia da ordem continuando na zona, e A era
comprado duas vezes —, e `['p1', 'p2', 'p2']` dava o mesmo assento a dois jogadores, inclusive dois
anfitriões.

### 3.2.1 Intenções de visibilidade — a família mais sensível

Todas implementam `RN13`: **a visibilidade só é concedida por ação explícita e registrada.** Nenhuma
delas move carta de zona; elas alteram apenas `peekedBy` / `revealedTo`.

| Intenção                     | Payload                                    | Concede                                                                                                          | Log                                                                                                                                      | Expira                                                          |
| ---------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `INTENT_PEEK`                | `{ zone, amount, from?: "TOP"\|"BOTTOM" }` | `peekedBy += sid` nas N cartas                                                                                   | "olhou as N do topo"                                                                                                                     | `_CLOSE_PEEK` · 120 s · troca de zona                           |
| `INTENT_CLOSE_PEEK`          | `{}`                                       | **Revoga** `peekedBy` do remetente                                                                               | —                                                                                                                                        | —                                                               |
| `INTENT_ARRANGE_PEEKED`      | `{ ids[], destino: "TOP"                   | "BOTTOM", aleatorio? }`                                                                                          | Nada novo: reordena **só cartas que o remetente olha agora** (`peekedBy`). Manual mantém a olhada; `aleatorio` usa o CSPRNG e **revoga** | "reordenou N no topo" / "colocou N no fundo em ordem aleatória" | —   |
| `INTENT_SCRY`                | `{ amount }`                               | `peekedBy` + abre a **sessão de scry** com os ids exatos mostrados (invariante 9)                                | "fez scry N"                                                                                                                             | `_SCRY_COMMIT` · 120 s                                          |
| `INTENT_SCRY_COMMIT`         | `{ toBottom: id[], topOrder: id[] }`       | Aplica e **revoga**. As duas listas na ordem da tela (a primeira de `toBottom` é a mais alta do bloco do fundo)  | "colocou N no fundo" _(contagem, não identidade)_                                                                                        | —                                                               |
| `INTENT_SURVEIL`             | `{ amount }`                               | `peekedBy` + abre a sessão de surveil                                                                            | "fez surveil N"                                                                                                                          | `_SURVEIL_COMMIT` · 120 s                                       |
| `INTENT_SURVEIL_COMMIT`      | `{ toGraveyard: id[], topOrder: id[] }`    | Aplica e **revoga**                                                                                              | "moveu N ao cemitério"                                                                                                                   | —                                                               |
| `INTENT_SEARCH_ZONE`         | `{ zone, filter? }`                        | `peekedBy` na zona **inteira**                                                                                   | "está procurando no grimório"                                                                                                            | `_CLOSE_PEEK` · 120 s                                           |
| `INTENT_REVEAL`              | `{ ids[], to: "ALL" \| sid[] }`            | `revealedTo`                                                                                                     | "revelou N carta(s)" + nomes se `ALL`                                                                                                    | `_UNREVEAL` · troca de zona                                     |
| `INTENT_REVEAL_ZONE`         | `{ zone, to }`                             | `revealedTo` na zona inteira                                                                                     | "revelou a mão"                                                                                                                          | idem                                                            |
| `INTENT_REVEAL_TOP`          | `{ amount }`                               | `revealedTo = "ALL"` nas N do topo                                                                               | "revelou o topo: {nomes}"                                                                                                                | troca de zona                                                   |
| `INTENT_UNREVEAL`            | `{ ids[] }`                                | **Revoga** `revealedTo`                                                                                          | "ocultou N carta(s)"                                                                                                                     | —                                                               |
| `INTENT_SET_ZONE_VISIBILITY` | `{ zone, to }`                             | Jogar com a zona aberta                                                                                          | "está jogando com o grimório revelado"                                                                                                   | manual                                                          |
| `INTENT_SET_TOP_REVEALED`    | `{ ligado }`                               | Modo contínuo: a carta do topo do grimório fica `revealedTo = "ALL"` e o servidor **reconcilia a cada intenção** | "está jogando com o topo revelado" / "parou de jogar com o topo revelado"                                                                | `{ ligado:false }`                                              |

**Invariantes obrigatórias desta família:**

1. **Não existe intenção para olhar zona oculta alheia.** O vocabulário do protocolo não tem essa
   frase — é o que torna a trapaça inexprimível, não apenas proibida.
2. `_PEEK` e `_SEARCH_ZONE` só são aceitas do `ownerId` da zona.
3. Todo `peekBuffer` tem **timeout de 120 s**; ao expirar, o servidor confirma a ordem original e
   revoga. Buffer eterno travaria o grimório.
4. Log de `_SCRY_COMMIT` e `_SURVEIL_COMMIT` publica **contagem**, nunca identidade.
5. `revealedTo` e `peekedBy` são **zerados** em qualquer `INTENT_CHANGE_ZONE` (`DOC-032` §4.1.2).
6. O resultado da olhada chega ao autor por **patch filtrado**, não por `broadcast`.
7. **`_SET_TOP_REVEALED` não revela nada por si.** A intenção só liga um interruptor no `Player`
   (`topoRevelado`). Quem revela é um **reconciliador** chamado depois de TODA intenção, no mesmo
   ponto único de despacho da sala: ele revoga a concessão da carta que deixou de ser o topo e
   concede à que passou a ser. Sem isso o modo duraria uma compra — e um handler por intenção que
   mexe no grimório (`_DRAW`, `_MILL`, `_SHUFFLE`, `_MOVE_TOP_TO_BOTTOM`, `_CHANGE_ZONE`,
   `_SCRY_COMMIT`, `_SURVEIL_COMMIT`, `_MULLIGAN`, `_RETURN_ZONE`…) seria uma lista que só cresce e
   sempre esquece um caso.
8. **A condição de saída do reconciliador olha a CARTA, não o id guardado.** `INTENT_SHUFFLE` chama
   `limparConcessoes` em todas as cartas: se o embaralhamento devolvesse a mesma carta ao topo, um
   `topoReveladoId === topo` bastaria para o reconciliador sair sem fazer nada, deixando o modo
   ligado e nada revelado. Ele só sai cedo se a carta do topo **ainda estiver** com
   `revealedTo = "ALL"` — o que o torna auto-corretivo depois de qualquer handler que limpe
   concessões.
9. **O commit do scry/surveil só vale contra a sessão que o abriu.** `_SCRY` e `_SURVEIL` guardam,
   por jogador, os ids exatos mostrados. O commit só é aplicado se o payload for uma **permutação
   exata** desses ids (sem repetição) **e** eles ainda forem o topo do grimório; senão o scry é
   cancelado, as olhadas revogadas e o remetente recebe `INVALID_PAYLOAD`. Antes o commit só
   perguntava "estas cartas estão no meu grimório?": comprar no meio recusava o commit e deixava
   `peekedBy` nas outras cartas para sempre; embaralhar no meio devolvia as cartas do scry ao topo;
   e o mesmo id em `toBottom` e `topOrder` duplicava a carta. Grimório vazio responde com erro, em vez
   de abrir um "Scry 0". Os dois commits são **irreversíveis** (`NAO_REVERSIVEIS` em
   `services/undo.ts`): desfazer devolveria a ordem antiga sem devolver a sessão.

### 3.3 Propriedades de carta

| Intenção                 | Payload                                           | Efeito                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `INTENT_TAP`             | `{ entityId, isTapped }`                          | Define `isTapped`                                                                                                                                                                                                        |
| `INTENT_UPDATE_PROPERTY` | `{ entityId, property, value }`                   | `property` ∈ {`isTapped`, `faceDown`, `rotation`}. `faceDown` é **ignorado** fora de `BATTLEFIELD`/`EXILE` (`DOC-032` §3.0.1, cláusula 3)                                                                                |
| `INTENT_ADD_COUNTER`     | `{ entityId, name, amount }`                      | `name` é **string livre** validada por `^[a-z0-9_+\-]{1,24}$` — Magic tem 100+ tipos nomeados de contador e um enum quebra a cada coleção (`DOC-036` §5.1). `amount` pode ser negativo; total fixado em ≥ 0              |
| `INTENT_SET_CONTROLLER`  | `{ entityId, controllerId }`                      | Transferência explícita de controle (`RN08`)                                                                                                                                                                             |
| `INTENT_GIVE_CARD`       | `{ entityId, targetPlayerId, faceDown?, x?, y? }` | Entrega uma permanente do campo. `faceDown`: entregue virada, só quem recebe a vê. `x`/`y` relativos à faixa de quem recebe (arraste até a faixa do oponente). Limpa o _lock_ — a carta chegava travada até o TTL vencer |
| `INTENT_BATCH_UPDATE`    | `{ entityIds[], property, value }` (1–200)        | Uma mensagem para seleção múltipla (`F25`) — evita estourar o limite de 30/s. `faceDown` só vale em `BATTLEFIELD`/`EXILE`, como acima                                                                                    |
| `INTENT_UNTAP_ALL`       | `{}`                                              | Desvira todas as cartas próprias no `BATTLEFIELD` (`F30`)                                                                                                                                                                |

### 3.4 Estado do jogador

| Intenção                      | Payload                                 | Efeito                                                                             |
| ----------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| `INTENT_SET_LIFE`             | `{ delta }` ou `{ absolute }`           | Ajusta vida; log "vida 40 → 37"                                                    |
| `INTENT_SET_COMMANDER_DAMAGE` | `{ fromPlayerId, delta, commanderId? }` | Atualiza a matriz de dano de comandante **e a vida** pelo mesmo delta (ver abaixo) |
| `INTENT_SET_PLAYER_COUNTER`   | `{ type, delta }`                       | `type` ∈ {`POISON`, `ENERGY`, `EXPERIENCE`, `RAD`, `TICKET`}                       |
| `INTENT_TOGGLE_DESIGNATION`   | `{ type }`                              | `type` ∈ {`MONARCH`, `INITIATIVE`} — transfere ao remetente                        |
| `INTENT_SET_COMMANDER_TAX`    | `{ delta }`                             | Ajusta o +2 cumulativo                                                             |

**`INTENT_SET_COMMANDER_DAMAGE`:**

- A chave em `Player.commanderDamage` é o **`Card.id` do comandante** quando `commanderId` vem e a
  carta é comandante de `fromPlayerId`; senão, `fromPlayerId`. Com parceiros a chave era uma só, e
  11 de Tymna + 10 de Thrasios somavam 21 e eliminavam — a regra 903.10a conta cada comandante
  separado.
- O dano **também muda a vida** pelo mesmo delta (regra 120.3). Antes o contador só mexia nos 21: o
  jogador marcava +5 e continuava com 40. No mesmo handler, para o desfazer e o "−" corrigirem as
  duas coisas juntas.
- Dano de quem **já saiu da sala** ainda pode ser corrigido. A checagem exigia o jogador presente, e
  21 de alguém que foi embora deixava o alvo eliminado para sempre.

### 3.5 Objetos criados

| Intenção               | Payload                                                             | Efeito                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INTENT_CREATE_TOKEN`  | `{ scryfallId?, name?, power?, toughness?, colors?, amount, x, y }` | Cria fichas com `isToken = true`; `power`/`toughness` viram P/T sobreposto (`hasPtOverride`) — antes eram descartados. A partir da 2ª ficha, escadeia **+0,03** por ficha (partindo do centro se `x = y = 0`) |
| `INTENT_COPY_CARD`     | `{ entityId }`                                                      | Duplica como **ficha do remetente** marcada como cópia (ver abaixo)                                                                                                                                           |
| `INTENT_DESTROY_TOKEN` | `{ entityId }`                                                      | Remove ficha                                                                                                                                                                                                  |
| `INTENT_CLEAR_TOKENS`  | `{}`                                                                | Remove todas as fichas próprias                                                                                                                                                                               |

**`INTENT_COPY_CARD`** só copia carta em **zona pública** que o remetente **pode ver** (`podeVer`), e
a cópia é sempre `isToken = true` com `ownerId = controllerId = remetente`, deslocada **+0,03** do
original (do centro, se ele não tinha coordenada). Só `podeVer` não bastava: uma carta da mão
revelada só para quem copiava virava, pela cópia, uma ficha de face para cima diante da mesa toda. Antes ela herdava o dono e o
`isToken` do original: a cópia de uma carta real era uma carta real do oponente, e ao morrer caía no
cemitério dele como uma segunda via. E como a cópia levava `scryfallId` e `faceDown` do original com o
remetente como controlador, copiar o morph do oponente era um jeito de ver o que ele era. A cópia de
carta virada agora é o que a regra diz (708.2): uma 2/2 virada, sem identidade.

### 3.6 Aleatoriedade e comunicação

| Intenção              | Payload                                | Efeito                                                                                                                                                         |
| --------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INTENT_ROLL_DICE`    | `{ sides }` — ∈ {2,4,6,8,10,12,20,100} | Sorteio no servidor; resultado no log e em evento de animação                                                                                                  |
| `INTENT_FLIP_COIN`    | `{}`                                   | Cara ou coroa no servidor                                                                                                                                      |
| `INTENT_CHAT`         | `{ text }` — máx. 500 caracteres       | Mensagem sanitizada, publicada a todos                                                                                                                         |
| `INTENT_PING`         | `{ x, y, targetId? }`                  | Marcador visual efêmero (`F13`)                                                                                                                                |
| `INTENT_ARROW`        | `{ fromId, toId, color? }`             | **Seta de alvo** persistente — é como se diz "isto ataca aquilo" sem motor de regras (`DOC-036` §11.1)                                                         |
| `INTENT_CLEAR_ARROWS` | `{ scope: "MINE" \| "COMBAT" }`        | Limpa setas; as de combate são limpas ao passar o turno                                                                                                        |
| `INTENT_PASS_TURN`    | `{}`                                   | Avança o marcador visual de turno e limpa setas de combate; **pula eliminados** (ver abaixo)                                                                   |
| `INTENT_UNDO`         | `{}`                                   | Desfaz a **última** ação própria, janela de 10 s. **Não desfaz** ação aleatória, revelação, compra, ficha, estado da mesa… — lista e motivos em `DOC-032` §3.2 |
| `INTENT_SET_TURN`     | `{ turn?, phase? }`                    | Marcador **puramente visual** de turno (`F29`)                                                                                                                 |

**`INTENT_PASS_TURN` pula quem já está fora.** A vez ia para o próximo assento mesmo eliminado — e
quem perdeu costuma sair da tela ou só assistir: a mesa inteira esperava alguém que não ia mais
jogar. Se todos os outros estiverem eliminados, a vez anda normalmente. A rodada (`turn`) sobe quando
a ordem **dá a volta** — inclusive quando o pulo de um eliminado passa por cima do assento 0, caso
em que a regra antiga ("o próximo é o assento 0") nunca contava a rodada.

### 3.7 Ciclo de partida

| Intenção             | Payload | Efeito                                                                                                     |
| -------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `INTENT_RESET_MATCH` | `{}`    | Reinicia a **mesa** inteira, não só os contadores (`DOC-032` §6). Requer confirmação de todos os presentes |
| `INTENT_LEAVE`       | `{}`    | Saída deliberada — libera a vaga sem aguardar a janela de reconexão                                        |

#### `INTENT_SET_ROOM_CONFIG` — as regras que a mesa combina

```ts
{
  tipoDeMulligan?: 'COMMANDER' | 'LONDON' | 'LIVRE';
  jogadorInicial?: string;      // '' = sortear; senão um sessionId da mesa
  ordemPelosAssentos?: boolean; // true = o assento 0 começa, sem sorteio
  sideboardPermitido?: boolean;
  cronometroDeTurno?: number;   // 0 | 60 | 120 | 180 | 300, em segundos
  maxSeats?: number;            // 1..MAX_PLAYERS, preso à faixa `jogadores` do formato
  vidaInicial?: number;         // 1..999; 0 volta à do formato. Só na sala de espera
}
```

**Vida inicial combinada.** A mesa livre prometia "vida configurável" no resumo do
formato e não havia onde configurar; nenhuma mesa jogava regra da casa. Gravar
`vidaInicial` na sala de espera já atualiza a vida de todos os sentados (o lobby
mostra `Player.life`), e START_MATCH, RESET_MATCH e quem entra no meio usam
`vidaInicialDaMesa(state)` — a combinada, ou a do formato quando é 0.

`INTENT_SET_LIFE { absolute }` aceita até ±99.999 (era ±999): somando cliques a vida
passava de 999, e o valor digitado por cima era recusado.

**Uma intenção para os cinco controles, e não cinco.** As opções são um
formulário do anfitrião, preenchido de uma vez: cinco intenções seriam cinco
viagens ao servidor e cinco oportunidades de a mesa ver a configuração pela
metade enquanto os patches chegam.

| Regra                                              | Rejeição          |
| -------------------------------------------------- | ----------------- |
| Só o anfitrião (assento 0), via `exigirAnfitriao`  | `NOT_HOST`        |
| Só em `phase === 'WAITING'` (exceto `maxSeats`)    | `CONFIG_LOCKED`   |
| `jogadorInicial` tem de existir em `state.players` | `INVALID_PAYLOAD` |
| `cronometroDeTurno` só da lista fechada            | recusado pelo zod |
| `maxSeats` abaixo dos jogadores já sentados        | `INVALID_PAYLOAD` |

`CONFIG_LOCKED` existe porque trocar o tipo de mulligan com a partida em
andamento muda a regra no meio do jogo — sobre decisões que os outros já
tomaram com base no combinado anterior.

**`maxSeats` é o único campo aceito com a partida em `PLAYING`**: abrir uma
vaga para quem chegou atrasado não muda nada do que já foi jogado. O valor é
preso à faixa `jogadores` do formato e nunca fica abaixo de quem já está
sentado (fechar assento ocupado seria expulsar, que é outra ação). Ao mudar, a
sala republica o metadado da lista pública. Antes `maxSeats` era gravado uma
vez, na criação, e o formulário nasce em 4: o quinto jogador levava
`ROOM_FULL` e a única saída era fechar a mesa e criar outra.

**O `tipoDeMulligan` padrão é do formato:** `COMMANDER` quando o formato tem zona de comando,
`LONDON` nos outros. Ele nascia `COMMANDER` em toda sala, e uma mesa de Modern 1v1 dava o primeiro
mulligan de graça — que a regra 103.5c só concede com zona de comando. O anfitrião continua podendo
trocar na sala de espera.

A lista de cronômetros é fechada em vez de um inteiro com faixa: um campo
aberto convida ao `1`, e um cronômetro de um segundo transforma o aviso — a
única coisa que ele faz — em ruído permanente para a mesa inteira.

#### O que `INTENT_START_MATCH` passou a respeitar

Ele fazia `activePlayerId = eu.id`: **quem clicava começava**. Como só o
anfitrião pode clicar, o anfitrião começava sempre — uma vantagem silenciosa
dele em todas as partidas. Agora, nesta ordem:

1. `jogadorInicial` preenchido → ele começa;
2. `ordemPelosAssentos` ligado → o assento 0 começa;
3. nenhum dos dois → **sorteio** por `services/rng.ts` (RN06), registrado no log.

Ele também grava `turnoIniciadoEm`, junto com `INTENT_PASS_TURN`.

**`INTENT_KEEP_HAND` só vale em `PLAYING`.** Marcado na sala de espera, o `keptHand` fechava a janela
de mulligan da partida que ainda ia começar.

#### A plateia tem teto próprio

`maxClients` é assentos + plateia (`MAX_PLAYERS + MAX_ESPECTADORES`), e com a
mesa ainda sem jogadores a sala aceitava dezoito espectadores. O `onAuth`
recusa com `ROOM_FULL` o passe de espectador quando já há
`MAX_ESPECTADORES` (10) assistindo.

#### A votação vencida é encerrada pelo servidor

A Room agenda o fim da votação no prazo (`votacaoExpiraEm`) e limpa os campos.
Antes ela só era varrida no voto seguinte, e o painel do cliente decidia sumir
comparando o prazo com o relógio do NAVEGADOR — quem estava com o relógio
adiantado nunca via a votação. O cliente agora trata "aberta" como
`votacaoAlvo !== ''`.

#### Espectador não emite intenção

Quem entra com um passe de espectador (claim `spectator` no seat token) é
barrado no despachante, **antes** do parse do payload, em toda intenção menos
`INTENT_CHAT`. A rejeição é `SPECTATOR`.

A barreira não está em `verificarAutorizacao` porque ela devolve `null` na hora
para `QUALQUER_JOGADOR`, sem checar se o remetente é mesmo um jogador — o nome
da regra sempre foi uma promessa que ninguém verificava, e não precisava ser
verificada enquanto todo mundo na sala tinha assento.

#### `INTENT_VOTE_KICK` — remover por votação

```ts
// autorização QUALQUER_JOGADOR · irreversível (NAO_REVERSIVEIS em services/undo.ts)
interface VoteKickPayload {
  playerId: string; // sessionId do alvo
  aceitar: boolean;
}
```

Só o anfitrião removia alguém (`INTENT_KICK_PLAYER`). Numa mesa em que o
problema é o próprio anfitrião — ou em que ele saiu para o café —, os outros
não tinham saída.

| Regra                                                                    | Por quê                                                                      |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| A primeira chamada abre a votação e vale como o "sim" de quem propôs     | Propor e votar sim são o mesmo gesto                                         |
| Prazo de **60 s**; uma votação por vez                                   | Votação esquecida aberta seria uma ameaça pendurada sobre a mesa             |
| Votam os jogadores **conectados**, menos o alvo                          | Exigir o voto de quem caiu travaria justamente a mesa que está se desfazendo |
| Um "não" encerra                                                         | "Todos concordam" sem virar maioria                                          |
| O alvo não vota                                                          | O voto dele é sempre "não" — contá-lo seria dar veto ao próprio alvo         |
| Todos os votantes disseram "sim" → o alvo sai pelo mesmo caminho do kick | E a **conta** fica bloqueada na sala (`PLAYER_BLOCKED`, §2.1)                |

O estado da votação vive no `RoomState` (`votacaoAlvo`, `votacaoAutor`,
`votacaoSim`, `votacaoExpiraEm` — `DOC-032` §3), e não numa mensagem: quem
reconecta no meio precisa ver a votação que está correndo.

**Decisão registrada:** numa mesa de dois, o único votante é quem propôs, e a
votação passa na hora. É a leitura literal de "todos os outros concordam", e é
o mesmo que a mesa de dois já podia fazer saindo da sala.

### 3.7.1 Intenções restantes por família

Completam o contrato para as 131 ações de `DOC-036`. Agrupadas por família para leitura; a
implementação segue o mesmo `registry.ts`.

**Propriedades de carta**

| Intenção               | Payload                             | Efeito                                                      |
| ---------------------- | ----------------------------------- | ----------------------------------------------------------- |
| `INTENT_TAP_ALL`       | `{}`                                | Vira todas as cartas próprias no `BATTLEFIELD`              |
| `INTENT_TRANSFORM`     | `{ entityId }`                      | Alterna `isFlipped` — mostra a outra face de uma DFC        |
| `INTENT_MELD`          | `{ ids: [a, b], resultScryfallId }` | Remove as duas e cria o objeto fundido                      |
| `INTENT_ATTACH`        | `{ childId, parentId }`             | Define `attachedTo`; o grupo se move junto                  |
| `INTENT_DETACH`        | `{ childId }`                       | Limpa `attachedTo`. Só quem controla `childId` (ver abaixo) |
| `INTENT_GROUP`         | `{ ids[] }`                         | Pilha visual                                                |
| `INTENT_SET_PT`        | `{ entityId, power, toughness }`    | P/T sobreposto (fichas e cópias)                            |
| `INTENT_SET_DAMAGE`    | `{ entityId, amount }`              | Dano marcado, distinto de `-1/-1`                           |
| `INTENT_CLEAR_DAMAGE`  | `{}`                                | Limpa dano de todas as próprias (fim de turno)              |
| `INTENT_SET_NOTE`      | `{ entityId, text }`                | Anotação livre, ≤ 120 caracteres, sanitizada                |
| `INTENT_SET_HIGHLIGHT` | `{ entityId, color }`               | Cor de destaque, `^[a-z]{3,12}$`                            |
| `INTENT_SET_COMMANDER` | `{ entityId }`                      | Marca a carta como comandante                               |

**`INTENT_DETACH` é `QUALQUER_JOGADOR` + checagem de controle no handler**, como o `INTENT_ATTACH`.
Com `'CONTROLLER'` o autorizador lia `payload.entityId`, mas o payload é `{ childId }`: todo
desanexar voltava `ENTITY_NOT_FOUND` e a aura continuava presa.

**Contadores**

| Intenção                    | Payload                         | Efeito                                                                      |
| --------------------------- | ------------------------------- | --------------------------------------------------------------------------- |
| `INTENT_SET_COUNTER`        | `{ entityId, name, value }`     | Valor absoluto; remove a chave se 0                                         |
| `INTENT_CLEAR_COUNTERS`     | `{ entityId }`                  | Limpa o mapa `counters`                                                     |
| `INTENT_ADD_PLAYER_COUNTER` | `{ name, amount }`              | Contador **no jogador** — `POISON`, `ENERGY`, `EXPERIENCE`, `RAD`, `TICKET` |
| `INTENT_BATCH_COUNTER`      | `{ entityIds[], name, amount }` | Lote (1–200), um só _patch_. Remove a chave ao chegar a **≤ 0**             |

`name` é `PlayerCounter`, **em maiúsculas**: esta linha mostrava `poison`, `energy`…, que o zod
recusa. `INTENT_ADD_PLAYER_COUNTER` e `INTENT_SET_PLAYER_COUNTER` passam pelo **mesmo** helper, e os
dois registram log. Eram dois `switch` escritos à mão que divergiram: o `ADD` — o que a interface
chama — mandava `RAD` e `TICKET` para um `default: return`, e Radiação e Ingresso não respondiam ao
clique, sem erro e sem log.

O `INTENT_BATCH_COUNTER` removia o marcador só em `=== 0`: Shift+A ("tirar um +1/+1") numa carta sem
marcador gravava `-1`. Agora é `<= 0`, como no `INTENT_ADD_COUNTER`.

**Jogador e designações** — todos marcadores visuais, sem efeito imposto (`RN01`)

| Intenção                   | Payload                                    | Efeito                                                   |
| -------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| `INTENT_SET_RING`          | `{ level: 0..4, bearerId? }`               | _O Anel te tenta_ + Portador                             |
| `INTENT_SET_DAY_NIGHT`     | `{ value: "DAY" \| "NIGHT" \| "NEITHER" }` | Ciclo dia/noite                                          |
| `INTENT_SET_SPEED`         | `{ value: 0..4 }`                          | _Start your engines!_                                    |
| `INTENT_VENTURE`           | `{ dungeon, room }`                        | Avança na masmorra                                       |
| `INTENT_SET_MAX_HAND_SIZE` | `{ value }`                                | Tamanho máximo de mão                                    |
| `INTENT_SET_TURN_ORDER`    | `{ order: sid[] }`                         | Define a ordem de turno; recusa ids repetidos (§3.2)     |
| `INTENT_CONCEDE`           | `{}`                                       | Marca o jogador como eliminado; **não** o remove da sala |

**Objetos criados**

| Intenção               | Payload          | Efeito                  |
| ---------------------- | ---------------- | ----------------------- |
| `INTENT_CREATE_EMBLEM` | `{ scryfallId }` | Emblema de planeswalker |

**Aleatoriedade** — tudo via `crypto.randomInt` (`RN06`)

| Intenção                | Payload             | Efeito                                 |
| ----------------------- | ------------------- | -------------------------------------- |
| `INTENT_RANDOM_PLAYER`  | `{}`                | Sorteia um jogador; resultado no log   |
| `INTENT_RANDOM_CARD`    | `{ zone, filter? }` | Sorteia uma carta da zona própria      |
| `INTENT_DISCARD_RANDOM` | `{ amount }`        | Descarta N aleatórias da própria mão   |
| `INTENT_DISCARD_ALL`    | `{}`                | Descarta a mão inteira                 |
| `INTENT_PLANESWALK`     | `{}`                | Vira o próximo plano do baralho planar |
| `INTENT_DRAW_SCHEME`    | `{}`                | Vira o próximo esquema (Archenemy)     |

**Ciclo e formato**

| Intenção                      | Payload              | Efeito                                                                              |
| ----------------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| `INTENT_CAST_COMMANDER`       | `{ entityId }`       | `COMMAND` → `BATTLEFIELD` e **incrementa `commanderTax` em 2**                      |
| `INTENT_FETCH_FROM_SIDEBOARD` | `{ scryfallId, to }` | Puxa do sideboard durante a partida — atende _Wish_, _Learn_, _Karn_ (`DOC-037` §8) |
| `INTENT_SHUFFLE`              | `{ zone, keepTop? }` | Alias canônico de `INTENT_SHUFFLE_ZONE`                                             |

**Arrastar também conjura.** `INTENT_CHANGE_ZONE` (e o lote) de `COMMAND` para `BATTLEFIELD` com
uma carta `isCommander` soma 2 ao `commanderTax` do DONO, como o botão. Só o botão somava, e arrastar
é o gesto que quase todo mundo usa — o imposto ficava em zero a partida inteira.

> **Nota de nomenclatura:** `INTENT_SHUFFLE` e `INTENT_SHUFFLE_ZONE` são o **mesmo** comando.
> Padronize em `INTENT_SHUFFLE` no `registry.ts` e mantenha o outro apenas como alias de
> compatibilidade, ou remova antes do primeiro release. Dois nomes para uma ação é dívida.

### 3.8 Exemplo de validação

```ts
// game-server/src/intents/schemas.ts
import { z } from 'zod';

export const MoveCardIntent = z.object({
  entityId: z.string().uuid(),
  x: z.number().finite().min(-10_000).max(10_000),
  y: z.number().finite().min(-10_000).max(10_000),
});

export const AddCounterIntent = z.object({
  entityId: z.string().uuid(),
  // chave livre, nao enum: ha 100+ tipos de contador em Magic (DOC-036 5.1).
  // A validacao de formato tambem barra XSS e poluicao de cardinalidade em metricas.
  name: z.string().regex(/^[a-z0-9_+\-]{1,24}$/),
  amount: z.number().int().min(-99).max(99),
});

export const PeekIntent = z.object({
  zone: z.enum(['LIBRARY', 'GRAVEYARD', 'EXILE']),
  amount: z.number().int().min(1).max(100),
  from: z.enum(['TOP', 'BOTTOM']).default('TOP'),
});

export const RevealIntent = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  to: z.union([z.literal('ALL'), z.array(z.string()).min(1).max(7)]),
});

export const ArrowIntent = z.object({
  fromId: z.string().uuid(),
  toId: z.string().uuid(),
  color: z
    .string()
    .regex(/^[a-z]{3,12}$/)
    .optional(),
});

export const DrawIntent = z.object({ amount: z.number().int().min(1).max(100) });
export const RollDiceIntent = z.object({
  sides: z.union([
    z.literal(2),
    z.literal(4),
    z.literal(6),
    z.literal(8),
    z.literal(10),
    z.literal(12),
    z.literal(20),
    z.literal(100),
  ]),
});
```

---

## 4. Servidor → cliente

### 4.1 Patches de estado (automáticos)

O Colyseus **não** envia JSON massivo a cada milissegundo. Ele usa **Fossil Delta**: se apenas a
propriedade `x` de uma carta mudou, o pacote carrega apenas a referência da entidade, o campo e o novo
valor — em binário, poucos bytes.

Conceitualmente: `[refId, fieldIndex, novoValor]`.

O cliente consome isso via _callbacks_ do `colyseus.js`:

```ts
room.state.cards.onAdd((card, id) => renderer.addSprite(id, card));
room.state.cards.onRemove((card, id) => renderer.removeSprite(id));
room.state.cards.onChange((card, id) => renderer.updateSprite(id, card));
room.state.players.onChange((player, id) => ui.updatePanel(id, player));
```

**Taxa de envio (`patchRate`):** 50 ms (20 Hz). Mutações dentro da mesma janela são agrupadas em um
único _patch_ — arrastar uma carta não gera 60 pacotes por segundo.

### 4.2 Eventos efêmeros (mensagens nomeadas)

Coisas que **não** fazem parte do estado durável da mesa:

| Evento                                     | Payload                                        | Uso                                           |
| ------------------------------------------ | ---------------------------------------------- | --------------------------------------------- |
| `log`                                      | `{ id, timestamp, type, actorId, text }`       | Entrada no painel de log/chat                 |
| `chat`                                     | `{ id, timestamp, actorId, text }`             | Mensagem de usuário                           |
| `dice`                                     | `{ actorId, sides, result }`                   | Dispara a animação do dado                    |
| `ping`                                     | `{ actorId, x, y, targetId? }`                 | Marcador visual efêmero                       |
| `revealToOwner`                            | `{ cards: [{ id, scryfallId }], motivo: "PEEK" | "SEARCH"                                      | "RANDOM", zone, from? }` | Resultado de olhar, buscar ou sortear — **enviado só ao dono**. Só `PEEK` e `RANDOM` abrem o painel de olhada; a busca é do inspetor de zona |
| `warning`                                  | `{ code, message }`                            | Ex.: `RATE_LIMITED` por excesso de intenções  |
| `error`                                    | `{ code, message, intent? }`                   | Intenção rejeitada                            |
| `playerJoined` / `playerLeft`              | `{ playerId, name }`                           | Notificação de presença                       |
| `playerDisconnected` / `playerReconnected` | `{ playerId }`                                 | Estado de conexão                             |
| `roomClosing`                              | `{ reason, inSeconds }`                        | Aviso de encerramento ou drenagem para deploy |

**Por que separar de estado:** um dado rolado não é estado da mesa — é um acontecimento. Colocá-lo no
`Schema` obrigaria a decidir quando removê-lo e geraria _patches_ inúteis.

### 4.3 Catálogo de mensagens de log

Todas neutras (`RN09`), sem revelar informação oculta:

| `type`               | Texto                                                      | Revela carta?                              |
| -------------------- | ---------------------------------------------------------- | ------------------------------------------ |
| `DRAW`               | "{Jogador} comprou {N} carta(s)"                           | ❌                                         |
| `PLAY`               | "{Jogador} jogou {Carta}"                                  | ✅ _(já é pública no Battlefield)_         |
| `ZONE_CHANGE`        | "{Jogador} moveu {Carta} de {Zona} para {Zona}"            | ✅ só se ambas as zonas forem públicas     |
| `ZONE_CHANGE_HIDDEN` | "{Jogador} moveu uma carta para {Zona}"                    | ❌                                         |
| `DISCARD`            | "{Jogador} descartou {Carta}"                              | ✅ _(cemitério é público)_                 |
| `MILL`               | "{Jogador} moveu {N} cartas do grimório para o cemitério"  | ❌ _(as cartas ficam públicas no destino)_ |
| `SHUFFLE`            | "{Jogador} embaralhou o grimório"                          | ❌                                         |
| `PEEK`               | "{Jogador} olhou o topo do grimório"                       | ❌                                         |
| `SEARCH`             | "{Jogador} está procurando no grimório"                    | ❌                                         |
| `TAP` / `UNTAP`      | "{Jogador} virou/desvirou {Carta}"                         | ✅                                         |
| `COUNTER`            | "{Jogador} colocou {N} marcador(es) {tipo} em {Carta}"     | ✅                                         |
| `LIFE`               | "{Jogador}: vida {antes} → {depois}"                       | —                                          |
| `CMD_DAMAGE`         | "{Jogador} recebeu {N} de dano de comandante de {Jogador}" | —                                          |
| `DICE`               | "{Jogador} rolou D{N} e tirou {R}"                         | —                                          |
| `TOKEN`              | "{Jogador} criou {N}× {ficha}"                             | —                                          |
| `SYSTEM`             | "{Jogador} entrou/saiu da mesa"                            | —                                          |

---

## 5. Ocultação de informação (segurança anti-cheat)

### 5.1 Regra crítica

> O servidor **NUNCA** enviará `scryfallId` nem `name` de uma carta em zona oculta (`HAND` ou
> `LIBRARY`) para um cliente que não seja o dono. Ele mascara, enviando apenas
> `{ id, zone, ownerId, faceDown }`.

Isto não é uma recomendação — é `RN02`, `FR-06` e `ADR-004`. Implementação em
[especificacao_do_motor_sandbox.md](especificacao_do_motor_sandbox.md) §2.

### 5.2 O que cada cliente vê da mesma carta

Carta de Jogador 1 na `HAND`:

```json
// pacote que chega ao Jogador 1 (dono)
{ "id": "uuid-123", "zone": "HAND", "ownerId": "p1", "scryfallId": "d5a0f3e2-...", "faceDown": false }

// pacote que chega aos Jogadores 2, 3 e 4
{ "id": "uuid-123", "zone": "HAND", "ownerId": "p1" }
```

Não é "o mesmo pacote com um campo ignorado". São **pacotes diferentes**, serializados por cliente.
Abrir o DevTools do Jogador 2 não revela nada.

### 5.3 O que permanece público

| Informação                                                 | Motivo                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| `hand.length` / `handCount`                                | O jogo exige saber quantas cartas o oponente tem na mão      |
| `library.length` / `libraryCount`                          | Relevante para a partida                                     |
| Existência do objeto (`id`)                                | Necessária para desenhar o verso da carta na posição correta |
| Conteúdo de `GRAVEYARD`, `EXILE`, `BATTLEFIELD`, `COMMAND` | São zonas públicas por definição                             |

### 5.4 Cuidado com o vazamento por evento

O `@filter` protege o **estado**. Eventos efêmeros precisam de disciplina manual:

- `revealToOwner` é enviado com `client.send()` **para um cliente específico**, nunca com `broadcast`.
- Mensagens de log de ação em zona oculta usam a variante `_HIDDEN` (§4.3).
- **Nunca** incluir nome de carta em `warning` ou `error` de intenção sobre zona oculta.

### 5.5 Espectadores (V2)

Espectador recebe o filtro **mais restritivo**: nenhuma zona oculta de ninguém, jamais. O `@filter`
verifica `client.sessionId === ownerId`; como o espectador não é dono de nada, ele naturalmente não
recebe — mas o teste de auditoria deve cobrir isso explicitamente.

---

## 6. Tratamento de erros e limites

| Situação                                       | Comportamento                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| _Payload_ inválido (Zod)                       | Descarta; envia `error { code: "INVALID_PAYLOAD" }` ao remetente        |
| Intenção sobre entidade inexistente            | Descarta; `error { code: "ENTITY_NOT_FOUND" }`                          |
| Intenção sem permissão (`controllerId` alheio) | Descarta; `error { code: "NOT_AUTHORIZED" }` + log de auditoria         |
| Intenção durante _lock_ de outro jogador       | Descarta **silenciosamente** (é disputa normal, não erro)               |
| Mais de 30 intenções/s                         | Descarta excedente; `warning { code: "RATE_LIMITED" }`                  |
| Mensagem acima de 4 KB                         | Fecha a conexão — só código malicioso faz isso                          |
| Intenção de jogador desconectado               | Descarta                                                                |
| Erro não tratado no _handler_                  | Captura, loga com `roomId`, envia `error` genérico. **A sala não cai.** |

**Princípio:** uma intenção malformada nunca deve derrubar a sala dos outros três jogadores.

---

## 7. Métricas do canal

Expostas em `/metrics` (`NFR-11`):

| Métrica                             | Tipo      | Uso                                           |
| ----------------------------------- | --------- | --------------------------------------------- |
| `ws_connections_active`             | Gauge     | CCU                                           |
| `ws_rooms_active`                   | Gauge     | Salas ativas                                  |
| `ws_intents_total{type}`            | Counter   | Volume por tipo de intenção                   |
| `ws_intents_rejected_total{reason}` | Counter   | Validação, autorização, _rate limit_          |
| `ws_patch_bytes_total`              | Counter   | Banda de saída (`NFR-05`)                     |
| `ws_patch_duration_seconds`         | Histogram | Custo de serialização, inclusive do `@filter` |
| `ws_room_tick_duration_seconds`     | Histogram | Saúde do _tick_                               |
| `ws_reconnections_total{result}`    | Counter   | Estabilidade (`RN10`)                         |

---

## 8. Checklist de implementação

- [ ] `onAuth` valida `seatToken` (assinatura, expiração, uso único, vínculo com `roomId`).
- [ ] Toda intenção tem _schema_ Zod e está no `registry.ts`.
- [ ] Nenhum _handler_ faz I/O (banco/HTTP) no caminho crítico (`DOC-021` §7).
- [ ] _Lock_ de arraste com TTL de 5 s e liberação em desconexão.
- [ ] _Rate limit_ de 30 intenções/s por cliente.
- [ ] `patchRate` em 50 ms.
- [ ] Heartbeat 15 s / timeout 45 s.
- [ ] `allowReconnection` de 600 s (`REALTIME_LIMITS.RECONNECTION_WINDOW_S`).
- [ ] `@filter` em **todo** campo sensível de `Card`.
- [ ] `revealToOwner` usa `client.send()`, nunca `broadcast`.
- [ ] Log com variante `_HIDDEN` para ação em zona oculta.
- [ ] **Teste de auditoria de pacote em CI** (`G1`): capturar tráfego de um oponente e assertar
      ausência de `scryfallId` e `name` de zona oculta.
- [ ] _Fuzzing_ de mensagens WS sem derrubar a sala.
- [ ] Métricas de §7 expostas.
