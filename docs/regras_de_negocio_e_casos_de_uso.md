# Especificação de Regras de Negócio e Casos de Uso

| Campo                       | Valor                                                                                                                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                      | `DOC-011`                                                                                                                                                                                                                                                   |
| **Versão**                  | 1.1                                                                                                                                                                                                                                                         |
| **Status**                  | Estável                                                                                                                                                                                                                                                     |
| **Última revisão**          | 2026-08-20                                                                                                                                                                                                                                                  |
| **Documentos relacionados** | [readme.md](readme.md) · [documentos_de_casos_de_uso.md](documentos_de_casos_de_uso.md) · [especificacao_do_motor_de_estado_state_machine.md](especificacao_do_motor_de_estado_state_machine.md) · [seguranca_e_privacidade.md](seguranca_e_privacidade.md) |

---

## 1. Introdução

Este documento detalha as **restrições sistêmicas invariáveis** (Regras de Negócio, `RN`) e os
**casos de uso técnicos** — aqueles em que o fluxo de rede importa tanto quanto o fluxo de tela.

> Diferença em relação a `DOC-012`: lá os casos de uso são narrados na perspectiva do usuário
> ("o ator clica, o sistema responde"). Aqui eles são narrados na perspectiva do **sistema
> distribuído** ("o cliente envia intenção, o servidor muta o schema, o patch propaga").

Devido à natureza _sandbox_ da plataforma, é vital compreender que o sistema **não valida regras de
Magic: The Gathering** — nada de pilha, custo de mana, prioridade ou resolução de dano. O sistema
gerencia **física, visibilidade e sincronização** da mesa.

---

## 2. Regras de negócio (RN)

As `RN` são invariantes. Qualquer funcionalidade nova que as contrarie deve ser rejeitada em revisão
de código, não negociada.

### RN01 — Sandbox e delegação de regras

O sistema **nunca** impedirá uma ação no tabuleiro sob a justificativa de "jogada ilegal" no Magic.
Cabe aos jogadores interpretarem e aplicarem as regras do TCG por comunicação e manipulação manual
das peças.

| Aspecto                  | Detalhe                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Permitido ao sistema** | Avisar, sinalizar, registrar no log                                                                            |
| **Proibido ao sistema**  | Bloquear, reverter, corrigir automaticamente                                                                   |
| **Exemplo permitido**    | Alertar "esta carta está fora da identidade de cor do comandante"                                              |
| **Exemplo proibido**     | Impedir que a carta entre no deck ou no Battlefield                                                            |
| **Exceção**              | Restrições **físicas** do sandbox (uma carta não pode estar em duas zonas) são legítimas e não violam a `RN01` |

### RN02 — Privacidade por design (anti-cheat)

O servidor é **estritamente proibido** de transmitir identidade de carta (`scryfallId`, `name` e
derivados) contida em zonas ocultas (`HAND`, `LIBRARY`) para qualquer cliente que não seja o dono
daquela zona.

| Aspecto                     | Detalhe                                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| **Implementação**           | `@filter` nas propriedades sensíveis do `Schema` do Colyseus (`FR-06`) |
| **Abordagem proibida**      | Enviar tudo e "esconder" no cliente via CSS/Canvas                     |
| **O que o oponente recebe** | `{ id, zone, ownerId, faceDown }` — nada mais                          |
| **O que é público**         | `library.length` e `hand.length` (números, nunca identidades)          |
| **Extensão a espectadores** | Espectador **nunca** recebe zona oculta de ninguém                     |
| **Teste obrigatório**       | Captura de tráfego WS de um oponente, assertando ausência dos campos   |

### RN03 — Limite de participantes definido pelo formato

O número de jogadores de uma sala **vem do preset de formato** (`format.players`), não é fixo. O teto
absoluto do sistema é **8**; o piso é **1** (playtest solo).

