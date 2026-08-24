# Documento de Visão do Projeto e Business Case

| Campo | Valor |
|---|---|
| **ID** | `DOC-001` |
| **Versão** | 1.1 |
| **Status** | Estável |
| **Última revisão** | 2026-08-20 |
| **Documentos relacionados** | [readme.md](readme.md) · [documento_de_requisitos_do_produto_prd.md](documento_de_requisitos_do_produto_prd.md) · [documento_de_funcionalidades.md](documento_de_funcionalidades.md) · [projeto_commander_online.md](projeto_commander_online.md) |

---

## 1. Problema

Jogadores de Magic: The Gathering — em especial do formato **Commander/EDH** — enfrentam barreiras
financeiras e logísticas altas para jogar com amigos à distância.

| Barreira | Detalhe | Custo real para o jogador |
|---|---|---|
| **Financeira** | Um deck competitivo de Commander em cartas físicas custa de R$ 500 a R$ 5.000+. No MTGO/Arena, a coleção digital é comprada separadamente e não é portável. | Alto e recorrente |
| **Logística** | Jogo presencial de 4 pessoas exige agenda comum, deslocamento e 2–4 h contínuas. | Alto |
| **Técnica** | Tabletop Simulator exige compra do software (~R$ 40), GPU dedicada e *setup* manual de mods. | Médio |
| **Física** | SpellTable exige possuir as cartas de papel + webcam + iluminação decente. | Alto |
| **Interface** | MTGO tem UI de duas décadas atrás e curva de aprendizado severa. | Alto (abandono) |

### 1.1 Concorrência — leitura honesta

| Plataforma | Modelo | Ponto forte | Onde falha para o nosso público |
|---|---|---|---|
| **MTGO** | Pago, coleção digital | Motor de regras completo, torneios oficiais | Coleção custa caro; UI datada; Commander secundário |
| **MTG Arena** | Free-to-play com grind | Produção visual excelente | **Não suporta Commander a 4 jogadores**; pool de cartas limitado |
| **SpellTable (WotC)** | Grátis | Oficial, integra com papel | Exige cartas físicas e webcam; sem estado sincronizado |
| **Tabletop Simulator** | Pago (software) | Físico realista, extensível | Compra obrigatória; hardware; setup por mod; performance instável |
| **Cockatrice / XMage** | Grátis, desktop | Motor de regras (XMage) | Instalação desktop, base de cartas manual, UX crua |
| **Untap.in / Forge** | Grátis / OSS | Web (Untap) | Untap tem manutenção irregular e UX limitada; Forge é desktop |

**Lacuna identificada:** não existe hoje uma plataforma **web, gratuita, sem instalação, com voz
integrada e estado sincronizado de verdade**, focada especificamente em Commander a 4 jogadores.
É exatamente esse espaço que o AetherTable ocupa.

---

## 2. Solução

O **AetherTable** é uma plataforma web *sandbox* gratuita, acessível direto pelo navegador.
O sistema **não atua como juiz de regras** (*rules engine*); ele fornece:

- Tabuleiro virtual com zonas de jogo, coordenadas livres e manipulação por *drag-and-drop*.
- **Servidor autoritativo de estado** com sincronização em tempo real via WebSocket (Colyseus).
- **Informação oculta garantida por servidor** — mão e grimório do oponente jamais trafegam na rede.
- Comunicação por **voz integrada** via WebRTC/SFU (LiveKit), sem Discord paralelo.
- Importação instantânea de decklist via **API pública da Scryfall**.

### 2.1 Proposta de valor em uma frase

> Abra o navegador, cole sua decklist, mande o link para três amigos e esteja jogando Commander
> com voz em menos de 60 segundos — de graça, em qualquer máquina.

### 2.2 O que o produto explicitamente **não** é

| Não é | Por quê |
|---|---|
| Um motor de regras de MTG | Ver `ADR-001` em [documento_de_arquitetura_de_software_sad.md](documento_de_arquitetura_de_software_sad.md). Codificar 25.000+ cartas é inviável. |
| Uma loja de cartas digitais | Proibido pela Fan Content Policy da WotC (`RN04`). |
| Uma plataforma de torneio ranqueado com premiação | Risco jurídico direto com a WotC. |
| Um cliente mobile nativo | O jogo é web; mobile atende Lobby/Deckbuilder, e a mesa exige *landscape*. |
| Um substituto do papel | É ferramenta de *playtest* e jogo casual remoto. |

---

## 3. Público-alvo

| Persona | Perfil | Dor principal | O que a plataforma entrega |
|---|---|---|---|
| **O Testador** ("vale a pena comprar?") | Joga presencial, quer validar deck antes de gastar | Não quer comprar R$ 800 em cartas para descobrir que o deck é ruim | *Playtest* solo e em grupo com o deck completo, sem custo |
| **O Grupo Remoto** | 4 amigos que jogavam junto e se mudaram | Perderam a mesa semanal | Sala privada por link + voz integrada |
| **O Sem Hardware** | Notebook de trabalho, sem GPU | TTS travando, MTGO não roda | Canvas leve, roda em navegador comum |
| **O Brewer** | Monta 10 decks por mês | Ciclo de iteração lento no papel | Importação por texto + troca instantânea de deck |
| **O Criador de Conteúdo** | Streamer/YouTuber de EDH | Setup de gravação complexo | Mesa limpa, capturável, com log legível |

