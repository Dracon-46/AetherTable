'use client';

/**
 * LifePanel.tsx — Painel de Vida e Contadores do Jogador (DOC-003 F11).
 * Overlay da Camada 2 — pointer-events apenas nos elementos interativos.
 */

import React, { useState } from 'react';
import { Heart, Skull, Zap, Star, Shield, Crown } from 'lucide-react';
import type { Room } from 'colyseus.js';
import { useGameStore, type PlayerData } from '../store/game.store';
import { intents } from '../net/intents';

interface LifePanelProps {
  room: Room<any>;
}

function PlayerCard({ player, room, isMe }: { player: PlayerData; room: Room<any>; isMe: boolean }) {
  const [editing, setEditing] = useState(false);
  const [lifeInput, setLifeInput] = useState(String(player.life));

  const handleLifeWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1 : -1;
    intents.setLife(room, delta);
  };

  const handleLifeConfirm = () => {
    const v = parseInt(lifeInput);
    if (!isNaN(v)) intents.setLife(room, undefined, v);
    setEditing(false);
  };

  const lifePct = Math.max(0, Math.min(100, (player.life / 40) * 100));
  const lifeDanger = player.life <= 10;
  const lifeCritical = player.life <= 5;

  return (
    <div
      className={`relative bg-panel/90 backdrop-blur border rounded-xl p-3 transition-all ${
        !player.connected ? 'border-warning/50 opacity-70' : 
        player.conceded ? 'border-danger/50 opacity-60' :
        'border-panel-border'
      }`}
      style={{ minWidth: 160 }}
    >
      {/* Barra de vida */}
      <div className="absolute bottom-0 left-0 h-0.5 rounded-b-xl transition-all duration-300"
        style={{
          width: `${lifePct}%`,
          background: lifeCritical ? '#EF4444' : lifeDanger ? '#F59E0B' : '#22C55E'
        }}
      />

      {/* Nome e status */}
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${player.connected ? 'bg-success' : 'bg-warning'}`} />
        <span className="text-xs font-bold text-text truncate">{player.name}</span>
        {/* Os ícones do lucide-react não aceitam `title`: o tooltip e o rótulo
            acessível ficam no <span> que os envolve. */}
        {player.isMonarch && (
          <span title="Monarca" role="img" aria-label="Monarca" className="flex-shrink-0">
            <Crown className="w-3 h-3 text-warning" aria-hidden="true" />
          </span>
        )}
        {player.hasInitiative && (
          <span title="Iniciativa" role="img" aria-label="Iniciativa" className="flex-shrink-0">
            <Shield className="w-3 h-3 text-primary" aria-hidden="true" />
          </span>
        )}
        {player.conceded && (
          <span title="Desistiu" role="img" aria-label="Desistiu" className="flex-shrink-0">
            <Skull className="w-3 h-3 text-danger" aria-hidden="true" />
          </span>
        )}
      </div>

      {/* Vida — só editável se for o próprio jogador */}
      <div
        className="flex items-center gap-2 cursor-pointer select-none"
        onWheel={isMe ? handleLifeWheel : undefined}
        onClick={isMe ? () => { setEditing(true); setLifeInput(String(player.life)); } : undefined}
      >
        <Heart className={`w-4 h-4 flex-shrink-0 ${lifeCritical ? 'text-danger' : lifeDanger ? 'text-warning' : 'text-success'}`} />
        {editing && isMe ? (
          <input
            autoFocus
            type="number"
            value={lifeInput}
            onChange={e => setLifeInput(e.target.value)}
            onBlur={handleLifeConfirm}
            onKeyDown={e => { if (e.key === 'Enter') handleLifeConfirm(); if (e.key === 'Escape') setEditing(false); }}
            className="w-16 bg-transparent border-b border-primary text-primary font-mono text-2xl font-bold outline-none"
          />
        ) : (
          <span className={`font-mono text-2xl font-bold ${lifeCritical ? 'text-danger' : 'text-text'}`}>
            {player.life}
          </span>
        )}
      </div>

      {/* Botões +1 / -1 */}
      {isMe && (
        <div className="flex gap-1 mt-2">
          <button
            onClick={() => intents.setLife(room, -1)}
            className="flex-1 py-1 text-xs bg-danger/20 text-danger hover:bg-danger/40 rounded transition-colors"
          >-1</button>
          <button
            onClick={() => intents.setLife(room, 1)}
            className="flex-1 py-1 text-xs bg-success/20 text-success hover:bg-success/40 rounded transition-colors"
          >+1</button>
        </div>
      )}

      {/* Contadores de veneno / energia / experiência */}
      <div className="flex gap-2 mt-2 text-xs">
        {player.poison > 0 && (
          <span className="flex items-center gap-0.5 text-warning">
            ☠ {player.poison}
          </span>
        )}
        {player.energy > 0 && (
          <span className="flex items-center gap-0.5 text-primary">
            <Zap className="w-3 h-3" />{player.energy}
          </span>
        )}
        {player.experience > 0 && (
          <span className="flex items-center gap-0.5 text-text-muted">
            <Star className="w-3 h-3" />{player.experience}
          </span>
        )}
      </div>

      {/* Grimório / Mão */}
      <div className="flex gap-2 mt-1 text-[10px] text-text-faint">
        <span>📚 {player.libraryCount}</span>
        <span>🃏 {player.handCount}</span>
      </div>
    </div>
  );
}

export function LifePanel({ room }: LifePanelProps) {
  const players = useGameStore(s => Object.values(s.players));
  const myId = useGameStore(s => s.mySessionId);

  return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex justify-center gap-3 p-3 z-30">
      {players.map(player => (
        <div key={player.id} className="pointer-events-auto">
          <PlayerCard player={player} room={room} isMe={player.id === myId} />
        </div>
      ))}
    </div>
  );
}
