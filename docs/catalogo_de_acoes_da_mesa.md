# Catálogo Completo de Ações da Mesa

| Campo                       | Valor                                                                                                                                                                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                      | `DOC-036`                                                                                                                                                                                                                                                                               |
| **Versão**                  | 1.0                                                                                                                                                                                                                                                                                     |
| **Status**                  | Estável                                                                                                                                                                                                                                                                                 |
| **Última revisão**          | 2026-08-21                                                                                                                                                                                                                                                                              |
| **Documentos relacionados** | [readme.md](readme.md) · [especificacao_do_motor_sandbox.md](especificacao_do_motor_sandbox.md) · [especificacao_websocket_e_eventos.md](especificacao_websocket_e_eventos.md) · [especificacao_do_motor_de_estado_state_machine.md](especificacao_do_motor_de_estado_state_machine.md) |

> **Fonte canônica das ações de mesa.** Enumera **tudo** que um jogador precisa poder fazer numa mesa
> de Commander sem motor de regras. É a lista de paridade com sandboxes existentes (EDHplay, Untap.in,
> SpellTable, Tabletop Simulator) e a referência para o dicionário de intenções.

---

## 1. Por que este documento existe

A primeira versão da especificação de WebSocket catalogou ~30 intenções. Isso cobre mover, virar,
comprar e marcar — e **não cobre a maior parte do que uma partida real exige**.

Faltavam categorias inteiras: olhar o topo, olhar X cartas, scry, surveil, revelar para um jogador
específico, exilar face para baixo, buscar no grimório, mulligan, setas de alvo, contadores nomeados,
Anel, masmorra, Planechase.

Mais grave: **três dessas ações quebram o modelo de visibilidade** que estava documentado.

### 1.1 O modelo antigo era insuficiente

```
ANTIGO:  visibilidade = f(zona, dono)
```

Isso funciona para "mão é oculta, campo é público". **Não** funciona para:

| Ação                             | Por que quebra o modelo                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Olhar o topo do grimório**     | A carta continua na `LIBRARY` (zona oculta), mas o dono precisa ver a identidade **temporariamente** |
| **Revelar carta da mão a todos** | A carta continua na `HAND` (zona oculta), mas **todos** precisam ver                                 |
| **Revelar a mão a um jogador**   | Zona oculta, e a visibilidade é para **um subconjunto** de jogadores                                 |
| **Exilar face para baixo**       | `EXILE` é zona pública, mas esta carta específica deve ficar oculta                                  |
| **Buscar no grimório**           | O dono vê a `LIBRARY` inteira por um período, os outros não                                          |
| **Scry / Surveil**               | O dono vê X cartas e as **reordena** antes de confirmar                                              |

```
NOVO:  visibilidade = f(zona, dono, controlador, faceDown, revealedTo[], peekedBy[])
```

Esta é a mudança estrutural mais importante deste documento. Implementação em
[especificacao_do_motor_sandbox.md](especificacao_do_motor_sandbox.md) §4.

### 1.1.1 O princípio que governa tudo: visibilidade é conquistada, nunca passiva

> **O jogador só vê o que ele explicitamente pediu para ver, por meio de uma ação registrada.
> Se não executar a ação, não recebe o dado — nem tem como obtê-lo.**

Este é o eixo do modelo inteiro. Não é preferência de UX: é o que torna a informação oculta
tecnicamente inviolável, e não apenas escondida.

| Consequência                                  | Detalhe                                                                                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ausência de ação = ausência de dado**       | Sem `INTENT_PEEK`, o `scryfallId` da carta do topo **nunca sai do servidor**. Não existe no cliente, nem escondido, nem em memória, nem em campo ignorado |
| **Toda visibilidade tem um pedido explícito** | Não há acesso implícito, automático ou "de bônus". Para ver, é preciso mandar a intenção                                                                  |
| **Todo pedido é registrado publicamente**     | `INTENT_PEEK` gera log: _"Arthur olhou as 3 cartas do topo do grimório"_. Os oponentes sabem **que** ele olhou, embora não saibam **o que** ele viu       |
| **A visibilidade expira**                     | Ao fechar o painel, `peekedBy` é limpo e o dado é retirado do cliente. Olhar não é uma licença permanente                                                 |
| **O cliente não pode se autoconceder acesso** | Alterar o JavaScript não ajuda: o dado nunca chegou. Não há nada para revelar                                                                             |

**O contraste com a abordagem ingênua é o ponto central.** Num sistema que envia tudo e esconde na
interface, "olhar o topo" é apenas um botão que revela um dado que já estava lá — e quem sabe abrir o
DevTools tem acesso permanente e silencioso a todo o grimório de todos. Aqui, o botão é a **única**
porta de entrada do dado, e passar por ela deixa registro.

**Simetria de auditoria.** Como toda concessão de visibilidade passa por uma intenção, e toda intenção
gera log, o histórico da partida contém o rastro completo de quem olhou o quê e quando. Isso substitui,
com vantagem, a confiança mútua da mesa física: ninguém pode espiar sem que a mesa saiba.