**Mercado endereçável:** o Commander é o formato mais jogado de MTG desde 2021 (dado público da
própria WotC). A base global de jogadores de Magic é estimada em ~50 milhões; a comunidade EDH
ativa online (Moxfield, Archidekt, r/EDH) está na ordem de milhões de contas.

---

## 4. Visão de longo prazo

Tornar-se a plataforma **não-oficial padrão global** para *playtest* e jogos casuais remotos de
Commander, suportando milhares de partidas simultâneas, ligas da comunidade e integração profunda
com criadores de conteúdo.

### 4.1 Horizontes

| Horizonte | Prazo | Objetivo |
|---|---|---|
| **H1 — Funciona** | 0–6 meses | Uma partida de 4 jogadores acontece de ponta a ponta, com voz, sem travar. |
| **H2 — Escala** | 6–18 meses | Centenas de salas simultâneas, espectadores, lobby público, i18n. |
| **H3 — Ecossistema** | 18 meses+ | API pública de replay, integração com Moxfield/Archidekt, ligas comunitárias, *overlay* para streamers. |

---

## 5. Estudo de viabilidade

### 5.1 Técnica — **Viável**

A arquitetura é inteiramente resolvível com tecnologia web madura (Canvas/WebGL, WebSocket, WebRTC
SFU). A ausência de motor de regras **elimina a maior parte da complexidade algorítmica** do MTG
(pilha, camadas, prioridade, substituição de eventos).

Riscos técnicos reais, com mitigação:

| Risco | Severidade | Mitigação |
|---|---|---|
| Performance do Canvas com 300+ sprites | Alta | `NFR-01`; *culling* de fora de tela, texturas compartilhadas, `small` como padrão. Ver `DOC-040`. |
| Escalonamento horizontal do Colyseus | Alta | `@colyseus/redis-presence` + *driver* Redis + LB com afinidade. Ver `DOC-053`. |
| Custo de banda do SFU de voz | Média | SFU em vez de malha P2P (~30 kbps de upload por usuário). LiveKit Cloud no início. |
| Dependência da Scryfall | Média | Cache local + bulk data diário. Ver `DOC-035`. |
| Vazamento de informação oculta | **Crítica** | `@filter` no Schema do Colyseus; nunca esconder só no cliente. Ver `DOC-050`. |

### 5.2 Jurídica — **Viável com disciplina**

O projeto opera **estritamente** sob a *Fan Content Policy* da Wizards of the Coast:

- É **proibido** cobrar pelo acesso ao jogo base ou por qualquer carta.
- É **proibido** vender produtos/serviços competitivos ranqueados envolvendo IP da WotC.
- É **obrigatório** exibir o *disclaimer* de Fan Content em todas as páginas.
- Imagens de carta são servidas da CDN da Scryfall, não hospedadas por nós.
- Nome e marca do produto não podem sugerir endosso oficial.

> Ponto de atenção permanente: qualquer feature de monetização precisa passar por revisão contra
> essa política **antes** de entrar no backlog. Ver §6.

### 5.3 Financeira — **Baixo custo inicial, custo variável em rede**

Estimativa de infraestrutura mensal (ordem de grandeza, USD):

| Item | MVP (~50 CCU) | V1 (~500 CCU) | V2 (~5.000 CCU) |
|---|---|---|---|
| Frontend (Vercel) | 0–20 | 20 | 20–150 |
| API Core (Render/Railway) | 7–25 | 50 | 200 |
| Game Servers (VPS dedicada) | 12–24 | 80–150 | 500–900 |
| PostgreSQL gerenciado | 0–15 | 25 | 100 |
| Redis | 0 | 10 | 50 |
| LiveKit (voz) | 0–20 | 100–250 | 800–1.500 |
| Cloudflare | 0 | 0–20 | 20–200 |
| **Total aproximado** | **~US$ 20–100** | **~US$ 300–500** | **~US$ 1.700–3.000** |

**O custo dominante em escala é voz + WebSocket**, não computação. É esse número que a monetização
precisa cobrir.

---

## 6. Modelo de negócio (monetização legal)

Objetivo: **custear a infraestrutura sem ferir a política de IP**.

| Canal | Descrição | Conformidade |
|---|---|---|
| **Doação recorrente** | Patreon / Apoia.se / GitHub Sponsors | ✅ Doação, não venda de acesso |
| **Cosméticos de plataforma** | Playmats customizados (upload próprio), bordas de perfil, avatares, títulos no chat, temas de UI | ✅ Nada envolve IP da WotC |
| **Qualidade de áudio premium** | Salas de apoiador com *bitrate* de áudio maior | ✅ Serviço de infraestrutura, não conteúdo de jogo |
| **Créditos de apoiador** | Nome em página de agradecimento | ✅ |

