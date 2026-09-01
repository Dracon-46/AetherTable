# Software Requirements Specification (SRS)

| Campo                       | Valor                                                                                                                                                                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                      | `DOC-010`                                                                                                                                                                                                                                                         |
| **Versão**                  | 1.1                                                                                                                                                                                                                                                               |
| **Status**                  | Estável                                                                                                                                                                                                                                                           |
| **Última revisão**          | 2026-08-20                                                                                                                                                                                                                                                        |
| **Documentos relacionados** | [readme.md](readme.md) · [documento_de_requisitos_do_produto_prd.md](documento_de_requisitos_do_produto_prd.md) · [plano_de_testes_e_qualidade.md](plano_de_testes_e_qualidade.md) · [especificacao_websocket_e_eventos.md](especificacao_websocket_e_eventos.md) |

---

## 1. Introdução

### 1.1 Propósito

Este documento especifica os requisitos funcionais, não funcionais e as interfaces do sistema
AetherTable em **linguagem de engenharia, mensurável e testável**. É o guia primário para
desenvolvimento e a base para o plano de testes (`DOC-052`).

Diferença de papel em relação ao PRD (`DOC-002`): o PRD diz _"a carta deve sincronizar rápido"_;
este documento diz _"p95 do RTT de `INTENT_MOVE_CARD` ≤ 150 ms medido no cliente"_.

### 1.2 Escopo

Plataforma cliente-servidor baseada em Canvas/WebGL para simulação de mesa de cartas (_sandbox_),
focada no formato Commander. O escopo cobre criação de salas, sincronização de estado multijogador
em tempo real, manipulação de objetos 2D, informação oculta imposta por servidor e comunicação de
voz via WebRTC.

**Fora de escopo, permanentemente:** implementação do livro de regras do MTG (_rules engine_).

### 1.3 Definições

| Termo              | Definição operacional neste documento                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| **Mutação**        | Alteração de um campo do `RoomState` no servidor                                                    |
| **Intent**         | Mensagem cliente→servidor pedindo uma mutação                                                       |
| **Patch**          | Pacote binário servidor→cliente com o _delta_ de estado                                             |
| **RTT de mutação** | Tempo entre o envio do _intent_ e a chegada do _patch_ correspondente, medido no cliente originador |
| **Zona oculta**    | `HAND` ou `LIBRARY` de um jogador                                                                   |
| **Sprite**         | Objeto renderizado no Canvas representando uma carta, token ou dado                                 |
| **CCU**            | Usuários simultâneos conectados a game servers                                                      |

### 1.4 Convenções normativas

- **DEVE** (`MUST`) — obrigatório; a ausência é defeito bloqueante.
- **DEVERIA** (`SHOULD`) — recomendado; desvio precisa ser justificado por escrito.
- **PODE** (`MAY`) — opcional.

---

## 2. Requisitos funcionais (FR)

### 2.1 Autenticação e sessão

| ID        | Requisito                                                                                                                                                                               | Verificação                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **FR-01** | O sistema **DEVE** autenticar usuários via OAuth 2.0 (Discord, Google) e via e-mail/senha com hash Argon2id.                                                                            | Teste de integração por provedor; hash inspecionado no banco                          |
| **FR-02** | O sistema **DEVE** manter a sessão por até 7 dias usando JWT de acesso (TTL 15 min) e _refresh token_ rotativo (TTL 7 dias) armazenado como cookie `HttpOnly; Secure; SameSite=Strict`. | Teste de expiração e de rotação; reuso de _refresh_ revogado deve invalidar a família |
| **FR-19** | O sistema **DEVE** invalidar todas as sessões de um usuário ao trocar a senha ou pedir exclusão de conta.                                                                               | Teste de integração                                                                   |
| **FR-20** | O sistema **DEVE** emitir, ao ingressar em sala, um token de curta duração (TTL 60 s, uso único) para o _handshake_ do game server e outro para o LiveKit.                              | Token reusado retorna 401                                                             |

