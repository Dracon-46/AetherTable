# Especificação do Motor de Estado (State Engine)

| Campo                       | Valor                                                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                      | `DOC-033`                                                                                                                                                                                                                                   |
| **Versão**                  | 1.1                                                                                                                                                                                                                                         |
| **Status**                  | Estável                                                                                                                                                                                                                                     |
| **Última revisão**          | 2026-08-20                                                                                                                                                                                                                                  |
| **Documentos relacionados** | [readme.md](readme.md) · [especificacao_do_motor_sandbox.md](especificacao_do_motor_sandbox.md) · [especificacao_websocket_e_eventos.md](especificacao_websocket_e_eventos.md) · [documento_de_arquitetura.md](documento_de_arquitetura.md) |

> **Escopo:** o **comportamento** do motor — qual intenção produz qual mutação, como o _lock_ impede
> desincronia, o que acontece em cada estado da sala. A **estrutura** do `Schema` (classes, campos,
> filtros) é canônica em [especificacao_do_motor_sandbox.md](especificacao_do_motor_sandbox.md).

---

## 1. O que este motor é

Como não há _rules engine_, o motor atua como **gerenciador de mutação de estado de memória
compartilhada**. Ele é um pequeno interpretador com três responsabilidades:

1. **Validar** a intenção (formato e autorização).
2. **Mutar** o `RoomState` de forma consistente.
3. **Registrar** o que aconteceu, em linguagem neutra.

Ele não sabe o que é uma criatura, nem o que é mana, nem o que é a pilha.

```
              ┌─────────────────────────────────────────────┐
   INTENT ───►│ 1. Zod    2. Autorização    3. Lock         │
              │                                             │
              │ 4. Handler → muta RoomState                 │
              │                                             │
              │ 5. Efeitos colaterais de zona               │
              │ 6. Log neutro                                │
              └──────────────┬──────────────────────────────┘
                             ▼
                    Colyseus calcula delta
                             ▼
                    patch binário filtrado por cliente
```

---

## 2. Pipeline de processamento de uma intenção

Toda intenção passa pelas mesmas seis etapas, na ordem. Uma falha em qualquer etapa **aborta** e
devolve `error` ao remetente, sem tocar o estado.

| #   | Etapa                  | O que verifica                                                                | Falha resulta em                           |
| --- | ---------------------- | ----------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | **Rate limit**         | ≤ 30 intenções/s do mesmo cliente                                             | Descarte + `warning RATE_LIMITED`          |
| 2   | **Validação de forma** | Zod (`FR-11`)                                                                 | `error INVALID_PAYLOAD`                    |
| 3   | **Existência**         | `entityId` existe em `state.cards`                                            | `error ENTITY_NOT_FOUND`                   |
| 4   | **Autorização**        | `controllerId === sessionId`, ou operação pública permitida (`FR-12`, `RN08`) | `error NOT_AUTHORIZED` + log de auditoria  |
| 5   | **Lock**               | Carta não está sob _lock_ de outro cliente (`FR-10`)                          | Descarte **silencioso** (disputa é normal) |
| 6   | **Mutação + log**      | —                                                                             | —                                          |

**Nada de I/O nas etapas 2–6.** Sem banco, sem HTTP, sem `await` de rede. O orçamento é de 10 ms
(`DOC-021` §7). Escritas duráveis (estatística de partida) acontecem fora do caminho crítico.

---

## 3. Dicionário de intenções → mutações

O cliente não atualiza o estado; ele envia intenções. Esta é a tabela de referência do que cada uma
faz **no servidor**.

### 3.1 Movimento

| Intenção                | Payload                       | Mutação                                              | Log |
| ----------------------- | ----------------------------- | ---------------------------------------------------- | --- |
| `INTENT_GRAB`           | `{ entityId }`                | `card.lockedBy = sessionId`; agenda expiração em 5 s | —   |
| `INTENT_MOVE_CARD`      | `{ entityId, x, y }`          | `card.x = x; card.y = y`                             | —   |
| `INTENT_RELEASE`        | `{ entityId, x, y, zIndex? }` | Grava posição final; `card.lockedBy = ''`            | —   |
| `INTENT_BRING_TO_FRONT` | `{ entityId }`                | `card.zIndex = maxZIndex(zone) + 1`                  | —   |

