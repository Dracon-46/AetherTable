# AetherTable — Documentação Mestra

> **Arquivo central do projeto.** Este é o único documento que você precisa abrir sem saber
> o que procurar. Ele diz **onde cada assunto vive**, **qual documento é a fonte canônica** de
> cada decisão e **em que ordem ler** conforme o seu papel no time.

| Campo                          | Valor                                                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Produto**                    | AetherTable — plataforma web _sandbox_ para Magic: The Gathering, **multiformato**, com Commander/EDH como formato-vitrine                    |
| **Tipo de sistema**            | Multiplayer web em tempo real, cliente-servidor com servidor autoritativo de estado                                                           |
| **Premissa central**           | **Não existe motor de regras.** O sistema move peças, sincroniza estado e esconde informação. As regras do MTG são aplicadas pelos jogadores. |
| **ID deste documento**         | `DOC-000`                                                                                                                                     |
| **Versão**                     | 1.1                                                                                                                                           |
| **Status**                     | Ativo — índice mestre                                                                                                                         |
| **Última revisão**             | 2026-08-20                                                                                                                                    |
| **Padrão de nomes de arquivo** | `snake_case.md`, sem acentos, sem parênteses                                                                                                  |

---

## 1. Mapa rápido — "onde eu acho isso?"

Localize a pergunta na coluna da esquerda. A **fonte canônica** é o documento que manda:
se dois documentos discordarem, vale o canônico.

