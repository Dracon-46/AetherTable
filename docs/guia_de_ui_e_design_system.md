# UI/UX e Design System

| Campo | Valor |
|---|---|
| **ID** | `DOC-041` |
| **Versão** | 1.1 |
| **Status** | Estável |
| **Última revisão** | 2026-08-20 |
| **Documentos relacionados** | [readme.md](readme.md) · [especificacao_tecnica_do_frontend_ui_ux.md](especificacao_tecnica_do_frontend_ui_ux.md) · [documentos_de_casos_de_uso.md](documentos_de_casos_de_uso.md) |

---

## 1. Princípios de design

### 1.1 Imersão neutra

A interface da mesa deve ser **escura, minimalista e sair do caminho**. As cores vibrantes vêm
exclusivamente das artes das cartas.

Consequência prática: nenhum elemento de UI usa cor saturada em repouso. Saturação é reservada para
**estado** (perigo, ação primária, jogador falando). Se a UI competir visualmente com a arte das
cartas, o jogador perde a leitura da mesa — que é a informação mais importante da tela.

### 1.2 Foco em espaço (Spatial UI)

Telas de notebook são pequenas e a mesa de Commander tem 4 áreas de jogo. Painéis (chat, vida, log)
devem ser **colapsáveis ou sobrepostos**, com opacidade controlada, para maximizar a área útil do
Canvas.

Meta: em 1366×768, o Canvas deve ocupar **no mínimo 75 %** da área da janela com todos os painéis
abertos.

### 1.3 Feedback tátil e visual

Toda ação precisa de resposta perceptível em **menos de 100 ms**, mesmo que a confirmação do servidor
demore mais:

| Ação | Feedback imediato |
|---|---|
| Pegar carta | Sombra projetada + leve escala (1,03×) |
| Arrastar | A carta acompanha o cursor sem atraso (predição otimista) |
| Virar (tap) | Rotação com *easing* de 150 ms |
| Marcador | *Badge* aparece com escala de 120 ms |
| Comprar carta | Carta desliza do grimório à mão em 200 ms |
| Botão | Mudança de estado em 80 ms |
| Ação rejeitada | Tremor horizontal de 200 ms + *toast* |

### 1.4 O log é a memória compartilhada

Como não há motor de regras, **o log de ações é o árbitro do grupo**. Quando alguém pergunta "espera,
você já comprou?", a resposta está no log. Portanto: o log precisa ser legível, filtrável e ter
histórico retido — não é decoração.

### 1.5 Honestidade de estado

O jogador precisa saber, a todo momento, se está conectado, se o microfone está aberto e se sua última
ação foi confirmada. Nada de estado ambíguo: reconexão mostra *overlay* explícito, microfone mostra
ícone permanente, ação rejeitada avisa.

---

## 2. Tokens de design

### 2.1 Cores

```js
// tailwind.config.ts (extrato)
colors: {
  table:   { DEFAULT: '#1A1C23', deep: '#12141A' },  // fundo da mesa
  panel:   { DEFAULT: '#252836', hover: '#2E3242', border: '#363B4D' },
  text:    { DEFAULT: '#E2E8F0', muted: '#94A3B8', faint: '#64748B' },
  primary: { DEFAULT: '#3B82F6', hover: '#2563EB', subtle: '#1E3A8A' },
  danger:  { DEFAULT: '#EF4444', hover: '#DC2626' },
  success: { DEFAULT: '#22C55E' },
  warning: { DEFAULT: '#F59E0B' },
  speaking:{ DEFAULT: '#FBBF24' },                   // aura de quem está falando
  mana:    { w: '#F8F6D8', u: '#C1D7E9', b: '#BAB1AB', r: '#E49977', g: '#A3C095' },
}
```

