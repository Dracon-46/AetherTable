# Sandbox & Game State Specification

| Campo                       | Valor                                                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                      | `DOC-032`                                                                                                                                                                                                                                                                 |
| **Versão**                  | 1.1                                                                                                                                                                                                                                                                       |
| **Status**                  | Estável                                                                                                                                                                                                                                                                   |
| **Última revisão**          | 2026-08-20                                                                                                                                                                                                                                                                |
| **Documentos relacionados** | [readme.md](readme.md) · [especificacao_do_motor_de_estado_state_machine.md](especificacao_do_motor_de_estado_state_machine.md) · [especificacao_websocket_e_eventos.md](especificacao_websocket_e_eventos.md) · [seguranca_e_privacidade.md](seguranca_e_privacidade.md) |

> **Fonte canônica do `Schema`.** Este documento define a **estrutura** do estado da sala: as classes,
> os campos, as zonas e as regras de visibilidade. Para o **comportamento** (qual intenção causa qual
> mutação, _locks_, máquina de estados), use
> [especificacao_do_motor_de_estado_state_machine.md](especificacao_do_motor_de_estado_state_machine.md).

---

## 1. Princípio: física sim, regras não

Apesar de não validarmos regras de Magic, o motor precisa manter **leis da física e estrutura de
zonas** — sem isso o resultado é caos, não liberdade.

| O motor **impõe**                                   | O motor **não impõe**                        |
| --------------------------------------------------- | -------------------------------------------- |
| Uma carta existe em exatamente uma zona             | Se a carta podia ser jogada agora            |
| Uma carta em zona oculta é invisível para os outros | Se o jogador tinha mana                      |
| Só quem controla a carta pode movê-la               | Se o efeito da carta resolveu                |
| Embaralhar produz ordem aleatória verificável       | Quantas cartas podem ser compradas por turno |
| Contadores são números inteiros ≥ 0                 | Se a criatura deveria morrer                 |
| Dois jogadores não arrastam a mesma carta           | De quem é a prioridade                       |

Essa é a fronteira da `RN01`: **restrição física é legítima; julgamento de regra não é.**

---

## 2. Sistema de zonas

Cada carta instanciada tem uma propriedade `zone`. A zona determina **visibilidade de rede** e
**regras de movimento**.

| Zona          | Visibilidade          | Estrutura                      | Coordenadas                       | Observações                               |
| ------------- | --------------------- | ------------------------------ | --------------------------------- | ----------------------------------------- |
| `BATTLEFIELD` | **Pública**           | Livre                          | `x`, `y` em fração (§3), `zIndex` | Oponentes veem tudo                       |
| `COMMAND`     | **Pública**           | Ancorada em painel             | Posição fixa por _slot_           | Exibe `commanderTax`                      |
| `GRAVEYARD`   | **Pública**           | Array ordenada                 | Não usa `x`/`y`                   | Vira lista de UI; último inserido no topo |
| `EXILE`       | **Pública**           | Array ordenada                 | Não usa `x`/`y`                   | Idem                                      |
| `HAND`        | **Oculta** (dono)     | Array ordenada                 | Não usa `x`/`y`                   | `scryfallId` **filtrado**                 |
| `LIBRARY`     | **Oculta e ordenada** | _Stack_ (topo = último índice) | Não usa `x`/`y`                   | Apenas `.length` é público                |

### 2.1 Transições de zona permitidas

Todas as transições são permitidas — é um sandbox. O motor apenas garante consistência:

```
        ┌──────────────────────────────────────────────┐
        │                                              │
   LIBRARY ──► HAND ──► BATTLEFIELD ──► GRAVEYARD ──► EXILE
        ▲       ▲  ▲         │  ▲            │  ▲       │
        │       │  └─────────┘  └────────────┘  └───────┘
        └───────┴─────────────── (qualquer zona pode voltar
                                  para qualquer outra)
                       COMMAND ◄──► BATTLEFIELD
```

**Efeitos colaterais obrigatórios de cada transição:**

| Ao entrar em                                          | O motor faz                                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `BATTLEFIELD`                                         | Atribui `x`, `y` e `zIndex`; mantém `isTapped`/`counters` se veio do próprio Battlefield, senão zera |
| `HAND`                                                | Zera `x`, `y`, `isTapped`, `counters`, `faceDown`; **recalcula visibilidade**                        |
| `LIBRARY`                                             | Zera tudo; insere no índice indicado (topo, fundo ou posição)                                        |
| `GRAVEYARD` / `EXILE`                                 | Zera `isTapped` e `counters`; empilha no fim do array                                                |
| `COMMAND`                                             | Zera contadores; ancora no _slot_ do dono                                                            |
| Qualquer zona ≠ `BATTLEFIELD`                         | Limpa o `attachedTo` da carta, **desanexa** as que estavam presas a ela e apaga as setas de/para ela |
| Qualquer zona ≠ `BATTLEFIELD`, sendo `isToken = true` | **Destrói o objeto** e tira o id da ordem do destino — fichas deixam de existir fora do campo        |

**Fora do campo, nada fica pendurado na carta.** `attachedTo` nunca era limpo: a aura que ia para o
cemitério voltava "anexada", e o hospedeiro que morria deixava as auras apontando para uma carta no
cemitério. As setas também sobreviviam — a de uma criatura morta reaparecia quando ela voltava.

