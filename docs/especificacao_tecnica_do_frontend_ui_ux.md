# Especificação Técnica do Frontend

| Campo                       | Valor                                                                                                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                      | `DOC-040`                                                                                                                                                                                                                                     |
| **Versão**                  | 1.1                                                                                                                                                                                                                                           |
| **Status**                  | Estável                                                                                                                                                                                                                                       |
| **Última revisão**          | 2026-08-20                                                                                                                                                                                                                                    |
| **Documentos relacionados** | [readme.md](readme.md) · [guia_de_ui_e_design_system.md](guia_de_ui_e_design_system.md) · [especificacao_websocket_e_eventos.md](especificacao_websocket_e_eventos.md) · [integracoes_externas_scryfall.md](integracoes_externas_scryfall.md) |

---

## 1. Estratégia de renderização híbrida

O projeto usa Next.js para separar as preocupações de renderização por rota.

| Rota                    | Estratégia          | Motivo                                                                  |
| ----------------------- | ------------------- | ----------------------------------------------------------------------- |
| `/` (landing)           | **SSG**             | SEO e primeiro carregamento rápido                                      |
| `/login`, `/register`   | SSR                 | Formulários acessíveis, sem JS pesado                                   |
| `/dashboard`            | SSR + hidratação    | Dados por usuário                                                       |
| `/decks`, `/decks/[id]` | SSR + `react-query` | HTML/Tailwind normal maximiza acessibilidade e velocidade de construção |
| **`/room/[id]`**        | **100 % CSR**       | Canvas e WebSocket não fazem sentido no servidor                        |

Renderizar a mesa no servidor não traria benefício algum: não há SEO em uma partida privada, e o
primeiro quadro útil depende do estado que só chega pelo WebSocket.

---

## 2. As três camadas da tela de jogo

```
┌───────────────────────────────────────────────────────────────┐
│ CAMADA 2 — OVERLAY UI (DOM, fundo transparente)               │
│                                                               │
│  ┌─ painéis de vida (4) ─┐            ┌─ chat / log ────────┐ │
│  │ 40 ♥  ☠0  ⚡0          │            │ Jogador A comprou…  │ │
│  └───────────────────────┘            │ Jogador B rolou D20 │ │
│  ┌─ barra de ações ──────────────┐    └─────────────────────┘ │
│  │ 🎲  🃏  🔀  🔊  ⚙            │                             │
│  └───────────────────────────────┘                            │
│  pointer-events: none no contêiner; auto nos elementos        │
├───────────────────────────────────────────────────────────────┤
│ CAMADA 1 — O JOGO (<canvas>, React Konva)                     │
│                                                               │
│   [carta] [carta] [carta]        ← sprites, GPU               │
│   [carta] [token]                ← pan, zoom, drag, hit test  │
├───────────────────────────────────────────────────────────────┤
│ CAMADA 0 — FUNDO (DOM)                                        │
│   playmat, textura, vinheta                                   │
└───────────────────────────────────────────────────────────────┘
```

### 2.1 Por que essa divisão

| Conteúdo                           | Melhor em  | Por quê                                                                      |
| ---------------------------------- | ---------- | ---------------------------------------------------------------------------- |
| Texto, formulário, menu, chat      | **DOM**    | Acessibilidade, leitor de tela, seleção de texto, IME, foco por teclado, CSS |
| Sprite em movimento, arraste, zoom | **Canvas** | GPU, custo previsível, sem _reflow_                                          |

Tentar fazer chat em Canvas custaria acessibilidade; tentar fazer 300 cartas arrastáveis em DOM
custaria a taxa de quadros. Cada um no que é bom.

**Detalhe de implementação que costuma passar batido:** o contênier da Camada 2 precisa de
`pointer-events: none`, com `pointer-events: auto` apenas nos elementos interativos. Sem isso, um
painel invisível bloqueia o clique no Canvas embaixo.

### 2.2 Estrutura de camadas dentro do Konva

O Konva permite múltiplos `<Layer>`, e cada um é um canvas separado. Redesenhar um layer não redesenha
os outros — o que é a principal alavanca de performance:

| Layer         | Conteúdo                                   | Frequência de redesenho    |
| ------------- | ------------------------------------------ | -------------------------- |
| `staticLayer` | Contornos de zona, rótulos, grade          | Raríssima (só em zoom/pan) |
| `cardsLayer`  | Todas as cartas em repouso                 | A cada _patch_ (20 Hz)     |
| `dragLayer`   | Apenas a(s) carta(s) sendo arrastada(s)    | A cada quadro (60 Hz)      |
| `fxLayer`     | Pings, animação de dado, brilho de seleção | Durante efeitos            |