| Token | Valor | Uso |
|---|---|---|
| `table` | `#1A1C23` | Fundo da mesa — cinza chumbo profundo, reduz cansaço visual em sessões de 3 h |
| `table-deep` | `#12141A` | Fundo de páginas fora da mesa |
| `panel` | `#252836` | Painéis, com **80 % de opacidade + `backdrop-blur`** |
| `panel-border` | `#363B4D` | Bordas de 1 px — separam sem pesar |
| `text` | `#E2E8F0` | Texto base: alto contraste **sem** branco puro (que "vibra" em fundo escuro) |
| `text-muted` | `#94A3B8` | Texto secundário, timestamps do log |
| `primary` | `#3B82F6` | Ação primária |
| `danger` | `#EF4444` | Excluir deck, sair da partida, vida crítica |
| `success` | `#22C55E` | Confirmação, conexão saudável |
| `warning` | `#F59E0B` | Deck fora do padrão, reconectando |
| `speaking` | `#FBBF24` | Aura dourada de VAD (`DOC-034` §4.2) |
| `mana-*` | — | Identificação de cor/jogador na mesa |

**Nota sobre contraste:** `text` sobre `panel` dá razão ≈ 9:1 — bem acima do AA (4,5:1). `text-muted`
sobre `panel` dá ≈ 4,6:1, no limite do AA — por isso é usado apenas em texto secundário, nunca em
informação essencial.

### 2.2 Tipografia

| Papel | Fonte | Tamanho | Peso |
|---|---|---|---|
| Interface geral | Inter (ou a fonte do sistema) | 14 px | 400 |
| Rótulos e botões | Inter | 13 px | 500 |
| Títulos de painel | Inter | 15 px | 600 |
| **Números de vida** | Inter, tabular nums | **28 px** | 700 |
| Contadores pequenos | Inter, tabular nums | 12 px | 600 |
| Log de ações | Inter | 13 px | 400 |
| Nome de carta no Canvas | Inter | escala com o zoom | 500 |

`font-variant-numeric: tabular-nums` é obrigatório em todo número que muda (vida, contadores): sem
isso, o texto "salta" na horizontal a cada mudança de dígito.

### 2.3 Espaçamento e raio

| Token | Valor | Uso |
|---|---|---|
| Grade base | 4 px | Todo espaçamento é múltiplo de 4 |
| Padding de painel | 12 px | — |
| Espaço entre painéis | 8 px | — |
| Raio de painel | 8 px | — |
| Raio de botão | 6 px | — |
| Raio de carta (Canvas) | 3,5 % da largura | Proporcional à carta real |
| Alvo de toque mínimo | 44 × 44 px | Tablet |

### 2.4 Proporções da carta

| Item | Valor |
|---|---|
| Proporção | **63 × 88 mm → 0,716** (largura ÷ altura) |
| Tamanho base no Canvas (zoom 1×) | 100 × 140 px |
| Faixa de zoom | 0,4× a 2,5× |
| Rotação de "virada" | 90° |
| Rotação de "invertida" | 180° |

Respeitar a proporção real da carta importa: qualquer distorção é imediatamente percebida por quem
joga Magic há anos.

### 2.5 Elevação

| Nível | Sombra | Uso |
|---|---|---|
| 0 | nenhuma | Carta em repouso |
| 1 | `0 2px 4px rgb(0 0 0 / .3)` | Painel |
| 2 | `0 8px 16px rgb(0 0 0 / .4)` | **Carta sendo arrastada** |
| 3 | `0 16px 32px rgb(0 0 0 / .5)` | Modal, inspetor de carta |

Sombra no Canvas é caro. Aplicada **somente** à carta arrastada (uma por vez), nunca às 300 em repouso.

---

## 3. Layout da mesa

