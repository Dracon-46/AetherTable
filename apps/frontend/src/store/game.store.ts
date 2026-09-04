import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { armazenamentoAgrupado } from './storage';

// ─── gameStore: espelho do estado do servidor ──────────────────────────────

export interface CardData {
  id: string;
  ownerId: string;
  controllerId: string;
  zone: string;
  scryfallId: string;
  revealedTo: string;
  peekedBy: string;
  x: number;
  y: number;
  rotation: number;
  zIndex: number;
  isTapped: boolean;
  faceDown: boolean;
  phasedOut: boolean;
  isToken: boolean;
  isCopy: boolean;
  isFlipped: boolean;
  lockedBy: string;
  attachedTo: string;
  note: string;
  highlight: string;
  damage: number;
  powerOverride: number;
  toughnessOverride: number;
  counters: Record<string, number>;
  exiledBy: string;
  goadedBy: string;
  hasPtOverride: boolean;
  enteredThisTurn: boolean;
  /** É o comandante do dono. Vem do deck, não da zona — ver `Card.isCommander`. */
  isCommander: boolean;
}

export interface PlayerData {
  id: string;
  userId: string;
  name: string;
  avatarUrl: string;
  seat: number;
  life: number;
  poison: number;
  energy: number;
  experience: number;
  commanderTax: number;
  isMonarch: boolean;
  hasInitiative: boolean;
  conceded: boolean;
  commanderDamage: Record<string, number>;
  handCount: number;
  libraryCount: number;
  mulliganCount: number;
  connected: boolean;
  disconnectedAt: number;
  rad: number;
  ticket: number;
  speed: number;
  ringLevel: number;
  ringBearerId: string;
  maxHandSize: number;
  /** IDs do catálogo fechado de cosméticos (DOC-060), nunca URLs. */
  sleeveId: string;
  playmatId: string;
  profileBorder: string;
  chatTitle: string;
  petId: string;
  /** Sala de espera: confirmou que está pronto. */
  ready: boolean;
  /** Já decidiu ficar com a mão inicial — fecha a janela de mulligan. */
  keptHand: boolean;
  deckName: string;
  /** Zonas ocultas que ele abriu para outros: `{ HAND: 'sid1,sid2' }`. */
  sharedZones: Record<string, string>;
  /** Saiu do jogo — por regra ou por vontade. Continua na sala. */
  eliminated: boolean;
  /** LIFE | POISON | COMMANDER | DECKED | CONCEDED */
  eliminationReason: string;
  /** Tentou comprar de grimório vazio. Pegajoso: não se desfaz sozinho. */
  decked: boolean;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  type: string;
  actorId: string;
  /** Pode conter `{Carta}`, substituído pelo nome resolvido no catálogo. */
  text: string;
  /** Presente só em ação pública — ver `LogEvent` em @aethertable/shared-types. */
  scryfallId?: string;
}

export interface ArrowData {
  id: string;
  ownerId: string;
  fromId: string;
  toId: string;
  color: string;
  combat: boolean;
}

interface GameState {
  roomId: string;
  phase: 'WAITING' | 'PLAYING' | 'PAUSED' | 'CLOSING';
  /** Marcadores VISUAIS da mesa (F29). O motor não controla turnos. */
  turn: number;
  turnPhase: string;
  dayNight: string;
  activePlayerId: string;
  arrows: Record<string, ArrowData>;
  mySessionId: string;
  players: Record<string, PlayerData>;
  cards: Record<string, CardData>;
  log: LogEntry[];
  connectionState: 'connecting' | 'connected' | 'reconnecting' | 'lost';

  // Actions
  setRoomInfo: (roomId: string, sessionId: string) => void;
  setPhase: (phase: GameState['phase']) => void;
  setMesa: (
    patch: Partial<Pick<GameState, 'turn' | 'turnPhase' | 'dayNight' | 'activePlayerId'>>,
  ) => void;
  setArrows: (arrows: Record<string, ArrowData>) => void;
  setConnectionState: (state: GameState['connectionState']) => void;
  upsertCard: (id: string, data: Partial<CardData>) => void;
  removeCard: (id: string) => void;
  upsertPlayer: (id: string, data: Partial<PlayerData>) => void;
  removePlayer: (id: string) => void;
  addLog: (entry: LogEntry) => void;
  addChat: (entry: LogEntry) => void;
  reset: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  roomId: '',
  phase: 'WAITING',
  turn: 1,
  turnPhase: '',
  dayNight: 'NEITHER',
  activePlayerId: '',
  arrows: {},
  mySessionId: '',
  players: {},
  cards: {},
  log: [],
  connectionState: 'connecting',