Esta regra está formalizada como **`RN13`** em
[regras_de_negocio_e_casos_de_uso.md](regras_de_negocio_e_casos_de_uso.md) §2.

### 1.2 Segunda correção: contadores nomeados

O modelo antigo usava um enum fixo: `{P1_P1, M1_M1, CHARGE, LOYALTY, GENERIC}`.

Magic tem **mais de 100 tipos de contador** nomeados — _oil_, _stun_, _shield_, _ki_, _verse_, _page_,
_blood_, _brick_, _lore_, _treasure_, _spore_, _time_, _level_, _quest_, _fade_, _pressure_, _rad_… e a
cada nova coleção surgem mais.

Um enum é matematicamente incapaz de acompanhar. **A chave do contador é string livre**, com atalhos na
UI para os mais comuns. Ver §5.

### 1.3 Escopo verificado

Não foi possível ler o menu do EDHplay nem do Untap.in por HTTP — ambos são aplicações de página única
e o fetch devolve apenas o _shell_ HTML. Este catálogo foi construído a partir do **conjunto de ações
físicas que o Magic exige**, que é o superconjunto do que qualquer sandbox implementa.

Onde há dúvida sobre paridade específica com um concorrente, a coluna **Prio** marca `C` (desejável) em
vez de `M` (obrigatório).

### 1.4 Legenda

| Coluna       | Significado                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------- |
| **#**        | Número da ação neste catálogo                                                                     |
| **Intenção** | Mensagem WebSocket correspondente                                                                 |
| **Priv.**    | Visibilidade do resultado: `Público` · `Privado` (só o autor) · `Dirigido` (jogadores escolhidos) |
| **Prio**     | **M**ust · **S**hould · **C**ould                                                                 |
| **Fase**     | MVP · V1 · V2                                                                                     |

---

## 2. Grimório (Library)

A zona mais rica em ações e a mais sensível em visibilidade.

| #   | Ação                                                       | Intenção                                                        | Priv.                                   | Prio  | Fase |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------- | ----- | ---- |
| 1   | **Comprar 1**                                              | `INTENT_DRAW {amount:1}`                                        | Privado                                 | **M** | MVP  |
| 2   | **Comprar X**                                              | `INTENT_DRAW {amount:X}`                                        | Privado                                 | **M** | MVP  |
| 3   | Comprar até N cartas na mão                                | `INTENT_DRAW_UP_TO {target:N}`                                  | Privado                                 | C     | V1   |
| 4   | **Olhar o topo (1 carta)**                                 | `INTENT_PEEK {zone:LIBRARY, amount:1}`                          | **Privado**                             | **M** | MVP  |
| 5   | **Olhar as X do topo**                                     | `INTENT_PEEK {zone:LIBRARY, amount:X}`                          | **Privado**                             | **M** | MVP  |
| 6   | Olhar as X do fundo                                        | `INTENT_PEEK {zone:LIBRARY, amount:X, from:BOTTOM}`             | Privado                                 | C     | V1   |
| 7   | **Scry X** — olhar X, escolher quais vão ao fundo          | `INTENT_SCRY {amount:X}`                                        | Privado → resultado público de contagem | **S** | V1   |
| 8   | **Surveil X** — olhar X, escolher quais vão ao cemitério   | `INTENT_SURVEIL {amount:X}`                                     | Privado → cemitério é público           | **S** | V1   |
| 9   | **Revelar o topo** (permanece no topo)                     | `INTENT_REVEAL_TOP {amount:1}`                                  | **Público**                             | **S** | V1   |
| 10  | **Revelar as X do topo**                                   | `INTENT_REVEAL_TOP {amount:X}`                                  | **Público**                             | **S** | V1   |
| 11  | Revelar uma a uma até parar (manual)                       | `INTENT_REVEAL_TOP` repetido                                    | Público                                 | C     | V1   |
| 12  | **Moer X para o cemitério** (mill)                         | `INTENT_MILL {amount:X, target:GRAVEYARD}`                      | Público                                 | **M** | MVP  |
| 13  | **Exilar X do topo**                                       | `INTENT_MILL {amount:X, target:EXILE}`                          | Público                                 | **M** | MVP  |
| 14  | **Exilar X do topo face para baixo**                       | `INTENT_MILL {amount:X, target:EXILE, faceDown:true}`           | **Privado**                             | **S** | V1   |
| 15  | **Mover X do topo para o fundo**                           | `INTENT_MOVE_TOP_TO_BOTTOM {amount:X}`                          | Público (contagem)                      | **M** | MVP  |
| 16  | **Buscar no grimório** (visão completa)                    | `INTENT_SEARCH_ZONE {zone:LIBRARY}`                             | **Privado**                             | **M** | MVP  |
| 17  | Buscar terreno básico (atalho)                             | `INTENT_SEARCH_ZONE {zone:LIBRARY, filter:"t:basic"}`           | Privado                                 | C     | V1   |
| 18  | **Embaralhar**                                             | `INTENT_SHUFFLE {zone:LIBRARY}`                                 | Público (evento)                        | **M** | MVP  |
| 19  | Embaralhar preservando as X do topo                        | `INTENT_SHUFFLE {zone:LIBRARY, keepTop:X}`                      | Público                                 | C     | V2   |
| 20  | **Colocar carta no topo**                                  | `INTENT_CHANGE_ZONE {to:LIBRARY, position:TOP}`                 | Depende da origem                       | **M** | MVP  |
| 21  | **Colocar carta no fundo**                                 | `INTENT_CHANGE_ZONE {to:LIBRARY, position:BOTTOM}`              | Depende                                 | **M** | MVP  |
| 22  | Colocar na N-ésima posição do topo                         | `INTENT_CHANGE_ZONE {to:LIBRARY, position:N}`                   | Depende                                 | S     | V1   |
| 23  | Colocar em posição aleatória                               | `INTENT_CHANGE_ZONE {to:LIBRARY, position:RANDOM}`              | Depende                                 | S     | V1   |
| 24  | **Reordenar as X do topo** (arrastar)                      | `INTENT_REORDER {zone:LIBRARY, ids:[...]}`                      | Privado                                 | **S** | V1   |
| 25  | Jogar com o grimório revelado                              | `INTENT_SET_ZONE_VISIBILITY {zone:LIBRARY, to:ALL}`             | Público                                 | C     | V2   |
| 26  | Contar cartas                                              | — (`libraryCount` já é público)                                 | Público                                 | **M** | MVP  |
| 27  | **Mulligan (London)** — nova mão de 7, devolver N ao fundo | `INTENT_MULLIGAN`                                               | Privado                                 | **S** | V1   |
| 28  | Devolver uma zona inteira ao grimório e embaralhar         | `INTENT_RETURN_ZONE {from:GRAVEYARD, to:LIBRARY, shuffle:true}` | Público                                 | S     | V1   |