### 2.2 Deckbuilder

| ID        | Requisito                                                                                                                                                                                                              | Verificação                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **FR-03** | O sistema **DEVE** aceitar _payload_ de texto plano, fazer o _parsing_ de quantidade/nome/edição e resolver contra cache interno ou Scryfall, retornando lista estruturada de cartas e lista de linhas não resolvidas. | Suíte com os 7 formatos de `DOC-035` §4.1                         |
| **FR-04** | O sistema **DEVE** persistir apenas `scryfall_id`, `quantity`, `is_commander` e `board_type` por carta — nunca nome, texto ou imagem.                                                                                  | Inspeção do schema; teste de migração                             |
| **FR-13** | O sistema **DEVE** agrupar nomes idênticos antes de montar o _batch_ e respeitar o teto de 75 identificadores por chamada a `POST /cards/collection`.                                                                  | Teste unitário do montador de _batch_                             |
| **FR-14** | O sistema **DEVE** resolver corretamente cartas de dupla face lendo `card_faces[n].image_uris` quando `image_uris` estiver ausente.                                                                                    | Teste com `layout` `transform`, `modal_dfc`, `split`, `adventure` |
| **FR-15** | O sistema **DEVE** retornar aviso não bloqueante quando o deck tiver contagem ≠ 100, carta com `legalities.commander != "legal"` ou comandante ausente.                                                                | Teste de integração; salvamento **DEVE** ocorrer                  |

### 2.3 Salas e _matchmaking_

| ID        | Requisito                                                                                                                                                       | Verificação                         |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **FR-05** | O host **DEVE** poder solicitar a alocação de uma instância de sala, recebendo um `roomId` único de 6 caracteres do alfabeto `A-Z2-9` (sem `0`, `O`, `1`, `I`). | Teste de colisão sobre 10⁶ gerações |
| **FR-16** | O sistema **DEVE** rejeitar a 5ª conexão de jogador com erro tipado `ROOM_FULL`, permitindo espectadores apenas se habilitado.                                  | Teste de integração                 |
| **FR-17** | O sistema **DEVE** encerrar salas sem nenhuma conexão ativa após 10 minutos, liberando memória.                                                                 | Teste com relógio simulado          |

### 2.4 Engine de estado

| ID        | Requisito                                                                                                                                                                                                                               | Verificação                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **FR-06** | O servidor **DEVE** aplicar filtragem de rede (_network culling_). Se um objeto `Card` tem `zone` em {`HAND`, `LIBRARY`}, apenas `id`, `zone`, `ownerId` e `faceDown` são transmitidos a clientes cujo `sessionId` difira de `ownerId`. | **Teste obrigatório:** capturar o tráfego WS de um cliente oponente e assertar ausência de `scryfallId`/`name` |
| **FR-07** | O servidor **DEVE** aceitar e refletir alterações de `x`, `y`, `rotation`, `zIndex` de objetos `Card` com `zone = "BATTLEFIELD"`.                                                                                                       | Teste de integração de sala                                                                                    |
| **FR-09** | Toda operação aleatória (embaralhar, dado, moeda) **DEVE** ser executada no servidor com `crypto.randomInt`. Nenhum resultado aleatório **PODE** originar-se do cliente.                                                                | Revisão de código + teste de distribuição χ² sobre 10⁵ rolagens                                                |
| **FR-10** | O servidor **DEVE** manter _lock_ de arraste: ao receber `INTENT_GRAB` de um cliente, ignora `INTENT_MOVE_CARD` de outros para o mesmo `entityId` até `INTENT_RELEASE` ou expiração de 5 s.                                             | Teste com dois clientes disputando a mesma carta                                                               |
| **FR-11** | O servidor **DEVE** validar todo _payload_ de intenção com Zod e descartar mensagens malformadas sem derrubar a sala.                                                                                                                   | _Fuzzing_ de mensagens WS                                                                                      |
| **FR-12** | O servidor **DEVE** rejeitar intenções sobre entidades cujo `ownerId`/`controllerId` não corresponda ao remetente, exceto operações públicas explicitamente permitidas.                                                                 | Teste de autorização por intenção                                                                              |
| **FR-18** | O servidor **DEVE** permitir reconexão com o mesmo `sessionId` dentro de 90 s, restaurando o estado sem recriar os objetos do jogador.                                                                                                  | Teste de queda e retomada                                                                                      |
| **FR-21** | O servidor **DEVE** gerar entrada de log para toda mutação relevante, com texto neutro que jamais revele identidade de carta oculta.                                                                                                    | Revisão da tabela de logs + teste de conteúdo                                                                  |