  setRoomInfo: (roomId, sessionId) => set({ roomId, mySessionId: sessionId }),
  setPhase: (phase) => set({ phase }),
  setMesa: (patch) => set(patch),
  setArrows: (arrows) => set({ arrows }),
  setConnectionState: (connectionState) => set({ connectionState }),

  upsertCard: (id, data) =>
    set((s) => ({
      cards: { ...s.cards, [id]: { ...(s.cards[id] ?? {}), ...data } as CardData },
    })),

  removeCard: (id) =>
    set((s) => {
      const cards = { ...s.cards };
      delete cards[id];
      return { cards };
    }),

  upsertPlayer: (id, data) =>
    set((s) => ({
      players: { ...s.players, [id]: { ...(s.players[id] ?? {}), ...data } as PlayerData },
    })),

  removePlayer: (id) =>
    set((s) => {
      const players = { ...s.players };
      delete players[id];
      return { players };
    }),

  addLog: (entry) =>
    set((s) => ({
      log: [...s.log.slice(-199), entry],
    })),

  addChat: (entry) =>
    set((s) => ({
      log: [...s.log.slice(-199), { ...entry, type: 'CHAT' }],
    })),

  reset: () =>
    set({
      roomId: '',
      phase: 'WAITING',
      turn: 1,
      turnPhase: '',
      dayNight: 'NEITHER',
      activePlayerId: '',
      arrows: {},
      mySessionId: '',
      players: {},
      cards: {},
      log: [],
      connectionState: 'connecting',
    }),
}));

// ─── uiStore: puramente local, nunca trafega ──────────────────────────────

/**
 * Zonas que podem ser abertas por inteiro no inspetor.
 *
 * `HAND` entrou junto com o pedido de visualização consentido
 * (`INTENT_REQUEST_VIEW`): quando o dono aceita mostrar a mão, o observador
 * precisa de algum lugar onde ela apareça. Sem isso a permissão era concedida
 * de verdade no servidor e não tinha superfície nenhuma no cliente — as cartas
 * chegavam com identidade e ninguém as desenhava.
 */
export type ZonaInspecionavel = 'GRAVEYARD' | 'EXILE' | 'LIBRARY' | 'SIDEBOARD' | 'HAND';

