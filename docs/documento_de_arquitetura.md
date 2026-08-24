# Documento de Arquitetura de Software

**Projeto:** AetherTable (Sandbox MTG)

| Campo | Valor |
|---|---|
| **ID** | `DOC-021` |
| **Versão** | 1.1 |
| **Status** | Estável |
| **Última revisão** | 2026-08-20 |
| **Documentos relacionados** | [readme.md](readme.md) · [documento_de_arquitetura_de_software_sad.md](documento_de_arquitetura_de_software_sad.md) · [especificacao_websocket_e_eventos.md](especificacao_websocket_e_eventos.md) · [especificacao_do_motor_de_estado_state_machine.md](especificacao_do_motor_de_estado_state_machine.md) |

> **Escopo deste documento:** a visão **operacional** da arquitetura — como os dados fluem, por onde,
> com que protocolo, e o que acontece quando algo quebra. Para o modelo C4, as ADRs e os riscos
> estruturais, use [documento_de_arquitetura_de_software_sad.md](documento_de_arquitetura_de_software_sad.md).

---

## 1. Topologia do sistema

A arquitetura é **cliente-servidor com servidor autoritativo de estado e sandbox de lógica**. O
servidor mantém a verdade sobre **onde** os objetos estão; ele não julga se o movimento é válido pelas
regras do Magic.

```
                          ┌──────────────────────────────┐
                          │   Cliente Web (Navegador)    │
                          │                              │
                          │  DOM: lobby, chat, painéis   │
                          │  Canvas: mesa (React Konva)  │
                          │  Zustand: estado local       │
                          └───┬────────┬─────────┬───────┘
                              │        │         │
             HTTPS (REST)     │        │ WSS     │ WebRTC (UDP/SRTP)
                              │        │         │
          ┌───────────────────▼──┐  ┌──▼──────────────────┐  ┌──────────────┐
          │  API Core (NestJS)   │  │  Game Server        │  │  LiveKit SFU │
          │  auth · decks ·      │  │  (Colyseus)         │  │  áudio Opus  │
          │  rooms · tokens      │  │  RoomState em RAM   │  │  VAD         │
          └───┬──────────────┬───┘  └──┬───────────────┬──┘  └──────────────┘
              │              │         │               │
      ┌───────▼───┐   ┌──────▼─────┐   │        ┌──────▼──────┐
      │ PostgreSQL│   │   Redis    │◄──┘        │   Redis     │
      │ users     │   │ rate limit │            │  presence   │
      │ decks     │   │  cache     │            │  pub/sub    │
      │ card_cache│   └────────────┘            └─────────────┘
      └───────────┘

              ┌──────────────────────────────────────────┐
              │  Scryfall API + CDN de imagens           │
              │  (backend consulta dados;                │
              │   browser baixa imagens direto)          │
              └──────────────────────────────────────────┘
```

**Princípios da topologia**

1. **Canais independentes.** WS (mesa), WebRTC (voz) e HTTP (dados) falham de forma isolada. Voz cair
   não afeta a partida; Scryfall cair não afeta partida em andamento.
2. **Imagem não passa pelo nosso servidor.** O browser baixa da CDN da Scryfall. Economia de banda.
3. **O único caminho para mutar estado é o WS.** Não existe endpoint HTTP que altere partida.

---

## 2. Padrões de comunicação

| Canal | Protocolo | Transporte | Uso | Volume típico |
|---|---|---|---|---|
| **Estado da mesa** | Colyseus Schema + Fossil Delta | WSS / TCP | Toda mutação de partida | 2–15 KB/s por cliente em jogo ativo |
| **Voz** | WebRTC / SRTP | UDP (TURN/TCP como *fallback*) | Áudio entre jogadores | ~30 kbps de upload, ~90 kbps de download |
| **Dados** | REST/JSON sobre TLS 1.3 | HTTPS | Auth, CRUD de decks, criação de sala | Requisições esparsas |
| **Imagens** | HTTP GET | HTTPS | Artes das cartas | 15–120 KB por carta, cacheado |

### 2.1 Por que TCP para o estado e UDP para a voz