### 2.5 Voz

| ID        | Requisito                                                                                                                                                                                  | Verificação                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| **FR-08** | Ao conectar na sala, o sistema **DEVE** despachar um token do LiveKit com escopo do `roomId`; o cliente **DEVE** publicar sua trilha de áudio e se inscrever nas dos demais participantes. | Teste E2E com 4 participantes    |
| **FR-22** | O cliente **DEVE** oferecer _mute_ de publicação, _mute_ local por participante e volume individual persistido localmente.                                                                 | Teste manual + unitário do store |

### 2.6 Cliente / render

| ID        | Requisito                                                                                                                                                                | Verificação                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| **FR-23** | O cliente **DEVE** requisitar imagem em qualidade `small` para cartas em `BATTLEFIELD`/`HAND` próprias e **NÃO DEVE** requisitar imagem alguma para cartas em `LIBRARY`. | Auditoria de requisições de rede na aba Network |
| **FR-24** | O cliente **DEVE** reaproveitar a mesma textura decodificada entre sprites de igual `scryfallId`.                                                                        | Teste de contagem de objetos `Image`            |
| **FR-25** | O cliente **DEVE** interpolar movimento de cartas alheias em vez de aplicar salto instantâneo de coordenada.                                                             | QA visual                                       |

---

## 3. Requisitos não funcionais (NFR)

| ID         | Categoria              | Requisito                                                                                           | Método de medição                                                                                                          | Meta                                                                            |
| ---------- | ---------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **NFR-01** | Performance gráfica    | Render de até 300 sprites de carta mantendo taxa de quadros estável via Canvas/WebGL                | `requestAnimationFrame` amostrado por 60 s em hardware de referência (Intel i5 8ª geração, gráficos integrados, 1920×1080) | **≥ 30 FPS obrigatório · 60 FPS alvo**                                          |
| **NFR-02** | Latência de rede       | RTT de mutação de estado sob conexão 4G ou banda larga                                              | Histograma no cliente sobre 1.000 mutações                                                                                 | **p95 ≤ 150 ms · p99 ≤ 300 ms**                                                 |
| **NFR-03** | Escalabilidade         | Múltiplos processos Node.js do Colyseus coordenados por Redis Pub/Sub, com escalonamento horizontal | Teste de carga com 2 e 4 nós                                                                                               | Dobrar CCU dobrando nós, sem alterar código                                     |
| **NFR-04** | Segurança de API       | Rate limiting em todas as rotas HTTP e proteção CSRF                                                | Teste automatizado de limite                                                                                               | **100 req/min por IP** geral; **5/min** em login; **3/hora** em criação de sala |
| **NFR-05** | Uso de banda (WS)      | Tráfego por jogador em partida ativa                                                                | Medição em partida de 40 min                                                                                               | **≤ 15 KB/s** de pico por cliente                                               |
| **NFR-06** | Uso de banda (voz)     | Upload por participante                                                                             | Estatística do LiveKit                                                                                                     | **≈ 30 kbps** contínuos                                                         |
| **NFR-07** | Memória do servidor    | Consumo por sala ativa                                                                              | Heap snapshot com 4 jogadores e 400 objetos                                                                                | **≤ 8 MB por sala**                                                             |
| **NFR-08** | Tempo de inicialização | Do clique em "Entrar na mesa" até o primeiro quadro jogável                                         | Marca de performance no cliente                                                                                            | **≤ 3 s** em banda larga                                                        |
| **NFR-09** | Disponibilidade        | Uptime mensal                                                                                       | Monitor externo                                                                                                            | **99,5 %** API · **99,0 %** game servers                                        |
| **NFR-10** | Compatibilidade        | Navegadores suportados                                                                              | Matriz de teste E2E                                                                                                        | Chrome, Edge, Firefox, Safari — 2 últimas versões                               |
| **NFR-11** | Observabilidade        | Métricas exportadas em formato Prometheus                                                           | Endpoint `/metrics`                                                                                                        | Salas ativas, CCU, RSS, _tick_ médio, patches/s, erros/min                      |
| **NFR-12** | Cobertura de testes    | Cobertura de linha nas funções de mutação e utilidades                                              | Relatório do Jest                                                                                                          | **≥ 80 %**                                                                      |
| **NFR-13** | Acessibilidade         | Contraste e operabilidade por teclado na UI de DOM                                                  | Auditoria axe-core                                                                                                         | Zero violação crítica; contraste AA                                             |
| **NFR-14** | Recuperação            | Reinício de um game server não deve derrubar salas de outro nó                                      | Teste de caos                                                                                                              | Salas de outros nós intactas                                                    |