interface UIState {
  /**
   * ─── ZOOM E CÂMERA SAÍRAM ────────────────────────────────────────────────
   *
   * `zoomLevel` e `cameraPosition` existiam para compensar uma mesa que NÃO
   * CABIA na tela: a geometria montava um plano lógico de 1920 e o desenho
   * encolhia tudo para caber, então o jogador precisava de zoom e arraste para
   * alcançar o que tinha ficado pequeno.
   *
   * A mesa agora é montada em pixels reais da área disponível
   * (`montarMesaFocada`) e ocupa a tela inteira, sempre. Zoom passaria a
   * servir para uma coisa só — se afastar e voltar a ter carta ilegível — que
   * é exatamente o que o jogador pediu para não existir.
   */
  /** Trilho de oponentes na direita. FLUTUA: abrir não redimensiona a mesa. */
  trilhoAberto: boolean;
  /**
   * A CÂMERA SEGUE DE QUEM É A VEZ.
   *
   * Ligado, passar o turno leva a tela para a mesa do próximo jogador
   * automaticamente. É preferência de quem OLHA, não estado de mesa: cada
   * pessoa decide se quer ser levada, e ninguém move a câmera de ninguém.
   *
   * Desligado por padrão, e não por timidez: ser arrastado para a mesa de outra
   * pessoa no meio de uma decisão sua é desorientador, e o jogador que quer
   * acompanhar sabe que quer. Um padrão que mexe na tela sem pedir vira a
   * primeira coisa que todos procuram desligar.
   */
  seguirTurno: boolean;
  activeModals: {
    chat: boolean;
    dice: boolean;
    settings: boolean;
    tokens: boolean;
    context: boolean;
    players: boolean;
  };
  selectedCardIds: string[];
  hoveredCardId: string | null;
  inspectedCardId: string | null;
  contextMenuCard: string | null;
  contextMenuPos: { x: number; y: number };
  showZoneOutlines: boolean;
  inspectedZone: ZonaInspecionavel | null;
  /**
   * De QUEM é a zona aberta no inspetor. O cemitério e o exílio são públicos:
   * clicar na pilha de um oponente precisa abrir a pilha DELE. Antes o inspetor
   * filtrava sempre por `ownerId === mySessionId` e mostrava a minha zona
   * qualquer que fosse a pilha clicada.
   */
  inspectedZoneOwner: string | null;
  /** Carta aberta no editor de marcadores/P/T/dano/anotação. */
  editingCardId: string | null;
  /**
   * Origem de uma seta de alvo em construção. O gesto é de dois toques —
   * escolher a origem e depois o destino — porque arrastar já significa
   * "mover a carta".
   */
  arrowSource: string | null;
  boardView: string; // 'ALL' | 'ME' | opponent_sessionId
  hasKeptHand: boolean;
  mulliganCount: number;
  /**
   * A barra de ações da base começa RECOLHIDA.
   *
   * Ela tem quatorze botões e vive por cima da faixa de mão — a parte da mesa
   * que o jogador mais olha. Deixá-la sempre aberta é gastar a borda inferior
   * inteira com um menu que se usa algumas vezes por turno. Recolhida, sobra
   * uma seta; a preferência é lembrada, para quem gosta dela aberta não ter de
   * reabrir a cada partida.
   */
  barraAberta: boolean;
  /**
   * Quanto do painel de vida fica na tela.
   *
   *   'minima' — some da mesa; sobra um selo com o próprio total.
   *   'minha'  — só o seu cartão (padrão).
   *   'mesa'   — todos, para mexer em dano de comandante e contadores.
   *
   * Três estados e não um booleano porque "minimizar" e "ver a mesa toda" são
   * pedidos diferentes: um é sobre tirar o painel da frente do tabuleiro, o
   * outro é sobre trazer informação dos oponentes. Com um booleano só, quem
   * quisesse a mesa limpa era obrigado a conviver com o próprio cartão.
   */
  vidaModo: 'minima' | 'minha' | 'mesa';
  /**
   * Log da partida aberto.
   *
   * Era estado local do `ChatLog`, recolhido à força a cada montagem: F5 no
   * meio da partida trazia o log de volta por cima do tabuleiro. Nasce
   * recolhido — o log é consulta, e aberto ele come a coluna direita, onde
   * ficam as pilhas de cada faixa — e a escolha sobrevive.
   */
  logAberto: boolean;