| Quero saber sobre…                                                                   | Fonte canônica                                                                                         | Apoio / detalhe                                                                                        |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Por que o produto existe, para quem, e como se sustenta                              | [documento_de_visao_do_projeto.md](documento_de_visao_do_projeto.md)                                   | [projeto_commander_online.md](projeto_commander_online.md)                                             |
| Escopo geral, épicos e roadmap comercial                                             | [documento_de_requisitos_do_produto_prd.md](documento_de_requisitos_do_produto_prd.md)                 | [documento_de_visao_do_projeto.md](documento_de_visao_do_projeto.md)                                   |
| Lista completa de funcionalidades (F01…Fnn)                                          | [documento_de_funcionalidades.md](documento_de_funcionalidades.md)                                     | [documento_de_requisitos_do_produto_prd.md](documento_de_requisitos_do_produto_prd.md)                 |
| Requisitos formais, mensuráveis, testáveis (FR/NFR)                                  | [especificacao_de_requisitos_de_software.md](especificacao_de_requisitos_de_software.md)               | [plano_de_testes_e_qualidade.md](plano_de_testes_e_qualidade.md)                                       |
| Regras invariáveis do negócio (RN01…)                                                | [regras_de_negocio_e_casos_de_uso.md](regras_de_negocio_e_casos_de_uso.md)                             | —                                                                                                      |
| Narrativas de uso passo a passo (CDU)                                                | [documentos_de_casos_de_uso.md](documentos_de_casos_de_uso.md)                                         | [regras_de_negocio_e_casos_de_uso.md](regras_de_negocio_e_casos_de_uso.md)                             |
| Topologia, contêineres, ADRs, decisões estruturais                                   | [documento_de_arquitetura_de_software_sad.md](documento_de_arquitetura_de_software_sad.md)             | [documento_de_arquitetura.md](documento_de_arquitetura.md)                                             |
| Diagrama de fluxo, padrões de comunicação, tolerância a falhas                       | [documento_de_arquitetura.md](documento_de_arquitetura.md)                                             | [documento_de_arquitetura_de_software_sad.md](documento_de_arquitetura_de_software_sad.md)             |
| Quais tecnologias usar e por quê                                                     | [stack_tecnologico.md](stack_tecnologico.md)                                                           | [documento_de_arquitetura_de_software_sad.md](documento_de_arquitetura_de_software_sad.md)             |
| Tabelas, colunas, índices, migrações                                                 | [modelo_de_dados.md](modelo_de_dados.md)                                                               | [especificacao_da_api_backend.md](especificacao_da_api_backend.md)                                     |
| Endpoints HTTP, payloads, códigos de erro                                            | [especificacao_da_api_backend.md](especificacao_da_api_backend.md)                                     | [modelo_de_dados.md](modelo_de_dados.md)                                                               |
| Protocolo WebSocket, comandos, patches                                               | [especificacao_websocket_e_eventos.md](especificacao_websocket_e_eventos.md)                           | [especificacao_do_motor_de_estado_state_machine.md](especificacao_do_motor_de_estado_state_machine.md) |
| **Schema** do estado da sala (classes Colyseus)                                      | [especificacao_do_motor_sandbox.md](especificacao_do_motor_sandbox.md)                                 | [especificacao_do_motor_de_estado_state_machine.md](especificacao_do_motor_de_estado_state_machine.md) |
| Comportamento do servidor por intenção (mover, virar, embaralhar)                    | [especificacao_do_motor_de_estado_state_machine.md](especificacao_do_motor_de_estado_state_machine.md) | [especificacao_websocket_e_eventos.md](especificacao_websocket_e_eventos.md)                           |
| Voz, WebRTC, SFU, tokens do LiveKit                                                  | [especificacao_webrtc_e_audio.md](especificacao_webrtc_e_audio.md)                                     | [documento_de_arquitetura.md](documento_de_arquitetura.md)                                             |
| Camadas de render, Canvas, stores do frontend                                        | [especificacao_tecnica_do_frontend_ui_ux.md](especificacao_tecnica_do_frontend_ui_ux.md)               | [guia_de_ui_e_design_system.md](guia_de_ui_e_design_system.md)                                         |
| Cores, tipografia, espaçamento, componentes, atalhos                                 | [guia_de_ui_e_design_system.md](guia_de_ui_e_design_system.md)                                         | [especificacao_tecnica_do_frontend_ui_ux.md](especificacao_tecnica_do_frontend_ui_ux.md)               |
| **O que o jogador pode fazer na mesa** (olhar o topo, revelar, scry, exilar, setas…) | [catalogo_de_acoes_da_mesa.md](catalogo_de_acoes_da_mesa.md)                                           | [especificacao_websocket_e_eventos.md](especificacao_websocket_e_eventos.md)                           |
| **Quais formatos são suportados** e as regras de cada um                             | [catalogo_de_formatos_e_variantes.md](catalogo_de_formatos_e_variantes.md)                             | [modelo_de_dados.md](modelo_de_dados.md)                                                               |
| Como consumir a Scryfall sem tomar bloqueio                                          | [integracoes_externas_scryfall.md](integracoes_externas_scryfall.md)                                   | [especificacao_da_api_backend.md](especificacao_da_api_backend.md)                                     |
| Anti-cheat, informação oculta, privacidade, LGPD                                     | [seguranca_e_privacidade.md](seguranca_e_privacidade.md)                                               | [plano_de_seguranca_e_ameacas_threat_model.md](plano_de_seguranca_e_ameacas_threat_model.md)           |
| Vetores de ataque, STRIDE, mitigações                                                | [plano_de_seguranca_e_ameacas_threat_model.md](plano_de_seguranca_e_ameacas_threat_model.md)           | [seguranca_e_privacidade.md](seguranca_e_privacidade.md)                                               |
| Estratégia de testes, metas de cobertura, teste de carga                             | [plano_de_testes_e_qualidade.md](plano_de_testes_e_qualidade.md)                                       | [especificacao_de_requisitos_de_software.md](especificacao_de_requisitos_de_software.md)               |
| Nuvem, CI/CD, observabilidade, custos                                                | [devops_e_infraestrutura.md](devops_e_infraestrutura.md)                                               | [stack_tecnologico.md](stack_tecnologico.md)                                                           |
| Rodar o projeto na minha máquina                                                     | [guia_de_configuracao_e_desenvolvimento.md](guia_de_configuracao_e_desenvolvimento.md)                 | [stack_tecnologico.md](stack_tecnologico.md)                                                           |
| Visão original / pitch histórico e roadmap em fases                                  | [projeto_commander_online.md](projeto_commander_online.md)                                             | —                                                                                                      |

---

## 2. Catálogo completo de documentos

### Trilha 1 — Produto e negócio _(por que construímos)_