---

## 4. Interfaces de comunicação

### 4.1 Cliente ↔ API (HTTP)

| Item          | Especificação                                                               |
| ------------- | --------------------------------------------------------------------------- |
| Protocolo     | HTTPS obrigatório, TLS 1.3                                                  |
| Formato       | JSON, `Content-Type: application/json; charset=utf-8`                       |
| Autenticação  | `Authorization: Bearer <JWT>`                                               |
| Versionamento | Prefixo de rota `/api/v1/...`                                               |
| Erros         | Envelope `{ "error": "CODIGO_ESTAVEL", "message": "texto", "details": {} }` |
| Paginação     | `?page=1&limit=50`, resposta com `{ data, meta: { page, limit, total } }`   |
| Idempotência  | `POST` de criação aceita `Idempotency-Key`                                  |

Detalhes por endpoint em [especificacao_da_api_backend.md](especificacao_da_api_backend.md).

### 4.2 Cliente ↔ State Server (WebSocket)

| Item                     | Especificação                                                                    |
| ------------------------ | -------------------------------------------------------------------------------- |
| Transporte               | `wss://` (TLS 1.3), sem _fallback_ para `ws://` em produção                      |
| Protocolo                | Colyseus com serialização `Schema` + Fossil Delta (binário)                      |
| _Handshake_              | Token de sala de uso único no `joinOptions`, validado antes de aceitar a conexão |
| _Heartbeat_              | `ping`/`pong` a cada 15 s; conexão sem `pong` por 45 s é encerrada               |
| Direção cliente→servidor | Apenas mensagens de **intenção**; nunca estado                                   |
| Direção servidor→cliente | Apenas _patches_ de estado e eventos de log                                      |
| Limite de taxa           | 30 intenções/s por cliente; excedente descartado com aviso                       |

Dicionário completo em [especificacao_websocket_e_eventos.md](especificacao_websocket_e_eventos.md).

### 4.3 Cliente ↔ Voice Server (WebRTC)

| Item          | Especificação                                                    |
| ------------- | ---------------------------------------------------------------- |
| Sinalização   | WebSocket do LiveKit, autenticado por JWT com escopo de `roomId` |
| Mídia         | UDP com _hole punching_ via STUN; TURN como _fallback_           |
| Codec         | Opus, mono, 24–48 kbps, DTX habilitado                           |
| Processamento | Supressão de ruído, cancelamento de eco e AGC do lado do cliente |