| Aspecto                             | Detalhe                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Fonte do limite**                 | `FormatPreset.players.{min,max,default}` — ver [catalogo_de_formatos_e_variantes.md](catalogo_de_formatos_e_variantes.md) |
| **Commander**                       | 1–8, padrão **4**                                                                                                         |
| **Construídos (Standard, Modern…)** | 2                                                                                                                         |
| **Two-Headed Giant**                | 4 (2 times de 2)                                                                                                          |
| **Emperor**                         | 6 (2 times de 3)                                                                                                          |
| **Playtest solo**                   | **1** — caso de uso nº 1 do produto (`DOC-001` §3)                                                                        |
| **Freeform**                        | 1–8, configurável pelo host                                                                                               |
| **Teto absoluto**                   | **8** — acima disso a UI da mesa e a voz deixam de ser legíveis                                                           |
| **Conexão acima do limite**         | Erro tipado `ROOM_FULL`, sem derrubar a sala                                                                              |
| **Vaga liberada**                   | Jogador que sai libera a vaga após a janela de reconexão (90 s)                                                           |
| **Espectadores**                    | Contados separadamente, com limite próprio configurável                                                                   |

**Consequência de projeto:** o `Player` não pode assumir 4 assentos, e a UI da mesa precisa de layouts
para 1, 2, 3, 4, 5, 6 e 8 jogadores. Ver [guia_de_ui_e_design_system.md](guia_de_ui_e_design_system.md) §3.

### RN04 — Legalidade e Fan Content

Para cumprir a _Fan Content Policy_ da Wizards of the Coast, o acesso a cartas, salas e mecânicas de
mesa será **sempre 100 % gratuito**.

| Proibido                           | Permitido                                            |
| ---------------------------------- | ---------------------------------------------------- |
| Vender _singles_ virtuais          | Doação (Patreon, Apoia.se)                           |
| _Loot boxes_ ou pacotes            | Cosméticos de plataforma (playmat, avatar, título)   |
| Paywall em qualquer função de jogo | Bitrate de áudio maior para apoiador                 |
| Torneio ranqueado com premiação    | Ligas casuais sem premiação                          |
| Sugerir endosso oficial da WotC    | _Disclaimer_ de Fan Content no rodapé de toda página |

### RN05 — Tolerância na importação de decks

O sistema **deve permitir** importar e salvar decks com tamanho diferente de 100 cartas ou com cartas
banidas, exibindo **alerta visual não bloqueante**.

| Situação                        | Comportamento                                               |
| ------------------------------- | ----------------------------------------------------------- |
| Deck com 87 cartas              | Salva; badge "fora do padrão: 87/100"                       |
| Carta banida no Commander       | Salva; badge vermelho na carta                              |
| Duplicata de carta não-básica   | Salva; aviso de singleton                                   |
| Sem comandante definido         | Salva; aviso "defina um comandante"                         |
| Linha não resolvida na Scryfall | **Não** salva a linha; marca em vermelho para edição manual |

### RN06 — Sincronia de ações aleatórias

Qualquer ação dependente de sorte — rolar dados, cara ou coroa, embaralhar o grimório, olhar o topo —
**deve obrigatoriamente** ser calculada no servidor e empurrada a todos os clientes.

| Aspecto                     | Detalhe                                                       |
| --------------------------- | ------------------------------------------------------------- |
| **Gerador**                 | `crypto.randomInt` do Node.js (CSPRNG), nunca `Math.random()` |
| **Algoritmo de embaralhar** | Fisher-Yates com índices do CSPRNG                            |
| **Publicação**              | Resultado vai ao log da sala, visível a todos                 |
| **Proibido**                | Qualquer resultado aleatório originado no cliente             |
| **Verificação**             | Teste de distribuição χ² sobre 10⁵ rolagens (`FR-09`)         |

### RN07 — Autoridade do servidor

