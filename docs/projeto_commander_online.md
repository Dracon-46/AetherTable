# Documento Fundador: Arquitetura e Escopo — Plataforma Sandbox para MTG (Commander)

| Campo                       | Valor                                                                                                                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                      | `DOC-004`                                                                                                                                                                                                         |
| **Versão**                  | 1.1 (formatação e notas de rastreio)                                                                                                                                                                              |
| **Status**                  | **Congelado** — referência histórica                                                                                                                                                                              |
| **Última revisão**          | 2026-08-20                                                                                                                                                                                                        |
| **Documentos relacionados** | [readme.md](readme.md) · [documento_de_visao_do_projeto.md](documento_de_visao_do_projeto.md) · [documento_de_funcionalidades.md](documento_de_funcionalidades.md) · [stack_tecnologico.md](stack_tecnologico.md) |

> ⚠️ **Este é o documento fundador do projeto.** Ele registra a concepção original — escopo, stack
> recomendada e roadmap em 5 fases — e é mantido **congelado** como referência histórica.
>
> Para informação **atual e canônica**, use os documentos derivados:
>
> | Assunto deste documento       | Documento canônico hoje                                                                                |
> | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
> | Visão, público, justificativa | [documento_de_visao_do_projeto.md](documento_de_visao_do_projeto.md) (`DOC-001`)                       |
> | Escopo de funcionalidades     | [documento_de_funcionalidades.md](documento_de_funcionalidades.md) (`DOC-003`)                         |
> | Stack e justificativas        | [stack_tecnologico.md](stack_tecnologico.md) (`DOC-022`)                                               |
> | Arquitetura e ADRs            | [documento_de_arquitetura_de_software_sad.md](documento_de_arquitetura_de_software_sad.md) (`DOC-020`) |
> | Modelagem da carta            | [especificacao_do_motor_sandbox.md](especificacao_do_motor_sandbox.md) (`DOC-032`)                     |
> | Roadmap                       | [documento_de_visao_do_projeto.md](documento_de_visao_do_projeto.md) §8                                |
>
> **Se este documento divergir de um canônico, vale o canônico.**

---

## 1. Visão geral e justificativa

**Conceito.** Uma plataforma web multiplayer em tempo real que simula uma mesa virtual (_sandbox_)
para jogar Magic: The Gathering, com foco no formato Commander (EDH). O sistema **não aplica as regras
do jogo** (motor de regras); ele fornece os componentes — cartas, dados, marcadores — e os jogadores
operam a lógica, como na vida real.

**Público-alvo.** Jogadores de Commander que desejam testar decks (_playtest_) antes de comprar,
grupos de amigos remotos e jogadores buscando uma alternativa leve e gratuita ao MTGO ou ao Tabletop
Simulator.

**Diferencial.** Roda direto no navegador, não exige hardware potente, possui chat de voz integrado e
busca cartas diretamente da API do Scryfall.

---

## 2. Escopo completo de funcionalidades

### A. Construção e importação de decks (Deckbuilder)

| Item                | Descrição                                                  | Hoje é |
| ------------------- | ---------------------------------------------------------- | ------ |
| **Busca de cartas** | Integração com a API do Scryfall (nome, cor, tipo etc.)    | `F01`  |
| **Importação**      | Texto plano padrão (Moxfield, Archidekt, TappedOut)        | `F02`  |
| **Customização**    | Escolha de artes específicas (_printings_) e idiomas       | `F04`  |
| **Validação**       | Verificação da banlist do Commander e limite de 100 cartas | `F05`  |
| **Armazenamento**   | Salvar decks atrelados à conta do usuário                  | `F03`  |

### B. O tabuleiro virtual (Game Board)

**Zonas de jogo individuais** — hoje `F06`:

| Zona                   | Comportamento original previsto                                              |
| ---------------------- | ---------------------------------------------------------------------------- |
| **Battlefield (mesa)** | Movimentação livre (_drag-and-drop_) de cartas                               |
| **Hand (mão)**         | Área oculta para os oponentes                                                |
| **Library (grimório)** | "Comprar 1", "Comprar X", "Embaralhar", "Olhar o topo", "Mover para o fundo" |
| **Graveyard e Exile**  | Zonas públicas em formato de lista/grade expansível                          |
| **Command Zone**       | Área destacada com contador de taxa do comandante (_commander tax_)          |

