# Software Architecture Document (SAD)

| Campo                       | Valor                                                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                      | `DOC-020`                                                                                                                                                                                     |
| **Versão**                  | 1.1                                                                                                                                                                                           |
| **Status**                  | Estável                                                                                                                                                                                       |
| **Última revisão**          | 2026-08-20                                                                                                                                                                                    |
| **Documentos relacionados** | [readme.md](readme.md) · [documento_de_arquitetura.md](documento_de_arquitetura.md) · [stack_tecnologico.md](stack_tecnologico.md) · [devops_e_infraestrutura.md](devops_e_infraestrutura.md) |

---

## 1. Visão arquitetural

A plataforma adota **monólito modular para regras de negócio + serviços isolados para rede de tempo
real**. Não é microsserviço por moda: a separação existe porque **WebSocket persistente e HTTP
stateless têm perfis de escalonamento incompatíveis**.

| Característica     | API Core (HTTP)                         | Game Server (WebSocket)                            |
| ------------------ | --------------------------------------- | -------------------------------------------------- |
| Estado             | _Stateless_                             | **Fortemente stateful** (RoomState em RAM)         |
| Escalonamento      | Horizontal trivial, autoscaling por CPU | Horizontal com afinidade de sessão                 |
| Deploy             | _Rolling_, sem impacto                  | Precisa drenar salas antes de derrubar             |
| Plataforma viável  | Serverless / PaaS                       | **Nunca serverless** — exige porta e processo vivo |
| Falha de instância | Retry no cliente                        | Sala perdida                                       |

Juntar os dois num só serviço obrigaria o HTTP a herdar as restrições do WebSocket. Daí a separação.

### 1.1 Atributos de qualidade priorizados

Em ordem. Quando dois conflitam, o de cima ganha.

| #   | Atributo                             | Como se manifesta                                            | Requisito       |
| --- | ------------------------------------ | ------------------------------------------------------------ | --------------- |
| 1   | **Integridade da informação oculta** | Mão e grimório alheios são inacessíveis por inspeção de rede | `FR-06`, `RN02` |
| 2   | **Latência percebida**               | Arrastar carta parece instantâneo                            | `NFR-02`        |
| 3   | **Performance de render**            | Mesa lotada não engasga                                      | `NFR-01`        |
| 4   | **Custo operacional**                | Sustentável por doação                                       | `NFR-10`        |
| 5   | **Escalabilidade horizontal**        | Mais salas = mais nós                                        | `NFR-03`        |
| 6   | **Manutenibilidade**                 | Tipos compartilhados, um só idioma                           | `NFR-11`        |

Trocas explícitas aceitas:

- **Integridade > conveniência de implementação.** O `@filter` complica o Schema; entra de qualquer jeito.
- **Latência > consistência forte.** Predição otimista no cliente com reconciliação, não _lock-step_.
- **Custo > durabilidade de partida.** Nada de replay persistido no MVP (`RN12`).

---

## 2. Modelo C4

### 2.1 Nível 1 — Contexto

```
                        ┌───────────────────────┐
                        │       Jogador         │
                        │  (navegador desktop   │
                        │   ou tablet)          │
                        └───────────┬───────────┘
                                    │ HTTPS · WSS · WebRTC
                        ┌───────────▼───────────┐
                        │   AetherTable    │
                        │   (esta plataforma)   │
                        └─────┬───────────┬─────┘
                              │           │
                  HTTPS       │           │  HTTPS (imagens direto ao browser)
                  ┌───────────▼──┐   ┌────▼──────────────┐
                  │ Scryfall API │   │ Google / Discord  │
                  │ (dados de    │   │ (OAuth 2.0)       │
                  │  carta)      │   └───────────────────┘
                  └──────────────┘
```

### 2.2 Nível 2 — Contêineres

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            Cloudflare (DNS · WAF · CDN)                      │
└───────┬─────────────────────┬────────────────────────┬───────────────────────┘
        │                     │                        │