`INTENT_MOVE_CARD` **não** gera log — geraria centenas de linhas por arraste.

### 3.2 Zona

| Intenção                | Payload                                    | Mutação                                                                                                                   | Log                                   |
| ----------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `INTENT_CHANGE_ZONE`    | `{ entityId, targetZone, index?, x?, y? }` | Remove de `zoneOrder[origem]`, insere em `zoneOrder[destino]`, define `card.zone`, aplica efeitos colaterais de zona (§4) | `ZONE_CHANGE` ou `ZONE_CHANGE_HIDDEN` |
| `INTENT_DRAW`           | `{ amount }`                               | Retira `amount` do **fim** de `LIBRARY` (topo) → `HAND`; atualiza contagens                                               | `DRAW`                                |
| `INTENT_MILL`           | `{ amount, target }`                       | Topo da `LIBRARY` → `GRAVEYARD`/`EXILE`                                                                                   | `MILL`                                |
| `INTENT_PEEK_TOP`       | `{ amount }`                               | **Nenhuma mutação de estado**; envia `revealToOwner` ao dono                                                              | `PEEK`                                |
| `INTENT_MOVE_TO_BOTTOM` | `{ entityId }`                             | Move para o índice 0 de `LIBRARY`                                                                                         | `ZONE_CHANGE_HIDDEN`                  |
| `INTENT_SHUFFLE_ZONE`   | `{ targetZone }`                           | `shuffle(zoneOrder[zona])` com CSPRNG                                                                                     | `SHUFFLE`                             |
| `INTENT_SEARCH_LIBRARY` | `{}`                                       | Nenhuma; envia `revealToOwner` com a `LIBRARY` inteira                                                                    | `SEARCH`                              |

**Convenção de topo:** o **topo** do grimório é o **último índice** do array. Comprar é `pop()`;
colocar no fundo é `unshift()`. Escolha arbitrária, mas precisa ser consistente em todo o código.

### 3.3 Propriedades

| Intenção                 | Payload                            | Mutação                                                                 | Log              |
| ------------------------ | ---------------------------------- | ----------------------------------------------------------------------- | ---------------- |
| `INTENT_TAP`             | `{ entityId, isTapped }`           | `card.isTapped = isTapped`; `rotation = isTapped ? 90 : 0`              | `TAP`/`UNTAP`    |
| `INTENT_UPDATE_PROPERTY` | `{ entityId, property, value }`    | Aplica a propriedade permitida                                          | Depende          |
| `INTENT_ADD_COUNTER`     | `{ entityId, type, amount }`       | `counters[type] = max(0, atual + amount)`; remove a chave se chegar a 0 | `COUNTER`        |
| `INTENT_SET_CONTROLLER`  | `{ entityId, controllerId }`       | `card.controllerId = novo`                                              | `SYSTEM`         |
| `INTENT_BATCH_UPDATE`    | `{ entityIds[], property, value }` | Aplica a todos, em um só _patch_                                        | Um log agregado  |
| `INTENT_UNTAP_ALL`       | `{}`                               | Todas as cartas próprias em `BATTLEFIELD` recebem `isTapped = false`    | `UNTAP` agregado |

### 3.4 Jogador

| Intenção                      | Payload                       | Mutação                                         | Log                       |
| ----------------------------- | ----------------------------- | ----------------------------------------------- | ------------------------- |
| `INTENT_SET_LIFE`             | `{ delta }` ou `{ absolute }` | `player.life += delta` (ou `= absolute`)        | `LIFE` com antes → depois |
| `INTENT_SET_COMMANDER_DAMAGE` | `{ fromPlayerId, delta }`     | `commanderDamage[from] = max(0, atual + delta)` | `CMD_DAMAGE`              |
| `INTENT_SET_PLAYER_COUNTER`   | `{ type, delta }`             | `poison`/`energy`/`experience`                  | `COUNTER`                 |
| `INTENT_TOGGLE_DESIGNATION`   | `{ type }`                    | Zera em todos e ativa no remetente              | `SYSTEM`                  |
| `INTENT_SET_COMMANDER_TAX`    | `{ delta }`                   | `commanderTax = max(0, atual + delta)`          | `SYSTEM`                  |

