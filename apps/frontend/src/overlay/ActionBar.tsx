'use client';

/**
 * ActionBar.tsx — Barra de Ações da Mesa (DOC-040 §2).
 *
 * MUDANÇAS DE LAYOUT (auditoria)
 *
 * A barra ficava em `top-3 left-1/2` com 14 botões numa linha rígida. Em
 * qualquer viewport abaixo de ~1400px ela cobria o rótulo da sala (canto
 * superior esquerdo) e o painel de Câmera (canto superior direito), e os
 * menus suspensos abriam para baixo por cima do painel de vida. Além disso a
 * barra tinha `z-30` enquanto a Câmera tinha `z-50`: a Câmera ganhava.
 *
 * Agora a barra vive na BASE da tela — onde não disputa espaço com nada — rola
 * horizontalmente quando não cabe, e seus menus abrem PARA CIMA.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Dices,
  Shuffle,
  BookOpen,
  RefreshCcw,
  Trash2,
  LogOut,
  ChevronUp,
  Repeat,
  Coins,
  Ghost,
  Mic,
  MicOff,
  Users,
  Search,
} from 'lucide-react';
import type { Room } from 'colyseus.js';
import { intents } from '../net/intents';
import { useRouter } from 'next/navigation';
import { useGameStore, useUIStore } from '../store/game.store';
import { useVoiceStore } from '../net/voice';
import { Undo2 } from 'lucide-react';
import type { RoomState } from '../net/schema/RoomState';

interface ActionBarProps {
  room: Room<RoomState>;
}

const DICE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;

/** Fecha um menu suspenso ao clicar fora dele. */
function useFecharAoClicarFora<T extends HTMLElement>(aberto: boolean, fechar: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!aberto) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) fechar();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [aberto, fechar]);
  return ref;
}