  setTrilhoAberto: (v: boolean) => void;
  setSeguirTurno: (v: boolean) => void;
  toggleModal: (modal: keyof UIState['activeModals']) => void;
  closeAllModals: () => void;
  setSelectedCards: (ids: string[]) => void;
  setHoveredCard: (id: string | null) => void;
  setInspectedCard: (id: string | null) => void;
  setInspectedZone: (zone: ZonaInspecionavel | null) => void;
  setZoneOwner: (playerId: string | null) => void;
  setEditingCard: (cardId: string | null) => void;
  toggleSelectedCard: (id: string) => void;
  clearSelection: () => void;
  setArrowSource: (id: string | null) => void;
  openContextMenu: (cardId: string, x: number, y: number) => void;
  closeContextMenu: () => void;
  setBoardView: (view: string) => void;
  setHasKeptHand: (val: boolean) => void;
  setMulliganCount: (count: number) => void;
  setBarraAberta: (v: boolean) => void;
  setVidaModo: (v: UIState['vidaModo']) => void;
  setLogAberto: (v: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      trilhoAberto: true,
      seguirTurno: false,
      activeModals: {
        chat: false,
        dice: false,
        settings: false,
        tokens: false,
        context: false,
        players: false,
      },
      selectedCardIds: [],
      hoveredCardId: null,
      inspectedCardId: null,
      contextMenuCard: null,
      contextMenuPos: { x: 0, y: 0 },
      showZoneOutlines: true,
      inspectedZone: null,
      inspectedZoneOwner: null,
      editingCardId: null,
      arrowSource: null,
      boardView: 'ALL',
      hasKeptHand: false,
      mulliganCount: 0,
      barraAberta: false,
      vidaModo: 'minha',
      logAberto: false,

      setTrilhoAberto: (trilhoAberto) => set({ trilhoAberto }),
      setSeguirTurno: (seguirTurno) => set({ seguirTurno }),
      toggleModal: (modal) =>
        set((s) => ({
          activeModals: { ...s.activeModals, [modal]: !s.activeModals[modal] },
        })),
      closeAllModals: () =>
        set({
          activeModals: {
            chat: false,
            dice: false,
            settings: false,
            tokens: false,
            context: false,
            players: false,
          },
        }),
      setSelectedCards: (selectedCardIds) => set({ selectedCardIds }),
      toggleSelectedCard: (id) =>
        set((s) => ({
          selectedCardIds: s.selectedCardIds.includes(id)
            ? s.selectedCardIds.filter((x) => x !== id)
            : [...s.selectedCardIds, id],
        })),
      clearSelection: () => set({ selectedCardIds: [] }),
      setArrowSource: (arrowSource) => set({ arrowSource }),
      setHoveredCard: (hoveredCardId) => set({ hoveredCardId }),
      setInspectedCard: (inspectedCardId) => set({ inspectedCardId }),
      setInspectedZone: (inspectedZone) => set({ inspectedZone }),
      setZoneOwner: (inspectedZoneOwner) => set({ inspectedZoneOwner }),
      setEditingCard: (editingCardId) => set({ editingCardId }),
      openContextMenu: (contextMenuCard, x, y) =>
        set({
          contextMenuCard,
          contextMenuPos: { x, y },
          activeModals: {
            chat: false,
            dice: false,
            settings: false,
            tokens: false,
            context: true,
            players: false,
          },
        }),
      closeContextMenu: () =>
        set((s) => ({
          contextMenuCard: null,
          activeModals: { ...s.activeModals, context: false },
        })),
      setBoardView: (boardView) => set({ boardView }),
      setHasKeptHand: (hasKeptHand) => set({ hasKeptHand }),
      setMulliganCount: (mulliganCount) => set({ mulliganCount }),
      setBarraAberta: (barraAberta) => set({ barraAberta }),
      setVidaModo: (vidaModo) => set({ vidaModo }),
      setLogAberto: (logAberto) => set({ logAberto }),
    }),
    {
      name: 'aether-ui-store',
      /**
       * ─── POR QUE O STORAGE AQUI É O AGRUPADO ─────────────────────────────
       *
       * O `persist` grava a cada `set`, e neste store os `set` mais frequentes
       * são de interação contínua: `setCamera` roda em `onMouseMove` enquanto
       * o jogador arrasta o fundo da mesa, e `setHoveredCard` roda ao entrar e
       * sair de CADA carta. Cada um custava um `JSON.stringify` mais uma
       * escrita SÍNCRONA em `localStorage`, na thread principal, no meio do
       * quadro — dezenas por segundo, de um objeto que não tinha mudado.
       *
       * Era um travamento de arraste causado inteiramente por gravar
       * preferências que ninguém pediu para gravar naquele instante.
       */
      storage: armazenamentoAgrupado,
      partialize: (s) => ({
        showZoneOutlines: s.showZoneOutlines,
        logAberto: s.logAberto,
        trilhoAberto: s.trilhoAberto,
        seguirTurno: s.seguirTurno,
        // `boardView` guarda um sessionId quando aponta para um oponente, e
        // sessionId muda a cada conexão. Persistido cru, o jogador voltava numa
        // partida nova com a câmera fixada num assento que não existe mais: a
        // mesa desenhava UMA faixa (nem "todos", nem a dele) e o seletor de
        // câmera parecia sem efeito. Só as duas visões estáveis sobrevivem.
        boardView: s.boardView === 'ALL' || s.boardView === 'ME' ? s.boardView : 'ALL',
        barraAberta: s.barraAberta,
        vidaModo: s.vidaModo,
      }),
    },
  ),
);

// ─── tableStore: eventos efêmeros do servidor ────────────────────────────────
//
// `dice`, `ping`, `revealToOwner` e `scryOpened` eram transmitidos pelo servidor
// e NINGUÉM os escutava no cliente. O dado rolava e só aparecia como texto no
// log; a olhada no topo do grimório não tinha para onde ir — era por isso que
// "olhar o topo" não mostrava nada.
//
// Estes dados não são estado da mesa (não sobrevivem a um reload, não têm dono),
// então ficam fora do gameStore, que é espelho do Schema.