### 2.1 O fluxo de "olhar X cartas" em detalhe

Esta é a ação que mais exige cuidado, porque a carta **não muda de zona** — muda apenas quem pode vê-la.

```
Jogador aciona "Olhar as 3 do topo"
   │
   ├─► INTENT_PEEK { zone: "LIBRARY", amount: 3 }
   │
   ├─ servidor: identifica as 3 do topo
   ├─ servidor: adiciona sessionId a card.peekedBy de cada uma   ← visibilidade temporária
   ├─ servidor: log público NEUTRO → "Arthur olhou as 3 cartas do topo do grimório"
   │
   ├─ patch: SÓ o autor recebe scryfallId dessas 3
   │         os oponentes não recebem NADA de novo
   │
   ├─ UI do autor: painel com as 3 cartas, opções de:
   │     • fechar (mantém a ordem)
   │     • reordenar (INTENT_REORDER)
   │     • mandar ao fundo    (scry)
   │     • mandar ao cemitério (surveil)
   │     • mover uma para a mão / campo / exílio
   │
   └─ ao fechar: servidor limpa peekedBy
        → o autor PERDE a visibilidade das cartas que ficaram no grimório
```

**Detalhe crítico:** ao fechar o painel, `peekedBy` **precisa** ser limpo. Se ficar, o cliente do autor
mantém a identidade das cartas no `Schema` — e uma olhada em "as 10 do topo" no início do jogo daria
conhecimento permanente do grimório. Isso é vantagem indevida sobre os outros três jogadores.

**Exceção deliberada:** cartas que o jogador olhou e **permanecem no topo sem embaralhar** poderiam
legitimamente continuar conhecidas por ele (é assim no jogo físico — você lembra). Mas manter isso no
`Schema` é vazamento estrutural. A solução correta: o **cliente** guarda essa memória localmente
(`uiStore.rememberedCards`), como anotação pessoal, e o servidor não participa. Memória do jogador é do
jogador, não do protocolo.

### 2.2 Scry e Surveil como buffer de ordenação

`INTENT_SCRY` e `INTENT_SURVEIL` não são "olhar + mover" separados: são uma **transação**. O jogador
precisa ver as X cartas, decidir quais ficam e em que ordem, e só então confirmar.

```
INTENT_SCRY { amount: 3 }
   → servidor cria um buffer transitório: state.peekBuffer[sessionId] = [id1, id2, id3]
   → peekedBy setado nas 3
   → cliente mostra o painel de ordenação

INTENT_SCRY_COMMIT { toBottom: [id2], topOrder: [id3, id1] }
   → servidor valida: os ids pertencem ao buffer daquele jogador
   → aplica: id2 ao fundo; id3 e id1 no topo nessa ordem
   → limpa buffer e peekedBy
   → log: "Arthur fez scry 3 e colocou 1 carta no fundo"   ← contagem é pública, identidade não
```

**Regra de log:** a **quantidade** movida é pública (informação legítima de partida); a **identidade**
não. "Colocou 1 carta no fundo" é correto; "colocou Sol Ring no fundo" vazaria.

**Timeout do buffer:** 120 s. Se o jogador abandonar o painel, o servidor confirma a ordem original e
limpa. Buffer eterno travaria o grimório.

---

## 3. Mão (Hand)

