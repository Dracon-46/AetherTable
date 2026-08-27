'use client';

/**
 * ActionBar.tsx — Barra de Ações da Mesa (DOC-040 §2).
 * 
 * Atalhos rápidos para as ações mais comuns:
 * comprar, embaralhar, dados, virar tudo, etc.
 */

import React, { useState } from 'react';
import {
  Dices, Shuffle, BookOpen, RefreshCcw, Trash2,
  LogOut, ChevronUp, Repeat, Coins, Ghost
} from 'lucide-react';
import type { Room } from 'colyseus.js';
import { intents } from '../net/intents';
import { useRouter } from 'next/navigation';
import { useUIStore } from '../store/game.store';

interface ActionBarProps {
  room: Room<any>;
}

const DICE_SIDES = [4, 6, 8, 10, 12, 20, 100];

export function ActionBar({ room }: ActionBarProps) {
  const router = useRouter();
  const toggleModal = useUIStore(s => s.toggleModal);
  
  const [showDice, setShowDice] = useState(false);
  const [drawAmount, setDrawAmount] = useState(1);
  const [showDraw, setShowDraw] = useState(false);
  // Só o setter é usado: o resultado do dado chega pelo evento 'dice' e é
  // renderizado pelo log, não por este componente.
  const [, setLastDice] = useState<{ sides: number; result?: number } | null>(null);

  const handleDice = (sides: number) => {
    intents.rollDice(room, sides);
    setShowDice(false);
    setLastDice({ sides });
    // O resultado chegará via evento 'dice' → log
  };

  const handleDraw = () => {
    intents.draw(room, drawAmount);
    setShowDraw(false);
  };

  const handleLeave = () => {
    intents.leave(room);
    room.leave();
    router.push('/dashboard');
  };

  return (
    <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-30">
      <div className="pointer-events-auto flex items-center gap-1 bg-panel/90 backdrop-blur border border-panel-border rounded-xl px-3 py-2 shadow-xl">
        
        {/* Comprar carta */}
        <div className="relative">
          <button
            onClick={() => intents.draw(room, 1)}
            onContextMenu={e => { e.preventDefault(); setShowDraw(!showDraw); }}
            title="Comprar 1 carta (Botão direito para X)"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text hover:text-primary hover:bg-panel-hover rounded-lg transition-colors"
          >
            <BookOpen className="w-4 h-4" />
            Comprar
          </button>
          {showDraw && (
            <div className="absolute top-full left-0 mt-1 bg-panel border border-panel-border rounded-lg p-2 shadow-xl z-10">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={drawAmount}
                  onChange={e => setDrawAmount(Number(e.target.value))}
                  className="w-16 bg-table-deep border border-panel-border text-text text-xs px-2 py-1 rounded"
                />
                <button
                  onClick={handleDraw}
                  className="px-3 py-1 bg-primary text-white text-xs rounded hover:bg-primary-hover"
                >
                  Comprar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Embaralhar */}
        <button
          onClick={() => intents.shuffle(room)}
          title="Embaralhar grimório"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text hover:text-primary hover:bg-panel-hover rounded-lg transition-colors"
        >
          <Shuffle className="w-4 h-4" />
          Embaralhar
        </button>

        {/* Desvirar tudo */}
        <button
          onClick={() => intents.untapAll(room)}
          title="Desvirar todas as cartas (início do turno)"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text hover:text-success hover:bg-panel-hover rounded-lg transition-colors"
        >
          <RefreshCcw className="w-4 h-4" />
          Desvirar
        </button>

        {/* Passar Turno */}
        <button
          onClick={() => intents.passTurn(room)}
          title="Passar o turno"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text hover:text-warning hover:bg-panel-hover rounded-lg transition-colors"
        >
          <ChevronUp className="w-4 h-4" />
          Turno
        </button>

        <div className="w-px h-5 bg-panel-border mx-1" />

        {/* Moeda */}
        <button
          onClick={() => intents.flipCoin(room)}
          title="Girar moeda"
          className="p-2 text-text hover:text-speaking hover:bg-panel-hover rounded-lg transition-colors"
        >
          <Coins className="w-4 h-4" />
        </button>

        {/* Dados */}
        <div className="relative">
          <button
            onClick={() => setShowDice(!showDice)}
            title="Rolar dado"
            className="p-2 text-text hover:text-speaking hover:bg-panel-hover rounded-lg transition-colors"
          >
            <Dices className="w-4 h-4" />
          </button>
          {showDice && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-panel border border-panel-border rounded-xl p-2 shadow-xl z-10">
              <div className="grid grid-cols-4 gap-1">
                {DICE_SIDES.map(s => (
                  <button
                    key={s}
                    onClick={() => handleDice(s)}
                    className="px-2 py-1.5 text-xs text-text bg-panel-hover hover:bg-speaking/20 hover:text-speaking rounded transition-colors font-mono"
                  >
                    D{s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Muligan */}
        <button
          onClick={() => intents.mulligan(room)}
          title="Fazer muligan"
          className="p-2 text-text hover:text-primary hover:bg-panel-hover rounded-lg transition-colors"
        >
          <Repeat className="w-4 h-4" />
        </button>

        {/* Gerar Token */}
        <button
          onClick={() => toggleModal('tokens')}
          title="Gerar Token"
          className="p-2 text-text hover:text-primary hover:bg-panel-hover rounded-lg transition-colors"
        >
          <Ghost className="w-4 h-4" />
        </button>

        {/* Limpar Tokens */}
        <button
          onClick={() => intents.clearTokens(room)}
          title="Remover todos os tokens"
          className="p-2 text-text hover:text-danger hover:bg-panel-hover rounded-lg transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>

        <div className="w-px h-5 bg-panel-border mx-1" />

        {/* Sair */}
        <button
          onClick={handleLeave}
          title="Sair da sala"
          className="p-2 text-text-faint hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
