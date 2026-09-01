/**
 * useRoomSync.ts — Ponte entre o Colyseus e o gameStore (DOC-040 §3.2).
 *
 * Regra crítica de performance: atualizações de sprite NÃO devem disparar
 * re-render da árvore React. O gameStore serve apenas a UI de overlay.
 */

import { useEffect, useRef } from 'react';
import { getStateCallbacks, type Room } from 'colyseus.js';
import {
  useGameStore,
  useTableStore,
  type ArrowData,
  type CardData,
  type PlayerData,
  type LogEntry,
} from '../store/game.store';
import { useToast } from '../components/Toast';
import { mensagemDeErro } from './erros';
import type { RoomState } from './schema/RoomState';
import type { Card } from './schema/Card';
import type { Player } from './schema/Player';

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
    exiledBy: card.exiledBy ?? '',
    goadedBy: card.goadedBy ?? '',
    hasPtOverride: card.hasPtOverride ?? false,
    enteredThisTurn: card.enteredThisTurn ?? false,
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
    mulliganCount: p.mulliganCount ?? 0,
    connected: p.connected,
    disconnectedAt: p.disconnectedAt,
    rad: p.rad ?? 0,
    ticket: p.ticket ?? 0,
    speed: p.speed ?? 0,
    ringLevel: p.ringLevel ?? 0,
    ringBearerId: p.ringBearerId ?? '',
    maxHandSize: p.maxHandSize ?? 7,
    sleeveId: p.sleeveId ?? '',
    playmatId: p.playmatId ?? '',
    profileBorder: p.profileBorder ?? '',
    chatTitle: p.chatTitle ?? '',
    petId: p.petId ?? '',
  };
}