O cliente **nunca** altera o estado da mesa. Ele envia **intenções**; o servidor decide, muta o
`Schema` e propaga o _patch_. O cliente pode aplicar predição otimista local, mas **deve** reconciliar
com o estado do servidor quando o _patch_ chegar.

### RN08 — Propriedade e controle de objeto

Toda carta tem `ownerId` (quem trouxe a carta no deck) e `controllerId` (quem a manipula agora).

| Regra                                                           | Detalhe                                        |
| --------------------------------------------------------------- | ---------------------------------------------- |
| Intenções de manipulação são aceitas de quem tem `controllerId` | —                                              |
| `ownerId` **nunca** muda durante a partida                      | Define a quem a carta retorna ao fim           |
| Transferência de controle é uma intenção explícita              | Suporta efeitos de "roubo" sem motor de regras |
| Ao fim da partida, cartas voltam ao deck do `ownerId`           | Nenhuma carta "muda de dono" de verdade        |

### RN09 — Log neutro

Mensagens automáticas de log descrevem a ação **sem revelar informação oculta**.

| Ação                      | Log correto                                                                                     | Log **proibido**             |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------- |
| Comprar carta             | "Jogador A comprou 1 carta"                                                                     | "Jogador A comprou Sol Ring" |
| Jogar da mão para o campo | "Jogador A jogou Sol Ring" _(já é público)_                                                     | —                            |
| _Mill_                    | "Jogador A moveu 3 cartas do grimório para o cemitério" + as cartas ficam públicas no cemitério | —                            |
| Olhar o topo              | "Jogador A olhou o topo do grimório"                                                            | Revelar qual carta era       |
| Descartar                 | "Jogador A descartou Lightning Bolt" _(cemitério é público)_                                    | —                            |

### RN10 — Janela de reconexão

A queda de conexão de um jogador **congela suas interações** por até **90 segundos**, mantendo suas
cartas na mesa. Retornando com `sessionId` válido, ele retoma o estado exato. Passada a janela, o
jogador é removido e suas cartas saem da mesa.

### RN11 — Coleta mínima de dados

O sistema armazena apenas **e-mail, nome de exibição e URL de avatar**. Nunca senha de provedor
OAuth, nunca dados de pagamento, nunca conteúdo de chat persistido além da sessão da sala.

### RN12 — Sem persistência de partida no banco relacional

O `RoomState` vive em memória (e opcionalmente em Redis). Nada de estado de partida em PostgreSQL:
o banco relacional guarda usuários e decks. Consequência aceita: o histórico de partidas é
estatística agregada, não replay — até que `DOC-002` §8 decida o contrário.

### RN13 — Visibilidade conquistada por ação explícita

> **O jogador só recebe uma informação oculta se executar a ação que a concede. Sem a ação, o dado
> não sai do servidor — e não há como obtê-lo por outro caminho.**

Complementa a `RN02`: enquanto a `RN02` diz _o que_ não pode trafegar, a `RN13` define _como_ a
visibilidade é adquirida quando ela é legítima.

| Aspecto                                | Detalhe                                                                                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sem ação, sem dado**                 | Não existe acesso implícito, automático ou passivo a zona oculta. Se o jogador não enviou `INTENT_PEEK`, o `scryfallId` da carta do topo nunca foi serializado para ele |
| **Toda concessão é uma intenção**      | Olhar, revelar, buscar e virar face para cima são intenções explícitas — nunca efeitos colaterais de outra ação                                                         |
| **Toda concessão gera log público**    | Os oponentes sempre sabem **que** houve uma olhada, mesmo sem saber **o que** foi visto (`RN09`)                                                                        |
| **Toda concessão expira**              | `peekedBy` é limpo ao encerrar a consulta; `revealedTo` é zerado em qualquer troca de zona. Visibilidade é um evento, não um estado permanente                          |
| **Cliente não se autoconcede**         | Modificar o frontend não dá acesso: o dado nunca chegou. Não há o que desbloquear                                                                                       |
| **Memória do jogador fica no cliente** | Lembrar cartas já vistas legitimamente é anotação local (`uiStore`), fora do `Schema` — o servidor não participa                                                        |