| #   | Ação                                               | Intenção                                             | Priv.              | Prio  | Fase |
| --- | -------------------------------------------------- | ---------------------------------------------------- | ------------------ | ----- | ---- |
| 29  | **Jogar carta** (mão → campo)                      | `INTENT_CHANGE_ZONE {to:BATTLEFIELD}`                | Público            | **M** | MVP  |
| 30  | Jogar face para baixo                              | `INTENT_CHANGE_ZONE {to:BATTLEFIELD, faceDown:true}` | Semi               | **M** | MVP  |
| 31  | **Revelar uma carta a todos**                      | `INTENT_REVEAL {ids:[...], to:"ALL"}`                | **Público**        | **M** | MVP  |
| 32  | **Revelar uma carta a um jogador**                 | `INTENT_REVEAL {ids:[...], to:[playerId]}`           | **Dirigido**       | **S** | V1   |
| 33  | **Revelar a mão toda a todos**                     | `INTENT_REVEAL_ZONE {zone:HAND, to:"ALL"}`           | **Público**        | **S** | V1   |
| 34  | **Revelar a mão toda a um jogador**                | `INTENT_REVEAL_ZONE {zone:HAND, to:[playerId]}`      | **Dirigido**       | **S** | V1   |
| 35  | Ocultar novamente o que foi revelado               | `INTENT_UNREVEAL {ids:[...]}`                        | —                  | S     | V1   |
| 36  | **Descartar carta escolhida**                      | `INTENT_CHANGE_ZONE {to:GRAVEYARD}`                  | Público            | **M** | MVP  |
| 37  | **Descartar X aleatórias**                         | `INTENT_DISCARD_RANDOM {amount:X}`                   | Público            | **S** | V1   |
| 38  | Descartar a mão toda                               | `INTENT_DISCARD_ALL`                                 | Público            | S     | V1   |
| 39  | **Exilar da mão**                                  | `INTENT_CHANGE_ZONE {to:EXILE}`                      | Público            | **M** | MVP  |
| 40  | Exilar da mão face para baixo                      | `INTENT_CHANGE_ZONE {to:EXILE, faceDown:true}`       | Privado            | S     | V1   |
| 41  | Devolver ao grimório (topo/fundo/embaralhar)       | `INTENT_CHANGE_ZONE {to:LIBRARY, position:...}`      | Público (contagem) | **M** | MVP  |
| 42  | Ordenar a mão                                      | `INTENT_REORDER {zone:HAND}`                         | Privado            | C     | V1   |
| 43  | **Modo streamer** (esconder a própria mão da tela) | — (só cliente)                                       | —                  | C     | V2   |
| 44  | Contar cartas na mão                               | — (`handCount` público)                              | Público            | **M** | MVP  |

### 3.1 Revelação — o modelo `revealedTo`

Revelar é **persistente até ser desfeito**, diferente de `peekedBy` (que é transitório):

| Campo                             | Semântica                                           | Duração                                                |
| --------------------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| `peekedBy: string[]`              | "eu **olhei** esta carta"                           | Transitória — limpa ao fechar o painel                 |
| `revealedTo: string[]` \| `"ALL"` | "esta carta **está revelada** para estes jogadores" | Persistente — até `INTENT_UNREVEAL` ou mudança de zona |

**Limpeza automática obrigatória:** ao mudar de zona, `revealedTo` e `peekedBy` são **zerados**. Uma
carta revelada na mão que vai ao campo passa a ser pública pela zona; se voltar à mão depois, precisa
ser oculta de novo. Não zerar aqui é um vazamento permanente.

**Revelação dirigida é o caso mais delicado.** "Revele sua mão para o jogador alvo" precisa que o
`@filter` avalie pertinência em um array — e o array precisa ser barato de consultar, porque o filtro
roda milhares de vezes por segundo (`DOC-032` §7). Implementação: `revealedTo` como string curta
separada por vírgulas em vez de `ArraySchema`, verificada com `indexOf`.

---

## 4. Battlefield — estado da carta

