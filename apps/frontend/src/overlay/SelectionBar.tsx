'use client';

/**
 * SelectionBar.tsx — ações em lote sobre a seleção múltipla (DOC-036 item 70).
 *
 * `selectedCardIds` existia no store desde o início e nada o preenchia nem o
 * consumia: não havia como selecionar mais de uma permanente, nem agir sobre
 * várias. Numa mesa de Commander com trinta criaturas, virar uma por uma é
 * inviável — e trinta mensagens seguidas estourariam o limite de 30 intenções
 * por segundo, que o servidor descarta com `RATE_LIMITED`.
 *
 * Daí `INTENT_BATCH_UPDATE` e `INTENT_BATCH_COUNTER`: uma mensagem para a
 * seleção inteira.
 */

import React from 'react';
import type { Room } from 'colyseus.js';
import { RotateCcw, Layers, Plus, Minus, X, Skull, Hand } from 'lucide-react';
import { useGameStore, useUIStore } from '../store/game.store';
import { intents } from '../net/intents';
import type { RoomState } from '../net/schema/RoomState';

interface SelectionBarProps {
  room: Room<RoomState>;
}

export function SelectionBar({ room }: SelectionBarProps) {
  const selecionadas = useUIStore((s) => s.selectedCardIds);
  const limpar = useUIStore((s) => s.clearSelection);
  const cards = useGameStore((s) => s.cards);

  if (selecionadas.length < 2) return null;

  const validas = selecionadas.filter((id) => cards[id]);
  if (validas.length < 2) return null;

  const todasViradas = validas.every((id) => cards[id]?.isTapped);

  const botao =
    'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text transition-colors hover:bg-panel-hover';

  return (
    // No mobile fica ACIMA do log recolhido; no desktop, dentro da faixa livre
    // entre o painel de vida (esquerda) e o log (direita) — centralizar na tela
    // inteira fazia a barra passar por baixo da coluna de vida.
    <div className="pointer-events-none absolute inset-x-0 bottom-28 z-30 flex justify-center px-2 sm:bottom-20 sm:pl-[13rem] sm:pr-[19rem]">
      <div className="painel-entra no-scrollbar border-primary/50 bg-panel/95 pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border px-2 py-2 shadow-xl backdrop-blur">
        <span className="bg-primary/20 text-primary shrink-0 rounded px-2 py-1 text-[10px] font-bold uppercase">
          {validas.length} selecionadas
        </span>

        <button
          onClick={() => intents.batchUpdate(room, validas, 'isTapped', !todasViradas)}
          className={`${botao} hover:text-primary`}
        >
          <RotateCcw className="h-4 w-4" />
          {todasViradas ? 'Desvirar' : 'Virar'}
        </button>

        <button
          onClick={() => intents.batchCounter(room, validas, '+1/+1', 1)}
          className={`${botao} hover:text-success`}
        >
          <Plus className="h-4 w-4" />
          +1/+1
        </button>

        <button
          onClick={() => intents.batchCounter(room, validas, '-1/-1', 1)}
          className={`${botao} hover:text-danger`}
        >
          <Minus className="h-4 w-4" />
          −1/−1
        </button>

        <button
          onClick={() => intents.batchUpdate(room, validas, 'faceDown', true)}
          className={`${botao} hover:text-warning`}
        >
          <Layers className="h-4 w-4" />
          Face ↓
        </button>

        <div className="bg-panel-border mx-1 h-5 w-px shrink-0" />

        {/* Mover em lote não tem intenção própria: uma troca de zona por carta
            é o caminho correto, e 2–60 cartas cabem no limite de 30/s se o
            jogador não repetir o gesto. */}
        <button
          onClick={() => {
            validas.forEach((id) => intents.changeZone(room, id, 'GRAVEYARD'));
            limpar();
          }}
          className={`${botao} hover:text-danger`}
        >
          <Skull className="h-4 w-4" />
          Cemitério
        </button>

        <button
          onClick={() => {
            validas.forEach((id) => intents.changeZone(room, id, 'HAND'));
            limpar();
          }}
          className={`${botao} hover:text-primary`}
        >
          <Hand className="h-4 w-4" />
          Mão
        </button>

        <button
          onClick={limpar}
          className={`${botao} text-text-faint hover:text-danger`}
          aria-label="Limpar seleção"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
