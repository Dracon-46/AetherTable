/**
 * useRoomSync.ts — Ponte entre o Colyseus e o gameStore (DOC-040 §3.2).
 *
 * Regra crítica de performance: atualizações de sprite NÃO devem disparar
 * re-render da árvore React. O gameStore serve apenas a UI de overlay.
 */

import { useEffect, useRef } from 'react';
import { getStateCallbacks, type Room } from 'colyseus.js';
import { useGameStore, type CardData, type PlayerData, type LogEntry } from '../store/game.store';
import { preaquecer } from '../canvas/textureCache';
import { RoomState } from './schema/RoomState';
import { Card } from './schema/Card';
import { Player } from './schema/Player';

function snapCard(card: Card): CardData {
  return {
    id: card.id,
    ownerId: card.ownerId,
    controllerId: card.controllerId,
    zone: card.zone,
    scryfallId: card.scryfallId ?? '',
    revealedTo: card.revealedTo ?? '',
    peekedBy: card.peekedBy ?? '',
    x: card.x,
    y: card.y,
    rotation: card.rotation,
    zIndex: card.zIndex,
    isTapped: card.isTapped,
    faceDown: card.faceDown,
    phasedOut: card.phasedOut ?? false,
    isToken: card.isToken,
    isCopy: card.isCopy,
    isFlipped: card.isFlipped,
    lockedBy: card.lockedBy ?? '',
    attachedTo: card.attachedTo ?? '',
    note: card.note ?? '',
    highlight: card.highlight ?? '',
    damage: card.damage ?? 0,
    powerOverride: card.powerOverride ?? 0,
    toughnessOverride: card.toughnessOverride ?? 0,
    counters: Object.fromEntries(card.counters?.entries?.() ?? []),
  };
}

function snapPlayer(p: Player): PlayerData {
  return {
    id: p.id,
    userId: p.userId,
    name: p.name,
    avatarUrl: p.avatarUrl ?? '',
    seat: p.seat,
    life: p.life,
    poison: p.poison,
    energy: p.energy,
    experience: p.experience,
    commanderTax: p.commanderTax,
    isMonarch: p.isMonarch,
    hasInitiative: p.hasInitiative,
    conceded: p.conceded,
    commanderDamage: Object.fromEntries(p.commanderDamage?.entries?.() ?? []),
    handCount: p.handCount,
    libraryCount: p.libraryCount,
    connected: p.connected,
    disconnectedAt: p.disconnectedAt,
  };
}

export function useRoomSync(room: Room<RoomState> | null) {
  const store = useGameStore.getState();
  const roomRef = useRef<Room<RoomState> | null>(null);

  useEffect(() => {
    if (!room) return;
    roomRef.current = room;

    // Pré-aquece o verso das cartas
    preaquecer();

    // Informações base da sala
    // colyseus.js expõe `roomId`, não `id`.
    store.setRoomInfo(room.roomId, room.sessionId);
    store.setConnectionState('connected');

    const $ = getStateCallbacks(room);

    // ── Cartas ─────────────────────────────────────────────────────────────

    $(room.state).cards.onAdd((card: Card, id: string) => {
      $(card).onChange(() => {
        useGameStore.getState().upsertCard(id, snapCard(card));
      });
      useGameStore.getState().upsertCard(id, snapCard(card));
    });

    $(room.state).cards.onRemove((_card: Card, id: string) => {
      useGameStore.getState().removeCard(id);
    });

    // ── Jogadores ──────────────────────────────────────────────────────────

    $(room.state).players.onAdd((player: Player, id: string) => {
      $(player).onChange(() => {
        useGameStore.getState().upsertPlayer(id, snapPlayer(player));
      });
      useGameStore.getState().upsertPlayer(id, snapPlayer(player));
    });

    $(room.state).players.onRemove((_p: Player, id: string) => {
      useGameStore.getState().removePlayer(id);
    });

    // ── Fase da sala ────────────────────────────────────────────────────────

    $(room.state).onChange(() => {
      useGameStore.getState().setPhase(room.state.phase as "WAITING" | "PLAYING" | "PAUSED" | "CLOSING");
    });

    // ── Eventos efêmeros ───────────────────────────────────────────────────

    room.onMessage('log', (entry: any) => {
      useGameStore.getState().addLog(entry as LogEntry);
    });

    room.onMessage('chat', (entry: any) => {
      useGameStore.getState().addChat(entry as LogEntry);
    });

    room.onMessage('error', (payload: any) => {
      console.warn('[AetherRoom] Intenção rejeitada:', payload.code, payload.message);
    });

    room.onMessage('warning', (payload: any) => {
      console.warn('[AetherRoom] Aviso:', payload.code, payload.message);
    });

    room.onMessage('playerJoined', (payload: any) => {
      useGameStore.getState().addLog({
        id: `join-${Date.now()}`,
        timestamp: Date.now(),
        type: 'SYSTEM',
        actorId: payload.playerId,
        text: `${payload.name} entrou na mesa.`,
      });
    });

    room.onMessage('playerLeft', (payload: any) => {
      useGameStore.getState().addLog({
        id: `left-${Date.now()}`,
        timestamp: Date.now(),
        type: 'SYSTEM',
        actorId: payload.playerId,
        text: `${payload.name} saiu da mesa.`,
      });
    });

    room.onMessage('playerDisconnected', (payload: any) => {
      useGameStore.getState().addLog({
        id: `dc-${Date.now()}`,
        timestamp: Date.now(),
        type: 'SYSTEM',
        actorId: payload.playerId,
        text: 'Um jogador se desconectou. Aguardando reconexão...',
      });
      useGameStore.getState().setConnectionState('reconnecting');
    });

    room.onMessage('playerReconnected', () => {
      useGameStore.getState().setConnectionState('connected');
    });

    // ── Limpeza ─────────────────────────────────────────────────────────────
    return () => {
      // NOTA: room.removeAllListeners() foi removido pois no React StrictMode
      // a remontagem rápida destruía permanentemente a comunicação com o Colyseus.
      // O ciclo de vida da sala é controlado por room.leave() no page.tsx.
      useGameStore.getState().reset();
    };
  }, [room]);

  return roomRef;
}