Mover a carta arrastada para o `dragLayer` durante o arraste é o que permite 60 FPS: apenas um layer
com um objeto é repintado a cada quadro, em vez das 300 cartas.

---

## 3. Estado global (Zustand)

O frontend **não** confia no servidor para coisas visuais locais — o zoom escolhido pelo jogador não é
assunto de ninguém.

```ts
// store/uiStore.ts — puramente local, nunca trafega
interface UIState {
  zoomLevel: number; // 0.4 .. 2.5
  cameraPosition: { x: number; y: number };
  activeModals: { chat: boolean; dice: boolean; settings: boolean; tokens: boolean };
  selectedCardIds: string[]; // seleção por caixa de arraste
  hoveredCardId: string | null;
  inspectedCardId: string | null; // zoom em painel lateral
  keybindings: Record<string, string>;
  showZoneOutlines: boolean;
}

// store/gameStore.ts — espelho do estado do servidor
interface GameState {
  roomId: string;
  phase: 'WAITING' | 'PLAYING' | 'PAUSED' | 'CLOSING';
  mySessionId: string;
  players: Record<string, PlayerData>;
  cards: Record<string, CardData>; // alimentado pelos patches do Colyseus
  log: LogEntry[]; // últimas 200 entradas
  connectionState: 'connecting' | 'connected' | 'reconnecting' | 'lost';
}

// store/audioStore.ts — local
interface AudioState {
  micEnabled: boolean;
  voiceMode: 'VAD' | 'PTT';
  speakingIds: Set<string>;
  volumes: Record<string, number>; // userId -> 0..1
  mutedIds: Set<string>;
}

// store/cardDataStore.ts — cache de metadados hidratados da Scryfall
interface CardDataState {
  byScryfallId: Record<string, ScryfallCard>;
  hydrate: (ids: string[]) => Promise<void>;
}
```

### 3.1 Fronteira entre os stores

| Regra                                              | Motivo                                                 |
| -------------------------------------------------- | ------------------------------------------------------ |
| `uiStore` **nunca** vai para a rede                | Zoom e modais são preferência pessoal                  |
| `gameStore` **nunca** é mutado pela UI diretamente | A UI envia intenção; o _patch_ muta o espelho (`RN07`) |
| `audioStore` é local, com persistência opcional    | Volume de cada um é escolha individual                 |
| `cardDataStore` é cache derivado                   | Reconstruível a qualquer momento                       |

### 3.2 Conectando o Colyseus ao `gameStore`

```ts
// hooks/useRoomSync.ts
room.state.cards.onAdd((card, id) => {
  useGameStore.getState().upsertCard(id, snapshot(card));
  renderer.addSprite(id);
});

room.state.cards.onChange((card, id) => {
  useGameStore.getState().upsertCard(id, snapshot(card));
  renderer.updateSprite(id); // não passa por re-render do React
});

room.state.cards.onRemove((_card, id) => {
  useGameStore.getState().removeCard(id);
  renderer.removeSprite(id);
});
```

**Ponto crítico de performance:** atualizações de sprite **não** devem disparar re-render de árvore
React. O `renderer` fala diretamente com os nós do Konva; o `gameStore` serve a UI de overlay (painéis
de vida, contadores), que muda com frequência muito menor.

Colocar 300 cartas como componentes React reativos ao store derruba a taxa de quadros — esse é o erro
clássico de quem usa React Konva pela primeira vez.

### 3.3 Predição otimista

```
usuário arrasta
  ├─ renderer move o sprite IMEDIATAMENTE (dragLayer)
  ├─ envia INTENT_MOVE_CARD com throttle de 20/s
  └─ patch chega:
       ├─ diferença < 2 px  → ignora (mantém a predição)
       └─ diferença maior   → interpola até a posição do servidor em ~100 ms
```

O servidor é a verdade (`RN07`); a predição é conforto visual.

---

## 4. Gestão de assets (imagens)

A performance gráfica é destruída se tentarmos baixar 400 imagens de alta resolução da Scryfall ao
mesmo tempo.

### 4.1 Estratégia de qualidade