**A ficha sai também da lista de ordem.** Quem chama já empurrou o id na ordem do destino; apagar só a
carta deixava o id órfão, e o topo do cemitério — lido da ordem — mostrava um fantasma vazio. A ficha
apagada **não é reconciliada**: tirá-la do mapa já a some de todas as views, e reconciliar uma
instância desanexada lança no Colyseus ("detached instance") — mover uma ficha virada para fora do
campo respondia `INTERNAL` e abortava o lote inteiro.

---

## 3. Modelo de estado da sala (`Schema` do Colyseus)

Este é o coração da partida: vive na RAM do game node e, opcionalmente, em _snapshot_ no Redis.

```ts
// game-server/src/schema/Card.ts
import { Schema, type, filter, MapSchema } from '@colyseus/schema';

export class Card extends Schema {
  @type('string') id!: string; // UUID desta carta nesta partida
  @type('string') ownerId!: string; // dono do deck — NUNCA muda
  @type('string') controllerId!: string; // quem manipula agora (RN08)
  @type('string') zone!: string; // BATTLEFIELD | HAND | LIBRARY | STACK | ...

  // ───────────────────────────────────────────────────────────────
  //  CAMPO CRÍTICO — a identidade da carta.
  //  Sai do servidor SOMENTE para quem CONQUISTOU o direito de ver.
  //  Ver §4 para a tabela de decisão completa (RN02, RN13, FR-06).
  // ───────────────────────────────────────────────────────────────
  @filter(function (this: Card, client: { sessionId: string }) {
    return podeVer(this, client.sessionId);
  })
  @type('string')
  scryfallId!: string;

  // ── concessões de visibilidade (RN13) ────────────────────────────
  // Strings com sessionIds separados por vírgula, não ArraySchema:
  // o filtro roda ~30.000×/s por sala e indexOf sobre string curta
  // é mais barato que iterar coleção (§7).
  @type('string') revealedTo = ''; // 'ALL' | 'sid1,sid2' — persistente até troca de zona
  @type('string') peekedBy = ''; // 'sid1,sid2' — transitório, limpo ao fechar o painel

  @type('number') x = 0; // FRAÇÃO (0–1) do campo de quem controla; (0, 0) = sem coordenada → centro
  @type('number') y = 0;
  @type('number') rotation = 0; // 0 = normal, 90 = virada, 180 = invertida
  @type('number') zIndex = 0;
  @type('boolean') isTapped = false;
  @type('boolean') faceDown = false; // morph / manifest / disguise / exílio oculto
  @type('boolean') phasedOut = false; // marcador visual
  @type('boolean') isToken = false;
  @type('boolean') isCopy = false;
  @type('boolean') isFlipped = false; // DFC mostrando a face de trás
  @type('string') lockedBy = ''; // sessionId de quem arrasta (FR-10)
  @type('string') attachedTo = ''; // equipamento / aura anexada a outra carta
  @type('string') exiledBy = ''; // agrupa o exílio pela carta que exilou (ação 92)
  @type('string') goadedBy = ''; // marcador de provocada
  @type('string') note = ''; // anotação livre do jogador (máx. 120 caracteres)
  @type('string') highlight = ''; // cor de destaque
  @type('number') damage = 0; // dano marcado, distinto de -1/-1
  @type('number') powerOverride = 0; // P/T sobreposto para fichas e cópias
  @type('number') toughnessOverride = 0;

  // contadores com chave STRING LIVRE, não enum: Magic tem 100+ tipos
  // nomeados e cada coleção adiciona outros. Chave: ^[a-z0-9_+\-]{1,24}$
  @type({ map: 'number' }) counters = new MapSchema<number>(); // "p1p1" -> 3, "oil" -> 2
}
```

**`x`/`y` no campo são fração, não pixel.** Guardavam pixels do campo de quem controla, no monitor
dele, e eles não cabiam no campo de quem olhava: no trilho dos oponentes, onde o campo é estreito,
todo valor passava da borda e o _clamp_ empilhava as permanentes numa coluna só; e dois jogadores com
telas diferentes viam arranjos diferentes. Agora o arranjo é o mesmo em qualquer tela e só a escala
muda (`posicaoNoCampo` no cliente). `(0, 0)` continua significando "sem coordenada — centralize", e
por isso o cliente nunca envia 0 exato (mínimo `0.0001`). Os deslocamentos do servidor seguem a
mesma unidade: `INTENT_COPY_CARD` +0,03 do original (do centro, se ele não tinha coordenada),
`INTENT_CREATE_TOKEN` +0,03 por ficha extra, e `INTENT_CAST_COMMANDER` e `INTENT_RESET_MATCH` gravam
`(0, 0)` — antes, `(960, 620)` de um plano de 1920×1080 que não existe mais.

### 3.0.1 A função de decisão `podeVer`

Extraída do decorador para poder ser testada isoladamente — é o trecho de código mais crítico do
sistema inteiro.