export interface CartaRevelada {
  id: string;
  scryfallId: string;
}

export interface PingVisual {
  id: string;
  actorId: string;
  x: number;
  y: number;
  em: number;
}

export interface SessaoScry {
  mode: 'SCRY' | 'SURVEIL';
  cards: CartaRevelada[];
}

/**
 * Dado e moeda num tipo só.
 *
 * Os dois são o mesmo gesto — pedir um número ao acaso e mostrá-lo à mesa — e
 * separá-los custava duas fatias de estado, dois temporizadores e a chance de
 * um sobrepor o outro na tela. Com uma união, o último sorteio é sempre o que
 * aparece, seja qual for o tipo.
 */
export type Sorteio =
  | { tipo: 'DADO'; actorId: string; sides: number; result: number; em: number }
  | { tipo: 'MOEDA'; actorId: string; result: 'CARA' | 'COROA'; em: number };

/** Um pedido de "me deixa ver sua mão", esperando decisão do dono da zona. */
export interface PedidoDeVista {
  requesterId: string;
  requesterName: string;
  zone: 'HAND' | 'LIBRARY' | 'GRAVEYARD' | 'EXILE';
  em: number;
}

interface TableState {
  /** Último dado ou moeda, para o destaque visual na mesa. */
  ultimoSorteio: Sorteio | null;
  pings: PingVisual[];
  /** Buffer de olhada/busca: o que o servidor liberou só para mim. */
  peek: CartaRevelada[];
  scry: SessaoScry | null;
  /** Pedidos recebidos, na ordem de chegada. */
  pedidosDeVista: PedidoDeVista[];

  setDado: (d: { actorId: string; sides: number; result: number }) => void;
  setMoeda: (m: { actorId: string; result: 'CARA' | 'COROA' }) => void;
  /** Some com o sorteio depois da animação, para não congelar na tela. */
  limparSorteio: () => void;
  addPing: (p: Omit<PingVisual, 'id' | 'em'>) => void;
  expirarPings: () => void;
  setPeek: (cards: CartaRevelada[]) => void;
  abrirScry: (s: SessaoScry) => void;
  fecharScry: () => void;
  addPedidoDeVista: (p: Omit<PedidoDeVista, 'em'>) => void;
  removerPedidoDeVista: (requesterId: string, zone: string) => void;
  reset: () => void;
}

export const useTableStore = create<TableState>((set) => ({
  ultimoSorteio: null,
  pings: [],
  peek: [],
  scry: null,
  pedidosDeVista: [],

  setDado: (d) => set({ ultimoSorteio: { tipo: 'DADO', ...d, em: Date.now() } }),
  setMoeda: (m) => set({ ultimoSorteio: { tipo: 'MOEDA', ...m, em: Date.now() } }),
  limparSorteio: () => set({ ultimoSorteio: null }),
  addPing: (p) =>
    set((s) => ({
      pings: [
        ...s.pings.slice(-9),
        { ...p, id: `${Date.now()}-${Math.round(p.x)}`, em: Date.now() },
      ],
    })),
  expirarPings: () =>
    set((s) => {
      const vivos = s.pings.filter((p) => Date.now() - p.em < 2500);
      return vivos.length === s.pings.length ? s : { pings: vivos };
    }),
  setPeek: (peek) => set({ peek }),
  abrirScry: (scry) => set({ scry }),
  fecharScry: () => set({ scry: null }),
  addPedidoDeVista: (p) =>
    set((s) => {
      // Insistir no botão não empilha três pedidos idênticos na tela de quem
      // vai decidir: o pedido é sobre a zona, não sobre o clique.
      const semDuplicata = s.pedidosDeVista.filter(
        (x) => !(x.requesterId === p.requesterId && x.zone === p.zone),
      );
      return { pedidosDeVista: [...semDuplicata, { ...p, em: Date.now() }] };
    }),
  removerPedidoDeVista: (requesterId, zone) =>
    set((s) => ({
      pedidosDeVista: s.pedidosDeVista.filter(
        (x) => !(x.requesterId === requesterId && x.zone === zone),
      ),
    })),
  reset: () => set({ ultimoSorteio: null, pings: [], peek: [], scry: null, pedidosDeVista: [] }),
}));