| ID        | Documento                                                                              | Conteúdo em uma linha                                                                                        | Status    |
| --------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------- |
| `DOC-001` | [documento_de_visao_do_projeto.md](documento_de_visao_do_projeto.md)                   | Problema, solução, viabilidade técnica/jurídica/financeira, monetização legal, roadmap MVP→V2.               | Estável   |
| `DOC-002` | [documento_de_requisitos_do_produto_prd.md](documento_de_requisitos_do_produto_prd.md) | Épicos, requisitos funcionais de produto (RF), requisitos não funcionais de alto nível, métricas de sucesso. | Estável   |
| `DOC-003` | [documento_de_funcionalidades.md](documento_de_funcionalidades.md)                     | Catálogo exaustivo de funcionalidades por módulo, com prioridade MoSCoW e fase de entrega.                   | Estável   |
| `DOC-004` | [projeto_commander_online.md](projeto_commander_online.md)                             | Documento fundador: escopo, stack recomendada e roadmap em 5 fases. Mantido como referência histórica.       | Congelado |

### Trilha 2 — Requisitos e comportamento _(o que o sistema faz)_

| ID        | Documento                                                                                | Conteúdo em uma linha                                                                        | Status  |
| --------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------- |
| `DOC-010` | [especificacao_de_requisitos_de_software.md](especificacao_de_requisitos_de_software.md) | SRS formal: FR e NFR com critérios de aceite mensuráveis.                                    | Estável |
| `DOC-011` | [regras_de_negocio_e_casos_de_uso.md](regras_de_negocio_e_casos_de_uso.md)               | Regras invariáveis (RN) + casos de uso técnicos com fluxo de rede.                           | Estável |
| `DOC-012` | [documentos_de_casos_de_uso.md](documentos_de_casos_de_uso.md)                           | Casos de uso narrativos (CDU) em linguagem de usuário, com fluxos alternativos e de exceção. | Estável |

### Trilha 3 — Arquitetura _(como o sistema é montado)_

| ID        | Documento                                                                                  | Conteúdo em uma linha                                                                                | Status  |
| --------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------- |
| `DOC-020` | [documento_de_arquitetura_de_software_sad.md](documento_de_arquitetura_de_software_sad.md) | SAD: modelo C4, contêineres, ADRs numeradas, atributos de qualidade, riscos arquiteturais.           | Estável |
| `DOC-021` | [documento_de_arquitetura.md](documento_de_arquitetura.md)                                 | Topologia, padrões de comunicação (WS/WebRTC/HTTP), render gráfico, reconexão e tolerância a falhas. | Estável |
| `DOC-022` | [stack_tecnologico.md](stack_tecnologico.md)                                               | Tecnologia escolhida por camada, alternativas descartadas, versões-alvo e critério de troca.         | Estável |
| `DOC-023` | [modelo_de_dados.md](modelo_de_dados.md)                                                   | Esquema PostgreSQL, dicionário de dados, índices, migrações e política de retenção.                  | Estável |

### Trilha 4 — Contratos e engine _(as interfaces exatas)_

| ID        | Documento                                                                                              | Conteúdo em uma linha                                                                                                    | Status  |
| --------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------- |
| `DOC-030` | [especificacao_da_api_backend.md](especificacao_da_api_backend.md)                                     | Endpoints REST, payloads, respostas, códigos de erro, paginação, rate limit.                                             | Estável |
| `DOC-031` | [especificacao_websocket_e_eventos.md](especificacao_websocket_e_eventos.md)                           | Handshake, dicionário completo de comandos cliente→servidor e eventos servidor→cliente.                                  | Estável |
| `DOC-032` | [especificacao_do_motor_sandbox.md](especificacao_do_motor_sandbox.md)                                 | Schema autoritativo do estado da sala (Card/Player/RoomState), zonas, visibilidade, RNG.                                 | Estável |
| `DOC-033` | [especificacao_do_motor_de_estado_state_machine.md](especificacao_do_motor_de_estado_state_machine.md) | Máquina de estados da sala, tabela de intenções → mutação, lock de arraste, anti-desync.                                 | Estável |
| `DOC-034` | [especificacao_webrtc_e_audio.md](especificacao_webrtc_e_audio.md)                                     | Topologia SFU, emissão de token, ciclo de vida das tracks, VAD, controles de mute/volume.                                | Estável |
| `DOC-035` | [integracoes_externas_scryfall.md](integracoes_externas_scryfall.md)                                   | Contrato com a Scryfall: endpoints usados, rate limit, cache, parser de decklist, fallbacks.                             | Estável |
| `DOC-036` | [catalogo_de_acoes_da_mesa.md](catalogo_de_acoes_da_mesa.md)                                           | **131 ações** que o jogador pode executar na mesa, com a intenção correspondente e o modelo de visibilidade conquistada. | Estável |
| `DOC-037` | [catalogo_de_formatos_e_variantes.md](catalogo_de_formatos_e_variantes.md)                             | **45 formatos e variantes** expressos como presets declarativos: jogadores, vida, times, validação, zonas.               | Estável |