| | Estado da mesa | Voz |
|---|---|---|
| Perder um pacote é | **Inaceitável** — a carta ficaria em coordenada errada permanentemente | Tolerável — 20 ms de áudio faltando é imperceptível |
| Ordem importa? | Sim: `zone: HAND` → `zone: BATTLEFIELD` fora de ordem corrompe o estado | Não |
| Escolha | **TCP** (entrega garantida e ordenada) | **UDP** (latência mínima, sem retransmissão) |

### 2.2 Fluxo de uma mutação, ponta a ponta

```
J1 arrasta carta
  │
  ├─ (1) cliente aplica posição LOCALMENTE          ← predição otimista, 0 ms percebido
  │
  ├─ (2) INTENT_MOVE_CARD {entityId, x, y}          ← throttle de 20/s
  │       │
  │       ▼
  │   Game Server
  │       ├─ (3) valida com Zod                      (FR-11)
  │       ├─ (4) checa lock e controllerId           (FR-10, FR-12)
  │       ├─ (5) muta RoomState.cards[id].x/.y
  │       └─ (6) Colyseus calcula delta binário
  │               │
  │  ┌────────────┼────────────┬────────────┐
  │  ▼            ▼            ▼            ▼
  │ J1           J2           J3           J4
  │  │            │            │            │
  │ (7) reconcilia  (8) interpola movimento suave (FR-25)
  │
  └─ RTT alvo: p95 ≤ 150 ms (NFR-02)
```

**Predição otimista + reconciliação** é o que faz a mesa parecer instantânea para quem arrasta. Se o
servidor devolver posição diferente (raro, mas possível em disputa de *lock*), o cliente **aceita a do
servidor** — o servidor é a verdade (`RN07`).

### 2.3 O que trafega e o que não trafega

| Informação | Vai para o dono | Vai para os oponentes |
|---|---|---|
| `id`, `zone`, `ownerId` de qualquer carta | ✅ | ✅ |
| `x`, `y`, `rotation`, `counters` de carta no Battlefield | ✅ | ✅ |
| `scryfallId`, `name` de carta no Battlefield / Graveyard / Exile | ✅ | ✅ |
| `scryfallId`, `name` de carta em `HAND` | ✅ | ❌ **nunca** |
| `scryfallId`, `name` de carta em `LIBRARY` | ❌ *(nem o dono, exceto ao "olhar o topo")* | ❌ **nunca** |
| `hand.length`, `library.length` | ✅ | ✅ *(só o número)* |
| Vida, veneno, dano de comandante | ✅ | ✅ |

Implementação em [especificacao_do_motor_sandbox.md](especificacao_do_motor_sandbox.md) §2.

---

## 3. Renderização gráfica (frontend)