| #   | Ação                                             | Intenção                                    | Prio  | Fase |
| --- | ------------------------------------------------ | ------------------------------------------- | ----- | ---- |
| 45  | **Virar / desvirar** (tap/untap)                 | `INTENT_TAP`                                | **M** | MVP  |
| 46  | **Desvirar tudo**                                | `INTENT_UNTAP_ALL`                          | **M** | MVP  |
| 47  | Virar tudo                                       | `INTENT_TAP_ALL`                            | C     | V1   |
| 48  | **Rotacionar 180°** (invertida)                  | `INTENT_UPDATE_PROPERTY {rotation:180}`     | **S** | V1   |
| 49  | **Phase out / in** (marcador visual)             | `INTENT_UPDATE_PROPERTY {phasedOut:bool}`   | **S** | V1   |
| 50  | **Virar face para baixo** (morph/disguise/cloak) | `INTENT_UPDATE_PROPERTY {faceDown:true}`    | **M** | MVP  |
| 51  | **Virar face para cima**                         | `INTENT_UPDATE_PROPERTY {faceDown:false}`   | **M** | MVP  |
| 52  | **Transformar** (DFC — mostrar a outra face)     | `INTENT_TRANSFORM {entityId}`               | **M** | V1   |
| 53  | Meld (juntar duas cartas em uma)                 | `INTENT_MELD {ids:[a,b], resultScryfallId}` | C     | V2   |
| 54  | **Anexar / equipar** (empilhar em outra carta)   | `INTENT_ATTACH {childId, parentId}`         | **S** | V1   |
| 55  | Desanexar                                        | `INTENT_DETACH {childId}`                   | **S** | V1   |
| 56  | Agrupar em pilha visual                          | `INTENT_GROUP {ids:[...]}`                  | C     | V2   |
| 57  | **Definir P/T sobreposto** (tokens, cópias)      | `INTENT_SET_PT {power, toughness}`          | **S** | V1   |
| 58  | **Marcar dano** (separado de -1/-1)              | `INTENT_SET_DAMAGE {amount}`                | **S** | V1   |
| 59  | Limpar dano de todas (fim de turno)              | `INTENT_CLEAR_DAMAGE`                       | S     | V1   |
| 60  | Marcador de "entrou este turno"                  | `INTENT_UPDATE_PROPERTY {enteredThisTurn}`  | C     | V1   |
| 61  | **Marcador de _goad_** (provocada)               | `INTENT_UPDATE_PROPERTY {goadedBy}`         | **S** | V1   |
| 62  | **Anotação livre na carta**                      | `INTENT_SET_NOTE {text}`                    | **S** | V1   |
| 63  | Destacar / marcar com cor                        | `INTENT_SET_HIGHLIGHT {color}`              | C     | V1   |
| 64  | Trazer para frente (z-index)                     | `INTENT_BRING_TO_FRONT`                     | **M** | MVP  |
| 65  | Definir como comandante                          | `INTENT_SET_COMMANDER`                      | **S** | V1   |
| 66  | **Criar cópia** (token cópia)                    | `INTENT_COPY_CARD`                          | **S** | V1   |
| 67  | **Ganhar controle**                              | `INTENT_SET_CONTROLLER`                     | **S** | V1   |
| 68  | Devolver controle ao dono                        | `INTENT_SET_CONTROLLER {to:owner}`          | **S** | V1   |
| 69  | Mover para qualquer zona                         | `INTENT_CHANGE_ZONE`                        | **M** | MVP  |
| 70  | Selecionar várias e agir em lote                 | `INTENT_BATCH_UPDATE`                       | **S** | V1   |

### 4.1 Face para baixo no campo — armadilha de segurança

Uma carta `faceDown` no `BATTLEFIELD` está numa zona **pública**, mas sua identidade é **privada do
controlador**. Se o `@filter` só olhar a zona, virar a carta para baixo é puramente cosmético — o
oponente lê o `scryfallId` no pacote WebSocket.

```ts
if (this.faceDown && this.zone === 'BATTLEFIELD') {
  return client.sessionId === this.controllerId; // só o controlador sabe qual é
}
```

Isto vale igualmente para **exílio face para baixo** (ação 14 e 40) — caso comum em Commander, com
efeitos de _foretell_, _plot_ e exílio temporário.

---

## 5. Contadores

| #   | Ação                                     | Intenção                                      | Prio  | Fase |
| --- | ---------------------------------------- | --------------------------------------------- | ----- | ---- |
| 71  | **Adicionar / remover contador nomeado** | `INTENT_ADD_COUNTER {entityId, name, amount}` | **M** | MVP  |
| 72  | Definir valor absoluto                   | `INTENT_SET_COUNTER {entityId, name, value}`  | S     | V1   |
| 73  | Limpar todos os contadores de uma carta  | `INTENT_CLEAR_COUNTERS {entityId}`            | S     | V1   |
| 74  | Contador em jogador (não em carta)       | `INTENT_ADD_PLAYER_COUNTER {name, amount}`    | **M** | V1   |
| 75  | Contador em lote (seleção múltipla)      | `INTENT_BATCH_COUNTER`                        | S     | V1   |

### 5.1 Contadores são string livre, não enum

```ts
// ERRADO — impossível de manter
type CounterType = 'P1_P1' | 'M1_M1' | 'CHARGE' | 'LOYALTY' | 'GENERIC';

// CORRETO
@type({ map: 'number' }) counters = new MapSchema<number>();  // "p1p1" -> 3, "oil" -> 2, "stun" -> 1
```

Magic tem mais de 100 tipos nomeados de contador, e cada coleção nova adiciona outros. Um enum fixo
quebra a cada três meses.

**Validação da chave:** `^[a-z0-9_+\-]{1,24}$` — minúsculas, sem espaço. Isso evita que o campo se
torne vetor de XSS ou de poluição de cardinalidade em métricas.

**Atalhos na UI** para os mais frequentes, com cor própria:

| Atalho             | Chave     | Cor      |
| ------------------ | --------- | -------- |
| +1/+1              | `p1p1`    | verde    |
| −1/−1              | `m1m1`    | vermelho |
| Lealdade           | `loyalty` | roxo     |
| Carga              | `charge`  | azul     |
| Óleo               | `oil`     | preto    |
| Atordoamento       | `stun`    | cinza    |
| Escudo             | `shield`  | branco   |
| Sabedoria (_lore_) | `lore`    | âmbar    |
| Genérico           | `generic` | neutro   |