**Vida pode ficar negativa.** O jogo real usa vida negativa como informação; e eliminar alguém seria
aplicar regra (`RN01`). O motor não impede.

### 3.5 Criação de objetos

| Intenção               | Payload                                                             | Mutação                                                            | Log      |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ | -------- |
| `INTENT_CREATE_TOKEN`  | `{ scryfallId?, name?, power?, toughness?, colors?, amount, x, y }` | Cria `amount` objetos `Card` com `isToken = true` em `BATTLEFIELD` | `TOKEN`  |
| `INTENT_COPY_CARD`     | `{ entityId }`                                                      | Novo `Card` com mesmo `scryfallId`, `isCopy = true`                | `TOKEN`  |
| `INTENT_DESTROY_TOKEN` | `{ entityId }`                                                      | Remove o objeto                                                    | `SYSTEM` |
| `INTENT_CLEAR_TOKENS`  | `{}`                                                                | Remove todas as fichas próprias                                    | `SYSTEM` |

Limite: `amount` ≤ 50 por intenção e teto de 200 fichas por jogador, para proteger `NFR-01`.

### 3.6 Aleatoriedade e comunicação

| Intenção           | Payload               | Mutação                                  | Log      |
| ------------------ | --------------------- | ---------------------------------------- | -------- |
| `INTENT_ROLL_DICE` | `{ sides }`           | Nenhuma no `Schema`; emite evento `dice` | `DICE`   |
| `INTENT_FLIP_COIN` | `{}`                  | Nenhuma; emite evento                    | `DICE`   |
| `INTENT_CHAT`      | `{ text }`            | Nenhuma; emite `chat` sanitizado         | —        |
| `INTENT_PING`      | `{ x, y, targetId? }` | Nenhuma; emite `ping`                    | —        |
| `INTENT_SET_TURN`  | `{ turn?, phase? }`   | `state.turn`, `state.activePlayerId`     | `SYSTEM` |

Dado e ping não entram no `Schema` porque não são estado — são acontecimentos (`DOC-031` §4.2).

---

## 4. Efeitos colaterais de mudança de zona

Ao mudar de zona, o motor **precisa** normalizar o objeto. Esquecer isso produz bugs sutis — uma
carta que volta do cemitério para a mão trazendo três marcadores +1/+1, por exemplo.

```ts
// game-server/src/intents/zone.ts (esqueleto)
function applyZoneEffects(card: Card, from: Zone, to: Zone, opts: MoveOpts) {
  // 1. ficha fora do campo deixa de existir
  if (card.isToken && to !== 'BATTLEFIELD') {
    destroy(card);
    return;
  }

  // 2. sair do battlefield limpa estado físico
  if (from === 'BATTLEFIELD' && to !== 'BATTLEFIELD') {
    card.isTapped = false;
    card.rotation = 0;
    card.counters.clear();
    card.x = 0;
    card.y = 0;
    card.zIndex = 0;
  }

  // 3. entrar em zona oculta limpa tudo e reseta face
  if (to === 'HAND' || to === 'LIBRARY') {
    card.isTapped = false;
    card.faceDown = false;
    card.counters.clear();
    card.x = 0;
    card.y = 0;
  }

  // 4. entrar no battlefield posiciona
  if (to === 'BATTLEFIELD') {
    card.x = opts.x ?? defaultDropX(card.controllerId);
    card.y = opts.y ?? defaultDropY(card.controllerId);
    card.zIndex = nextZIndex('BATTLEFIELD');
  }

  // 5. controle volta ao dono ao sair do campo
  if (to !== 'BATTLEFIELD') card.controllerId = card.ownerId;

  // 6. ⚠️ CRÍTICO — revoga TODA concessão de visibilidade (RN13).
  //    Sem isto, uma carta revelada na mão que vai ao campo e volta
  //    continua visível a todos PARA SEMPRE. É o vazamento mais fácil
  //    de introduzir neste modelo. Coberto por caso próprio no teste G1.
  card.revealedTo = '';
  card.peekedBy = '';

  // 7. contagens públicas
  syncCounts(card.ownerId);
}
```