export function ActionBar({ room }: ActionBarProps) {
  const router = useRouter();
  const toggleModal = useUIStore((s) => s.toggleModal);
  const setInspectedZone = useUIStore((s) => s.setInspectedZone);

  const [showDice, setShowDice] = useState(false);
  const [drawAmount, setDrawAmount] = useState(1);
  const [showDraw, setShowDraw] = useState(false);

  // De quem é a vez. Marcador visual (F29) — o servidor não impõe turno, mas
  // desde que só o jogador da vez pode passá-la, o botão precisa saber.
  const myId = useGameStore((s) => s.mySessionId);
  const activePlayerId = useGameStore((s) => s.activePlayerId);
  const players = useGameStore((s) => s.players);
  // Sem vez definida (antes do primeiro turno, ou depois de um reset) qualquer
  // um pode destravar a rotação — é o que o servidor faz.
  const minhaVez = !activePlayerId || activePlayerId === myId;
  const nomeDaVez = activePlayerId ? (players[activePlayerId]?.name ?? null) : null;

  // Voz: lida do store, nunca de um hook do LiveKit chamado condicionalmente.
  const voiceAvailable = useVoiceStore((s) => s.available);
  const micEnabled = useVoiceStore((s) => s.micEnabled);
  const toggleMic = useVoiceStore((s) => s.toggleMic);

  const diceRef = useFecharAoClicarFora<HTMLDivElement>(showDice, () => setShowDice(false));
  const drawRef = useFecharAoClicarFora<HTMLDivElement>(showDraw, () => setShowDraw(false));

  const handleDice = (sides: number) => {
    intents.rollDice(room, sides);
    setShowDice(false);
  };

  const handleDraw = () => {
    intents.draw(room, Math.max(1, Math.min(20, drawAmount)));
    setShowDraw(false);
  };

  const handleLeave = () => {
    intents.leave(room);
    room.leave();
    router.push('/dashboard');
  };

  const btn =
    'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text transition-colors hover:bg-panel-hover';
  const iconBtn =
    'flex shrink-0 items-center justify-center rounded-lg p-2 text-text transition-colors hover:bg-panel-hover';

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="no-scrollbar border-panel-border bg-panel/95 pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border px-2 py-2 shadow-xl backdrop-blur">
        {/* Comprar carta */}
        <div className="relative shrink-0" ref={drawRef}>
          <button
            onClick={() => intents.draw(room, 1)}
            onContextMenu={(e) => {
              e.preventDefault();
              setShowDraw((v) => !v);
            }}
            title="Comprar 1 carta (botão direito para escolher a quantidade)"
            className={`${btn} hover:text-primary`}
          >
            <BookOpen className="h-4 w-4" />
            <span className="hidden sm:inline">Comprar</span>
          </button>
          {showDraw && (
            <div className="border-panel-border bg-panel absolute bottom-full left-0 mb-2 rounded-lg border p-2 shadow-xl">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={drawAmount}
                  onChange={(e) => setDrawAmount(Number(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleDraw();
                  }}
                  className="border-panel-border bg-table-deep text-text w-16 rounded border px-2 py-1 text-xs"
                />
                <button
                  onClick={handleDraw}
                  className="bg-primary hover:bg-primary-hover rounded px-3 py-1 text-xs text-white"
                >
                  Comprar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Buscar no grimório (tutor) — antes só existia via clique na pilha */}
        <button
          onClick={() => setInspectedZone('LIBRARY')}
          title="Buscar no grimório"
          className={`${btn} hover:text-warning`}
        >
          <Search className="h-4 w-4" />
          <span className="hidden lg:inline">Buscar</span>
        </button>

        <button
          onClick={() => intents.shuffle(room)}
          title="Embaralhar grimório"
          className={`${btn} hover:text-primary`}
        >
          <Shuffle className="h-4 w-4" />
          <span className="hidden lg:inline">Embaralhar</span>
        </button>

        <button
          onClick={() => intents.untapAll(room)}
          title="Desvirar todas as cartas (início do turno)"
          className={`${btn} hover:text-success`}
        >
          <RefreshCcw className="h-4 w-4" />
          <span className="hidden lg:inline">Desvirar</span>
        </button>

        {/* O SERVIDOR RECUSA SE NAO FOR A SUA VEZ — o botao precisa dizer isso
            ANTES do clique. Deixa-lo sempre ativo transforma a regra nova num
            toast de erro repetido: o jogador clica, leva "nao e a sua vez", e
            nao entende por que o botao existia. Fica visivel (para saber de
            quem e a vez) mas desabilitado, e dourado quando e a sua. */}
        <button
          onClick={() => intents.passTurn(room)}
          disabled={!minhaVez}
          title={
            minhaVez
              ? 'Passar o turno'
              : nomeDaVez
                ? `A vez e de ${nomeDaVez} — so quem esta na vez passa o turno`
                : 'Aguardando o inicio da rotacao de turnos'
          }
          className={`${btn} ${
            minhaVez
              ? 'border-[#facc15]/60 text-[#facc15] hover:text-[#facc15]'
              : 'cursor-not-allowed opacity-40'
          }`}
        >
          <ChevronUp className="h-4 w-4" />
          <span className="hidden lg:inline">Turno</span>
        </button>

        <div className="bg-panel-border mx-1 h-5 w-px shrink-0" />

        <button
          onClick={() => intents.flipCoin(room)}
          title="Girar moeda"
          className={`${iconBtn} hover:text-speaking`}
        >
          <Coins className="h-4 w-4" />
        </button>

        <button
          onClick={() => toggleModal('players')}
          title="Ver jogadores"
          className={`${iconBtn} hover:text-primary`}
        >
          <Users className="h-4 w-4" />
        </button>

        {/* Dados */}
        <div className="relative shrink-0" ref={diceRef}>
          <button
            onClick={() => setShowDice((v) => !v)}
            title="Rolar dado"
            className={`${iconBtn} hover:text-speaking`}
          >
            <Dices className="h-4 w-4" />
          </button>
          {showDice && (
            <div className="border-panel-border bg-panel absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-xl border p-2 shadow-xl">
              <div className="grid grid-cols-4 gap-1">
                {DICE_SIDES.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleDice(s)}
                    className="bg-panel-hover text-text hover:bg-speaking/20 hover:text-speaking rounded px-2 py-1.5 font-mono text-xs transition-colors"
                  >
                    D{s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => intents.mulligan(room)}
          title="Fazer mulligan"
          className={`${iconBtn} hover:text-primary`}
        >
          <Repeat className="h-4 w-4" />
        </button>

        <button
          onClick={() => toggleModal('tokens')}
          title="Gerar token"
          className={`${iconBtn} hover:text-primary`}
        >
          <Ghost className="h-4 w-4" />
        </button>

        <button
          onClick={() => intents.clearTokens(room)}
          title="Remover todos os tokens"
          className={`${iconBtn} hover:text-danger`}
        >
          <Trash2 className="h-4 w-4" />
        </button>

        <button
          onClick={() => intents.undo(room)}
          title="Desfazer a última ação própria (até 10 s). Não desfaz sorteio nem revelação."
          className={`${iconBtn} hover:text-warning`}
        >
          <Undo2 className="h-4 w-4" />
        </button>

        <div className="bg-panel-border mx-1 h-5 w-px shrink-0" />

        {voiceAvailable && (
          <button
            onClick={toggleMic}
            title={micEnabled ? 'Mutar microfone' : 'Ativar microfone'}
            className={`${iconBtn} ${
              micEnabled
                ? 'hover:bg-speaking/20 hover:text-speaking'
                : 'bg-danger/10 text-danger hover:bg-danger hover:text-white'
            }`}
          >
            {micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          </button>
        )}

        <button
          onClick={handleLeave}
          title="Sair da sala"
          className={`${iconBtn} text-text-faint hover:bg-danger/10 hover:text-danger`}
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