Qualquer outro nome é digitado pelo jogador e aparece como _badge_ com texto.

---

## 6. Fichas, cópias e objetos criados

| #   | Ação                                                                                                | Intenção                                               | Prio  | Fase |
| --- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----- | ---- |
| 76  | **Criar ficha oficial** (busca Scryfall)                                                            | `INTENT_CREATE_TOKEN {scryfallId, amount}`             | **S** | V1   |
| 77  | **Criar ficha em branco** (nome, P/T, cor, tipo)                                                    | `INTENT_CREATE_TOKEN {name, power, toughness, colors}` | **S** | V1   |
| 78  | Criar N fichas de uma vez                                                                           | `INTENT_CREATE_TOKEN {amount:N}`                       | **S** | V1   |
| 79  | **Atalhos de ficha predefinida** — Tesouro, Pista, Comida, Sangue, Mapa, Incubadora, Poeira de Ouro | `INTENT_CREATE_TOKEN {preset:"treasure"}`              | **S** | V1   |
| 80  | Criar emblema de planeswalker                                                                       | `INTENT_CREATE_EMBLEM {scryfallId}`                    | C     | V2   |
| 81  | Destruir ficha                                                                                      | `INTENT_DESTROY_TOKEN`                                 | **S** | V1   |
| 82  | Limpar todas as fichas próprias                                                                     | `INTENT_CLEAR_TOKENS`                                  | S     | V1   |

Os atalhos da ação 79 importam mais do que parecem: fichas de Tesouro e Comida são criadas dezenas de
vezes por partida. Obrigar busca na Scryfall a cada uma seria atrito constante.

---

## 7. Zonas públicas — cemitério e exílio

| #   | Ação                                                     | Intenção                                         | Prio  | Fase |
| --- | -------------------------------------------------------- | ------------------------------------------------ | ----- | ---- |
| 83  | **Ver como lista / grade expansível**                    | — (cliente)                                      | **M** | MVP  |
| 84  | Buscar e filtrar dentro da zona                          | — (cliente)                                      | **S** | V1   |
| 85  | **Devolver à mão**                                       | `INTENT_CHANGE_ZONE {to:HAND}`                   | **M** | MVP  |
| 86  | **Devolver ao campo**                                    | `INTENT_CHANGE_ZONE {to:BATTLEFIELD}`            | **M** | MVP  |
| 87  | **Devolver ao grimório** (topo/fundo/embaralhado)        | `INTENT_CHANGE_ZONE {to:LIBRARY, position}`      | **M** | MVP  |
| 88  | Mover do cemitério ao exílio                             | `INTENT_CHANGE_ZONE {to:EXILE}`                  | **M** | MVP  |
| 89  | **Devolver a zona inteira ao grimório e embaralhar**     | `INTENT_RETURN_ZONE`                             | **S** | V1   |
| 90  | Reordenar a zona                                         | `INTENT_REORDER`                                 | C     | V1   |
| 91  | **Exílio face para baixo** (só o dono vê)                | `INTENT_CHANGE_ZONE {to:EXILE, faceDown:true}`   | **S** | V1   |
| 92  | **Exílio com referência** (agrupar por carta que exilou) | `INTENT_CHANGE_ZONE {to:EXILE, exiledBy:cardId}` | **S** | V1   |
| 93  | Contagem pública da zona                                 | —                                                | **M** | MVP  |

A ação 92 resolve um problema real: com vários efeitos de exílio ativos, o exílio se torna uma pilha
indistinguível. Agrupar visualmente "exilado por _Sanguíneo_" versus "exilado por _Portal_" é o que
permite devolver a carta certa.

---

## 8. Zona de comando e zonas auxiliares

| #   | Ação                                                          | Intenção                           | Prio  | Fase |
| --- | ------------------------------------------------------------- | ---------------------------------- | ----- | ---- |
| 94  | **Contador de taxa do comandante** (+2)                       | `INTENT_SET_COMMANDER_TAX {delta}` | **M** | MVP  |
| 95  | **Conjurar do comando** (incrementa a taxa)                   | `INTENT_CAST_COMMANDER`            | **M** | MVP  |
| 96  | **Comandante volta ao comando** em vez do cemitério           | `INTENT_CHANGE_ZONE {to:COMMAND}`  | **M** | MVP  |
| 97  | **Dois comandantes** (Partner / Background / Friends Forever) | provisionado no `onJoin`           | **S** | V1   |
| 98  | **Zona de companheiro** (Companion)                           | zona `COMPANION`                   | C     | V2   |
| 99  | **Sideboard / wishboard acessível na mesa**                   | `INTENT_FETCH_FROM_SIDEBOARD`      | **S** | V1   |

A ação 99 atende _Wish_, _Learn/Lesson_, _Karn, the Great Creator_ e _Spawnsire_ — todos precisam
puxar carta de fora do deck durante a partida. Sem isso, essas cartas são injogáveis na plataforma.

---

## 9. Estado do jogador