```
┌────────────────────────────────────────────────────────────────────┐
│  ┌──────────┐        Oponente 2 (topo)         ┌──────────┐        │
│  │ Oponente │   [battlefield do oponente 2]    │ Oponente │        │
│  │    1     │                                  │    3     │        │
│  │ (esq.)   │                                  │ (dir.)   │        │
│  │          │                                  │          │        │
│  │ 40 ♥     │      Á R E A   C E N T R A L     │ 40 ♥     │        │
│  │ ☠0 ⚡0    │        (mesa compartilhada)      │ ☠0 ⚡0    │        │
│  │          │                                  │          │        │
│  └──────────┘                                  └──────────┘        │
│                                                                    │
│  ┌───────────────── SEU BATTLEFIELD ──────────────────┐  ┌───────┐ │
│  │                                                    │  │ CHAT  │ │
│  │                                                    │  │   /   │ │
│  └────────────────────────────────────────────────────┘  │  LOG  │ │
│  ┌─ CMD ─┐  ┌────── SUA MÃO ──────┐  ┌ GRAV ┐ ┌ EXÍLIO ┐│       │ │
│  │       │  │  [][][][][][][]     │  │  12  │ │   3    ││       │ │
│  └───────┘  └─────────────────────┘  └──────┘ └────────┘└───────┘ │
│  ┌─ SEU PAINEL ─┐  ┌── BARRA DE AÇÕES ──┐  ┌─ GRIMÓRIO ─┐         │
│  │ 40 ♥ ☠0 ⚡0   │  │ 🎲 🃏 🔀 🔊 ⚙      │  │     87     │         │
│  └──────────────┘  └────────────────────┘  └────────────┘         │
└────────────────────────────────────────────────────────────────────┘
```

### 3.1 Regras de layout

| Regra | Motivo |
|---|---|
| O jogador local fica **sempre embaixo** | Referência espacial estável, como sentar à mesa |
| Oponentes distribuídos em esquerda / topo / direita | Espelha a mesa física de 4 lugares |
| A mão é a faixa inferior, sempre visível | É a zona mais consultada |
| Grimório à direita, próximo à barra de ações | "Comprar" é a ação mais frequente |
| Cemitério e exílio como contadores expansíveis | Consultados esporadicamente; não merecem área permanente |
| Chat/log na coluna direita, colapsável | Importante, mas não deve roubar a mesa |
| Battlefield do oponente é **somente leitura visual** | Você olha, não arrasta (salvo transferência de controle) |

---

## 4. Componentes

### 4.1 Painel de vida

```
┌────────────────────────────┐
│ 🟡 Arthur          ⋮       │   ← aura dourada = falando; ⋮ abre volume/mute
│                            │
│      ─   4 0   +           │   ← 28 px, tabular-nums
│                            │
│  ☠ 0   ⚡ 0   ✦ 0   👑     │   ← veneno · energia · experiência · monarca
│                            │
│  🗡 CMD: 0 / 0 / 0         │   ← dano de comandante por oponente
└────────────────────────────┘
```

| Estado | Aparência |
|---|---|
| Normal | Fundo `panel`, texto `text` |
| Vida ≤ 10 | Número em `warning` |
| Vida ≤ 0 | Número em `danger` + borda pulsante — **sem eliminar ninguém** (`RN01`) |
| Falando | Aura `speaking` de 2 px ao redor do painel |
| Microfone mudo | Ícone de microfone cortado no cabeçalho |
| Desconectado | Painel a 40 % de opacidade + "reconectando…" |

### 4.2 Log / chat

```
┌─ LOG ──────────────── [Tudo ▾] ─┐
│ 21:04  Arthur comprou 1 carta   │
│ 21:04  Arthur jogou Sol Ring    │
│ 21:05  Bia rolou D20 → 15       │
│ 21:05  Bia: quem começa?        │
│ 21:06  Caio: vida 40 → 37       │
│ ...                             │
├─────────────────────────────────┤
│ [ digite uma mensagem…       ⏎ ]│
└─────────────────────────────────┘
```

| Recurso | Detalhe |
|---|---|
| Filtro | Tudo · Só chat · Só ações · Só dados |
| Distinção visual | Log de sistema em `text-muted`; chat de usuário em `text` |
| Cor por jogador | Cada jogador tem uma cor de nome (derivada do `mana-*`) |
| Retenção | Últimas 200 entradas na memória |
| Rolagem | Fixa no fim; se o usuário rolar para cima, para de seguir e mostra "↓ novas mensagens" |
| Timestamps | `HH:MM`, em `text-muted` |
| Sanitização | `DOMPurify`; markdown **não** é renderizado como HTML |