┌───────▼────────┐   ┌────────▼──────────┐   ┌─────────▼───────────┐
│ Frontend Web   │   │ API Gateway /     │   │ State Servers       │
│ (SPA)          │   │ Backend Core      │   │ (Game Nodes)        │
│                │   │                   │   │                     │
│ Next.js        │   │ Node.js + NestJS  │   │ Node.js + Colyseus  │
│ React Konva    │   │ REST /api/v1      │   │ WebSocket (WSS)     │
│ Zustand        │   │ Auth · Decks      │   │ RoomState em RAM    │
│ Tailwind       │   │ Rooms · Perfis    │   │ @filter de zona     │
│ Vercel / CDN   │   │ Prisma            │   │ VPS dedicada        │
└───┬────────┬───┘   └────┬─────────┬────┘   └───┬─────────────┬───┘
    │        │            │         │            │             │
    │        │            │         │            │             │
    │        │      ┌─────▼───┐  ┌──▼──────┐  ┌──▼──────┐      │
    │        │      │Postgres │  │  Redis  │◄─┤ Presence│      │
    │        │      │(Users,  │  │(cache,  │  │ Driver  │      │
    │        │      │ Decks,  │  │ rate    │  └─────────┘      │
    │        │      │ card_   │  │ limit,  │                   │
    │        │      │ cache)  │  │ pubsub) │                   │
    │        │      └─────────┘  └─────────┘                   │
    │        │                                                 │
    │        └────────────► WSS ─────────────────────────────► │
    │
    └──── WebRTC (UDP) ──────► ┌──────────────────┐
                               │ Voice Server     │
                               │ LiveKit (SFU)    │
                               │ Opus · VAD       │
                               └──────────────────┘
```

### 2.3 Descrição dos contêineres

| Contêiner                    | Tecnologia                                          | Responsabilidade                                                                                              | **Não** é responsável por                   |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Frontend Web (SPA)**       | Next.js, React Konva (ou PixiJS), Zustand, Tailwind | Render do tabuleiro em GPU, UI de overlay, predição otimista, cache de imagem                                 | Decidir estado de jogo; esconder informação |
| **API Gateway / Core**       | Node.js + NestJS, Prisma                            | Auth OAuth/JWT, CRUD de decks e perfis, parsing de decklist, emissão de tokens de sala, _rate limiting_       | Estado de partida; WebSocket                |
| **State Server (Game Node)** | Node.js + Colyseus                                  | **Única fonte de verdade da partida**: zonas, coordenadas, contadores, RNG, `@filter`, log, _lock_ de arraste | Regras de MTG; persistência durável         |
| **Voice Server (SFU)**       | LiveKit                                             | Receber e redistribuir trilhas de áudio, VAD                                                                  | Estado de jogo; autenticação primária       |
| **Banco primário**           | PostgreSQL                                          | Usuários, decks, `card_cache`                                                                                 | Estado de partida (`RN12`)                  |
| **Cache / Presence**         | Redis                                               | _Rate limit_, Pub/Sub do Colyseus, presença de sala, sessão de reconexão                                      | Verdade durável                             |
| **Edge**                     | Cloudflare                                          | DDoS, WAF, CDN, _rate limit_ de borda                                                                         | Lógica de aplicação                         |

### 2.4 Nível 3 — Componentes do Game Server

```
game-server/
├── rooms/
│   ├── GameRoom.ts          onJoin · onLeave · onMessage · onDispose
│   └── matchmaker.ts        alocação e roomId de 6 caracteres
├── schema/
│   ├── Card.ts              @filter de zona oculta  ← CRÍTICO
│   ├── Player.ts            vida, contadores, commanderDamage
│   └── RoomState.ts         raiz da árvore de estado
├── intents/
│   ├── registry.ts          mapa intent → handler
│   ├── move.ts              grab · move · release (lock)
│   ├── zone.ts              changeZone · draw · mill · shuffle
│   ├── property.ts          tap · counters · faceDown
│   └── player.ts            life · commanderDamage · poison
├── services/
│   ├── rng.ts               crypto.randomInt · Fisher-Yates
│   ├── log.ts               mensagens neutras (RN09)
│   └── deckLoader.ts        deck → objetos Card
├── auth/
│   └── verifySeatToken.ts   token de uso único do Core
└── metrics/
    └── prometheus.ts        /metrics
