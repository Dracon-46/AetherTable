import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { armazenamentoSeguro } from './storage';

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

/** Zonas que o dono pode abrir por inteiro. */
export type ZonaInspecionavel = 'GRAVEYARD' | 'EXILE' | 'LIBRARY' | 'SIDEBOARD';

interface UIState {
  zoomLevel: number;
  cameraPosition: { x: number; y: number };
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

  setZoom: (z: number) => void;
  setCamera: (x: number, y: number) => void;
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
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      zoomLevel: 1,
      cameraPosition: { x: 0, y: 0 },
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

      setZoom: (zoomLevel) => set({ zoomLevel: Math.min(2.5, Math.max(0.4, zoomLevel)) }),
      setCamera: (x, y) => set({ cameraPosition: { x, y } }),
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
    }),
    {
      name: 'aether-ui-store',
      storage: armazenamentoSeguro,
      partialize: (s) => ({
        showZoneOutlines: s.showZoneOutlines,
        boardView: s.boardView,
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

interface TableState {
  /** Último dado ou moeda, para o destaque visual na mesa. */
  ultimoSorteio: Sorteio | null;
  pings: PingVisual[];
  /** Buffer de olhada/busca: o que o servidor liberou só para mim. */
  peek: CartaRevelada[];
  scry: SessaoScry | null;

  setDado: (d: { actorId: string; sides: number; result: number }) => void;
  setMoeda: (m: { actorId: string; result: 'CARA' | 'COROA' }) => void;
  /** Some com o sorteio depois da animação, para não congelar na tela. */
  limparSorteio: () => void;
  addPing: (p: Omit<PingVisual, 'id' | 'em'>) => void;
  expirarPings: () => void;
  setPeek: (cards: CartaRevelada[]) => void;
  abrirScry: (s: SessaoScry) => void;
  fecharScry: () => void;
  reset: () => void;
}

export const useTableStore = create<TableState>((set) => ({
  ultimoSorteio: null,
  pings: [],
  peek: [],
  scry: null,

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
  reset: () => set({ ultimoSorteio: null, pings: [], peek: [], scry: null }),
}));