### Trilha 5 — Frontend e experiência _(como aparece na tela)_

| ID        | Documento                                                                                | Conteúdo em uma linha                                                                     | Status  |
| --------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------- |
| `DOC-040` | [especificacao_tecnica_do_frontend_ui_ux.md](especificacao_tecnica_do_frontend_ui_ux.md) | Render híbrido DOM+Canvas, camadas, stores Zustand, orçamento de performance, assets.     | Estável |
| `DOC-041` | [guia_de_ui_e_design_system.md](guia_de_ui_e_design_system.md)                           | Princípios, tokens de cor/tipo/espaço, componentes, atalhos de teclado, responsivo, A11y. | Estável |

### Trilha 6 — Segurança, qualidade e operação _(como não cair)_

| ID        | Documento                                                                                    | Conteúdo em uma linha                                                                                | Status  |
| --------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------- |
| `DOC-050` | [seguranca_e_privacidade.md](seguranca_e_privacidade.md)                                     | Controles de infraestrutura, anti-cheat por design, dados pessoais, LGPD, conformidade WotC.         | Estável |
| `DOC-051` | [plano_de_seguranca_e_ameacas_threat_model.md](plano_de_seguranca_e_ameacas_threat_model.md) | Threat model STRIDE, vetores por superfície, mitigação e severidade.                                 | Estável |
| `DOC-052` | [plano_de_testes_e_qualidade.md](plano_de_testes_e_qualidade.md)                             | Pirâmide de testes, ferramentas, metas de cobertura, teste de carga WS, QA visual, gates de release. | Estável |
| `DOC-053` | [devops_e_infraestrutura.md](devops_e_infraestrutura.md)                                     | Ambientes, topologia de nuvem, CI/CD, escalonamento do Colyseus, observabilidade, custos, DR.        | Estável |
| `DOC-054` | [guia_de_configuracao_e_desenvolvimento.md](guia_de_configuracao_e_desenvolvimento.md)       | Setup local passo a passo, monorepo, variáveis de ambiente, scripts, troubleshooting.                | Estável |

### Trilha 7 — Administração e Monetização _(Backoffice)_

| ID        | Documento                                                                                    | Conteúdo em uma linha                                                                          | Status  |
| --------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------- |
| `DOC-060` | [especificacao_de_cosmeticos_e_monetizacao.md](especificacao_de_cosmeticos_e_monetizacao.md) | Regras de cosméticos (playmats, sleeves, bordas), catálogo fechado, sincronização com Patreon. | Estável |
| `DOC-061` | [especificacao_do_painel_admin.md](especificacao_do_painel_admin.md)                         | Backoffice: moderação, bloqueios, CRUD de cosméticos e ferramentas de sistema.                 | Estável |

---

## 3. Trilhas de leitura por papel

Leia **na ordem**. Cada trilha leva de zero a produtivo.

| Papel                              | Ordem de leitura                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Novo no time (qualquer função)** | `DOC-000` (este) → `DOC-001` → `DOC-003` → `DOC-021` → `DOC-054`                                  |
| **Dev Backend / Game Server**      | `DOC-054` → `DOC-020` → **`DOC-036`** → `DOC-032` → `DOC-033` → `DOC-031` → `DOC-050` → `DOC-023` |
| **Dev Frontend**                   | `DOC-054` → `DOC-040` → `DOC-041` → **`DOC-036`** → `DOC-031` → `DOC-035` → `DOC-012`             |
| **Dev API / Dados**                | `DOC-054` → `DOC-030` → `DOC-023` → `DOC-035` → `DOC-051`                                         |
| **DevOps / SRE**                   | `DOC-053` → `DOC-020` → `DOC-022` → `DOC-051` → `DOC-052`                                         |
| **QA**                             | `DOC-052` → `DOC-010` → `DOC-012` → `DOC-011` → `DOC-031`                                         |
| **Produto / PO**                   | `DOC-001` → `DOC-002` → `DOC-003` → **`DOC-037`** → `DOC-011` → `DOC-012`                         |
| **Segurança**                      | `DOC-051` → `DOC-050` → `DOC-032` → `DOC-030`                                                     |
| **Design**                         | `DOC-041` → `DOC-040` → `DOC-003` → `DOC-012`                                                     |