**Interações com as cartas** — hoje `F08`, `F10`, `F24`, `F25`:

- **Virar/desvirar (tap/untap):** rotação de 90°, com atalho de teclado.
- **Marcadores:** adicionar e remover (+1/+1, -1/-1, _charge_ etc.).
- **Tokens e cópias:** criar fichas em branco ou puxar tokens oficiais da API.
- **Virar para baixo:** cartas de Morph/Disguise (_face-down_).
- **Agrupamento:** selecionar várias cartas para mover ou desvirar simultaneamente.

**Gestão de partida** — hoje `F11`, `F12`, `F13`:

- Contador de vida principal.
- Matriz de dano de comandante (rastreando os 3 oponentes).
- Marcadores de veneno, energia, experiência, monarca e iniciativa.
- Rolagem de dados (D6, D20) compartilhada, com histórico no chat.
- _Ping_ na mesa (clicar para destacar um ponto/carta para os outros verem).

### C. Sistema social e multiplayer

| Item                     | Descrição                                                                    | Hoje é       |
| ------------------------ | ---------------------------------------------------------------------------- | ------------ |
| **Lobby / matchmaking**  | Salas privadas com senha e link de convite rápido                            | `F14`, `F37` |
| **Sistema de log**       | Chat de texto informando ações automáticas ("Jogador A comprou 1 carta")     | `F15`        |
| **Chat de voz (WebRTC)** | Áudio com botão de mutar, volume individual e indicação de quem está falando | `F16`        |

---

## 3. Arquitetura e stack tecnológico recomendado

> Como é um sistema _sandbox_, o segredo do sucesso **não é a lógica de jogo, mas a sincronização de
> estado em tempo real.**

Essa frase é a tese central do projeto e continua válida. Ela é o que motiva `ADR-002` (Colyseus) e
`ADR-004` (informação oculta no servidor).

### Frontend — a interface e a mesa

| Camada                      | Escolha                          | Justificativa original                                                                                                                                                    |
| --------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework                   | **Next.js (React) + TypeScript** | Roteamento e SEO                                                                                                                                                          |
| Estilização                 | **Tailwind CSS**                 | Lobby, chat e Deckbuilder                                                                                                                                                 |
| **Motor da mesa (crucial)** | **React Konva (Canvas API)**     | Usar HTML/DOM (`div`) para centenas de cartas com _drag-and-drop_ e zoom travaria o navegador. O Canvas usa aceleração por GPU, garantindo 60 FPS mesmo com a mesa lotada |
| Estado local                | **Zustand**                      | Leve e rápido                                                                                                                                                             |

### Backend — multiplayer e servidor

| Camada           | Escolha                  | Justificativa original                                                                                                                                                          |
| ---------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Servidor de jogo | **Node.js + Colyseus**   | _"Fuja do Socket.io puro."_ O Colyseus foi feito para jogos baseados em salas e tem _State Synchronization_ automática — envia apenas o que mudou na mesa, poupando muita banda |
| Chat de voz      | **LiveKit (SFU WebRTC)** | P2P entre 4 pessoas consome muita internet dos usuários. O LiveKit centraliza o áudio, garantindo latência quase zero                                                           |

### Banco de dados e infraestrutura

| Camada                    | Escolha                            | Justificativa original                                   |
| ------------------------- | ---------------------------------- | -------------------------------------------------------- |
| Banco principal           | **PostgreSQL** (Prisma ou Drizzle) | Usuários, senhas e decks                                 |
| Cache / estado em memória | **Redis**                          | Opcional no início; vital para escalar o Colyseus depois |
| APIs externas             | **Scryfall API**                   | Imagens, textos e dados das cartas                       |

---

## 4. Plano de entregas (roadmap em fases)

O projeto deve ser construído de forma modular para evitar sobrecarga.

### Fase 1 — Fundação (Deckbuilder e autenticação)

**Entregável:** o usuário consegue logar e criar seu deck.

- Sistema de login (NextAuth ou Supabase).
- Integração com Scryfall (pesquisa de cartas e exibição da arte).
- Construção do Deckbuilder (adicionar/remover do deck).
- Persistência do deck no banco (PostgreSQL).

### Fase 2 — O motor multiplayer (sincronização básica)

**Entregável:** jogadores entram em uma sala vazia e veem os cursores/ações uns dos outros.