**Exemplo do contraste.** Sem a `RN13`, "olhar o topo" seria um botão que exibe um dado já presente no
cliente; quem inspecionasse o tráfego teria acesso permanente e silencioso ao grimório de todos. Com a
`RN13`, o botão é a única porta de entrada do dado, e atravessá-la deixa rastro no log.

**Efeito colateral desejável:** como toda concessão é registrada, o log da partida contém a auditoria
completa de quem olhou o quê e quando — substituindo com vantagem a confiança mútua da mesa física.

Catálogo completo das ações que concedem visibilidade em
[catalogo_de_acoes_da_mesa.md](catalogo_de_acoes_da_mesa.md).

---

## 3. Matriz regra × implementação

| Regra    | Requisito de engenharia       | Documento de implementação      | Como é testada                                                                             |
| -------- | ----------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| RN01     | — (é uma proibição de escopo) | `DOC-033`                       | Revisão de código                                                                          |
| **RN02** | **FR-06**                     | `DOC-032`, `DOC-050`, `DOC-051` | **Auditoria de pacote WS**                                                                 |
| RN03     | FR-16                         | `DOC-032`                       | Integração de sala                                                                         |
| RN04     | —                             | `DOC-001` §6                    | Revisão de produto                                                                         |
| RN05     | FR-15                         | `DOC-035` §4                    | Integração de import                                                                       |
| RN06     | FR-09                         | `DOC-032` §RNG                  | χ² sobre 10⁵ amostras                                                                      |
| RN07     | FR-07, FR-11                  | `DOC-033`                       | Integração de sala                                                                         |
| RN08     | FR-12                         | `DOC-032`                       | Teste de autorização                                                                       |
| RN09     | FR-21                         | `DOC-031` §Log                  | Teste de conteúdo de log                                                                   |
| RN10     | FR-18                         | `DOC-021` §5                    | Teste de queda e retomada                                                                  |
| RN11     | —                             | `DOC-023`, `DOC-050`            | Inspeção de schema                                                                         |
| RN12     | —                             | `DOC-023`                       | Inspeção de schema                                                                         |
| **RN13** | **FR-06, FR-26**              | `DOC-036`, `DOC-032` §4         | **Auditoria de pacote: sem `INTENT_PEEK`, nenhum `scryfallId` de `LIBRARY` chega ao dono** |

---

## 4. Casos de uso técnicos (CDU)

### CDU01 — Autenticação e gestão de perfil

| Campo                 | Valor                                                    |
| --------------------- | -------------------------------------------------------- |
| **Atores**            | Jogador · Provedor OAuth (Google/Discord) · Backend Core |
| **Pré-condições**     | Ator acessa a página inicial                             |
| **Regras associadas** | RN04, RN11                                               |

**Fluxo principal**

1. O ator escolhe login via provedor OAuth.
2. O sistema redireciona ao provedor com `state` aleatório e PKCE.
3. O provedor retorna com código de autorização; o backend troca por _access token_.
4. O backend obtém e-mail, nome e avatar; cria ou recupera o perfil (`upsert` por e-mail).
5. O backend emite JWT de acesso (15 min) e _refresh token_ rotativo em cookie `HttpOnly`.
6. O ator é redirecionado ao Dashboard.

**Fluxos alternativos**

- **A1 — E-mail já existente com outro provedor:** vincula o provedor à conta existente após
  confirmação explícita do ator. Nunca cria conta duplicada silenciosamente.
- **A2 — `state` inválido:** aborta com `401 OAUTH_STATE_MISMATCH` (proteção contra CSRF de login).
- **A3 — Provedor indisponível:** oferece login por e-mail/senha.

---

### CDU02 — Importar e validar deck