Detalhes em [especificacao_webrtc_e_audio.md](especificacao_webrtc_e_audio.md).

### 4.4 Backend ↔ Scryfall

Ver [integracoes_externas_scryfall.md](integracoes_externas_scryfall.md): `User-Agent` identificável,
intervalo mínimo de 100 ms entre chamadas, _backoff_ exponencial em `429`.

---

## 5. Rastreabilidade

| FR/NFR               | Origem no PRD | Regra de negócio | Onde é implementado                     | Onde é testado                |
| -------------------- | ------------- | ---------------- | --------------------------------------- | ----------------------------- |
| FR-01, FR-02         | RF01          | —                | `backend-core/auth`                     | Integração de auth            |
| FR-03, FR-13, FR-14  | RF04, RF05    | RN05             | `backend-core/decks`, `scryfall-client` | Unitário do parser            |
| FR-04                | RF05          | —                | `modelo_de_dados`                       | Migração + integração         |
| FR-05, FR-16, FR-17  | RF07, RF24    | RN03             | `game-server/rooms`                     | Integração de sala            |
| **FR-06**            | **RF09**      | **RN02**         | `game-server/schema` (`@filter`)        | **Auditoria de pacote WS**    |
| FR-07, FR-10         | RF08, RF17    | RN01             | `game-server/intents`                   | Integração com 2 clientes     |
| FR-09                | RF23          | RN06             | `game-server/rng`                       | Distribuição χ²               |
| FR-08, FR-22         | RF11          | —                | `frontend/voice`                        | E2E com 4 pares               |
| FR-18                | RF21          | —                | `game-server/reconnect`                 | Teste de queda                |
| NFR-01, FR-23, FR-24 | RNF01         | —                | `frontend/canvas`                       | QA visual + amostragem de FPS |
| NFR-02               | RNF04         | —                | transversal                             | Teste de carga                |
| NFR-03, NFR-14       | RNF02         | —                | `devops`                                | Teste de caos                 |
| NFR-11               | RNF03         | —                | `game-server/metrics`                   | Verificação de `/metrics`     |

---

## 6. Restrições de projeto

1. **TypeScript em todas as camadas**, com tipos de domínio em `packages/shared-types` como única
   definição de contrato (`NFR` de manutenibilidade em `DOC-002` §3).
2. **Node.js LTS** (≥ 18) no backend.
3. **Sem serverless** para o game server: WebSocket exige processo persistente com porta aberta.
4. **PostgreSQL** como único armazenamento durável; Redis é volátil e descartável.
5. **Nenhum dado de carta** (nome, texto, imagem) persistido além do cache derivável de `DOC-035` §6.
6. **Sem estado de jogo no banco relacional** — o `RoomState` vive em memória, opcionalmente em Redis.

---

## 7. Critérios de aceite de release

Um release **não sai** se qualquer item abaixo falhar:

| Gate                       | Critério                                                                   |
| -------------------------- | -------------------------------------------------------------------------- |
| **G1 — Informação oculta** | Auditoria de tráfego WS não revela zona oculta alheia (`FR-06`)            |
| **G2 — Performance**       | 300 sprites a ≥ 30 FPS no hardware de referência (`NFR-01`)                |
| **G3 — Latência**          | p95 de RTT ≤ 150 ms no teste de carga (`NFR-02`)                           |
| **G4 — Cobertura**         | ≥ 80 % nas funções de mutação (`NFR-12`)                                   |
| **G5 — E2E**               | Caminho feliz completo: login → import → sala → jogar carta (`DOC-052`)    |
| **G6 — Segurança**         | Zero vulnerabilidade crítica/alta no `npm audit` e no scan de dependências |
| **G7 — Carga**             | 500 conexões simultâneas sem exceder 80 % de CPU (`DOC-052` §3)            |
| **G8 — Acessibilidade**    | Zero violação crítica no axe-core (`NFR-13`)                               |