---

## 4. Rastreabilidade de identificadores

O projeto usa várias famílias de identificadores. Elas convivem — **não** são duplicatas.

| Prefixo      | Significado                                               | Documento dono              | Exemplo                                           |
| ------------ | --------------------------------------------------------- | --------------------------- | ------------------------------------------------- |
| `RF`         | Requisito funcional **de produto** (linguagem de negócio) | `DOC-002` PRD               | `RF08` — sincronizar posição com latência baixa   |
| `F`          | Funcionalidade entregável (unidade de escopo/backlog)     | `DOC-003` Funcionalidades   | `F08` — ações de carta (tap, marcador, face-down) |
| `FR` / `NFR` | Requisito **de engenharia**, mensurável e testável        | `DOC-010` SRS               | `FR-06` — network culling de zona oculta          |
| `RN`         | Regra de negócio invariável                               | `DOC-011` Regras de Negócio | `RN02` — privacidade por design                   |
| `CDU`        | Caso de uso (narrativa de interação)                      | `DOC-012` / `DOC-011`       | `CDU05` — comprar carta                           |
| `ADR`        | Registro de decisão arquitetural                          | `DOC-020` SAD               | `ADR-002` — Colyseus em vez de Socket.io          |

### Cadeia de rastreabilidade dos temas críticos

| Tema                                    | Negócio        | Escopo | Engenharia        | Regra          | Implementação                   |
| --------------------------------------- | -------------- | ------ | ----------------- | -------------- | ------------------------------- |
| Informação oculta / anti-cheat          | `RF09`         | `F06`  | `FR-06`           | `RN02`         | `DOC-032`, `DOC-050`, `DOC-051` |
| **Visibilidade conquistada por ação**   | `RF18`         | `F09`  | `FR-06`           | **`RN13`**     | `DOC-036`, `DOC-032` §4         |
| **Suporte multiformato**                | `RF06`         | `F05`  | `FR-15`           | `RN03`, `RN05` | `DOC-037`, `DOC-023`            |
| Sincronização em tempo real             | `RF08`         | `F07`  | `FR-07`, `NFR-02` | `RN01`         | `DOC-031`, `DOC-033`            |
| Aleatoriedade justa (dados, embaralhar) | `RF10`         | `F12`  | `FR-09`           | `RN06`         | `DOC-032` §RNG, `DOC-033`       |
| Importação de deck                      | `RF04`, `RF05` | `F02`  | `FR-03`, `FR-04`  | `RN05`         | `DOC-030`, `DOC-035`            |
| Voz integrada                           | `RF11`         | `F16`  | `FR-08`           | —              | `DOC-034`                       |
| Performance do tabuleiro                | `RNF01`        | `F07`  | `NFR-01`          | —              | `DOC-040`, `DOC-052`            |

---

## 5. Convenções do repositório

**Nomes de arquivo.** `snake_case`, ASCII puro, sem acentos, sem parênteses, sempre `.md`.
`Especificação Técnica (UI/UX).md` → `especificacao_tecnica_do_frontend_ui_ux.md`.

**Cabeçalho obrigatório.** Todo documento abre com título `#` e uma tabela de metadados
(ID, versão, status, última revisão, documentos relacionados).

**Status possíveis.** `Rascunho` · `Em revisão` · `Estável` · `Congelado` (histórico, não atualizar) · `Obsoleto`.

**Versionamento.** `MAJOR.MINOR`. `MINOR` para adição de conteúdo; `MAJOR` quando uma decisão
anterior é revertida — nesse caso, registre uma ADR nova em `DOC-020` em vez de apagar a antiga.

**Links.** Sempre relativos e sempre para o nome `snake_case` do arquivo.