| Campo                 | Valor                                 |
| --------------------- | ------------------------------------- |
| **Atores**            | Jogador · Backend Core · Scryfall API |
| **Pré-condições**     | Estar autenticado                     |
| **Regras associadas** | RN05                                  |

**Fluxo principal**

1. O ator insere texto no padrão MTG e envia.
2. O backend faz _parsing_ linha a linha, agrupando quantidades por nome (`DOC-035` §4).
3. O backend consulta o `card_cache` local; o que faltar vai a `POST /cards/collection` em lotes de 75.
4. O backend devolve `{ resolved[], notFound[], warnings[] }`.
5. O Deckbuilder exibe as cartas e os avisos.
6. O ator define nome e comandante e salva.
7. O backend persiste **apenas** `scryfall_id`, `quantity`, `is_commander`, `board_type` (`FR-04`).

**Fluxos de exceção**

- **E1 — Carta não encontrada:** a linha é destacada em vermelho e permanece editável; o resto do
  deck importa normalmente.
- **E2 — Scryfall com `429`:** _backoff_ exponencial; se esgotar, `503 CARD_PROVIDER_UNAVAILABLE`
  preservando o texto no cliente.
- **E3 — Payload > 64 KB ou > 1.000 linhas:** rejeita com `413`.
- **E4 — Deck fora do padrão:** salva com aviso (`RN05`), nunca bloqueia.

---

### CDU03 — Criar sala de partida

| Campo                 | Valor                                                            |
| --------------------- | ---------------------------------------------------------------- |
| **Atores**            | Jogador (Host) · Backend Core · Game Server (Colyseus) · LiveKit |
| **Pré-condições**     | Ter pelo menos um deck salvo                                     |
| **Regras associadas** | RN03                                                             |

**Fluxo principal**

1. O ator define nome da sala, senha opcional e deck.
2. O backend valida a posse do deck e aplica _rate limit_ (3 criações/hora por IP — `NFR-04`).
3. O backend solicita a criação da instância ao game server via _matchmaker_ do Colyseus.
4. O game server instancia a sala, gera `roomId` de 6 caracteres e devolve o _seat reservation_.
5. O backend emite dois tokens de uso único (TTL 60 s): um para o _handshake_ do WS, outro para o LiveKit.
6. O ator conecta ao WS; o servidor injeta seu deck embaralhado em `LIBRARY` e move 7 cartas para `HAND`.
7. O cliente conecta ao LiveKit e publica a trilha de áudio.
8. A UI exibe o link de convite.

**Fluxos de exceção**

- **E1 — Nenhum nó com capacidade:** `503 NO_CAPACITY`; a UI sugere tentar novamente.
- **E2 — Deck não pertence ao ator:** `403`.
- **E3 — LiveKit indisponível:** a sala funciona **sem voz**; a UI avisa e permite tentar reconectar.

---

### CDU04 — Sincronização de movimento no tabuleiro

| Campo                 | Valor                                                          |
| --------------------- | -------------------------------------------------------------- |
| **Atores**            | Jogador 1 (ativo) · Jogadores 2–4 (observadores) · Game Server |
| **Pré-condições**     | Todos na mesma sala                                            |
| **Regras associadas** | RN01, RN07                                                     |

**Fluxo principal**

1. J1 pressiona o botão sobre uma carta → cliente envia `INTENT_GRAB { entityId }`.
2. O servidor concede o _lock_ (`isLockedBy = sessionId_J1`) e propaga o _patch_ de lock (`FR-10`).
3. Enquanto arrasta, o cliente de J1 envia `INTENT_MOVE_CARD { entityId, x, y }` **no máximo 20 ×/s**
   (_throttle_), aplicando a posição localmente por predição otimista.