### 6.1 Regras invioláveis de monetização

1. **Zero paywall de gameplay.** Todas as cartas, zonas, contadores, dados e salas são gratuitos (`RN04`).
2. **Nenhuma venda de "singles" virtuais, boosters ou loot boxes.** Nunca.
3. **Nenhuma vantagem competitiva paga.** Cosmético não pode alterar estado de jogo.
4. **Sem anúncios dentro da mesa.** No máximo, um rodapé discreto de patrocínio no Lobby.

---

## 7. Métricas de sucesso

| Métrica | Definição | Meta MVP | Meta V1 | Meta V2 |
|---|---|---|---|---|
| **Time-to-Table** | Do cadastro à primeira carta jogada | < 5 min | < 3 min | < 90 s |
| **Taxa de conclusão de partida** | Partidas que passam de 20 min sem abandono técnico | 60 % | 80 % | 90 % |
| **Partidas por semana** | Salas com ≥ 2 jogadores e ≥ 10 min | 50 | 1.000 | 20.000 |
| **CCU de pico** | Usuários simultâneos | 20 | 300 | 3.000 |
| **Retenção D7** | Voltam em 7 dias | 20 % | 30 % | 40 % |
| **Crash/desync por partida** | Incidentes que exigem recarregar | < 0,5 | < 0,2 | < 0,05 |
| **p95 de latência de mutação** | RTT de mover carta | < 200 ms | < 150 ms | < 100 ms |
| **Custo por partida** | Infra ÷ partidas | — | < US$ 0,05 | < US$ 0,02 |

---

## 8. Roadmap do produto

### MVP — meses 1–3 · *"Uma partida acontece"*

- Autenticação (e-mail + Google + Discord).
- Deckbuilder básico com importação por texto e integração Scryfall.
- Sala instanciada para 4 jogadores com link de convite.
- Movimentação de cartas no Canvas com sincronização por WebSocket.
- Zonas: Battlefield, Hand, Library, Graveyard, Command Zone.
- Contador de vida e log de texto.

**Critério de saída:** quatro pessoas em máquinas diferentes concluem uma partida de 40 minutos
sem recarregar a página.

### V1 — meses 4–6 · *"É bom de usar"*

- Chat de voz embutido (LiveKit) com VAD e mute local.
- Matriz de dano de comandante, veneno, energia, experiência, monarca, iniciativa.
- Geração de tokens (oficiais e em branco), cópias, face-down.
- Dados (D6/D20) e moeda com RNG de servidor.
- Reconexão com janela de tolerância e congelamento de estado.
- Atalhos de teclado e seleção múltipla.

**Critério de saída:** `NFR-01` (60 FPS com 300 cartas) e `NFR-02` (RTT < 150 ms) atingidos em teste
de carga.

### V2 — meses 7–12 · *"Escala e comunidade"*

- Modo espectador.
- Lobby público com *matchmaking* casual.
- Brackets de torneio comunitário (sem premiação).
- Otimização de banda e *culling* agressivo.
- Internacionalização (pt-BR, en, es) incluindo nomes de carta via `lang` da Scryfall.
- Cosméticos de apoiador.

### Pós-V2 — candidatos

Replay de partida, *overlay* para streamers, importação direta de Moxfield/Archidekt por URL,
histórico de partidas, estatísticas de deck, salas de 5–6 jogadores.

---

## 9. Premissas e restrições

**Premissas.**

1. A Scryfall permanece pública, gratuita e estável.
2. A Fan Content Policy da WotC não muda de forma a proibir *sandboxes* web.
3. Os jogadores aceitam aplicar as regras manualmente — é o mesmo contrato social da mesa física.
4. O público-alvo tem banda suficiente para WebSocket + áudio (~100 kbps agregados).

**Restrições.**

1. Limite de jogadores por sala definido pelo formato, de 1 a 8 (`RN03`). Commander usa 4 por padrão.
2. Sem *rules engine*, em qualquer versão.
3. Sem monetização de gameplay, em qualquer versão.
4. A mesa exige tela em *landscape* (tablet ou desktop).

---

## 10. Riscos de produto

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Notificação de cessar e desistir da WotC | Baixa | **Fatal** | Conformidade estrita; sem monetização de IP; disclaimer visível; canal de contato aberto |
| Massa crítica insuficiente (sala vazia) | Média | Alto | Foco inicial em **grupos fechados** (link privado), não em matchmaking público |
| Frustração por falta de motor de regras | Média | Médio | Comunicar o modelo *sandbox* de forma explícita no *onboarding*; log de ações claro |
| Custo de voz explodir | Média | Alto | Limites por sala; degradar *bitrate* antes de negar serviço; SFU próprio se justificar |
| Toxicidade em salas públicas | Média | Médio | `RF03` (bloqueio/report) antes de abrir lobby público |
| Abandono do mantenedor | Média | Alto | Documentação viva (este repositório) + código aberto |