```ts
// game-server/src/schema/visibility.ts
const ZONA_OCULTA = new Set(['HAND', 'LIBRARY']);
const ZONA_PUBLICA = new Set(['BATTLEFIELD', 'GRAVEYARD', 'EXILE', 'COMMAND', 'STACK']);

/** Único ponto de decisão de visibilidade de identidade de carta. */
export function podeVer(card: Card, sid: string): boolean {
  // 1. Revelação explícita vence tudo (RN13) — inclusive zona oculta.
  if (card.revealedTo === 'ALL') return true;
  if (card.revealedTo && contem(card.revealedTo, sid)) return true;

  // 2. Olhada explícita e ainda ativa (RN13).
  if (card.peekedBy && contem(card.peekedBy, sid)) return true;

  // 3. Face para baixo: a zona é pública, a identidade não.
  //    Vale para BATTLEFIELD (morph) e EXILE (foretell/plot) — SÓ em zona pública.
  if (card.faceDown && ZONA_PUBLICA.has(card.zone)) return sid === card.controllerId;

  // 4. Zonas públicas com a face para cima: todos veem.
  if (ZONA_PUBLICA.has(card.zone)) return true;

  // 5. Mão: só o dono.
  if (card.zone === 'HAND') return sid === card.ownerId;

  // 6. Grimório: NINGUÉM — nem o dono (§4.3).
  //    Só se chega aqui via revelação ou olhada, tratadas em 1 e 2.
  if (card.zone === 'LIBRARY') return false;

  // 7. Zona desconhecida: nega por padrão. Falha fechada, nunca aberta.
  return false;
}

/** Busca de sessionId em lista separada por vírgula, com fronteiras. */
function contem(lista: string, sid: string): boolean {
  const i = lista.indexOf(sid);
  if (i === -1) return false;
  const antes = i === 0 || lista.charCodeAt(i - 1) === 44; // ',' ou início
  const fim = i + sid.length;
  const depois = fim === lista.length || lista.charCodeAt(fim) === 44;
  return antes && depois;
}
```

**Ordem das cláusulas importa.** Revelação e olhada vêm **antes** da checagem de zona, porque são
exatamente os casos em que a zona diz "oculto" e a concessão explícita diz "este jogador pode".

**A cláusula 3 só vale em zona pública.** Ela valia em qualquer zona e vinha antes da regra do
grimório: um `INTENT_BATCH_UPDATE` com `faceDown` sobre as cartas do próprio grimório fazia o dono
passar a vê-las — o grimório inteiro, sem uma linha no log. Virada na mão ou no grimório continua
governada pela regra da zona, e `INTENT_UPDATE_PROPERTY`/`INTENT_BATCH_UPDATE` ignoram `faceDown`
fora de `BATTLEFIELD`/`EXILE`.

**A cláusula 7 é a mais importante para segurança:** zona desconhecida **nega**. Se alguém adicionar
uma zona nova e esquecer de tratá-la aqui, o efeito é a carta ficar invisível — um bug visível e
inofensivo. O oposto (liberar por padrão) seria um vazamento silencioso. **Falha sempre fechada.**

**A função `contem` existe para evitar falso positivo por substring.** Um `indexOf` cru faria o
`sessionId` `abc` casar dentro de `xabcy`. A verificação de fronteira por vírgula resolve isso sem
alocar array — relevante porque essa função roda dezenas de milhares de vezes por segundo (§7).

```ts
// game-server/src/schema/Player.ts
export class Player extends Schema {
  @type('string') id!: string; // sessionId
  @type('string') userId!: string; // id persistente da conta
  @type('string') name!: string;
  @type('string') avatarUrl = '';
  @type('string') playmatUrl = ''; // URL do playmat
  @type('string') sleeveUrl = ''; // URL da estampa do verso da carta
  @type('string') profileBorder = ''; // Borda animada
  @type('string') chatTitle = ''; // Título no log
  @type('number') seat = 0; // 0..3 — posição na mesa

  @type('number') life = 40; // sobrescrito pela `vidaInicial` do formato (§6.1)
  @type('number') poison = 0;
  @type('number') energy = 0;
  @type('number') experience = 0;
  @type('number') commanderTax = 0;
  @type('boolean') isMonarch = false;
  @type('boolean') hasInitiative = false;

  // dano de comandante recebido, por jogador de origem
  @type({ map: 'number' }) commanderDamage = new MapSchema<number>();

  // espelhos públicos de contagem — o array em si é filtrado (§4.2)
  @type('number') handCount = 0;
  @type('number') libraryCount = 0;

  @type('boolean') connected = true;
  @type('number') disconnectedAt = 0; // epoch ms; 0 = conectado
}
```

```ts
// game-server/src/schema/RoomState.ts
export class RoomState extends Schema {
  @type('string') roomCode!: string;
  @type('string') phase = 'PLAYING'; // WAITING | PLAYING | PAUSED | CLOSING
  @type('number') turn = 1; // marcador VISUAL apenas (F29)
  @type('string') activePlayerId = ''; // marcador VISUAL apenas
  @type('number') startedAt = 0;

  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Card }) cards = new MapSchema<Card>();

  // ordem por zona: zoneOrder["p1:LIBRARY"] = ArraySchema<cardId>
  @type({ map: ['string'] }) zoneOrder = new MapSchema<ArraySchema<string>>();

  // ─── configuração da sala (escolhida na criação) ───────────────────────
  @type('number') maxSeats = 4;
  @type('string') gameType = 'commander';
  @type('string') nome = '';
  @type('string') visibilidade = 'PRIVADA'; // PRIVADA | PUBLICA
  @type('string') comunicacao = 'QUALQUER'; // QUALQUER | VOZ | TEXTO
  @type('string') idioma = 'pt-BR';
  @type('number') nivelDePoder = 0; // 0 = não declarado

  // ─── regras de jogo (ajustadas na sala de espera) ──────────────────────
  @type('string') tipoDeMulligan = 'COMMANDER'; // COMMANDER | LONDON | LIVRE — padrão do formato (DOC-031 §3.7)
  @type('string') jogadorInicial = ''; // '' = sortear
  @type('boolean') ordemPelosAssentos = false;
  @type('boolean') sideboardPermitido = false;
  @type('number') cronometroDeTurno = 0; // segundos; 0 = desligado
  @type('number') turnoIniciadoEm = 0; // epoch ms

  // ─── plateia ───────────────────────────────────────────────────────────
  @type({ map: Espectador }) espectadores = new MapSchema<Espectador>();

  // ─── votação para remover um jogador (INTENT_VOTE_KICK) ────────────────
  @type('string') votacaoAlvo = ''; // sessionId do alvo; '' = nenhuma aberta
  @type('string') votacaoAutor = ''; // sessionId de quem propôs
  @type('string') votacaoSim = ''; // sessionIds que votaram sim, separados por vírgula
  @type('number') votacaoExpiraEm = 0; // epoch ms
  @type('number') vidaInicial = 0; // vida combinada no lobby; 0 = a do formato

  // marcadores visuais: dayNight, turnPhase, arrows
}
```