export function useRoomSync(room: Room<RoomState> | null) {
  const store = useGameStore.getState();
  const roomRef = useRef<Room<RoomState> | null>(null);

  useEffect(() => {
    if (!room) return;
    roomRef.current = room;

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
      const st = useGameStore.getState();
      st.setPhase(room.state.phase as 'WAITING' | 'PLAYING' | 'PAUSED' | 'CLOSING');
      // Os marcadores globais (turno, fase, dia/noite) viajam no mesmo patch e
      // ninguém os lia: o painel de mesa mostrava sempre turno 1.
      st.setMesa({
        turn: room.state.turn ?? 1,
        turnPhase: room.state.turnPhase ?? '',
        dayNight: room.state.dayNight ?? 'NEITHER',
        activePlayerId: room.state.activePlayerId ?? '',
      });
    });

    // ── Setas de alvo ──────────────────────────────────────────────────────
    const sincronizarSetas = () => {
      const mapa: Record<string, ArrowData> = {};
      room.state.arrows?.forEach((a, id) => {
        mapa[id] = {
          id: a.id,
          ownerId: a.ownerId,
          fromId: a.fromId,
          toId: a.toId,
          color: a.color,
          combat: a.combat,
        };
      });
      useGameStore.getState().setArrows(mapa);
    };

    $(room.state).arrows.onAdd(() => sincronizarSetas());
    $(room.state).arrows.onRemove(() => sincronizarSetas());

    // ── Eventos efêmeros ───────────────────────────────────────────────────

    room.onMessage('log', (entry: any) => {
      useGameStore.getState().addLog(entry as LogEntry);
    });

    room.onMessage('chat', (entry: any) => {
      useGameStore.getState().addChat(entry as LogEntry);
    });

    // ── Eventos efêmeros que NINGUÉM escutava ────────────────────────────
    //
    // O servidor já transmitia `dice`, `ping`, `revealToOwner` e `scryOpened`.
    // Sem estes handlers, olhar o topo do grimório não mostrava nada, o ping
    // não aparecia na mesa e o dado só existia como texto no log.

    room.onMessage('dice', (payload: { actorId: string; sides: number; result: number }) => {
      useTableStore.getState().setDado(payload);
    });

    room.onMessage('coin', (payload: { actorId: string; result: 'CARA' | 'COROA' }) => {
      useTableStore.getState().setMoeda(payload);
    });

    room.onMessage('ping', (payload: { actorId: string; x: number; y: number }) => {
      useTableStore.getState().addPing(payload);
    });

    room.onMessage(
      'revealToOwner',
      (payload: { cards: Array<{ id: string; scryfallId: string }> }) => {
        useTableStore.getState().setPeek(payload.cards ?? []);
      },
    );

    room.onMessage(
      'scryOpened',
      (payload: { mode: 'SCRY' | 'SURVEIL'; cards: Array<{ id: string; scryfallId: string }> }) => {
        useTableStore.getState().abrirScry({ mode: payload.mode, cards: payload.cards ?? [] });
      },
    );

    room.onMessage('matchStarted', () => {
      useGameStore.getState().setPhase('PLAYING');
    });

    /**
     * UMA REJEIÇÃO PRECISA APARECER NA TELA.
     *
     * Estes dois canais existiam e só chegavam ao `console.warn`. O servidor
     * dizia "NOT_AUTHORIZED", "RATE_LIMITED", "ENTITY_NOT_FOUND" — e o jogador
     * via a carta não se mexer, sem nada mais. Da cadeira dele, uma ação
     * recusada e um clique que não pegou são indistinguíveis, e a conclusão
     * natural é que a mesa está quebrada.
     *
     * O log da partida também recebe: o toast some em 5 s, e quem estava
     * olhando para outro canto da mesa perderia o aviso.
     */
    room.onMessage('error', (payload: any) => {
      const texto = mensagemDeErro(payload?.code, payload?.message);
      console.warn('[AetherRoom] Intenção rejeitada:', payload?.code, payload?.message);
      useToast.getState().mostrar(texto, 'erro');
      useGameStore.getState().addLog({
        id: `erro-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        type: 'SYSTEM',
        actorId: '',
        text: texto,
      });
    });

    room.onMessage('warning', (payload: any) => {
      console.warn('[AetherRoom] Aviso:', payload?.code, payload?.message);
      useToast.getState().mostrar(mensagemDeErro(payload?.code, payload?.message), 'info');
    });

    /**
     * O deck não entrou na mesa.
     *
     * Era a falha mais cruel do fluxo: `provisionarDeck` fazia `console.error`
     * no SERVIDOR e seguia adiante. O jogador entrava, iniciava a partida, e a
     * mesa dele nascia sem grimório, sem comandante e sem mão — sobrava
     * assistir os outros jogarem, sem nenhuma mensagem que explicasse por quê.
     */
    room.onMessage('deckError', (payload: any) => {
      const texto =
        payload?.message ||
        'Seu deck não pôde ser carregado — você entra na mesa sem cartas. Volte à Taverna e entre de novo.';
      useToast.getState().mostrar(texto, 'erro');
      useGameStore.getState().addLog({
        id: `deck-${Date.now()}`,
        timestamp: Date.now(),
        type: 'SYSTEM',
        actorId: '',
        text: texto,
      });
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

    /**
     * `playerDisconnected` fala de OUTRA pessoa, não da minha conexão.
     *
     * O handler marcava `connectionState: 'reconnecting'` no store LOCAL. Quer
     * dizer: o vizinho perdia o wi-fi e o meu cliente passava a se considerar
     * reconectando — com a minha conexão intacta. Hoje nenhum componente lê
     * esse campo, então o estrago é invisível; no dia em que alguém desenhar o
     * indicador de conexão, ele vai mentir para três jogadores toda vez que o
     * quarto piscar. `connectionState` descreve o MEU socket e mais nada.
     *
     * A mensagem também não dizia quem tinha caído, apesar de o `playerId` vir
     * no payload: numa mesa de quatro, "um jogador se desconectou" obriga todo
     * mundo a conferir quem sumiu.
     */
    room.onMessage('playerDisconnected', (payload: any) => {
      const nome = useGameStore.getState().players[payload?.playerId]?.name;
      useGameStore.getState().addLog({
        id: `dc-${Date.now()}`,
        timestamp: Date.now(),
        type: 'SYSTEM',
        actorId: payload?.playerId ?? '',
        text: nome
          ? `${nome} se desconectou. Aguardando reconexão…`
          : 'Um jogador se desconectou. Aguardando reconexão…',
      });
    });

    room.onMessage('playerReconnected', (payload: any) => {
      const nome = useGameStore.getState().players[payload?.playerId]?.name;
      useGameStore.getState().addLog({
        id: `rc-${Date.now()}`,
        timestamp: Date.now(),
        type: 'SYSTEM',
        actorId: payload?.playerId ?? '',
        text: nome ? `${nome} voltou para a mesa.` : 'Um jogador voltou para a mesa.',
      });
    });

    // ── Limpeza ─────────────────────────────────────────────────────────────
    return () => {
      // NOTA: room.removeAllListeners() foi removido pois no React StrictMode
      // a remontagem rápida destruía permanentemente a comunicação com o Colyseus.
      // O ciclo de vida da sala é controlado por room.leave() no page.tsx.
      useGameStore.getState().reset();
      useTableStore.getState().reset();
    };
  }, [room]);

  return roomRef;
}