4. O servidor atualiza `x`/`y` no `Schema`.
5. O Colyseus calcula o _delta_ e envia o _patch_ binário aos demais.
6. Os clientes 2–4 **interpolam** o movimento (`FR-25`) em vez de saltar.
7. Ao soltar, o cliente envia `INTENT_RELEASE`; o servidor libera o _lock_ e grava o Z-index final.

**Fluxos de exceção**

- **E1 — J2 tenta mover a mesma carta:** intenção descartada silenciosamente enquanto o _lock_ vigora.
- **E2 — J1 desconecta durante o arraste:** o _lock_ expira em 5 s e a carta fica na última posição sincronizada.
- **E3 — Excesso de intenções (> 30/s):** o servidor descarta o excedente e emite aviso ao cliente.

---

### CDU05 — Interação com zonas ocultas (comprar carta)

| Campo                 | Valor                                       |
| --------------------- | ------------------------------------------- |
| **Atores**            | Jogador · Game Server                       |
| **Pré-condições**     | Estar em sala ativa com cartas na `LIBRARY` |
| **Regras associadas** | RN02, RN06, RN09                            |

**Fluxo principal**

1. O jogador aciona "Comprar Carta" → `INTENT_DRAW { amount: 1 }`.
2. O servidor verifica que o remetente é o dono da `LIBRARY` alvo.
3. O servidor remove o objeto do **topo** da `LIBRARY` (último índice) e altera `zone` para `HAND`.
4. O `@filter` recalcula visibilidade: o dono passa a receber `scryfallId`; os demais, não.
5. O servidor gera log neutro: **"Jogador X comprou 1 carta"** (`RN09`).
6. Para os oponentes, apenas `hand.length` e `library.length` mudam. **A imagem não transita na rede.**

**Fluxos de exceção**

- **E1 — Grimório vazio:** log "Jogador X tentou comprar de um grimório vazio". **Não** elimina o
  jogador — isso seria aplicar regra (`RN01`).
- **E2 — `amount` inválido (≤ 0 ou > 100):** Zod rejeita a intenção (`FR-11`).
- **E3 — Remetente não é o dono:** rejeita com log de auditoria (`FR-12`).

---

### CDU06 — Modificação de estado da carta (virar e marcadores)

| Campo                 | Valor                 |
| --------------------- | --------------------- |
| **Atores**            | Jogador · Game Server |
| **Regras associadas** | RN01, RN07, RN08      |

**Fluxo principal**

1. O jogador seleciona uma carta que controla e pressiona `T`.
2. O cliente envia `INTENT_UPDATE_PROPERTY { entityId, property: "isTapped", value: true }`.
3. O servidor confere `controllerId` (`RN08`) e aplica a mutação.
4. O _patch_ propaga; todos os clientes animam a rotação de 90° com _easing_ de 150 ms.
5. O mesmo fluxo vale para marcadores: `INTENT_ADD_COUNTER { entityId, type: "P1_P1", amount: 1 }`
   atualiza o mapa `counters` e o _badge_ aparece para todos.

**Fluxos de exceção**

- **E1 — Carta de outro jogador sem transferência de controle:** rejeitada (`FR-12`).
- **E2 — Marcador negativo levando a total < 0:** o total é fixado em 0; o sistema não impede a intenção.
- **E3 — Seleção múltipla:** um único `INTENT_BATCH_UPDATE` com lista de `entityId` (`F25`), para não
  estourar o limite de 30 intenções/s.

---

### CDU07 — Comunicação por voz integrada

| Campo                 | Valor                             |
| --------------------- | --------------------------------- |
| **Atores**            | Jogadores da sala · LiveKit (SFU) |
| **Pré-condições**     | Estar conectado à sala            |
| **Regras associadas** | RN11                              |

**Fluxo principal**