| #     | Efeito                                       | Motivo                                                                                                               |
| ----- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1     | Ficha destruída fora do campo                | Fichas não existem em outras zonas                                                                                   |
| 2     | Limpa estado físico ao sair do campo         | Marcadores e "virada" são propriedades do campo                                                                      |
| 3     | Limpa e reseta face ao entrar em zona oculta | Carta na mão não está virada nem com marcador                                                                        |
| 4     | Posiciona ao entrar no campo                 | Sem coordenada, o sprite aparece em (0,0)                                                                            |
| 5     | Controle volta ao dono                       | Evita carta "roubada" presa com o oponente após sair do campo (`RN08`)                                               |
| **6** | **Revoga `revealedTo` e `peekedBy`**         | **Visibilidade é concedida por ação e não sobrevive à troca de zona (`RN13`). Esquecer aqui é vazamento permanente** |
| 7     | Sincroniza `handCount`/`libraryCount`        | Contagens públicas precisam bater (`DOC-032` §4.2)                                                                   |

### 4.1 Buffer de scry / surveil

`INTENT_SCRY` e `INTENT_SURVEIL` são **transações de duas fases**, não mutações simples: o jogador
precisa ver N cartas, decidir a ordem e só então confirmar.

```ts
// state.peekBuffer[sessionId] = { ids: string[], kind: 'SCRY' | 'SURVEIL', expiresAt: number }

// fase 1 — abre
INTENT_SCRY { amount: 3 }
  → seleciona as 3 do topo, seta peekedBy, cria o buffer
  → log: "Arthur fez scry 3"

// fase 2 — confirma
INTENT_SCRY_COMMIT { toBottom: [id2], topOrder: [id3, id1] }
  → valida que TODO id pertence ao buffer daquele jogador   ← senão o cliente move carta arbitrária
  → aplica, limpa buffer e revoga peekedBy
  → log: "colocou 1 carta no fundo"   ← contagem, nunca identidade
```

| Regra                                          | Valor                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| Timeout do buffer                              | **120 s** — ao expirar, confirma a ordem original e revoga       |
| Um buffer por jogador                          | Abrir um novo descarta o anterior (confirmando a ordem original) |
| Validação de pertinência                       | Todo `id` do commit **precisa** estar no buffer do remetente     |
| Intenções bloqueadas enquanto há buffer aberto | `_DRAW`, `_SHUFFLE`, `_MILL` sobre a mesma zona — evitam corrida |

### 4.2 Pilha de desfazer

Profundidade **1**, por jogador, janela de **10 s** (`DOC-036` §11.3).

```ts
// state interno (fora do Schema — não precisa sincronizar)
undoStack: Map<sessionId, { inverse: () => void; label: string; expiresAt: number }>;
```

| Regra          | Detalhe                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Escopo         | Apenas a última ação **do próprio jogador**                                                           |
| **Não desfaz** | Embaralhar, dado, moeda, descarte aleatório, carta aleatória — desfazer daria nova tentativa (`RN06`) |
| **Não desfaz** | `_PEEK`, `_REVEAL`, `_SCRY_COMMIT` — informação revelada não volta a ser secreta                      |
| Log            | Sempre público: "Arthur desfez: comprar 1 carta"                                                      |
| Invalidação    | Qualquer ação de **outro** jogador sobre a mesma entidade invalida o undo pendente                    |

---

## 5. Prevenção de desincronização (desync)

### 5.1 O problema

Sem controle, dois jogadores arrastando a mesma carta produzem _jitter_: cada `INTENT_MOVE_CARD`
sobrescreve o anterior, e a carta pula entre duas posições enquanto ambos seguram o botão.

### 5.2 Sistema de _lock_ momentâneo

```
J1 mousedown na carta X
   │
   ├─► INTENT_GRAB { X }
   │      servidor: X.lockedBy = "sessionId_J1"; timer de 5 s
   │
   ├─► INTENT_MOVE_CARD { X, ... }   ✅ aceito (lockedBy === remetente)
   │
J2 tenta arrastar a mesma carta X
   │
   ├─► INTENT_GRAB { X }             ❌ ignorado (já travada)
   ├─► INTENT_MOVE_CARD { X, ... }   ❌ ignorado, SILENCIOSAMENTE
   │
J1 mouseup
   └─► INTENT_RELEASE { X, x, y }
          servidor: grava posição final; X.lockedBy = ""; cancela timer
```