Os quatro campos de votação são **estado, e não mensagem**: quem entra ou reconecta no meio de uma
votação precisa vê-la correndo, e um evento efêmero já teria passado. Estão no **fim** da classe pela
regra de §3.0.2. A regra da votação está em `DOC-031` §3.7.

### 3.0.2 Campo novo vai NO FIM. Sem exceção.

`@colyseus/schema` serializa **por índice de campo**. Um campo inserido no meio
desloca todos os seguintes, e o cliente decodifica lixo — sem erro, sem aviso,
sem nada no console. Foi assim que `Player.mulliganCount` fez a mesa parar de
receber cartas.

Depois de tocar qualquer schema, rode `pnpm schema:sync`. O `mirror.spec.ts`
falha se você esquecer, e o `schema:check` do CI também.

### 3.0.3 Por que a configuração vive no estado, e não na querystring

`maxClients` e `gameType` viajavam em `/play/CODE?maxClients=4&gameType=...` e
de lá para o `joinOrCreate`. **Quem entra pelo código nunca recebeu essas
opções**: a sala de espera do convidado mostrava números inventados enquanto a
do criador mostrava os certos.

O contrato da configuração é `ConfigDeSala`, em `@aethertable/shared-types`, e
quem a grava é `normalizarConfigDeSala` — a mesma função que o formulário do
navegador chama antes de enviar e que a API chama ao validar. As opções chegam
ao `onCreate` **escritas pelo navegador e sem assinatura**; a configuração
autorizada vem depois, na claim `cfg` do seat token, aplicada no `onAuth` do
primeiro cliente (que é sempre o criador).

### 3.0.4 A plateia tem mapa próprio

`espectadores` é separado de `players` porque **`state.players` significa
exatamente "quem está jogando"**, e muito código depende disso sem dizer. Um
`Player` com `seat = -1` quebraria quatro coisas em silêncio:

1. `removerJogador` reordena assentos e daria o assento 0 ao espectador — quer
   dizer, o papel de anfitrião;
2. `INTENT_START_MATCH` esperaria um "pronto" que ele não tem como dar;
3. a checagem de grimório o barraria por deck ausente;
4. `INTENT_PASS_TURN` passaria a vez para quem só está olhando.

Visibilidade não precisou de cláusula nova: `podeVer` (§3.0.1) já nega toda
zona oculta a quem não é dono nem controller, e o espectador não é nenhum dos
dois em carta nenhuma.

### 3.1 Por que `zoneOrder` separado das cartas

`HAND`, `LIBRARY`, `GRAVEYARD` e `EXILE` são **ordenadas**, e a ordem importa (topo do grimório,
sequência do cemitério). Guardar a ordem como um índice dentro de `Card` obrigaria a reindexar N
cartas a cada inserção — N _patches_ para uma única compra.

Com `zoneOrder`, comprar uma carta gera: uma mutação em `Card.zone`, uma remoção em
`zoneOrder["p1:LIBRARY"]` e uma inserção em `zoneOrder["p1:HAND"]`. Barato e claro.

> **Cuidado de segurança:** `zoneOrder` contém **IDs de mesa** (`Card.id`), não `scryfallId`. Conhecer
> a ordem dos UUIDs de um grimório não revela nada — os UUIDs são gerados por partida e não têm
> relação com a identidade da carta. Ainda assim, a ordem de `LIBRARY`/`HAND` **também** deve ser
> filtrada, para não vazar informação estrutural (quantas cartas foram do topo para o fundo, etc.).

### 3.2 Desfazer: recorte do estado e o que não volta

`INTENT_UNDO` restaura um **recorte** tirado antes da última intenção do jogador
(`services/undo.ts`): as cartas que ele tinha, as listas de ordem dele e o `Player` dele — que agora
inclui `decked`, sem o qual desfazer a compra do grimório vazio não revivia o jogador. Quando a carta
restaurada é de **outro dono**, as listas desse dono são corrigidas **cirurgicamente**: o id sai de
todas as listas dele e volta só para a da zona restaurada. Antes só as listas de quem desfez voltavam,
e uma carta alheia mandada ao grimório do dono e desfeita ficava no campo **e** no grimório dele — a
próxima compra a puxava para a mão. Restaurar a lista inteira do dono apagaria o que ele fez nesses
dez segundos.

