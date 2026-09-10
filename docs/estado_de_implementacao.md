# Estado de Implementação das Intenções

| Campo          | Valor                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **ID**         | `DOC-090`                                                                                                                |
| **Gerado por** | `node tools/estado-implementacao.mjs`                                                                                    |
| **Fontes**     | `packages/shared-types/src/intents.ts` · `apps/game-server/src/intents/registry.ts` · `apps/frontend/src/net/intents.ts` |

> **Este arquivo é gerado.** Não edite à mão: rode `pnpm docs:estado`.

## 1. Por que este documento existe

O contrato de intenções ([`especificacao_websocket_e_eventos.md`](especificacao_websocket_e_eventos.md))
e o catálogo de ações ([`catalogo_de_acoes_da_mesa.md`](catalogo_de_acoes_da_mesa.md)) dizem o que o
sistema **deve** fazer. Nenhum dos dois dizia o que ele **faz**.

A consequência apareceu em produção: o cliente emitia 35 intenções e o servidor
implementava 20. Colyseus descarta mensagem sem handler em silêncio — sem erro,
sem log, sem exceção. O jogador clicava em "Passar turno" e nada acontecia, e
não havia nenhum lugar onde essa lacuna estivesse escrita.

As três colunas abaixo vêm do próprio código. A divergência entre elas é
justamente o tipo de defeito que não aparece em nenhum teste de unidade.

## 2. Cobertura

- Contrato (`IntentPayloadMap`): **96** intenções
- Implementadas no servidor: **90**
- Emitidas pelo cliente: **90**
- Emitidas SEM handler no servidor: **0** (nenhuma — é o que se quer)

## 3. Tabela