| #   | Ação                                            | Intenção                                     | Prio  | Fase |
| --- | ----------------------------------------------- | -------------------------------------------- | ----- | ---- |
| 100 | **Vida** (delta ou absoluto)                    | `INTENT_SET_LIFE`                            | **M** | MVP  |
| 101 | **Matriz de dano de comandante**                | `INTENT_SET_COMMANDER_DAMAGE`                | **M** | V1   |
| 102 | **Veneno**                                      | `INTENT_ADD_PLAYER_COUNTER {name:"poison"}`  | **M** | V1   |
| 103 | **Energia**                                     | `{name:"energy"}`                            | **M** | V1   |
| 104 | **Experiência**                                 | `{name:"experience"}`                        | **M** | V1   |
| 105 | **Radiação** (_rad_)                            | `{name:"rad"}`                               | **S** | V1   |
| 106 | Tickets                                         | `{name:"ticket"}`                            | C     | V2   |
| 107 | **Monarca**                                     | `INTENT_TOGGLE_DESIGNATION {type:"MONARCH"}` | **M** | V1   |
| 108 | **Iniciativa**                                  | `{type:"INITIATIVE"}`                        | **M** | V1   |
| 109 | **Bênção da Cidade** (Ascend)                   | `{type:"CITYS_BLESSING"}`                    | **S** | V1   |
| 110 | **Dia / Noite**                                 | `INTENT_SET_DAY_NIGHT`                       | **S** | V1   |
| 111 | **O Anel te tenta** (nível 1–4) + Portador      | `INTENT_SET_RING {level, bearerId}`          | **S** | V1   |
| 112 | **Masmorra** (Undercity / Lost Mine / Mad Mage) | `INTENT_VENTURE {dungeon, room}`             | C     | V2   |
| 113 | **Velocidade** (_Start your engines!_, 1–4)     | `INTENT_SET_SPEED {value}`                   | C     | V1   |
| 114 | Tamanho máximo de mão                           | `INTENT_SET_MAX_HAND_SIZE`                   | C     | V2   |
| 115 | **Conceder / marcar eliminado**                 | `INTENT_CONCEDE`                             | **S** | V1   |
| 116 | Ordem de turno / quem começa                    | `INTENT_SET_TURN_ORDER`                      | **S** | V1   |

Itens 105 e 109–113 são mecânicas de designação que existem **por jogador** e não caberiam em
contadores de carta. Todas são marcadores visuais — o sistema não impõe efeito algum (`RN01`).

---

## 10. Aleatoriedade

| #   | Ação                                      | Intenção                          | Prio  | Fase |
| --- | ----------------------------------------- | --------------------------------- | ----- | ---- |
| 117 | **Dados** d2 d4 d6 d8 d10 d12 d20 d100    | `INTENT_ROLL_DICE {sides}`        | **M** | V1   |
| 118 | Dado com lados arbitrários                | `INTENT_ROLL_DICE {sides:N}`      | S     | V1   |
| 119 | Rolar vários dados de uma vez             | `INTENT_ROLL_DICE {sides, count}` | S     | V1   |
| 120 | **Cara ou coroa**                         | `INTENT_FLIP_COIN`                | **M** | V1   |
| 121 | **Escolher jogador aleatório**            | `INTENT_RANDOM_PLAYER`            | **S** | V1   |
| 122 | **Carta aleatória de uma zona**           | `INTENT_RANDOM_CARD {zone}`       | **S** | V1   |
| 123 | Planechase — dado planar + deck de planos | `INTENT_PLANESWALK`               | C     | V2   |
| 124 | Archenemy — deck de esquemas              | `INTENT_DRAW_SCHEME`              | C     | V2   |

Tudo resolvido no servidor com `crypto.randomInt` (`RN06`). A ação 122 é usada por descarte aleatório
(ação 37) e por efeitos de "escolha ao acaso".

---

## 11. Mesa e comunicação

| #   | Ação                                               | Intenção                             | Prio  | Fase |
| --- | -------------------------------------------------- | ------------------------------------ | ----- | ---- |
| 125 | **Ping** (apontar um ponto)                        | `INTENT_PING {x,y}`                  | **S** | V1   |
| 126 | **Seta de alvo** (origem → destino)                | `INTENT_ARROW {fromId, toId, color}` | **M** | V1   |
| 127 | **Rastreador de turno e fase**                     | `INTENT_SET_TURN {turn, phase}`      | **S** | V1   |
| 128 | **Passar o turno**                                 | `INTENT_PASS_TURN`                   | **S** | V1   |
| 129 | **Zona de pilha visual** (cartas sendo conjuradas) | zona `STACK`                         | **S** | V1   |
| 130 | **Desfazer última ação**                           | `INTENT_UNDO`                        | **S** | V1   |
| 131 | Chat, log, notas, timer                            | `INTENT_CHAT`, `INTENT_SET_NOTE`     | **M** | MVP  |

### 11.1 Setas de alvo (ação 126) — mais importante do que parece

Num sandbox sem motor de regras, **a seta é a forma de dizer "isto está atacando aquilo"** ou "este
feitiço tem aquele alvo". Sem seta, o grupo recorre a voz para tudo e a mesa fica ambígua — quem atacou
quem, qual criatura bloqueou qual.