**O desfazer nunca funcionou pela sala.** O `HistoricoDeComandos` apagava a entrada do remetente
**antes** de executar uma intenção irreversível — e o próprio `INTENT_UNDO` é irreversível: o handler
perguntava pelo histórico já apagado e todo "desfazer" respondia "nada para desfazer". Os testes
chamavam `desfazer()` direto e nunca passavam pela sala. Agora executa e **depois** apaga.

**Irreversíveis novos** (`NAO_REVERSIVEIS`), além de aleatoriedade, olhadas e revelações:

| Intenções                                                          | Por que não voltam                                                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `_DRAW`, `_DRAW_UP_TO`, `_MILL`                                    | Desfazer devolvia ao topo, na mesma ordem, cartas já vistas — uma olhada grátis                        |
| `_CHANGE_ZONE` / `_BATCH_CHANGE_ZONE` **saindo do `LIBRARY`**      | Idem; decidido **por carta** em `ComandoDeIntencao.reversivel()`, antes do handler rodar               |
| `_CREATE_TOKEN`, `_COPY_CARD`                                      | O recorte só conhece as cartas que já existiam: as novas ficavam, e o "desfeito" não mudava nada       |
| `_TOGGLE_DESIGNATION`, `_PASS_TURN`, `_SET_TURN`, `_SET_DAY_NIGHT` | Estado da **mesa**: o recorte restaurava só quem desfez (a mesa ficava sem monarca, a vez não voltava) |
| `_SCRY_COMMIT`, `_SURVEIL_COMMIT`                                  | Devolveria a ordem antiga sem devolver a sessão (`DOC-031` §3.2.1, invariante 9)                       |
| `_VOTE_KICK`                                                       | Voto dado é voto dado — e o último já tirou alguém da sala                                             |

Uma ação irreversível também **invalida o passado** do jogador: desfazer "por cima" dela restauraria
um estado que não existe mais.

---

## 4. Visibilidade e filtragem

### 4.1 A tabela de decisão do `@filter`

Avaliada **na ordem**. A primeira linha que casa decide. Implementação em `podeVer()`, §3.0.1.

| #   | Condição                                                         | `scryfallId` é enviado?         | Regra         |
| --- | ---------------------------------------------------------------- | ------------------------------- | ------------- |
| 1   | `revealedTo === 'ALL'`                                           | ✅ **Sim, a todos**             | `RN13`        |
| 2   | `sid ∈ revealedTo`                                               | ✅ Sim, aos escolhidos          | `RN13`        |
| 3   | `sid ∈ peekedBy`                                                 | ✅ Sim, enquanto a olhada durar | `RN13`        |
| 4   | `faceDown` **e** zona pública                                    | Só se `sid === controllerId`    | §4.3          |
| 5   | Zona ∈ {`BATTLEFIELD`, `GRAVEYARD`, `EXILE`, `COMMAND`, `STACK`} | ✅ Sim                          | Zona pública  |
| 6   | Zona = `HAND`                                                    | Só se `sid === ownerId`         | `RN02`        |
| 7   | Zona = `LIBRARY`                                                 | ❌ **Não — a ninguém**          | §4.4          |
| 8   | Zona desconhecida                                                | ❌ **Não**                      | Falha fechada |

**Por que revelação e olhada vêm antes da zona:** são exatamente os casos em que a zona diz "oculto" e
uma ação explícita do jogador diz "este pode ver". Inverter a ordem tornaria `INTENT_PEEK` e
`INTENT_REVEAL` inoperantes em zona oculta — ou seja, em todos os casos que importam.

### 4.1.1 Visibilidade só existe se for conquistada (`RN13`)

O modelo tem duas concessões, com durações diferentes:

| Campo        | Semântica                                 | Concedido por                                                        | Revogado por                                         |
| ------------ | ----------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------- |
| `peekedBy`   | "eu **olhei** esta carta"                 | `INTENT_PEEK`, `INTENT_SCRY`, `INTENT_SURVEIL`, `INTENT_SEARCH_ZONE` | Fechar o painel · _timeout_ de 120 s · troca de zona |
| `revealedTo` | "esta carta **está revelada** para estes" | `INTENT_REVEAL`, `INTENT_REVEAL_ZONE`, `INTENT_REVEAL_TOP`           | `INTENT_UNREVEAL` · **troca de zona**                |

**Sem a ação, o dado não existe no cliente.** Não está escondido, não está num campo ignorado, não
está em memória — **nunca foi serializado**. Modificar o frontend não dá acesso porque não há nada para
desbloquear.

**Toda concessão gera log público** (`RN09`): os oponentes sempre sabem _que_ houve uma olhada, sem
saber _o que_ foi visto. Isso torna o histórico da partida uma auditoria completa de acesso.

### 4.1.2 Limpeza obrigatória em troca de zona

```ts
// SEMPRE, em applyZoneEffects (DOC-033 §4)
card.revealedTo = '';
card.peekedBy = '';
```

Sem isso, o vazamento é permanente: uma carta revelada na mão que vai ao campo e volta à mão
continuaria visível a todos para sempre. **É o erro mais fácil de cometer neste modelo** e o teste `G1`
tem um caso específico para ele.

**Limpar a concessão da carta não é revogar a permissão da zona.** `INTENT_SHUFFLE`,
`INTENT_MULLIGAN`, `INTENT_MOVE_TOP_TO_BOTTOM` e `INTENT_RETURN_ZONE` chamam `limparConcessoes` e,
logo depois, `reaplicarPermissaoDeZona`, que regrava o `revealedTo` a partir do `sharedZones` do
**dono**. Antes, embaralhar revogava o grimório que o dono tinha compartilhado, embora `sharedZones`
continuasse dizendo que sim.

