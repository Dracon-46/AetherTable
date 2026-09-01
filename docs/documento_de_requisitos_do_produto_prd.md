# Product Requirements Document (PRD)

| Campo                       | Valor                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                      | `DOC-002`                                                                                                                                                                                                                                                     |
| **Versão**                  | 1.1                                                                                                                                                                                                                                                           |
| **Status**                  | Estável                                                                                                                                                                                                                                                       |
| **Última revisão**          | 2026-08-20                                                                                                                                                                                                                                                    |
| **Documentos relacionados** | [readme.md](readme.md) · [documento_de_visao_do_projeto.md](documento_de_visao_do_projeto.md) · [documento_de_funcionalidades.md](documento_de_funcionalidades.md) · [especificacao_de_requisitos_de_software.md](especificacao_de_requisitos_de_software.md) |

---

## 1. Contexto e objetivo deste documento

Este PRD define **o que** o AetherTable deve fazer, em linguagem de produto. Ele é a ponte
entre a visão (`DOC-001`) e a especificação de engenharia (`DOC-010`).

- **Requisitos `RF`** desta página são de produto e ficam nesta casa.
- Sua tradução técnica e mensurável vive como `FR-nn` em [especificacao_de_requisitos_de_software.md](especificacao_de_requisitos_de_software.md).
- Sua quebra em entregáveis de backlog vive como `Fnn` em [documento_de_funcionalidades.md](documento_de_funcionalidades.md).

**Premissa que atravessa todo o documento:** o sistema é _sandbox_. Nenhum requisito aqui implica
validar a legalidade de uma jogada de Magic.

### 1.1 Legenda de prioridade

