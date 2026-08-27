import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  connected: boolean;
  disconnectedAt: number;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  type: string;
  actorId: string;
  text: string;
}

interface GameState {
  roomId: string;
  phase: 'WAITING' | 'PLAYING' | 'PAUSED' | 'CLOSING';
  mySessionId: string;
  players: Record<string, PlayerData>;
  cards: Record<string, CardData>;
  log: LogEntry[];
  connectionState: 'connecting' | 'connected' | 'reconnecting' | 'lost';

  // Actions
  setRoomInfo: (roomId: string, sessionId: string) => void;
  setPhase: (phase: GameState['phase']) => void;
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
  mySessionId: '',
  players: {},
  cards: {},
  log: [],
  connectionState: 'connecting',

  setRoomInfo: (roomId, sessionId) => set({ roomId, mySessionId: sessionId }),
  setPhase: (phase) => set({ phase }),
  setConnectionState: (connectionState) => set({ connectionState }),

  upsertCard: (id, data) => set((s) => ({
    cards: { ...s.cards, [id]: { ...(s.cards[id] ?? {}), ...data } as CardData },
  })),

  removeCard: (id) => set((s) => {
    const cards = { ...s.cards };
    delete cards[id];
    return { cards };
  }),

  upsertPlayer: (id, data) => set((s) => ({
    players: { ...s.players, [id]: { ...(s.players[id] ?? {}), ...data } as PlayerData },
  })),

  removePlayer: (id) => set((s) => {
    const players = { ...s.players };
    delete players[id];
    return { players };
  }),

  addLog: (entry) => set((s) => ({
    log: [...s.log.slice(-199), entry],
  })),

  addChat: (entry) => set((s) => ({
    log: [...s.log.slice(-199), { ...entry, type: 'CHAT' }],
  })),

  reset: () => set({ roomId: '', phase: 'WAITING', mySessionId: '', players: {}, cards: {}, log: [], connectionState: 'connecting' }),
}));

// ─── uiStore: puramente local, nunca trafega ──────────────────────────────

interface UIState {
  zoomLevel: number;
  cameraPosition: { x: number; y: number };
  activeModals: { chat: boolean; dice: boolean; settings: boolean; tokens: boolean; context: boolean };
  selectedCardIds: string[];
  hoveredCardId: string | null;
  inspectedCardId: string | null;
  contextMenuCard: string | null;
  contextMenuPos: { x: number; y: number };
  showZoneOutlines: boolean;
  inspectedZone: 'GRAVEYARD' | 'EXILE' | null;

  setZoom: (z: number) => void;
  setCamera: (x: number, y: number) => void;
  toggleModal: (modal: keyof UIState['activeModals']) => void;
  closeAllModals: () => void;
  setSelectedCards: (ids: string[]) => void;
  setHoveredCard: (id: string | null) => void;
  setInspectedCard: (id: string | null) => void;
  setInspectedZone: (zone: 'GRAVEYARD' | 'EXILE' | null) => void;
  openContextMenu: (cardId: string, x: number, y: number) => void;
  closeContextMenu: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      zoomLevel: 1,
      cameraPosition: { x: 0, y: 0 },
      activeModals: { chat: false, dice: false, settings: false, tokens: false, context: false },
      selectedCardIds: [],
      hoveredCardId: null,
      inspectedCardId: null,
      contextMenuCard: null,
      contextMenuPos: { x: 0, y: 0 },
      showZoneOutlines: true,
      inspectedZone: null,

      setZoom: (zoomLevel) => set({ zoomLevel: Math.min(2.5, Math.max(0.4, zoomLevel)) }),
      setCamera: (x, y) => set({ cameraPosition: { x, y } }),
      toggleModal: (modal) => set((s) => ({
        activeModals: { ...s.activeModals, [modal]: !s.activeModals[modal] },
      })),
      closeAllModals: () => set({
        activeModals: { chat: false, dice: false, settings: false, tokens: false, context: false },
      }),
      setSelectedCards: (selectedCardIds) => set({ selectedCardIds }),
      setHoveredCard: (hoveredCardId) => set({ hoveredCardId }),
      setInspectedCard: (inspectedCardId) => set({ inspectedCardId }),
      setInspectedZone: (inspectedZone) => set({ inspectedZone }),
      openContextMenu: (contextMenuCard, x, y) => set({
        contextMenuCard,
        contextMenuPos: { x, y },
        activeModals: { chat: false, dice: false, settings: false, tokens: false, context: true },
      }),
      closeContextMenu: () => set((s) => ({
        contextMenuCard: null,
        activeModals: { ...s.activeModals, context: false },
      })),
    }),
    { name: 'aether-ui-store', partialize: (s) => ({ showZoneOutlines: s.showZoneOutlines }) }
  )
);