### 4.1.3 Memória de cartas já vistas fica no cliente

Quando um jogador olha o topo do grimório e a carta permanece lá, ele legitimamente **lembra** qual é —
como no jogo físico. Mas manter `peekedBy` para preservar essa memória entregaria a identidade no
`Schema` de forma permanente, e uma olhada em "as 10 do topo" viraria conhecimento perpétuo.

Solução: o **cliente** guarda a anotação (`uiStore.rememberedCards`), o servidor não participa. Memória
do jogador é do jogador, não do protocolo.

### 4.2 Contagens públicas

Como o array filtrado não expõe tamanho de forma confiável, mantemos inteiros espelhados:
`Player.handCount` e `Player.libraryCount`. Atualizados na mesma mutação que altera a zona.

Redundância deliberada: é mais simples e mais seguro do que depender do comportamento interno do
serializador.

### 4.3 `faceDown` é público, a identidade não

Uma carta virada para baixo é **visível como objeto** para todos (todos sabem que há uma carta ali),
mas sua identidade só é conhecida por quem tem direito:

- `faceDown = true` é campo **público**.
- `scryfallId` de carta `faceDown` é filtrado para todos, exceto o `controllerId`.

**Vale em qualquer zona pública**, não só no campo:

| Caso                                | Zona          | Quem conhece a identidade |
| ----------------------------------- | ------------- | ------------------------- |
| Morph / Manifest / Disguise / Cloak | `BATTLEFIELD` | Só o controlador          |
| Foretell / Plot / exílio oculto     | `EXILE`       | Só o controlador          |
| Carta jogada face para baixo        | `BATTLEFIELD` | Só o controlador          |

Sem tratar `faceDown` **antes** da checagem de zona pública, virar uma carta para baixo é puramente
cosmético — o oponente lê a identidade no pacote. É por isso que a cláusula 4 da tabela §4.1 precede a
cláusula 5.

### 4.4 O grimório é oculto até para o dono

O dono **não** recebe o conteúdo da própria `LIBRARY`. Se recebesse, o `Schema` do seu cliente
conteria a ordem completa das cartas — e bastaria abrir o DevTools para conhecer toda a sequência de
compras, o que é vantagem indevida sobre os outros três jogadores.

Acesso ao grimório existe **somente** por ação explícita e registrada (`RN13`): `INTENT_PEEK`,
`INTENT_SCRY`, `INTENT_SURVEIL`, `INTENT_SEARCH_ZONE` ou `INTENT_REVEAL_TOP` — cada uma concedendo
visibilidade temporária via `peekedBy` e deixando log público.

### 4.5 Auditoria obrigatória

Todo campo novo adicionado a `Card` precisa responder: **"isto revela algo sobre uma carta oculta?"**
Se a resposta for sim ou "talvez", entra com `@filter`. O teste `G1` do `DOC-010` §7 é executado em CI
e falha o _build_ se `scryfallId` ou `name` aparecerem no tráfego de um oponente.

---

## 5. Gestão de aleatoriedade (RNG)

Como é um sistema multiplayer, **nunca** geramos números aleatórios no frontend. O cliente envia
`INTENT_ROLL_DICE`; o backend sorteia, atualiza o estado e emite evento global.

```ts
// game-server/src/services/rng.ts
import { randomInt } from 'node:crypto';

/** Dado justo, viés zero. randomInt é CSPRNG e já trata o módulo corretamente. */
export function rollDie(sides: number): number {
  return randomInt(1, sides + 1);
}

export function flipCoin(): 'HEADS' | 'TAILS' {
  return randomInt(0, 2) === 0 ? 'HEADS' : 'TAILS';
}

/** Fisher-Yates com índices de CSPRNG. Embaralha in-place. */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
```

### 5.1 Por que `crypto.randomInt` e não `Math.random()`

|                                   | `Math.random()`                                                    | `crypto.randomInt`          |
| --------------------------------- | ------------------------------------------------------------------ | --------------------------- |
| Previsibilidade                   | Estado interno do PRNG é recuperável a partir de saídas observadas | Não previsível              |
| Viés no módulo                    | `Math.floor(Math.random() * n)` introduz viés para alguns `n`      | Trata rejeição internamente |
| Adequado para jogo com adversário | **Não**                                                            | Sim                         |

Em um jogo onde os jogadores competem, um PRNG previsível é uma vulnerabilidade — alguém poderia
inferir a ordem do grimório após observar rolagens suficientes. O custo de `randomInt` é irrelevante
na nossa escala.

### 5.2 Onde a aleatoriedade aparece

| Operação                     | Função                 | Publicação                                           |
| ---------------------------- | ---------------------- | ---------------------------------------------------- |
| Embaralhar grimório          | `shuffle()`            | Log "embaralhou"; conteúdo **não** vai aos oponentes |
| Embaralhar ao entrar na sala | `shuffle()`            | Silencioso                                           |
| Rolar dado                   | `rollDie()`            | Log + evento `dice` para **todos**                   |
| Cara ou coroa                | `flipCoin()`           | Log + evento para todos                              |
| Determinar quem começa       | `rollDie(playerCount)` | Log                                                  |

### 5.3 Verificação (`FR-09`)

Teste de distribuição χ² sobre 10⁵ rolagens de D20, com nível de significância de 0,01. Também é
testado que `Math.random` **não aparece** em nenhum arquivo de `game-server/src/` (regra de lint).