| Marca          | Significado                                 |
| -------------- | ------------------------------------------- |
| **M** (Must)   | Sem isso não há produto. Bloqueia release.  |
| **S** (Should) | Importante; sai na V1 se não couber no MVP. |
| **C** (Could)  | Desejável; entra se houver folga.           |
| **W** (Won't)  | Explicitamente fora do escopo desta versão. |

---

## 2. Épicos e requisitos funcionais

### Épico 1 — Gestão de identidade e social

| ID       | Requisito                                                                                                              | Prio  | Fase | Critério de aceite                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | ----- | ---- | --------------------------------------------------------------------------------------------- |
| **RF01** | O usuário deve poder se cadastrar e autenticar via E-mail/senha, Google e Discord.                                     | **M** | MVP  | Os três provedores concluem login e criam o perfil; sessão persiste por 7 dias.               |
| **RF02** | O sistema deve manter um perfil público com avatar, nome de exibição e estatísticas (salas criadas, partidas jogadas). | **S** | MVP  | Perfil acessível por URL; estatísticas atualizadas ao fim de cada partida.                    |
| **RF03** | O usuário deve poder bloquear e reportar jogadores.                                                                    | **S** | V1   | Bloqueado não consegue entrar em sala criada pelo bloqueador; report gera registro auditável. |
| **RF12** | O usuário deve poder editar preferências persistentes (atalhos de teclado, volume por jogador, tema, playmat).         | **C** | V1   | Preferências sobrevivem a logout/login e a troca de dispositivo.                              |
| **RF13** | O usuário deve poder excluir a conta e todos os dados associados.                                                      | **M** | V1   | Exclusão remove usuário, decks e preferências em até 30 dias; exigido por LGPD.               |

### Épico 2 — Gestão de decks (Deckbuilder)

| ID       | Requisito                                                                                               | Prio  | Fase | Critério de aceite                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------- | ----- | ---- | ------------------------------------------------------------------------------------ |
| **RF04** | O usuário deve poder colar uma decklist em texto plano para importar cartas.                            | **M** | MVP  | Formatos Moxfield, Archidekt e TappedOut importam sem edição manual.                 |
| **RF05** | O sistema deve consultar a Scryfall e converter a lista em objetos com URL de imagem, legalidade e IDs. | **M** | MVP  | Deck de 100 cartas resolve em < 3 s; linhas não encontradas são listadas ao usuário. |
| **RF06** | O sistema deve alertar — mas permitir salvar — decks com cartas banidas ou fora de 100 cartas.          | **M** | MVP  | Aviso visual não bloqueante; deck salva e é jogável.                                 |
| **RF14** | O usuário deve poder escolher a impressão (edição, arte, idioma) de cada carta.                         | **S** | V1   | Seletor lista todas as impressões; escolha persiste no deck.                         |
| **RF15** | O usuário deve poder criar, editar, duplicar, excluir e favoritar decks.                                | **M** | MVP  | CRUD completo; duplicar cria cópia independente.                                     |
| **RF16** | O usuário deve poder buscar cartas com filtros (nome, cor, tipo, custo, texto).                         | **S** | MVP  | Busca retorna em < 800 ms com paginação.                                             |

### Épico 3 — O tabuleiro (Game Board)

| ID       | Requisito                                                                                                                                                | Prio  | Fase   | Critério de aceite                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ | ------------------------------------------------------------------------------ |
| **RF07** | O sistema deve instanciar uma sala persistente em memória para até 4 jogadores.                                                                          | **M** | MVP    | Sala aceita 4 conexões; 5ª recebe erro claro de sala cheia.                    |
| **RF08** | O sistema deve sincronizar posição (X, Y, Z) e estado (virada, marcadores) de cada carta com latência baixa.                                             | **M** | MVP    | p95 do RTT de mutação < 150 ms em banda larga (ver `NFR-02`).                  |
| **RF09** | Zonas privadas (Library e Hand) **não** devem transmitir identidade de carta aos oponentes.                                                              | **M** | MVP    | Inspeção do tráfego WebSocket de um oponente não revela nome nem `scryfallId`. |
| **RF17** | O jogador deve poder executar as ações de carta essenciais: mover, virar/desvirar, adicionar/remover marcadores, virar face para baixo, agrupar seleção. | **M** | MVP/V1 | Cada ação reflete em todos os clientes em < 150 ms.                            |
| **RF18** | O jogador deve poder operar o grimório: comprar 1, comprar X, embaralhar, olhar o topo, mover para o fundo, _mill_.                                      | **M** | MVP    | Embaralhar e comprar são resolvidos no servidor; log registra a ação.          |
| **RF19** | O sistema deve oferecer painel de status com vida, dano de comandante por oponente, veneno, energia, experiência, monarca e iniciativa.                  | **M** | V1     | Todos os contadores sincronizam e ficam visíveis a todos.                      |
| **RF20** | O jogador deve poder criar tokens (oficiais via Scryfall ou em branco) e cópias de cartas.                                                               | **S** | V1     | Token criado aparece como objeto independente no Battlefield.                  |
| **RF21** | O sistema deve suportar reconexão sem perda de estado dentro de uma janela de tolerância.                                                                | **M** | V1     | Queda de rede de até 90 s permite retomar a partida no mesmo ponto.            |

### Épico 4 — Comunicação

| ID       | Requisito                                                                              | Prio  | Fase | Critério de aceite                                                                     |
| -------- | -------------------------------------------------------------------------------------- | ----- | ---- | -------------------------------------------------------------------------------------- |
| **RF10** | Chat de texto na sala mesclando mensagens de usuários e logs de sistema.               | **M** | MVP  | Ações relevantes geram log automático neutro; chat aceita mensagem livre sanitizada.   |
| **RF11** | Chat de voz com supressão de ruído e modo _Voice Activity_ ou _Push-to-Talk_.          | **M** | V1   | 4 participantes com áudio inteligível; indicador de "falando"; mute local por jogador. |
| **RF22** | O sistema deve oferecer _ping_ visual na mesa para chamar atenção a um ponto ou carta. | **C** | V1   | Ping aparece para todos com decaimento em ~2 s.                                        |
| **RF23** | Rolagem de dados e moeda com resultado calculado no servidor e publicado no log.       | **M** | V1   | Resultado idêntico para todos; impossível recalcular no cliente.                       |

### Épico 5 — Lobby e ciclo de partida

| ID       | Requisito                                                                  | Prio  | Fase | Critério de aceite                                                |
| -------- | -------------------------------------------------------------------------- | ----- | ---- | ----------------------------------------------------------------- |
| **RF24** | O host deve poder criar sala privada com senha opcional e link de convite. | **M** | MVP  | Link entra direto na sala; senha, quando definida, é exigida.     |
| **RF25** | O convidado deve poder escolher o deck ao ingressar.                       | **M** | MVP  | Seleção de deck ocorre antes da injeção das cartas na mesa.       |
| **RF26** | O sistema deve oferecer lobby público com salas abertas.                   | **C** | V2   | Lista paginada com filtro por vagas.                              |
| **RF27** | O sistema deve suportar espectadores com visão pública apenas.             | **C** | V2   | Espectador vê Battlefield/Graveyard/Exile e nunca mão de ninguém. |

### Fora de escopo (Won't)

| ID        | Item                                           | Motivo                                    |
| --------- | ---------------------------------------------- | ----------------------------------------- |
| **RFW01** | Motor de regras (pilha, camadas, prioridade)   | `ADR-001` — inviável e desnecessário      |
| **RFW02** | Comércio de cartas ou moeda virtual            | Fan Content Policy (`RN04`)               |
| **RFW03** | Vídeo (webcam) na mesa                         | Custo de banda; voz resolve o caso de uso |
| **RFW04** | Apps nativos iOS/Android                       | Web responsivo atende                     |
| **RFW05** | Formatos competitivos ranqueados com premiação | Risco jurídico                            |
| **RFW06** | Salas de 5+ jogadores                          | Depois da V2, se houver demanda medida    |

---

## 3. Requisitos não funcionais (RNF)

| ID        | Categoria           | Requisito                                                                     | Meta mensurável                                                      |
| --------- | ------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **RNF01** | Performance gráfica | Render do tabuleiro fluido mesmo com mesa lotada                              | 60 FPS com 300 cartas ativas; mínimo aceitável 30 FPS (ver `NFR-01`) |
| **RNF02** | Escalabilidade      | Rede deve suportar adição horizontal de nós de WebSocket com _load balancing_ | Dobrar CCU dobrando instâncias, sem alteração de código              |
| **RNF03** | Observabilidade     | Backend exporta métricas de salas ativas, CCU e memória                       | Painel Grafana/Prometheus com alertas configurados                   |
| **RNF04** | Latência            | Mutação de estado percebida como instantânea                                  | p95 < 150 ms; p99 < 300 ms                                           |
| **RNF05** | Disponibilidade     | Plataforma disponível para jogo casual                                        | 99,5 % mensal para API; 99,0 % para game servers                     |
| **RNF06** | Segurança           | Informação oculta inviolável por inspeção de rede                             | Auditoria de pacote não revela zona oculta alheia                    |
| **RNF07** | Compatibilidade     | Funciona nos navegadores majoritários                                         | Chrome, Edge, Firefox e Safari — duas últimas versões                |
| **RNF08** | Acessibilidade      | Interface operável sem depender de arraste fino                               | Atalhos remapeáveis; contraste AA no texto de UI                     |
| **RNF09** | Privacidade         | Coleta mínima de dados pessoais                                               | Somente e-mail, nome de exibição e avatar                            |
| **RNF10** | Custo               | Infraestrutura sustentável por doação                                         | < US$ 0,05 de infra por partida na V1                                |
| **RNF11** | Manutenibilidade    | Tipos compartilhados entre front e back                                       | Pacote `shared-types` como única definição de contrato               |

---

## 4. Jornada do usuário (fluxo principal)

```
Landing ─► Login (OAuth) ─► Dashboard
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
             Meus Decks               Criar/Entrar em Sala
                    │                       │
            Importar decklist         Selecionar deck
                    │                       │
            Scryfall resolve          Conectar WS + LiveKit
                    │                       │
              Salvar deck             ►  MESA DE JOGO  ◄
                                            │
                        comprar · arrastar · virar · marcar
                        vida · dados · voz · log · ping
                                            │
                                     Encerrar partida
                                            │
                                    Estatísticas ─► Dashboard
```

Detalhamento passo a passo em [documentos_de_casos_de_uso.md](documentos_de_casos_de_uso.md).

---

## 5. Requisitos por fase (escopo de release)

| Fase    | Requisitos incluídos                                                                               | Objetivo declarado                                   |
| ------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **MVP** | RF01, RF02, RF04, RF05, RF06, RF07, RF08, RF09, RF10, RF15, RF16, RF17 (parcial), RF18, RF24, RF25 | Uma partida de 4 jogadores acontece do início ao fim |
| **V1**  | RF03, RF11, RF12, RF13, RF14, RF19, RF20, RF21, RF22, RF23, RF17 (completo)                        | Experiência com qualidade de produto                 |
| **V2**  | RF26, RF27 + i18n + cosméticos + brackets                                                          | Escala e comunidade                                  |

---

## 6. Métricas de produto e instrumentação

| Evento a instrumentar                                                               | Serve para medir                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------------------- |
| `signup_completed` (com provedor)                                                   | Conversão de landing e preferência de provedor    |
| `deck_import_attempted` / `deck_import_succeeded` (com nº de linhas não resolvidas) | Qualidade do parser                               |
| `room_created` / `room_joined`                                                      | Funil de entrada em partida                       |
| `first_card_played`                                                                 | **Time-to-Table** (métrica-chave de `DOC-001` §7) |
| `match_ended` (duração, nº de jogadores, motivo)                                    | Taxa de conclusão                                 |
| `reconnect_attempted` / `reconnect_succeeded`                                       | Estabilidade de rede                              |
| `voice_joined` / `voice_failed`                                                     | Confiabilidade do LiveKit                         |
| `fps_sample` (p50/p05 por sessão)                                                   | `RNF01` no mundo real                             |
| `mutation_rtt` (histograma)                                                         | `RNF04` no mundo real                             |

Toda instrumentação é **anônima e agregada**; nada de conteúdo de chat ou de deck é enviado para
telemetria. Ver [seguranca_e_privacidade.md](seguranca_e_privacidade.md).

---

## 7. Dependências externas

| Dependência                           | Criticidade | Se falhar                                                  |
| ------------------------------------- | ----------- | ---------------------------------------------------------- |
| **Scryfall API**                      | Alta        | Importação para; partidas em curso seguem. Ver `DOC-035`.  |
| **Provedores OAuth (Google/Discord)** | Média       | Login por e-mail/senha continua funcionando.               |
| **LiveKit (Cloud ou self-hosted)**    | Média       | Mesa funciona sem voz; UI avisa e sugere fallback externo. |
| **Cloudflare**                        | Média       | Perda de proteção DDoS e cache; serviço segue degradado.   |

---

## 8. Perguntas abertas

| #   | Pergunta                                                                                                         | Responsável | Prazo para decidir                           |
| --- | ---------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------- |
| 1   | Espectadores entram na V2 ou antecipam para V1 por demanda de streamers?                                         | Produto     | Antes do início da V1                        |
| 2   | Salas de 5–6 jogadores justificam o custo de UI?                                                                 | Produto     | Após medir demanda em V1                     |
| 3   | LiveKit Cloud ou SFU próprio a partir de qual CCU?                                                               | Infra       | Quando a fatura de voz passar de US$ 300/mês |
| 4   | Persistir estado da partida em Redis permite retomar sala após restart do servidor — vale a complexidade no MVP? | Engenharia  | Antes da Fase 2                              |
| 5   | Importação direta por URL do Moxfield/Archidekt depende de API pública deles?                                    | Engenharia  | V2                                           |