| Intenção                      | Servidor | Cliente |
| ----------------------------- | :------: | :-----: |
| `INTENT_ADD_COUNTER`          |    ✅    |   ✅    |
| `INTENT_ADD_DAMAGE`           |    ✅    |   ✅    |
| `INTENT_ADD_PLAYER_COUNTER`   |    ✅    |   ✅    |
| `INTENT_ARROW`                |    ✅    |   ✅    |
| `INTENT_ATTACH`               |    ✅    |   ✅    |
| `INTENT_BATCH_COUNTER`        |    ✅    |   ✅    |
| `INTENT_BATCH_UPDATE`         |    ✅    |   ✅    |
| `INTENT_BRING_TO_FRONT`       |    ✅    |   ✅    |
| `INTENT_CAST_COMMANDER`       |    ✅    |   ✅    |
| `INTENT_CHANGE_ZONE`          |    ✅    |   ✅    |
| `INTENT_CHAT`                 |    ✅    |   ✅    |
| `INTENT_CLEAR_ARROWS`         |    ✅    |   ✅    |
| `INTENT_CLEAR_COUNTERS`       |    ✅    |   ✅    |
| `INTENT_CLEAR_DAMAGE`         |    ✅    |   ✅    |
| `INTENT_CLEAR_TOKENS`         |    ✅    |   ✅    |
| `INTENT_CLOSE_PEEK`           |    ✅    |   ✅    |
| `INTENT_CONCEDE`              |    ✅    |   ✅    |
| `INTENT_COPY_CARD`            |    ✅    |   ✅    |
| `INTENT_CREATE_EMBLEM`        |    —     |    —    |
| `INTENT_CREATE_TOKEN`         |    ✅    |   ✅    |
| `INTENT_DESTROY_TOKEN`        |    ✅    |   ✅    |
| `INTENT_DETACH`               |    ✅    |   ✅    |
| `INTENT_DISCARD_ALL`          |    ✅    |   ✅    |
| `INTENT_DISCARD_RANDOM`       |    ✅    |   ✅    |
| `INTENT_DRAW`                 |    ✅    |   ✅    |
| `INTENT_DRAW_SCHEME`          |    —     |    —    |
| `INTENT_DRAW_UP_TO`           |    ✅    |   ✅    |
| `INTENT_FETCH_FROM_SIDEBOARD` |    ✅    |   ✅    |
| `INTENT_FLIP_COIN`            |    ✅    |   ✅    |
| `INTENT_GIVE_CARD`            |    ✅    |   ✅    |
| `INTENT_GRAB`                 |    ✅    |   ✅    |
| `INTENT_GROUP`                |    —     |    —    |
| `INTENT_KEEP_HAND`            |    ✅    |   ✅    |
| `INTENT_KICK_PLAYER`          |    ✅    |   ✅    |
| `INTENT_LEAVE`                |    ✅    |   ✅    |
| `INTENT_MELD`                 |    —     |    —    |
| `INTENT_MILL`                 |    ✅    |   ✅    |
| `INTENT_MOVE_CARD`            |    ✅    |   ✅    |
| `INTENT_MOVE_TOP_TO_BOTTOM`   |    ✅    |   ✅    |
| `INTENT_MULLIGAN`             |    ✅    |   ✅    |
| `INTENT_PASS_TURN`            |    ✅    |   ✅    |
| `INTENT_PEEK`                 |    ✅    |   ✅    |
| `INTENT_PING`                 |    ✅    |   ✅    |
| `INTENT_PLANESWALK`           |    —     |    —    |
| `INTENT_RANDOM_CARD`          |    ✅    |   ✅    |
| `INTENT_RANDOM_PLAYER`        |    ✅    |   ✅    |
| `INTENT_RELEASE`              |    ✅    |   ✅    |
| `INTENT_REORDER`              |    ✅    |   ✅    |
| `INTENT_REQUEST_VIEW`         |    ✅    |   ✅    |
| `INTENT_RESET_MATCH`          |    ✅    |   ✅    |
| `INTENT_RESPOND_VIEW`         |    ✅    |   ✅    |
| `INTENT_RETURN_ZONE`          |    ✅    |   ✅    |
| `INTENT_REVEAL`               |    ✅    |   ✅    |
| `INTENT_REVEAL_TOP`           |    ✅    |   ✅    |
| `INTENT_REVEAL_ZONE`          |    ✅    |   ✅    |
| `INTENT_REVOKE_VIEW`          |    ✅    |   ✅    |
| `INTENT_ROLL_DICE`            |    ✅    |   ✅    |
| `INTENT_SCRY`                 |    ✅    |   ✅    |
| `INTENT_SCRY_COMMIT`          |    ✅    |   ✅    |
| `INTENT_SEARCH_ZONE`          |    ✅    |   ✅    |
| `INTENT_SET_COMMANDER`        |    ✅    |   ✅    |
| `INTENT_SET_COMMANDER_DAMAGE` |    ✅    |   ✅    |
| `INTENT_SET_COMMANDER_TAX`    |    ✅    |   ✅    |
| `INTENT_SET_CONTROLLER`       |    ✅    |   ✅    |
| `INTENT_SET_COSMETICS`        |    ✅    |   ✅    |
| `INTENT_SET_COUNTER`          |    ✅    |   ✅    |
| `INTENT_SET_DAMAGE`           |    ✅    |   ✅    |
| `INTENT_SET_DAY_NIGHT`        |    ✅    |   ✅    |
| `INTENT_SET_DECK`             |    ✅    |   ✅    |
| `INTENT_SET_HIGHLIGHT`        |    ✅    |   ✅    |
| `INTENT_SET_LIFE`             |    ✅    |   ✅    |
| `INTENT_SET_MAX_HAND_SIZE`    |    ✅    |   ✅    |
| `INTENT_SET_NOTE`             |    ✅    |   ✅    |
| `INTENT_SET_PLAYER_COUNTER`   |    ✅    |   ✅    |
| `INTENT_SET_PT`               |    ✅    |   ✅    |
| `INTENT_SET_READY`            |    ✅    |   ✅    |
| `INTENT_SET_RING`             |    ✅    |   ✅    |
| `INTENT_SET_ROOM_CONFIG`      |    ✅    |   ✅    |
| `INTENT_SET_SPEED`            |    ✅    |   ✅    |
| `INTENT_SET_TOP_REVEALED`     |    ✅    |   ✅    |
| `INTENT_SET_TURN`             |    ✅    |   ✅    |
| `INTENT_SET_TURN_ORDER`       |    ✅    |   ✅    |
| `INTENT_SET_ZONE_VISIBILITY`  |    ✅    |   ✅    |
| `INTENT_SHUFFLE`              |    ✅    |   ✅    |
| `INTENT_START_MATCH`          |    ✅    |   ✅    |
| `INTENT_SURVEIL`              |    ✅    |   ✅    |
| `INTENT_SURVEIL_COMMIT`       |    ✅    |   ✅    |
| `INTENT_TAP`                  |    ✅    |   ✅    |
| `INTENT_TAP_ALL`              |    ✅    |   ✅    |
| `INTENT_TOGGLE_DESIGNATION`   |    ✅    |   ✅    |
| `INTENT_TRANSFORM`            |    ✅    |   ✅    |
| `INTENT_UNDO`                 |    ✅    |   ✅    |
| `INTENT_UNREVEAL`             |    ✅    |   ✅    |
| `INTENT_UNTAP_ALL`            |    ✅    |   ✅    |
| `INTENT_UPDATE_PROPERTY`      |    ✅    |   ✅    |
| `INTENT_VENTURE`              |    —     |    —    |

## 4. Pendências declaradas

Todas são prioridade C (_could_) / V2 no catálogo e exigem estrutura de domínio
nova — não apenas um handler. Ficam listadas em `INTENCOES_PENDENTES`
(`registry.ts`) para que a lacuna seja explícita e verificável.

| Intenção               | Motivo                                        |
| ---------------------- | --------------------------------------------- |
| `INTENT_MELD`          | V2 — exige carta resultante e desfazer o meld |
| `INTENT_GROUP`         | V2 — exige um id de grupo no Schema de Card   |
| `INTENT_CREATE_EMBLEM` | V2 — exige zona/objeto de emblema             |
| `INTENT_VENTURE`       | V2 — exige os mapas das masmorras             |
| `INTENT_PLANESWALK`    | V2 — Planechase: deck de planos               |
| `INTENT_DRAW_SCHEME`   | V2 — Archenemy: deck de esquemas              |

## 5. Implementadas sem gesto no cliente

Existem no servidor e ainda não têm superfície na interface. Não são defeito:
são pontos de extensão prontos.

_Nenhuma._

## 6. Fora do contrato, sem plano

_Nenhuma._