### 4.3 Menu de contexto de carta

Abre com clique direito. Itens visíveis dependem da zona:

```
┌──────────────────────────┐
│ Virar / Desvirar      T  │
│ Virar 180°        Ctrl+T │
│ Face para baixo       F  │
│ ─────────────────────────│
│ + Marcador +1/+1      +  │
│ − Marcador            −  │
│ Marcador…             ▸  │
│ ─────────────────────────│
│ Criar cópia              │
│ ─────────────────────────│
│ Mover para            ▸  │  → Mão · Grimório (topo/fundo) · Cemitério · Exílio · Comando
│ Trazer para frente       │
│ ─────────────────────────│
│ Inspecionar        Alt+⌖ │
└──────────────────────────┘
```

### 4.4 Barra de ações

| Ícone | Ação | Atalho |
|---|---|---|
| 🎲 | Dados e moeda | `R` |
| 🃏 | Criar ficha | `K` |
| 🔀 | Embaralhar grimório | `S` |
| ⟳ | Desvirar tudo | `U` |
| ⬆ | Comprar carta | `D` |
| 🔊 | Microfone (on/off/PTT) | `M` |
| 📌 | Ping | `Alt+clique` |
| ⚙ | Configurações | — |

### 4.5 Inspetor de carta

Painel lateral que aparece em `hover` longo (400 ms) ou `Alt+clique`. Mostra a imagem em qualidade
`normal`, nome, custo, tipo e texto de regras (hidratados do `cardDataStore`). Fecha com `Esc`.

### 4.6 Estados de conexão

| Estado | UI |
|---|---|
| Conectando | *Overlay* com *spinner* e "entrando na mesa…" |
| Conectado | Indicador verde discreto |
| Reconectando | *Overlay* semitransparente + contagem regressiva de 90 s. A mesa segue visível, mas inerte |
| Perdido | Modal bloqueante com "a sala foi encerrada" e botão para o Dashboard |
| Voz desconectada | Banner **separado**, sem sugerir que a partida caiu |

---

## 5. Comportamento responsivo

| Faixa | Comportamento |
|---|---|
| **≥ 1280 px** | Experiência completa; painéis laterais fixos |
| **1024–1280 px** | Painéis colapsáveis e sobrepostos ao Canvas |
| **Tablet landscape (≥ 900 px)** | Suportado; alvos de toque de 44 px; toque longo abre menu de contexto |
| **Tablet portrait** | Aviso para girar o dispositivo |
| **Smartphone** | Lobby, Dashboard e Deckbuilder **100 % funcionais** em modo vertical. A mesa exibe aviso claro: "a experiência requer tela em modo paisagem (landscape) ou tablet/desktop" |

O motivo é honesto e vale repetir na UI: com 4 áreas de jogo, abaixo de ~900 px a carta fica pequena
demais para a arte ser reconhecível.

---

## 6. Atalhos de teclado

Todos remapeáveis (`uiStore` + `UserPreference`), o que também é um requisito de acessibilidade
(`NFR-13`).

### 6.1 Padrão

| Tecla | Ação |
|---|---|
| `T` | Virar / desvirar a carta selecionada |
| `Ctrl+T` | Rotacionar 180° |
| `F` | Face para baixo |
| `D` | Comprar 1 carta |
| `Shift+D` | Comprar X (abre diálogo) |
| `S` | Embaralhar grimório |
| `U` | Desvirar tudo |
| `B` | Enviar carta da mão ao Battlefield |
| `G` | Enviar ao cemitério |
| `E` | Enviar ao exílio |
| `+` / `-` | Marcador +1/+1 |
| `R` | Painel de dados |
| `K` | Painel de fichas |
| `M` | Mutar / desmutar microfone |
| `Espaço` (segurar) | *Pan* da câmera |
| `Alt+clique` | Inspecionar carta |
| `Shift+clique` | Adicionar à seleção |
| `Ctrl+A` | Selecionar todas as próprias no Battlefield |
| `Esc` | Limpar seleção / fechar modal |
| `Setas` | Mover a seleção em passos de 10 px |
| `Enter` | Foco no campo de chat |
| `?` | Lista de atalhos |