| Contexto                                | Qualidade                                          | Peso                                  | Quando é buscada         |
| --------------------------------------- | -------------------------------------------------- | ------------------------------------- | ------------------------ |
| Carta na `LIBRARY`                      | **nenhuma** — só o verso local (`/card-back.webp`) | ~15 KB, 1 requisição para toda a mesa | Nunca                    |
| Carta no `BATTLEFIELD` / `HAND` própria | `small` (146×204)                                  | ~15–25 KB                             | Ao entrar na zona        |
| `hover` longo / `Alt+clique`            | `normal` (488×680)                                 | ~80–120 KB                            | Sob demanda, uma por vez |
| Deckbuilder (detalhe)                   | `normal`                                           | ~100 KB                               | Ao abrir                 |
| Thumbnail de deck                       | `art_crop`                                         | ~30 KB                                | Ao listar                |

**Regra dura:** nunca pré-carregar as 100 imagens de um deck ao entrar na sala. Só o que está visível
em zona revelada é resolvido (`FR-23`).

### 4.2 Três camadas de cache

```
1. CDN da Scryfall (cards.scryfall.io)
   └─ imagens imutáveis por scryfall_id, Cache-Control longo
        │
2. Service Worker (CacheStorage)
   └─ estratégia cache-first, teto de 200 MB, evicção LRU
      pré-cache: verso, terras básicas, tokens comuns
        │
3. Memória (texturas do Konva)
   └─ uma HTMLImageElement decodificada por scryfallId,
      compartilhada entre todos os sprites que a usam
```

A camada 3 é a mais importante e a mais fácil de esquecer: um deck com 30 Mountains deve carregar
**uma** textura, não trinta (`FR-24`).

```ts
// canvas/textureCache.ts
const cache = new Map<string, HTMLImageElement>();

export function getTexture(scryfallId: string, url: string): HTMLImageElement {
  let img = cache.get(scryfallId);
  if (!img) {
    img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    cache.set(scryfallId, img);
  }
  return img;
}
```

### 4.3 Fallback de imagem quebrada

Se a imagem falhar (printing removida, rede), o sprite renderiza uma **moldura cinza com o nome da
carta em texto**. Nunca um retângulo vazio — o jogador precisa saber o que está ali.

### 4.4 Cartas de dupla face

`layout` ∈ {`transform`, `modal_dfc`, `split`, `adventure`} não têm `image_uris` na raiz. O renderer
**deve** cair para `card_faces[n].image_uris` e oferecer um botão de virar a face (`FR-14`).

---

## 5. Orçamento de performance

Alvo: **60 FPS**, mínimo aceitável **30 FPS**, com 300 sprites, no hardware de referência (Intel i5 de
8ª geração, gráficos integrados, 1920×1080) — `NFR-01`.

| Técnica                                        | Ganho                           | Prioridade        |
| ---------------------------------------------- | ------------------------------- | ----------------- |
| **Layers separados** (§2.2)                    | Alto — o maior ganho isolado    | **Obrigatório**   |
| **Carta arrastada no `dragLayer`**             | Alto                            | **Obrigatório**   |
| **Texturas compartilhadas** (§4.2)             | Alto — memória e decode         | **Obrigatório**   |
| **`listening: false`** em nós não interativos  | Médio — hit testing é caro      | **Obrigatório**   |
| **Culling de fora de tela**                    | Alto com zoom afastado          | Obrigatório na V1 |
| **`perfectDrawEnabled: false`** nos sprites    | Médio                           | Recomendado       |
| **Sem re-render React por sprite** (§3.2)      | Crítico                         | **Obrigatório**   |
| **Throttle de intenção de movimento (20/s)**   | Médio — banda                   | **Obrigatório**   |
| Cache de `Group` estático (`cache()` do Konva) | Médio                           | Recomendado       |
| Sombra só na carta arrastada                   | Médio — sombra é caro no Canvas | Recomendado       |

### 5.1 Instrumentação

```ts
// devtools/fpsMeter.ts — ativo em dev; amostragem em produção
let frames = 0,
  last = performance.now();
function tick() {
  frames++;
  const now = performance.now();
  if (now - last >= 1000) {
    telemetry.sample('fps', frames); // p50 e p05 por sessão
    frames = 0;
    last = now;
  }
  requestAnimationFrame(tick);
}
```

Métrica reportada: **p05 de FPS** por sessão, não a média. A média esconde exatamente os engasgos que
o jogador percebe.

### 5.2 Abstração de render (plano B do `ADR-003`)

Todo acesso ao Konva passa por `CanvasRenderer`:

```ts
interface CanvasRenderer {
  addSprite(id: string): void;
  updateSprite(id: string): void;
  removeSprite(id: string): void;
  setCamera(x: number, y: number, zoom: number): void;
  beginDrag(id: string): void; // move para o dragLayer
  endDrag(id: string): void;
  playEffect(effect: Effect): void;
}
```

Se `NFR-01` não for atingido, trocar a implementação por PixiJS não deve tocar nada da lógica de jogo.

---

## 6. Interação e entrada

| Entrada                              | Ação                         | Observação                               |
| ------------------------------------ | ---------------------------- | ---------------------------------------- |
| Arrastar com botão esquerdo em carta | Move a carta                 | Emite `GRAB` → `MOVE` → `RELEASE`        |
| Arrastar em área vazia               | Caixa de seleção             | Preenche `selectedCardIds`               |
| Arrastar com botão do meio / espaço  | _Pan_ da câmera              | —                                        |
| Roda do mouse                        | Zoom centrado no cursor      | Limites 0,4×–2,5×                        |
| Clique com botão direito em carta    | Menu de contexto             | Tap, marcadores, mover para zona, copiar |
| `hover` longo (400 ms)               | Zoom no painel lateral       | Carrega qualidade `normal`               |
| `Alt+clique`                         | Zoom fixado até novo clique  | —                                        |
| Duplo clique em carta                | Tap/untap                    | Atalho mais usado                        |
| `Shift+clique`                       | Adiciona à seleção           | —                                        |
| `Esc`                                | Limpa seleção e fecha modais | —                                        |

Atalhos de teclado completos e remapeáveis em [guia_de_ui_e_design_system.md](guia_de_ui_e_design_system.md) §6.

---

## 7. Responsividade

| Dispositivo              | Comportamento                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| **Desktop ≥ 1280 px**    | Experiência completa: mesa + painéis laterais fixos                                       |
| **Desktop 1024–1280 px** | Painéis colapsáveis, sobrepostos ao Canvas                                                |
| **Tablet landscape**     | Suportado; alvos de toque ampliados; menu de contexto por toque longo                     |
| **Tablet portrait**      | Aviso para girar o dispositivo                                                            |
| **Smartphone**           | Lobby e Deckbuilder **100 % funcionais**; mesa exibe aviso de que requer landscape/tablet |

Motivo: a mesa de Commander tem 4 áreas de jogo simultâneas. Abaixo de ~900 px de largura útil, o
tamanho da carta cai a ponto de a arte deixar de ser reconhecível — e o produto perde o sentido.

---

## 8. Estrutura de pastas

```
apps/frontend/src/
├── app/
│   ├── page.tsx                  landing (SSG)
│   ├── login/ · register/
│   ├── dashboard/
│   ├── decks/ · decks/[id]/
│   └── room/[id]/page.tsx        mesa (CSR)
├── canvas/
│   ├── CanvasRenderer.ts         abstração (§5.2)
│   ├── konva/                    implementação Konva
│   ├── layers/                   static · cards · drag · fx
│   ├── sprites/                  CardSprite · TokenSprite · DiceSprite
│   ├── camera.ts                 pan · zoom · culling
│   └── textureCache.ts
├── overlay/
│   ├── LifePanel.tsx · ChatLog.tsx · ActionBar.tsx
│   ├── ContextMenu.tsx · CardInspector.tsx
│   └── TokenPicker.tsx · DiceRoller.tsx
├── store/                        uiStore · gameStore · audioStore · cardDataStore
├── net/
│   ├── colyseus.ts               conexão e reconexão
│   ├── intents.ts                emissores tipados (shared-types)
│   └── useRoomSync.ts
├── voice/                        connect.ts · useVoice.ts
├── deckbuilder/                  Importer · CardSearch · DeckList · PrintingPicker
├── api/                          cliente REST + react-query
└── lib/                          hooks, utilitários, formatação
```

> Este bloco é o desenho original e **diverge do que existe**: não há `login/` (a tela de entrada é a
> própria `app/page.tsx`), a mesa está em `play/[roomId]/` e o cliente REST está em `lib/fetcher.ts`,
> não em `api/`. Trate-o como intenção, e o repositório como fonte.

### 8.1 As telas de acesso

Quatro rotas fora da casca autenticada. Todas usam o mesmo painel de vidro sobre `min-h-dvh` — `dvh` e
não `vh` porque `100vh` no celular é a altura da janela **sem** a barra do navegador, e o botão de
entrar termina embaixo dela.