---

## 6. Ciclo de vida da sala

```
   POST /rooms
        │
        ▼
   ┌──────────┐  primeiro jogador entra
   │ WAITING  │──────────────────────────┐
   └──────────┘                          ▼
                                   ┌──────────┐
        ┌──────────────────────────│ PLAYING  │
        │  todos desconectados     └────┬─────┘
        ▼                               │  INTENT_RESET_MATCH
   ┌──────────┐   alguém volta          │  (mantém sala, zera estado)
   │  PAUSED  │─────────────────────────┘
   └────┬─────┘
        │  90 s sem ninguém  →  ┌──────────┐  vazia (§6.2)  →  onDispose()
        └──────────────────────►│ CLOSING  │──────────────────────► destruída
                                └──────────┘
```

| Estado    | Significado                                          | Intenções aceitas  |
| --------- | ---------------------------------------------------- | ------------------ |
| `WAITING` | Sala criada, aguardando jogadores                    | Chat, configuração |
| `PLAYING` | Partida em andamento                                 | Todas              |
| `PAUSED`  | Todos desconectados, dentro da janela                | Nenhuma            |
| `CLOSING` | Encerramento anunciado (saída ou drenagem de deploy) | Nenhuma            |

**`INTENT_RESET_MATCH`** volta a vida de todos à `vidaInicial` do formato e, além de veneno, energia,
experiência, imposto e designações, zera `rad`, `ticket`, `speed`, `ringLevel` e `ringBearerId` e
devolve `maxHandSize` a 7. Esses campos não eram tocados e atravessavam para a partida seguinte — o
botão promete "zera vida, contadores".

Ele também reinicia a **mesa**. Antes as cartas ficavam onde estavam: o `INTENT_START_MATCH`
seguinte via a mão cheia e não servia a inicial, e o mulligan respondia `MULLIGAN_CLOSED` a partida
inteira, porque havia carta no campo. Agora:

| O quê                | Para onde / como fica                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fichas e cópias      | Apagadas                                                                                                                                         |
| Comandantes          | `COMMAND`                                                                                                                                        |
| Reserva              | Fica no `SIDEBOARD`                                                                                                                              |
| Todo o resto         | `LIBRARY` do dono, **embaralhado**                                                                                                               |
| Estado de cada carta | Zerado: controle volta ao dono, `x`/`y`/`zIndex`/`rotation`, virada, face, anexos, marcadores, sobreposições de P/T, nota, destaque, concessões… |
| Mesa                 | Setas apagadas, `dayNight = 'NEITHER'`, `turnPhase = ''`, sessões de scry descartadas                                                            |
| Jogadores            | `sharedZones` e `topoRevelado` zerados; `handCount`/`libraryCount` recalculados                                                                  |

**Morto que volta reabre a partida.** A morte do penúltimo leva a fase a `CLOSING`; se um eliminado
volta (vida corrigida, dano desfeito) e há **≥ 2 vivos**, a fase volta a `PLAYING`. Antes ela ficava
em `CLOSING`, `verificarFimDePartida` saía cedo para sempre e a mesa nunca mais anunciava vencedor.

### 6.1 Provisionamento inicial de um jogador (`onJoin`)

1. Carrega o deck do jogador pelo `deckId` (lista de `scryfall_id` + quantidades).
2. Instancia um objeto `Card` por unidade — 100 cartas geram 100 objetos com UUID próprio.
3. Coloca todos em `LIBRARY`, com `ownerId = controllerId = sessionId`.
4. Move o comandante para `COMMAND`.
5. `shuffle()` na `LIBRARY`.
6. Move as 7 primeiras para `HAND`.
7. Atualiza `handCount` e `libraryCount`.
8. Emite log `SYSTEM`: "{Jogador} entrou na mesa".

**A vida inicial é do formato.** O `onJoin`, o `INTENT_START_MATCH` e o `INTENT_RESET_MATCH` gravam
`Player.life = vidaInicial` do catálogo de formatos. Antes nada mudava os 40 do schema: Modern, Duel
Commander, Oathbreaker e Brawl começavam com a vida de Commander — o catálogo sempre teve
`vidaInicial`, e ninguém no servidor lia.

**`INTENT_SET_DECK` com a partida em `PLAYING`** é aceito para quem **ainda não tem carta nenhuma**.
Entrar pela lista pública manda um passe sem deck, e a recusa ("só antes de a partida começar")
deixava a pessoa sentada, sem grimório, assistindo a mesa para sempre.

**O provisionamento é versionado por jogador.** Só a resposta do **último** `INTENT_SET_DECK` é
aplicada, e só se o jogador **ainda estiver sentado**; o deck anterior é limpo **depois** da
resposta, não antes do `fetch`. Duas escolhas rápidas limpavam as duas vezes e depois empilhavam as
duas respostas (159 cartas no grimório), e uma resposta que chegava depois de o jogador sair criava
cartas de um dono que não existe mais. Cada linha do deck é limitada a **99 cópias**: um deck salvo
antes do limite do backend com "2000000000 Forest" travava o processo do jogo neste laço.

**Custo:** 4 jogadores × ~100 cartas = ~400 objetos `Card` por sala. Dentro do orçamento de 8 MB por
sala (`NFR-07`) e dos 300–400 sprites de `NFR-01`.

### 6.2 Sala vazia e saída de jogador