### 6.2 Regras de atalho

1. Nada sobrescreve atalho crítico do navegador (`Ctrl+W`, `Ctrl+T`, `F5`, `Ctrl+L`).
2. Com foco em campo de texto, atalhos de jogo ficam **inertes**.
3. Todo atalho tem equivalente por mouse — o teclado é aceleração, nunca requisito.
4. `?` sempre lista os atalhos vigentes, inclusive remapeados.

---

## 7. Movimento e animação

| Animação | Duração | *Easing* |
|---|---|---|
| Virar carta (tap) | 150 ms | `ease-out` |
| Comprar (grimório → mão) | 200 ms | `ease-in-out` |
| Mudança de zona | 180 ms | `ease-out` |
| *Badge* de marcador | 120 ms | `ease-out` com leve *overshoot* |
| Rolagem de dado | 600 ms | Personalizada |
| Ping | 800 ms + decaimento | `ease-out` |
| Interpolação de movimento alheio | intervalo do *patch* (50 ms) | Linear |
| Abrir painel | 150 ms | `ease-out` |
| *Toast* | 200 ms entrada / 150 ms saída | `ease-out` |

**`prefers-reduced-motion`:** desliga todas as animações não essenciais. Transições de estado passam a
ser instantâneas; a interpolação de movimento alheio é mantida, porque sem ela a mesa fica ilegível.

---

## 8. Acessibilidade (A11y)

| Requisito | Implementação |
|---|---|
| Contraste | AA (≥ 4,5:1) em todo texto de UI |
| Navegação por teclado | Toda a UI de DOM; ordem de foco lógica; `focus-visible` visível |
| Leitor de tela na mesa | Região `aria-live="polite"` espelhando o log de ações |
| Nome da carta como texto | `hover` longo expõe o nome no DOM, não só no Canvas |
| Alternativa ao arraste | Selecionar por teclado + mover por setas |
| Atalhos remapeáveis | Todos, para usuários com limitação motora |
| Movimento reduzido | `prefers-reduced-motion` respeitado |
| Tamanho de texto | Respeita o zoom do navegador na UI de DOM |
| Cor não é o único sinal | Estado sempre acompanhado de ícone ou texto (importante para daltonismo) |
| Alvos de toque | ≥ 44 × 44 px em tablet |

**Limitação assumida e declarada:** o Canvas é opaco para leitores de tela. O espelho em `aria-live` é
mitigação parcial, não solução completa. Está registrado como dívida conhecida.

---

## 9. Modo claro

O produto é **dark-first** — a mesa escura é decisão de design (§1.1), não preferência. O tema claro
existe para o **Lobby, Dashboard e Deckbuilder**, onde há muito texto e leitura prolongada.

A **mesa permanece escura** em ambos os temas: fundo claro atrás de 300 cartas coloridas destrói a
leitura visual.

---

## 10. Checklist de UI

- [ ] Tokens de cor no `tailwind.config.ts` como fonte única.
- [ ] `tabular-nums` em todo número que muda.
- [ ] Proporção de carta 0,716 respeitada em qualquer zoom.
- [ ] Sombra aplicada **só** à carta arrastada.
- [ ] Canvas ocupando ≥ 75 % da janela em 1366×768 com painéis abertos.
- [ ] Feedback visual em < 100 ms para toda ação.
- [ ] Log filtrável, com retenção de 200 entradas e rolagem inteligente.
- [ ] Distinção clara entre "mutar meu microfone" e "mutar aquele jogador".
- [ ] Estados de conexão de jogo e de voz **separados** na UI.
- [ ] Vida ≤ 0 sinalizada sem eliminar ninguém (`RN01`).
- [ ] Todos os atalhos remapeáveis; `?` lista os vigentes.
- [ ] `prefers-reduced-motion` respeitado.
- [ ] `aria-live` espelhando o log.
- [ ] Contraste AA verificado com axe-core no CI.
- [ ] Aviso de landscape abaixo de 900 px.