| Rota               | Arquivo                        | O que faz                                                   |
| ------------------ | ------------------------------ | ----------------------------------------------------------- |
| `/`                | `app/page.tsx`                 | Entrada: e-mail e senha, botões de provedor, erros de OAuth |
| `/register`        | `app/register/page.tsx`        | Cadastro                                                    |
| `/senha/esqueci`   | `app/senha/esqueci/page.tsx`   | Pede o link de redefinição                                  |
| `/senha/redefinir` | `app/senha/redefinir/page.tsx` | Escolhe a senha nova, com o token do e-mail                 |

`app/senha/Moldura.tsx` é a casca compartilhada pelas duas telas de senha. Ela **não** foi aplicada
retroativamente a `/` e `/register`: aquelas duas carregam a `CenaDoDragao` com o estado de sopro
ligado ao envio do formulário, e migrá-las junto misturaria a recuperação de senha com uma mudança na
porta de entrada do produto. Fica como o próximo passo de quem mexer nelas.

**Três decisões que se repetem nessas telas, e o porquê:**

1. **Nada de `useSearchParams()`.** O token de redefinição e o `?erro=` do OAuth são lidos de
   `window.location` dentro de um efeito. O hook obriga a rota a renderizar no cliente e já quebrou o
   `next build` deste projeto com _"useSearchParams() should be wrapped in a suspense boundary"_ — foi
   o motivo de `OAuthTokenCapture` existir como componente separado. As duas telas novas são estáticas
   (`○` no relatório do `next build`) por causa disso.
2. **O que veio na URL sai da URL.** Token e código de erro são apagados com `replaceState` assim que
   lidos — um token de redefinição na querystring entra no histórico e no `Referer`, e um erro já
   lido não deve ressuscitar quando a pessoa recarrega.
3. **O botão do provedor só aparece se funcionar.** `GET /auth/provedores` diz quais existem no
   servidor. Antes, os dois botões eram desenhados sempre e o aviso de "DUMMY KEYS" era condicionado a
   `NODE_ENV` — ou seja, sumia em produção, que é justo onde as chaves não estavam configuradas e o
   clique levava a uma página de erro do Google.

O dicionário de mensagens de erro de OAuth vive no **frontend** (`MENSAGEM_DE_OAUTH` em
`app/page.tsx`), não na URL: desenhar texto arbitrário vindo da querystring transformaria a tela de
entrada numa página de phishing hospedada no domínio certo.

---

## 9. Acessibilidade no frontend

| Item                            | Implementação                                               |
| ------------------------------- | ----------------------------------------------------------- |
| UI de DOM navegável por teclado | Ordem de foco lógica, `focus-visible` em tudo               |
| Contraste                       | AA no texto de UI (`NFR-13`)                                |
| Leitor de tela na mesa          | Região `aria-live="polite"` espelha o log de ações em texto |
| Nome da carta                   | `hover` longo expõe o nome também como texto no DOM         |
| Alternativa ao arraste fino     | Selecionar com teclado e mover por setas (`F25` + atalhos)  |
| Movimento reduzido              | `prefers-reduced-motion` desliga animações não essenciais   |
| Atalhos remapeáveis             | Todos, via `uiStore` e `UserPreference`                     |

O Canvas é, por natureza, opaco para leitores de tela. A mitigação é o espelho textual em
`aria-live` — não resolve tudo, mas torna o log e as mudanças de estado audíveis.

---

## 10. Checklist de implementação

- [ ] Camadas 0/1/2 com `pointer-events` corretos (§2.1).
- [ ] Layers do Konva separados: static, cards, drag, fx (§2.2).
- [ ] Carta arrastada movida para o `dragLayer`.
- [ ] `listening: false` em nós não interativos.
- [ ] `CanvasRenderer` como única porta de acesso ao motor gráfico (§5.2).
- [ ] Sprites **não** re-renderizam via React (§3.2).
- [ ] Texturas compartilhadas por `scryfallId` (`FR-24`).
- [ ] Nenhuma imagem requisitada para `LIBRARY` (`FR-23`).
- [ ] Suporte a `card_faces` para MDFC (`FR-14`).
- [ ] Fallback visual de imagem quebrada (§4.3).
- [ ] Service Worker com teto de 200 MB e LRU.
- [ ] Throttle de 20/s no `INTENT_MOVE_CARD`.
- [ ] Predição otimista com reconciliação (§3.3).
- [ ] Interpolação de movimento alheio (`FR-25`).
- [ ] Culling de fora de tela.
- [ ] Medidor de FPS reportando p05.
- [ ] `aria-live` espelhando o log.
- [ ] Aviso de landscape em telas estreitas.