- Configuração do servidor Colyseus.
- Criação do _Room State_.
- Chat de texto básico para validar o WebSocket.
- Teste de latência com botões simples (ex.: alterar vida e todos verem).

### Fase 3 — A mesa (playtest single player)

**Entregável:** você consegue jogar com seu deck sozinho na mesa.

- Criação do Canvas com React Konva.
- Lógica de "comprar" (mover carta de `Library` para `Hand`).
- _Drag-and-drop_ (mover de `Hand` para `Battlefield`).
- Ação de tap/untap nas cartas da mesa.

### Fase 4 — O jogo completo (integração multiplayer)

**Entregável:** partidas EDH reais acontecendo.

- Conectar a Fase 3 com a Fase 2: ao mover a carta no Canvas, envia a coordenada ao Colyseus, que
  atualiza a tela dos oponentes.
- Zonas de jogo visíveis (tela dividida mostrando a mesa dos oponentes).
- Painel de status completo (vida, dano de comandante).
- Rolagem de dados e geração de tokens.

### Fase 5 — Polimento e voice chat

**Entregável:** experiência final com qualidade de produto.

- Integração do LiveKit para comunicação por voz.
- Atalhos de teclado avançados.
- Tratamento de desconexões: se o jogador cair, a mesa dele congela e espera ele voltar.
- Efeitos visuais (animações ao puxar cartas, sons de dados).

### 4.1 Correspondência com o roadmap atual

| Fase original         | Corresponde a                                       |
| --------------------- | --------------------------------------------------- |
| Fases 1–4             | **MVP** de `DOC-001` §8                             |
| Fase 5                | **V1** de `DOC-001` §8                              |
| _(não previsto aqui)_ | **V2**: espectadores, lobby público, i18n, brackets |

---

## 5. Dica de modelagem — a estrutura da carta

No servidor (backend/Colyseus), a carta **não** deve conter todas as informações do Magic. Deve ser
apenas um modelo leve:

```ts
// Exemplo de estado no Colyseus (concepção original)
class Card extends Schema {
  @type('string') id: string; // ID único na mesa
  @type('string') scryfallId: string; // Para o frontend buscar a imagem
  @type('number') x: number; // Coordenada no Canvas
  @type('number') y: number; // Coordenada no Canvas
  @type('boolean') isTapped: boolean; // Virada?
  @type('number') counters: number; // Quantidade de marcadores
  @type('string') ownerId: string; // De quem é a carta
}
```

> **O backend lida com coordenadas. O frontend lida com imagens e textos.**

Essa separação continua sendo o princípio central do modelo de dados: o banco guarda apenas
`scryfall_id` (`DOC-023` §1.2) e o estado da sala guarda apenas metadados espaciais (`DOC-032` §3).

### 5.1 O que o modelo atual acrescentou

A classe `Card` de hoje evoluiu em pontos que a concepção original não previa. As diferenças
importam — cada uma resolve um problema real descoberto depois:

| Adição                               | Por que foi necessária                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **`@filter` no `scryfallId`**        | **A adição mais importante.** Sem ela, a mão do oponente vai no pacote e é lida no DevTools (`ADR-004`, `RN02`) |
| `controllerId` separado de `ownerId` | Suporta efeitos de "roubo" de carta sem motor de regras (`RN08`)                                                |
| `zone` como enum                     | O modelo original inferia a zona pela posição; explicitar a zona é o que permite filtrar visibilidade           |
| `counters` como `map<string,int>`    | Um único inteiro não distingue `+1/+1` de _charge_ ou _loyalty_                                                 |
| `rotation` em vez de só `isTapped`   | Permite 180° (invertida) além dos 90°                                                                           |
| `faceDown`                           | Morph/Manifest — e a identidade precisa ser filtrada também aqui                                                |
| `zIndex`                             | Empilhamento visual no Battlefield                                                                              |
| `isToken` / `isCopy`                 | Fichas deixam de existir fora do campo                                                                          |
| `lockedBy`                           | Impede que dois jogadores arrastem a mesma carta (`FR-10`)                                                      |
| `zoneOrder` no `RoomState`           | Ordem de grimório/mão/cemitério sem reindexar N cartas por inserção                                             |

O `Schema` completo e atual está em
[especificacao_do_motor_sandbox.md](especificacao_do_motor_sandbox.md) §3.