| Regra                  | Valor                                                                           |
| ---------------------- | ------------------------------------------------------------------------------- |
| TTL do _lock_          | **5 s** — protege contra `INTENT_RELEASE` perdido                               |
| Rejeição a terceiros   | **Silenciosa** — é disputa normal, não erro                                     |
| Desconexão do detentor | _Lock_ liberado imediatamente                                                   |
| Expiração              | Carta permanece na última posição sincronizada                                  |
| Escopo                 | Um _lock_ por `entityId`; um cliente pode ter vários _locks_ (seleção múltipla) |

### 5.3 Predição otimista e reconciliação

O cliente que arrasta aplica a posição **localmente antes** de o servidor confirmar — é isso que faz o
arraste parecer instantâneo. Quando o _patch_ volta:

| Situação                                     | Comportamento do cliente                                |
| -------------------------------------------- | ------------------------------------------------------- |
| Posição do servidor ≈ local (dentro de 2 px) | Ignora; mantém a predição                               |
| Posição do servidor difere                   | **Aceita a do servidor** e interpola até ela em ~100 ms |
| Servidor rejeitou a intenção                 | Reverte para o último estado confirmado                 |

A regra é `RN07`: **o servidor é a verdade**. Predição é conforto visual, nunca autoridade.

### 5.4 Interpolação nos clientes observadores

Clientes que **não** originaram o movimento recebem _patches_ a 20 Hz. Aplicar a coordenada crua
produziria movimento em degraus. O cliente interpola linearmente entre o valor anterior e o novo ao
longo do intervalo de _patch_ (`FR-25`).

### 5.5 Ordem de operações e idempotência

O WebSocket é TCP: as mensagens chegam em ordem. Mas o mesmo _handler_ pode receber intenções
repetidas (usuário clicando duas vezes). Regras:

| Intenção                           | Idempotente?               | Tratamento                                          |
| ---------------------------------- | -------------------------- | --------------------------------------------------- |
| `INTENT_TAP { isTapped: true }`    | **Sim** — valor absoluto   | Aplicar de novo não faz diferença                   |
| `INTENT_ADD_COUNTER { amount: 1 }` | **Não** — é delta          | Aceita o duplo clique como intenção real do usuário |
| `INTENT_DRAW { amount: 1 }`        | **Não**                    | Idem                                                |
| `INTENT_SET_LIFE { delta: -1 }`    | **Não**                    | Idem                                                |
| `INTENT_MOVE_CARD`                 | **Sim** — posição absoluta | Sem problema                                        |

**Decisão de projeto:** intenções de valor absoluto usam valor absoluto (`isTapped`, `x`, `y`);
intenções de contador usam delta, porque o usuário realmente quer "adicionar mais um" e o valor
absoluto criaria condição de corrida entre dois jogadores ajustando o mesmo contador.

---

## 6. Máquina de estados da sala

```
                  ┌───────────┐
   criada ───────►│  WAITING  │
                  └─────┬─────┘
                        │ primeiro onJoin
                        ▼
                  ┌───────────┐   INTENT_RESET_MATCH
                  │  PLAYING  │◄──────────┐
                  └─┬───┬───┬─┘           │
                    │   │   └─────────────┘
     todos          │   │ deploy / último jogador sai
   desconectados    │   │
                    ▼   ▼
              ┌────────┐  ┌───────────┐
              │ PAUSED │  │  CLOSING  │
              └───┬────┘  └─────┬─────┘
                  │             │ 10 min vazia
      alguém volta│             ▼
                  └──► PLAYING  onDispose()
                  │
      90 s sem ninguém ──► CLOSING
```

| Estado    | Intenções aceitas | Timers ativos                     |
| --------- | ----------------- | --------------------------------- |
| `WAITING` | `INTENT_CHAT`     | —                                 |
| `PLAYING` | Todas             | _Locks_ (5 s), _heartbeat_ (15 s) |
| `PAUSED`  | Nenhuma           | Reconexão (90 s por jogador)      |
| `CLOSING` | Nenhuma           | Descarte (10 min)                 |

### 6.1 Reconexão

Detalhado em `DOC-021` §5.2. Do ponto de vista do motor:

1. `onLeave(client, consented)` — se não foi saída deliberada, chama `allowReconnection(client, 90)`.
2. `player.connected = false`, `player.disconnectedAt = Date.now()`.
3. Todas as intenções sobre cartas cujo `controllerId` seja o desconectado são **rejeitadas**.
4. Na volta, o cliente recebe o estado **completo** (não delta) e `player.connected = true`.
5. Se expirar: remove o `Player`, remove todas as cartas com aquele `ownerId`, log `SYSTEM`.

---

## 7. Autorização por intenção

| Intenção                                           | Quem pode                                       | Verificação                                                           |
| -------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| Movimento, tap, marcador, face-down                | Quem tem `controllerId`                         | `card.controllerId === sessionId`                                     |
| `INTENT_DRAW`, `SHUFFLE`, `MILL`, `PEEK`, `SEARCH` | Só o dono da zona                               | `card.ownerId === sessionId`                                          |
| `INTENT_SET_LIFE` do próprio painel                | O próprio jogador                               | `playerId === sessionId`                                              |
| `INTENT_SET_LIFE` de outro jogador                 | **Permitido**                                   | É comum ajustar a vida de outro na mesa física; log registra quem fez |
| `INTENT_SET_COMMANDER_DAMAGE`                      | Qualquer um                                     | Idem                                                                  |
| `INTENT_SET_CONTROLLER`                            | Controlador atual                               | Cede controle voluntariamente                                         |
| `INTENT_CREATE_TOKEN`                              | Qualquer jogador                                | Cria no próprio campo                                                 |
| `INTENT_RESET_MATCH`                               | Qualquer jogador, com confirmação dos presentes | Voto                                                                  |
| `INTENT_TOGGLE_DESIGNATION`                        | Qualquer jogador                                | Monarca/iniciativa muda de mão                                        |

**Escolha deliberada:** permitir que um jogador ajuste a vida de outro reflete a mesa física, onde
qualquer um mexe no contador de qualquer um. O controle contra abuso é **social**, apoiado pelo log
que registra o autor de cada mudança — não técnico. Coerente com `RN01`.

---

## 8. Anti-abuso

| Vetor                       | Mitigação                                    |
| --------------------------- | -------------------------------------------- |
| Spam de intenções           | 30/s por cliente (`DOC-031` §2.2)            |
| Spam de fichas              | ≤ 50 por intenção, teto de 200 por jogador   |
| Spam de dados               | 5 rolagens / 10 s                            |
| Spam de chat                | 10 mensagens / 10 s; máx. 500 caracteres     |
| Mensagem gigante            | Corta em 4 KB; conexão fechada se persistir  |
| Intenção sobre carta alheia | Rejeitada + log de auditoria com `sessionId` |
| _Payload_ malicioso         | Zod em tudo; _fuzzing_ no CI                 |
| _Lock_ eterno               | TTL de 5 s                                   |
| Sala zumbi                  | Descarte após 10 min vazia                   |

---

## 9. Checklist de implementação

- [ ] Pipeline de 6 etapas (§2) aplicado a **toda** intenção, via _middleware_ único.
- [ ] Registro central `intents/registry.ts` mapeando nome → { schema Zod, autorização, handler }.
- [ ] Nenhum `await` de I/O dentro de _handler_.
- [ ] `applyZoneEffects` chamado em **toda** mudança de zona (§4).
- [ ] Convenção "topo = último índice" documentada no código e respeitada.
- [ ] _Lock_ com TTL de 5 s, liberação em desconexão, rejeição silenciosa a terceiros.
- [ ] Contadores como delta; propriedades booleanas/posicionais como valor absoluto (§5.5).
- [ ] `controllerId` volta ao `ownerId` ao sair do `BATTLEFIELD`.
- [ ] Máquina de estados `WAITING/PLAYING/PAUSED/CLOSING` com intenções bloqueadas por estado.
- [ ] `allowReconnection(90)` e envio de estado completo na volta.
- [ ] Log neutro em toda mutação relevante, com variante `_HIDDEN` (`RN09`).
- [ ] Limites de anti-abuso da §8.
- [ ] Testes: dois clientes disputando _lock_; efeitos de zona por transição; idempotência.