```

**Regra de dependência:** `intents/` depende de `schema/` e `services/`, nunca o contrário.
`schema/` não conhece HTTP, banco, nem Scryfall.

---

## 3. Decisões arquiteturais (ADR)

### ADR-001 — Sandbox: ausência de _rules engine_

| Campo                        | Conteúdo                                                                                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**                   | Aceita · Imutável                                                                                                                                                                         |
| **Contexto**                 | Magic tem 25.000+ cartas, com pilha, camadas, prioridade, efeitos de substituição e interações emergentes. Novas cartas saem a cada ~2 meses.                                             |
| **Decisão**                  | **Não implementar motor de regras.** O sistema fornece peças, física e visibilidade; as regras ficam com os jogadores.                                                                    |
| **Consequências positivas**  | Elimina a maior parte da complexidade algorítmica; suporte instantâneo a **toda** carta que existe, inclusive lançada ontem; zero custo de manutenção de regras; o produto envelhece bem. |
| **Consequências negativas**  | Exige contrato social entre jogadores; público que espera automação pode se frustrar; erros de regra não são detectados.                                                                  |
| **Alternativas descartadas** | _(a)_ Motor completo — milhares de horas + manutenção perpétua. _(b)_ Motor parcial ("só o básico") — pior dos mundos: o jogador não sabe o que é validado.                               |
| **Reversível?**              | Não. Toda a arquitetura de intenções assume isso.                                                                                                                                         |

### ADR-002 — Colyseus em vez de Socket.io puro

| Campo                        | Conteúdo                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**                   | Aceita                                                                                                                                                                                                                                                                                                                |
| **Contexto**                 | O tabuleiro tem 300–400 objetos mutáveis. Emitir JSON completo a cada quadro é inviável em banda.                                                                                                                                                                                                                     |
| **Decisão**                  | Usar **Colyseus** com `Schema` e serialização Fossil Delta.                                                                                                                                                                                                                                                           |
| **Justificativa**            | Socket.io emite eventos brutos — cada mudança viraria uma mensagem manual, e a reconciliação seria escrita à mão. O Colyseus mantém o `Schema` no servidor e envia **apenas o delta binário**: se `x` vai de 10 para 15, o pacote são poucos bytes em vez de um JSON de mesa inteira. Redução de banda acima de 90 %. |
| **Bônus decisivo**           | `@filter` por propriedade — é o mecanismo que implementa `RN02`/`FR-06` **no servidor**. Com Socket.io isso seria lógica manual em cada emissão, com alta chance de vazamento.                                                                                                                                        |
| **Consequências negativas**  | Acoplamento a um framework de nicho; `@filter` custa CPU (avaliação por cliente); documentação menor que a do Socket.io.                                                                                                                                                                                              |
| **Alternativas descartadas** | _(a)_ Socket.io + diff manual — reinventar o Colyseus pior. _(b)_ Yjs/CRDT — resolve concorrência sem servidor autoritativo, mas **não** resolve informação oculta, que é o requisito nº 1. _(c)_ Nakama/Photon — mais peso e custo, com Go/C# fora do nosso idioma.                                                  |
| **Reversível?**              | Custo alto: o `Schema` está no centro do sistema.                                                                                                                                                                                                                                                                     |

### ADR-003 — Render via Canvas (React Konva)

| Campo                        | Conteúdo                                                                                                                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**                   | Aceita, com ressalva                                                                                                                                                                                                                                            |
| **Contexto**                 | Centenas de cartas arrastáveis simultâneas.                                                                                                                                                                                                                     |
| **Decisão**                  | Renderizar a mesa em `<canvas>` via **React Konva**; manter UI de overlay em DOM.                                                                                                                                                                               |
| **Justificativa**            | O DOM entra em colapso com centenas de `div` arrastadas: cada movimento dispara _reflow_/_repaint_ na árvore. O Canvas repassa a pintura à GPU e gerencia sprites e eventos com custo previsível.                                                               |
| **Ressalva registrada**      | Acima de ~1.000 nós mutáveis, o React Konva perde para PixiJS puro (que usa WebGL de forma mais agressiva). Nosso teto de projeto é 300–400 objetos, dentro da zona confortável — mas se `NFR-01` falhar em teste de carga, a migração para PixiJS é o plano B. |
| **Mitigação preventiva**     | Camada de abstração de render (`CanvasRenderer`) para que a troca de motor não vaze para a lógica de jogo.                                                                                                                                                      |
| **Alternativas descartadas** | _(a)_ DOM puro — inviável. _(b)_ PixiJS já no MVP — mais performance, mas ergonomia React pior e velocidade de desenvolvimento menor. _(c)_ Three.js/WebGL 3D — complexidade sem benefício para mesa 2D.                                                        |
| **Reversível?**              | Sim, se a abstração de render for respeitada.                                                                                                                                                                                                                   |

### ADR-004 — Informação oculta imposta no servidor

| Campo                        | Conteúdo                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**                   | Aceita · Não negociável                                                                                                                             |
| **Contexto**                 | O jogador pode abrir o DevTools e ler todo pacote WebSocket recebido.                                                                               |
| **Decisão**                  | Campos sensíveis (`scryfallId`, `name`) de cartas em `HAND`/`LIBRARY` **nunca saem do servidor** para quem não é o dono, via `@filter` do Colyseus. |
| **Justificativa**            | Esconder no cliente é ilusão de segurança: o pacote está lá. Sem essa decisão, o produto é indefensável como plataforma de jogo.                    |
| **Consequências**            | Custo de CPU por cliente na avaliação do filtro; testes de auditoria de pacote passam a ser obrigatórios em cada release (`G1`).                    |
| **Alternativas descartadas** | _(a)_ Esconder no cliente — trivialmente burlável. _(b)_ Criptografar por jogador — complexidade sem ganho: a chave estaria no cliente.             |
| **Reversível?**              | Nunca.                                                                                                                                              |

### ADR-005 — SFU (LiveKit) em vez de malha P2P

| Campo                        | Conteúdo                                                                                                                                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**                   | Aceita                                                                                                                                                                                                                                                            |
| **Contexto**                 | Voz para 4 participantes.                                                                                                                                                                                                                                         |
| **Decisão**                  | SFU centralizado (LiveKit), começando pelo LiveKit Cloud.                                                                                                                                                                                                         |
| **Justificativa**            | Em malha P2P com 4 pessoas, cada um faz **3 uploads** simultâneos da própria voz (~90 kbps de upload) e mantém 3 conexões ICE. O SFU reduz a **um** upload (~30 kbps) e uma conexão, o que importa muito em internet doméstica brasileira com upload assimétrico. |
| **Consequências negativas**  | Custo de banda no servidor (maior item da fatura em escala); dependência de terceiro; ponto único de falha da voz.                                                                                                                                                |
| **Mitigação**                | Falha de voz **não** afeta a mesa: são canais independentes. Migrar para SFU próprio quando a fatura passar de ~US$ 300/mês.                                                                                                                                      |
| **Alternativas descartadas** | _(a)_ P2P mesh — não escala no upload do usuário. _(b)_ MCU (mixagem no servidor) — CPU muito maior e perda de controle de volume individual. _(c)_ Discord externo — abandona o diferencial do produto.                                                          |

### ADR-006 — Sem persistência de estado de partida no banco relacional

| Campo                       | Conteúdo                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Status**                  | Aceita, com revisão prevista                                                                                             |
| **Contexto**                | O `RoomState` muda dezenas de vezes por segundo.                                                                         |
| **Decisão**                 | Estado de partida vive em RAM; PostgreSQL guarda apenas usuários, decks e `card_cache` (`RN12`).                         |
| **Justificativa**           | Persistir mutação de coordenada em banco relacional é desperdício de I/O e não há caso de uso que pague por isso no MVP. |
| **Consequências negativas** | Reinício do nó derruba as salas dele; não há replay.                                                                     |
| **Mitigação futura**        | _Snapshot_ periódico em Redis permitiria retomar sala após restart. Está em `DOC-002` §8 como pergunta aberta nº 4.      |

### ADR-007 — Monorepo com tipos compartilhados

| Campo                       | Conteúdo                                                                                                                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**                  | Aceita                                                                                                                                                                                                                                   |
| **Decisão**                 | Monorepo pnpm com `packages/shared-types` como única definição de `ICard`, `IPlayer`, _payloads_ de intenção e envelopes de erro.                                                                                                        |
| **Justificativa**           | Frontend e três serviços de backend falam do mesmo objeto `Card`. Duplicar a definição garante _drift_. Com tipo compartilhado, mudar um campo quebra a compilação de quem não acompanhou — o que é exatamente o comportamento desejado. |
| **Consequências negativas** | _Build_ acoplado; exige disciplina de versionamento interno.                                                                                                                                                                             |

### ADR-008 — TypeScript ponta a ponta

| Campo                    | Conteúdo                                                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**               | Aceita                                                                                                                                                                                   |
| **Decisão**              | Node.js + TypeScript no backend, mesmo com Go/Elixir sendo tecnicamente superiores para WebSocket em massa.                                                                              |
| **Justificativa**        | Um único idioma permite compartilhar tipos (ADR-007) e reduz custo cognitivo de um time pequeno. O gargalo do projeto é banda e I/O, não CPU bruta. Node segura o volume-alvo com folga. |
| **Ponto de reavaliação** | Se um nó saturar CPU abaixo de 100 salas, reavaliar Elixir/Go para o game server isoladamente.                                                                                           |

---

## 4. Vistas arquiteturais

### 4.1 Vista de implantação

| Ambiente     | Frontend         | API Core                   | Game Server      | Postgres                        | Redis            | LiveKit                |
| ------------ | ---------------- | -------------------------- | ---------------- | ------------------------------- | ---------------- | ---------------------- |
| **Local**    | `localhost:3000` | `localhost:3333`           | `localhost:2567` | Docker                          | Docker           | LiveKit CLI (opcional) |
| **Staging**  | Vercel preview   | Render (1 instância)       | 1 VPS pequena    | Postgres gerenciado             | Redis gerenciado | LiveKit Cloud (dev)    |
| **Produção** | Vercel + CDN     | Render/ECS (2+ instâncias) | 2+ VPS dedicadas | Postgres gerenciado com réplica | Redis gerenciado | LiveKit Cloud          |

Detalhes em [devops_e_infraestrutura.md](devops_e_infraestrutura.md).

### 4.2 Vista de dados

| Dado                                       | Onde vive                        | Durabilidade                          |
| ------------------------------------------ | -------------------------------- | ------------------------------------- |
| Usuário, deck                              | PostgreSQL                       | Durável                               |
| `card_cache`                               | PostgreSQL                       | Derivável (reconstruível da Scryfall) |
| `RoomState`                                | RAM do game node                 | **Volátil**                           |
| Presença de sala, `sessionId` de reconexão | Redis                            | Volátil, TTL curto                    |
| _Rate limit_                               | Redis                            | Volátil                               |
| Imagens de carta                           | CDN da Scryfall + Service Worker | Cache                                 |
| Métricas                                   | Prometheus                       | Retenção de 15 dias                   |

### 4.3 Vista de segurança

Três fronteiras de confiança:

1. **Borda pública** (Cloudflare) — DDoS, WAF, _rate limit_ de IP.
2. **Fronteira de autenticação** (API Core) — JWT; emite tokens de uso único para WS e LiveKit.
3. **Fronteira de autorização de estado** (Game Server) — valida `ownerId`/`controllerId` por intenção
   e aplica `@filter` na saída.

Detalhes em [plano_de_seguranca_e_ameacas_threat_model.md](plano_de_seguranca_e_ameacas_threat_model.md).

---

## 5. Riscos arquiteturais

| #   | Risco                                                          | Prob. | Impacto   | Mitigação                                                                                     | Gatilho de ação                        |
| --- | -------------------------------------------------------------- | ----- | --------- | --------------------------------------------------------------------------------------------- | -------------------------------------- |
| R1  | `@filter` mal aplicado vaza informação oculta                  | Média | **Fatal** | Teste de auditoria de pacote em CI (`G1`); revisão obrigatória de todo campo novo no `Schema` | Qualquer campo adicionado a `Card`     |
| R2  | React Konva não atinge `NFR-01`                                | Média | Alto      | Abstração `CanvasRenderer`; plano B PixiJS                                                    | FPS p05 < 30 no hardware de referência |
| R3  | Escalonamento horizontal do Colyseus mais difícil que previsto | Média | Alto      | POC de 2 nós + Redis **antes** da Fase 4                                                      | POC falhar                             |
| R4  | Custo de voz insustentável                                     | Média | Alto      | Degradar bitrate; teto por sala; SFU próprio                                                  | Fatura > US$ 300/mês                   |
| R5  | Scryfall muda contrato ou limita uso                           | Baixa | Alto      | Cliente isolado em `packages/scryfall-client`; bulk data diário                               | Mudança anunciada                      |
| R6  | Reinício de nó derruba salas                                   | Alta  | Médio     | Deploy com drenagem; aviso na UI; _snapshot_ em Redis (ADR-006)                               | Reclamação recorrente                  |
| R7  | Node.js satura CPU antes do previsto                           | Baixa | Médio     | Métricas de `tick` por sala; reavaliar Elixir/Go                                              | CPU > 80 % com < 100 salas             |
| R8  | Notificação legal da WotC                                      | Baixa | **Fatal** | Conformidade estrita (`RN04`); canal de contato                                               | Qualquer contato oficial               |

---

## 6. Restrições arquiteturais

1. Game server **não pode** rodar em serverless.
2. Nenhum campo sensível **pode** ser adicionado ao `Schema` sem `@filter` correspondente.
3. Nenhuma lógica de aleatoriedade **pode** existir no cliente (`RN06`).
4. Nenhuma dependência de render **pode** ser referenciada fora da camada de Canvas (ADR-003).
5. Tipos de domínio **devem** vir de `packages/shared-types` (ADR-007).
6. Estado de partida **não pode** ser gravado em PostgreSQL (ADR-006).

---

## 7. Evolução planejada

| Momento       | Mudança arquitetural                  | Disparador                               |
| ------------- | ------------------------------------- | ---------------------------------------- |
| Fase 4        | 2º game node + Redis Presence         | Mais de ~40 salas simultâneas            |
| V2            | Modo espectador com filtro endurecido | Escopo de produto                        |
| V2            | _Snapshot_ de sala em Redis           | Reclamação sobre perda de sala em deploy |
| Pós-V2        | SFU próprio                           | Custo de voz                             |
| Pós-V2        | Réplica de leitura no Postgres        | Latência de listagem de deck             |
| Se necessário | Game server em Elixir/Go              | Saturação de CPU                         |