1. Ao entrar, o cliente pede permissão de microfone ao navegador.
2. O cliente conecta ao LiveKit com o JWT de escopo do `roomId` (`FR-08`).
3. O áudio é captado com supressão de ruído e cancelamento de eco, publicado em trilha única Opus.
4. O SFU distribui a trilha aos demais participantes.
5. O SDK emite `participant.isSpeaking`; o frontend desenha a aura dourada no painel do falante.
6. Qualquer jogador pode aplicar _mute_ local ou ajustar volume individual (`FR-22`).

**Fluxos de exceção**

- **E1 — Permissão de microfone negada:** entra apenas como ouvinte; a UI mostra ícone de microfone cortado.
- **E2 — Sem UDP disponível (rede corporativa):** _fallback_ para TURN sobre TCP/443, com latência maior.
- **E3 — LiveKit cai no meio da partida:** o WS da mesa **não** é afetado; a UI mostra "voz
  desconectada — reconectando" e tenta 3 ×.

---

### CDU08 — Reconexão após queda

| Campo                 | Valor                 |
| --------------------- | --------------------- |
| **Atores**            | Jogador · Game Server |
| **Regras associadas** | RN10                  |

**Fluxo principal**

1. O WS cai; o servidor detecta ausência de `pong` (45 s) ou fechamento explícito.
2. O servidor marca `player.connected = false` e inicia a janela de 90 s (`allowReconnection`).
3. Os demais clientes exibem o painel do jogador esmaecido com "reconectando…".
4. As cartas do jogador **permanecem** exatamente onde estavam; intenções sobre elas são rejeitadas.
5. O jogador retorna com o mesmo `sessionId`; o servidor reassocia a conexão.
6. O cliente recebe o estado completo (não um _delta_) e redesenha a mesa.

**Fluxos de exceção**

- **E1 — Janela expirada:** jogador removido; suas cartas saem da mesa; log "Jogador X saiu da partida".
- **E2 — Reconexão em outro nó (Colyseus escalado):** o `sessionId` é resolvido via Redis Presence
  e a conexão é roteada ao nó correto (`NFR-03`).

---

### CDU09 — Embaralhar e ações aleatórias

| Campo                 | Valor                 |
| --------------------- | --------------------- |
| **Atores**            | Jogador · Game Server |
| **Regras associadas** | RN06, RN09            |

**Fluxo principal**

1. O jogador aciona "Embaralhar" → `INTENT_SHUFFLE_ZONE { targetZone: "LIBRARY" }`.
2. O servidor aplica Fisher-Yates com índices de `crypto.randomInt`.
3. Nenhum _patch_ de conteúdo vai aos oponentes — a ordem da `LIBRARY` é oculta para eles.
4. Log: "Jogador X embaralhou o grimório".
5. Para dados: `INTENT_ROLL_DICE { sides: 20 }` → servidor sorteia, grava no log e emite evento de
   animação para **todos**.

**Fluxos de exceção**

- **E1 — `sides` fora de {2, 4, 6, 8, 10, 12, 20, 100}:** rejeitado por Zod.
- **E2 — Abuso (spam de rolagens):** _rate limit_ de 5 rolagens/10 s por jogador.

---

### CDU10 — Encerrar partida

| Campo                 | Valor                                  |
| --------------------- | -------------------------------------- |
| **Atores**            | Jogadores · Game Server · Backend Core |
| **Regras associadas** | RN08, RN12                             |

**Fluxo principal**

1. Um jogador aciona "Sair da partida" e confirma.
2. O servidor remove o jogador e suas cartas (que retornam logicamente ao deck do `ownerId`).
3. Quando a sala fica sem conexões, ela é destruída após 10 min (`FR-17`).
4. O game server envia ao Backend Core um resumo **agregado** (duração, nº de jogadores) para
   estatística de perfil. Nenhum estado de jogo é persistido (`RN12`).

**Fluxos de exceção**

- **E1 — Todos caem simultaneamente:** a sala aguarda a janela de reconexão de todos antes de destruir.
- **E2 — Backend Core indisponível:** o resumo é descartado; a partida não é bloqueada por telemetria.