Para suportar centenas de objetos em movimento simultâneo sem *reflow*/*repaint* massivos no DOM, a
mesa delega a pintura à **API Canvas** (contexto 2D acelerado / WebGL), envelopada por **React Konva**.

### 3.1 As três camadas de tela

```
┌─────────────────────────────────────────────────────────┐
│ Camada 2 — OVERLAY (DOM, transparente)                  │
│   painéis de vida · chat/log · menus · modais · toasts  │
│   pointer-events só nos elementos, não no fundo         │
├─────────────────────────────────────────────────────────┤
│ Camada 1 — JOGO (<canvas> / React Konva)                │
│   sprites de carta · tokens · dados · pings · seleção   │
│   pan · zoom · drag-and-drop · hit testing              │
├─────────────────────────────────────────────────────────┤
│ Camada 0 — FUNDO (DOM)                                  │
│   playmat, textura da mesa, vinheta                     │
└─────────────────────────────────────────────────────────┘
```

Motivo da separação: texto e formulários são **muito** melhores em DOM (acessibilidade, seleção de
texto, IME, leitores de tela); sprites em movimento são **muito** melhores em Canvas. Cada um no que
é bom.

Detalhamento em [especificacao_tecnica_do_frontend_ui_ux.md](especificacao_tecnica_do_frontend_ui_ux.md).

---

## 4. Gerenciamento de estado (Room State)

O servidor é a fonte de verdade. Usando o `Schema` do Colyseus, apenas os **deltas** são enviados aos
clientes (*state synchronization*).

### 4.1 Modelagem de entidades

**Entidade `Card`** — mantém apenas metadados espaciais e físicos. Imagens e textos são resolvidos no
cliente a partir do `scryfallId`.

| Campo | Tipo | Descrição | Visibilidade |
|---|---|---|---|
| `id` | `string` | UUID gerado ao instanciar na mesa | Pública |
| `scryfallId` | `string` | Referência para buscar a imagem | **Filtrada por zona** |
| `x`, `y` | `float` | Coordenadas relativas ao canvas | Pública |
| `rotation` | `float` | 0 = normal, 90 = virada, 180 = invertida | Pública |
| `zone` | `enum` | `HAND`, `BATTLEFIELD`, `LIBRARY`, `GRAVEYARD`, `EXILE`, `COMMAND` | Pública |
| `zIndex` | `int` | Ordem de empilhamento visual | Pública |
| `ownerId` | `string` | Jogador dono da carta (dono do deck) | Pública |
| `controllerId` | `string` | Quem controla agora — suporta efeitos de "roubo" | Pública |
| `isTapped` | `bool` | Virada | Pública |
| `faceDown` | `bool` | Face para baixo (morph/manifest) | Pública |
| `counters` | `map<string,int>` | Marcadores por tipo | Pública |
| `isToken` | `bool` | Ficha — deixa de existir ao sair do Battlefield | Pública |
| `isLockedBy` | `string` | `sessionId` de quem está arrastando | Pública |

**Distinção importante:** `ownerId` **nunca muda** (define a quem a carta volta ao fim da partida);
`controllerId` muda por intenção explícita (`RN08`).

**Entidade `Player`**

| Campo | Tipo | Descrição |
|---|---|---|
| `id`, `name`, `avatarUrl` | `string` | Identidade |
| `life` | `int` | Vida (inicia em 40) |
| `poison`, `energy`, `experience` | `int` | Contadores diversos |
| `isMonarch`, `hasInitiative` | `bool` | Designações |
| `commanderDamage` | `map<string,int>` | Dano de comandante por oponente |
| `commanderTax` | `int` | +2 cumulativo |
| `connected` | `bool` | Falso durante janela de reconexão |
| `handCount`, `libraryCount` | `int` | Espelhos públicos de contagem |

Schema completo e código em [especificacao_do_motor_sandbox.md](especificacao_do_motor_sandbox.md).

### 4.2 Por que contagens redundantes (`handCount`)

O oponente precisa saber **quantas** cartas você tem na mão, mas o array `HAND` é filtrado. Manter um
inteiro público espelhado é mais simples e mais seguro do que tentar expor "o tamanho do array
filtrado" — que dependeria de comportamento interno do serializador.

---

## 5. Tolerância a falhas e desconexões

### 5.1 Matriz de falhas

| Componente que falha | Impacto imediato | Comportamento do sistema | Recuperação |
|---|---|---|---|
| **Conexão WS de um jogador** | Aquele jogador congela | Cartas dele permanecem; intenções sobre elas rejeitadas; painel esmaecido para os outros | Janela de 90 s com `sessionId` (`RN10`) |
| **Game node inteiro** | Salas daquele nó são perdidas | Clientes recebem `ROOM_LOST` e são levados ao Dashboard com aviso | Criar nova sala. Mitigável com *snapshot* em Redis (ADR-006) |
| **LiveKit** | Voz cai | **Mesa continua normal**; UI mostra "voz reconectando…" | Retry 3× com *backoff* |
| **API Core** | Não dá para logar, importar deck ou criar sala | Partidas em andamento **não são afetadas** | Retry no cliente |
| **PostgreSQL** | Login e decks indisponíveis | Partidas em andamento seguem (não tocam o banco) | Failover do serviço gerenciado |
| **Redis** | *Rate limit* e presença degradados | Modo degradado: *rate limit* em memória local, sala única por nó | Reinício |
| **Scryfall** | Importação para | Partidas seguem (usam UUID + cache de imagem) | *Backoff*; cache local |
| **Cloudflare** | Sem WAF/CDN | Serviço funciona direto na origem, mais exposto | DNS de emergência |

### 5.2 Reconexão em detalhe

```
t=0s    WS fecha (rede caiu / aba recarregada)
t=0s    servidor: player.connected = false; allowReconnection(client, 90)
t=0s    demais clientes: painel esmaecido, "reconectando…"
        cartas do jogador permanecem exatamente onde estavam
        intenções de terceiros sobre as cartas dele: REJEITADAS
t=0-90s cliente tenta reconectar com backoff: 1s, 2s, 4s, 8s, 15s, 30s
t<90s   sucesso → servidor reassocia sessionId
                → cliente recebe ESTADO COMPLETO (não delta)
                → mesa redesenhada, partida retomada
t=90s   falha → jogador removido, cartas saem da mesa
                log: "Jogador X saiu da partida"
                vaga liberada
```

**Por que estado completo na volta e não delta:** o cliente perdeu uma quantidade indeterminada de
*patches*. Aplicar deltas sobre um estado desatualizado produz corrupção silenciosa. Enviar o estado
inteiro custa alguns KB e é a única opção correta.

### 5.3 Deploy sem derrubar partidas

Game server é *stateful*, então o deploy exige **drenagem**:

1. Nova versão sobe em nós novos.
2. O *matchmaker* para de alocar salas nos nós antigos (`draining = true`).
3. Nós antigos continuam servindo as salas existentes até esvaziarem.
4. Quando um nó antigo fica sem salas, é desligado.

Deploy do frontend e da API Core é *rolling* comum, sem cerimônia.

---

## 6. Otimização de imagens

| Contexto | Qualidade | Quando é buscada |
|---|---|---|
| Carta em `LIBRARY` | **nenhuma** — só o verso local | Nunca |
| Carta em `BATTLEFIELD` / `HAND` própria | `small` (146×204) | Ao entrar na zona |
| Zoom / `hover` / `Alt+clique` | `normal` (488×680) | Sob demanda, uma por vez |
| Deckbuilder | `normal` | Ao abrir o detalhe |

Três camadas de cache: CDN da Scryfall → Service Worker (`CacheStorage`, teto de 200 MB, LRU) →
texturas em memória compartilhadas por `scryfallId`.

Regra dura: **nunca** pré-carregar as 100 imagens de um deck ao entrar na sala.

Detalhes em [integracoes_externas_scryfall.md](integracoes_externas_scryfall.md) §5.

---

## 7. Orçamento de latência

Decomposição do alvo de 150 ms (p95) para uma mutação:

| Etapa | Orçamento |
|---|---|
| Captura do evento e envio no cliente | ≤ 5 ms |
| Rede cliente → servidor | ≤ 50 ms |
| Validação + mutação + cálculo do delta | ≤ 10 ms |
| Rede servidor → clientes | ≤ 50 ms |
| Aplicação do patch e render do quadro | ≤ 20 ms |
| **Folga** | 15 ms |

Consequências de projeto: o *handler* de intenção **não pode** fazer I/O (banco, HTTP) no caminho
crítico. Toda escrita durável é assíncrona e fora do fluxo de mutação.

---

## 8. Escalabilidade

| Dimensão | Estratégia | Limite conhecido |
|---|---|---|
| **Salas simultâneas** | Mais game nodes + Redis Presence/Driver | ~8 MB de RAM por sala (`NFR-07`) |
| **Jogadores por sala** | Definido pelo preset de formato, 1–8 (`RN03`) | Teto de 8: acima disso a mesa e a voz perdem legibilidade |
| **Cartas por mesa** | *Culling* de fora de tela, texturas compartilhadas | 300–400 sprites (`NFR-01`) |
| **Requisições HTTP** | Instâncias *stateless* com autoscaling | CPU |
| **Voz** | LiveKit Cloud → SFU próprio | Custo, não técnica |
| **Leitura de decks** | Réplica de leitura no Postgres (pós-V2) | — |

Roteamento com afinidade é obrigatório: uma conexão WS **precisa** chegar ao nó que hospeda a sala.
O `@colyseus/redis-driver` resolve a descoberta; o proxy reverso precisa manter `keep-alive` e não
balancear a mesma conexão entre nós.

Detalhes operacionais em [devops_e_infraestrutura.md](devops_e_infraestrutura.md).