**Idioma.** Português do Brasil na prosa; inglês nos identificadores técnicos
(`BATTLEFIELD`, `scryfallId`, `INTENT_MOVE_CARD`) para casar com o código.

**Sobreposição consciente.** `DOC-020`/`DOC-021`, `DOC-032`/`DOC-033` e `DOC-011`/`DOC-012`
tratam temas vizinhos de propósito: um é estrutural, o outro é operacional. A coluna
"fonte canônica" da seção 1 resolve qualquer conflito.

---

## 6. Glossário

| Termo                         | Definição                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Sandbox**                   | Modelo em que o software fornece as peças e a física, mas não julga a legalidade das jogadas.                                  |
| **Rules Engine**              | Motor de regras do MTG (pilha, camadas, prioridade). **Fora de escopo, permanentemente.**                                      |
| **Colyseus**                  | Framework Node.js de salas multiplayer com sincronização automática de estado por _delta_.                                     |
| **Schema**                    | Árvore de estado tipada do Colyseus; a única fonte de verdade da partida.                                                      |
| **Fossil Delta**              | Algoritmo de diff binário usado pelo Colyseus para enviar apenas o que mudou.                                                  |
| **Patch**                     | Pacote binário com a diferença de estado enviado do servidor para o cliente.                                                   |
| **Intent**                    | Mensagem do cliente pedindo uma mutação. O cliente nunca altera estado por conta própria.                                      |
| **Network culling / @filter** | Filtro que impede que campos sensíveis saiam do servidor para clientes não autorizados.                                        |
| **SFU**                       | _Selective Forwarding Unit_: servidor que recebe uma trilha de áudio e a redistribui.                                          |
| **VAD**                       | _Voice Activity Detection_: detecção de quem está falando.                                                                     |
| **CCU**                       | _Concurrent Users_: usuários simultâneos.                                                                                      |
| **Zona**                      | Região lógica onde uma carta existe: `BATTLEFIELD`, `HAND`, `LIBRARY`, `GRAVEYARD`, `EXILE`, `COMMAND`.                        |
| **Commander tax**             | Custo adicional cumulativo de +2 por vez que o comandante foi conjurado da zona de comando.                                    |
| **Printing**                  | Impressão específica de uma carta (edição + arte + idioma), identificada por `scryfall_id`.                                    |
| **Playmat**                   | Imagem de fundo da mesa; item cosmético.                                                                                       |
| **Preset de formato**         | Objeto declarativo que define jogadores, vida, times, validação e zonas de um formato. Formato é dado, não código (`DOC-037`). |
| **Visibilidade conquistada**  | O jogador só recebe informação oculta se executar a ação que a concede, e a ação fica registrada (`RN13`).                     |
| **`peekedBy` / `revealedTo`** | Concessões de visibilidade: a primeira é transitória (olhar), a segunda persistente (revelar).                                 |
| **Scry / Surveil**            | Olhar N cartas do topo e decidir quais vão ao fundo (scry) ou ao cemitério (surveil).                                          |

---

## 7. Backlog de documentação

Lacunas conhecidas, em ordem de prioridade:

1. **`especificacao_do_motor_de_draft.md`** — subsistema de draft (Booster, Cube, Winston, Grid...), previsto para V3 e o maior item aberto (`DOC-037` §6).
2. **`documento_de_espectadores_e_torneios.md`** — modo espectador e brackets (previsto para V2).
3. **`runbook_de_incidentes.md`** — procedimento de plantão: sala travada, SFU fora, fila de Scryfall.
4. **`politica_de_moderacao.md`** — fluxo de report/bloqueio de `RF03` ponta a ponta.
5. **`plano_de_internacionalizacao.md`** — i18n de UI e de nomes de carta (a Scryfall suporta `lang`).
6. **Diagramas renderizados** — hoje os diagramas são ASCII/Mermaid; avaliar exportar SVG versionado.

---

## 8. Aviso legal

> AetherTable is unofficial Fan Content permitted under the Wizards of the Coast Fan Content
> Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards
> of the Coast. ©Wizards of the Coast LLC.

O acesso a cartas, salas e mecânicas de mesa é **sempre gratuito** (`RN04`). A monetização
permitida está descrita em `DOC-001` §5 e restringe-se a cosméticos de plataforma e doação.
