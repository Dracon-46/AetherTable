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
import { useUIStore } from '../store/game.store';
import { mensagemDeErro } from './erros';
import type { RoomState } from './schema/RoomState';
import type { Card } from './schema/Card';
import type { Player } from './schema/Player';

/** Por que o jogador saiu, em português de mesa. */
const MOTIVO_DE_DERROTA: Record<string, string> = {
  LIFE: 'a vida chegou a zero',
  POISON: '10 marcadores de veneno',
  COMMANDER: '21 de dano de comandante',
  DECKED: 'grimório vazio na hora de comprar',
  CONCEDED: 'desistiu da partida',
};

/** Nome legível da zona, para as mensagens de pedido/resposta de visualização. */
const ROTULO_DE_ZONA: Record<string, string> = {
  HAND: 'a mão',
  LIBRARY: 'o grimório',
  GRAVEYARD: 'o cemitério',
  EXILE: 'o exílio',
};

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
    isCommander: card.isCommander ?? false,
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
    ready: p.ready ?? false,
    keptHand: p.keptHand ?? false,
    deckName: p.deckName ?? '',
    sharedZones: Object.fromEntries(p.sharedZones?.entries?.() ?? []),
    eliminated: p.eliminated ?? false,
    eliminationReason: p.eliminationReason ?? '',
    decked: p.decked ?? false,
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

    /**
     * ─── MAPA ANINHADO NÃO DISPARA O `onChange` DO PAI ─────────────────────
     *
     * `$(card).onChange` avisa quando um CAMPO da carta muda. `card.counters` é
     * um `MapSchema`: pôr um marcador dentro dele não troca a referência do
     * campo, então o `onChange` do `Card` NÃO dispara.
     *
     * O efeito era exatamente este: o servidor gravava `+1/+1`, o patch saía, e
     * o cliente nunca reescrevia a carta no store. Marcador não aparecia na
     * mesa nem no editor — e como a ação era aceita (nenhum erro, nenhum
     * toast), a leitura natural era "o botão de marcador não funciona".
     *
     * A assinatura no próprio mapa fecha o buraco. Vale para TODO `MapSchema`
     * aninhado do schema: aqui, `Card.counters`; abaixo,
     * `Player.commanderDamage` e `Player.sharedZones`.
     */
    const assinarCarta = (card: Card, id: string) => {
      const reSnap = () => useGameStore.getState().upsertCard(id, snapCard(card));
      $(card).onChange(reSnap);
      $(card).counters.onAdd(reSnap);
      $(card).counters.onChange(reSnap);
      $(card).counters.onRemove(reSnap);
      reSnap();
    };

    $(room.state).cards.onAdd((card: Card, id: string) => {
      assinarCarta(card, id);
    });

    $(room.state).cards.onRemove((_card: Card, id: string) => {
      useGameStore.getState().removeCard(id);
    });

    // ── Jogadores ──────────────────────────────────────────────────────────

    $(room.state).players.onAdd((player: Player, id: string) => {
      // Mesmo motivo da carta: `commanderDamage` e `sharedZones` são mapas
      // aninhados, e mutá-los não dispara o `onChange` do `Player`. Sem estas
      // assinaturas, o dano de comandante subia no servidor e o painel de vida
      // continuava mostrando zero.
      const reSnap = () => useGameStore.getState().upsertPlayer(id, snapPlayer(player));
      $(player).onChange(reSnap);
      $(player).commanderDamage.onAdd(reSnap);
      $(player).commanderDamage.onChange(reSnap);
      $(player).commanderDamage.onRemove(reSnap);
      $(player).sharedZones.onAdd(reSnap);
      $(player).sharedZones.onChange(reSnap);
      $(player).sharedZones.onRemove(reSnap);
      reSnap();
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
     * O grimório entrou na mesa. Confirma a escolha feita na sala de espera —
     * sem isto, escolher um deck e ver o contador subir sozinho é indistinguível
     * de "não aconteceu nada" quando o deck é pequeno.
     */
    room.onMessage('deckReady', (payload: any) => {
      useToast
        .getState()
        .mostrar(
          `Grimório "${payload?.name ?? ''}" pronto (${payload?.cards ?? 0} cartas).`,
          'info',
        );
    });

    /**
     * ALGUÉM PEDIU PARA VER UMA ZONA OCULTA MINHA.
     *
     * Chega só para o dono da zona, e não concede nada: é um convite a decidir.
     * A permissão só existe depois de `INTENT_RESPOND_VIEW` com `accept: true`.
     */
    room.onMessage('viewRequest', (payload: any) => {
      if (!payload?.requesterId) return;
      useTableStore.getState().addPedidoDeVista({
        requesterId: payload.requesterId,
        requesterName: payload.requesterName ?? 'Alguém',
        zone: payload.zone,
      });
    });

    room.onMessage('viewResponse', (payload: any) => {
      const zona = ROTULO_DE_ZONA[payload?.zone] ?? 'a zona';
      const nome = payload?.ownerName ?? 'O jogador';
      useToast
        .getState()
        .mostrar(
          payload?.accepted
            ? `${nome} abriu ${zona} para você.`
            : `${nome} recusou mostrar ${zona}.`,
          payload?.accepted ? 'sucesso' : 'info',
        );
      // Aceito: abre a zona daquele jogador direto, senão o jogador teria de
      // adivinhar onde a permissão recém-concedida aparece.
      if (payload?.accepted && payload?.ownerId) {
        const ui = useUIStore.getState();
        ui.setZoneOwner(payload.ownerId);
        ui.setInspectedZone(payload.zone);
      }
    });

    /**
     * ALGUÉM SAIU DO JOGO.
     *
     * O estado autoritativo já viaja no patch (`Player.eliminated`); este
     * evento existe para o MOMENTO — o toast e a linha no log. Sem ele, a
     * eliminação seria um ícone que muda de cor num painel para o qual ninguém
     * está olhando.
     */
    room.onMessage('playerEliminated', (payload: any) => {
      const souEu = payload?.playerId === useGameStore.getState().mySessionId;
      const porQuem = payload?.byName ? ` (comandante de ${payload.byName})` : '';
      const motivo = MOTIVO_DE_DERROTA[payload?.reason] ?? 'saiu da partida';
      useToast
        .getState()
        .mostrar(
          souEu
            ? `Você saiu do jogo: ${motivo}${porQuem}.`
            : `${payload?.name}: ${motivo}${porQuem}.`,
          souEu ? 'erro' : 'info',
        );
    });

    room.onMessage('matchEnded', (payload: any) => {
      const souEu = payload?.winnerId === useGameStore.getState().mySessionId;
      useToast
        .getState()
        .mostrar(
          souEu ? 'Você venceu a partida!' : `${payload?.winnerName} venceu a partida.`,
          'sucesso',
        );
    });

    /**
     * Fui removido pelo anfitrião.
     *
     * Sem este canal, a expulsão chegava como uma conexão que simplesmente caiu
     * — e o jogador tentava voltar em looping, sem entender por que o passe já
     * não valia.
     */
    room.onMessage('kicked', (payload: any) => {
      useToast.getState().mostrar(payload?.message ?? 'Você foi removido da sala.', 'erro');
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          window.location.href = '/dashboard?motivo=expulso';
        }, 1500);
      }
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