É o recurso que mais separa um sandbox utilizável de um frustrante. Marcado como **Must** apesar de não
constar da especificação original.

Modelo: seta persistente até ser removida, com origem, destino e cor por jogador. Setas de combate
são limpas ao passar o turno.

### 11.2 Zona de pilha visual (ação 129)

Não é motor de regras — é uma **área de apoio** onde os jogadores colocam as cartas sendo conjuradas,
para que todos vejam o que está "no ar" antes de resolver. O sistema não ordena, não resolve e não
valida: só oferece o espaço. Coerente com `RN01`.

### 11.3 Desfazer (ação 130)

Sem motor de regras, erros de manipulação são frequentes — arrastar a carta errada, comprar duas vezes,
descartar por engano. O "desfazer" é o que evita que cada erro se torne uma negociação verbal.

| Regra                           | Detalhe                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| Escopo                          | Apenas a **última** ação do próprio jogador                                                    |
| Janela                          | 10 segundos                                                                                    |
| **Não desfaz** ações aleatórias | Embaralhar, dado, descarte aleatório, carta aleatória — desfazer daria nova tentativa (`RN06`) |
| **Não desfaz** revelação        | Informação revelada não volta a ser secreta                                                    |
| Log                             | "Arthur desfez: comprar 1 carta" — sempre público                                              |
| Implementação                   | Pilha de _inverse patches_ por jogador, profundidade 1                                         |

A exclusão de ações aleatórias e de revelações é o que impede que "desfazer" se torne trapaça.

---

## 12. Resumo de cobertura

| Categoria            | Ações   | Estavam na v1.0 | Adicionadas |
| -------------------- | ------- | --------------- | ----------- |
| Grimório             | 28      | 7               | **21**      |
| Mão                  | 16      | 3               | **13**      |
| Battlefield          | 26      | 10              | **16**      |
| Contadores           | 5       | 1               | **4**       |
| Fichas e cópias      | 7       | 4               | 3           |
| Zonas públicas       | 11      | 2               | **9**       |
| Comando e auxiliares | 6       | 2               | 4           |
| Jogador              | 17      | 5               | **12**      |
| Aleatoriedade        | 8       | 2               | 6           |
| Mesa                 | 7       | 4               | 3           |
| **Total**            | **131** | **40**          | **91**      |

### 12.1 Lacunas assumidas (não implementaremos)

| Item                                     | Motivo                                                     |
| ---------------------------------------- | ---------------------------------------------------------- |
| Resolução automática da pilha            | É motor de regras (`RN01`)                                 |
| Cálculo de mana disponível               | Idem                                                       |
| Validação de alvos legais                | Idem                                                       |
| Detecção de morte de criatura            | Idem                                                       |
| Aplicação de camadas / efeitos contínuos | Idem                                                       |
| Vanguard, Conspiracy (draft)             | Formatos fora de escopo                                    |
| Rollback completo de partida             | Complexidade alta; "desfazer" de 1 nível cobre o caso real |

---

## 13. Impacto nos outros documentos

Este catálogo obriga mudanças em quatro lugares:

| Documento                                                                                              | Mudança necessária                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [especificacao_do_motor_sandbox.md](especificacao_do_motor_sandbox.md)                                 | **Novo modelo de visibilidade** (`revealedTo`, `peekedBy`, `faceDown`); contadores como string livre; novos campos de `Card` e `Player`; zonas `STACK`, `COMPANION`, `SIDEBOARD` |
| [especificacao_websocket_e_eventos.md](especificacao_websocket_e_eventos.md)                           | Dicionário de intenções ampliado de ~30 para ~70 nomes                                                                                                                           |
| [especificacao_do_motor_de_estado_state_machine.md](especificacao_do_motor_de_estado_state_machine.md) | Buffer de scry/surveil; pilha de desfazer; limpeza de `revealedTo`/`peekedBy` em troca de zona                                                                                   |
| [documento_de_funcionalidades.md](documento_de_funcionalidades.md)                                     | Novas `Fnn` para as categorias adicionadas                                                                                                                                       |

---

## 14. Checklist de conformidade

- [ ] Modelo de visibilidade de 6 fatores implementado no `@filter`.
- [ ] `peekedBy` **limpo** ao fechar o painel de olhar.
- [ ] `revealedTo` e `peekedBy` **zerados** em toda troca de zona.
- [ ] `faceDown` no `BATTLEFIELD` e no `EXILE` filtra a identidade.
- [ ] Contadores como chave string validada, não enum.
- [ ] Buffer de scry/surveil com timeout de 120 s.
- [ ] Log publica **contagem**, nunca identidade de carta oculta.
- [ ] Memória de cartas já vistas fica no **cliente**, não no `Schema`.
- [ ] Setas de alvo implementadas (ação 126 — Must).
- [ ] Desfazer não cobre ação aleatória nem revelação.
- [ ] Atalhos de ficha (Tesouro, Comida, Pista, Sangue, Mapa).
- [ ] Sideboard acessível durante a partida (ação 99).
- [ ] Auditoria de pacote (`G1`) estendida a: olhar, revelar dirigido, exílio face para baixo.