**Sobrou um jogador numa partida que começou com dois ou mais: ele venceu.** `verificarFimDePartida`
exige dois jogadores na mesa (senão a mesa solo terminaria no primeiro clique), e num 1v1 o oponente
fechar a aba deixava a partida aberta para sempre. `removerJogador` anuncia o vencedor quando sobra
um e o auge da partida (`augeDeJogadores`) foi de dois ou mais.

O `autoDispose` do Colyseus está **desligado**. Com ele, a sala morria no instante em que o último
cliente saía — e o criador de uma mesa pública não consegue estar no lobby e na lista na mesma aba:
voltar à lista para conferir a mesa bastava para ela sumir. Agora a sala **vazia** (sem `players` nem
`espectadores` no estado — quem caiu e está na janela de reconexão ainda conta) é descartada depois
de **180 s se `PUBLICA`** e **30 s se `PRIVADA`**; a pública espera mais porque é ela que alguém pode
achar na vitrine. Qualquer entrada cancela o descarte agendado.

Quando um jogador sai, as cartas **dele** saem com ele, e as cartas **de outros donos** que ele
controlava voltam ao `ownerId`. Antes elas ficavam com `controllerId` apontando para um jogador
inexistente: ninguém podia movê-las e nenhuma faixa as desenhava. O resto de `removerJogador`:

| Ao sair um jogador                                                                                                | Por quê                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Se era a vez dele, ela passa a quem herdou o assento (ou ao assento 0)                                            | `activePlayerId` ficava com quem saiu, e `exigirVez` recusava todos com `NOT_YOUR_TURN` até alguém reiniciar a partida |
| `jogadorInicial` é limpo, se era ele                                                                              | A configuração da sala ficaria apontando para quem não está mais na mesa                                               |
| Setas dele, ou que apontam para ele ou suas cartas, são apagadas                                                  | Ficavam sem ponta no estado e reapareciam se o id voltasse a valer                                                     |
| `verificarFimDePartida` roda (agora exportada do `registry.ts`): a saída do último oponente vivo decide a partida | Só a eliminação a chamava: com A vivo, C eliminado e B saindo da sala, a mesa ficava em `PLAYING` para sempre          |

**Expulsar quem está desconectado remove o assento na hora.** O Colyseus já tirou o cliente de
`this.clients`, então o `leave()` não tinha em quem agir: o expulso seguia ocupando a vaga pela janela
de reconexão inteira — e a chave de reconexão dele pula o `onAuth`, então ele voltava a sentar apesar
do bloqueio da conta. Se a aba dele reconectar depois, o `onLeave` a recusa por não ter assento.

**O resumo da partida conta só quem jogou.** Os participantes são as contas sentadas **enquanto a
fase é `PLAYING`** (registradas no primeiro `START_MATCH` e em quem entra depois dele), e a duração
conta do primeiro `START_MATCH`, não da criação da sala. Antes quem passava pela sala de espera
contava: uma mesa pública com entra-e-sai passava de `MAX_PLAYERS` participantes, o backend recusava
o resumo e a partida não era gravada.

---

## 7. Orçamento de recursos por sala

| Recurso                      | Estimativa                         | Limite (`NFR`)                            |
| ---------------------------- | ---------------------------------- | ----------------------------------------- |
| Objetos `Card`               | ~400 (4 × 100)                     | —                                         |
| Objetos `Player`             | 1–8, conforme o preset (típico: 4) | `RN03`                                    |
| RAM por sala                 | ~4–8 MB                            | ≤ 8 MB (`NFR-07`)                         |
| Sprites no Canvas do cliente | 40–120 típico; 300 pico            | ≥ 30 FPS a 300 (`NFR-01`)                 |
| Banda de saída por cliente   | 2–15 KB/s                          | ≤ 15 KB/s (`NFR-05`)                      |
| `patchRate`                  | 50 ms (20 Hz)                      | —                                         |
| Custo de `@filter`           | O(cartas × clientes) por _patch_   | Monitorado em `ws_patch_duration_seconds` |

**Ponto de atenção de performance:** o `@filter` é avaliado **por cliente, por campo filtrado, por
patch**. Com 400 cartas × 4 clientes × 20 Hz, são ~32.000 avaliações por segundo por sala. A função de
filtro precisa ser trivial — comparação de string e nada mais. Nenhuma alocação, nenhuma consulta,
nenhum `includes` sobre array grande.

---

## 8. Checklist de implementação

- [ ] `Card`, `Player`, `RoomState` conforme §3.
- [ ] `@filter` em `scryfallId` cobrindo `HAND`, `LIBRARY` **e** `faceDown` no `BATTLEFIELD` (§4.3).
- [ ] Função de filtro trivial, sem alocação (§7).
- [ ] `handCount` / `libraryCount` atualizados em toda mutação de zona.
- [ ] `zoneOrder` mantido e também filtrado para zonas ocultas.
- [ ] Tokens destruídos ao sair do `BATTLEFIELD` (§2.1).
- [ ] `ownerId` imutável após o provisionamento.
- [ ] Todo RNG via `crypto.randomInt`; regra de lint proibindo `Math.random` em `game-server/`.
- [ ] `LIBRARY` não revelada nem ao dono, exceto por `revealToOwner`.
- [ ] Ciclo de vida `WAITING → PLAYING → PAUSED → CLOSING` implementado.
- [ ] `onJoin` provisiona, embaralha e serve 7 cartas.
- [ ] Teste χ² do RNG e teste de auditoria de pacote (`G1`) no CI.
