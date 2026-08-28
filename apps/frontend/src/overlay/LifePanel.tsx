'use client';

/**
 * LifePanel.tsx — Painel de Vida e Contadores do Jogador (DOC-003 F11).
 * Overlay da Camada 2 — pointer-events apenas nos elementos interativos.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Heart, Skull, Zap, Star, Shield, Crown, Settings } from 'lucide-react';
import type { Room } from 'colyseus.js';
import { useGameStore, type PlayerData } from '../store/game.store';
import { intents } from '../net/intents';

interface LifePanelProps {
  room: Room<any>;
}

import { useParticipants } from '@livekit/components-react';

function PlayerCard({ player, room, isMe }: { player: PlayerData; room: Room<any>; isMe: boolean }) {
  const [editing, setEditing] = useState(false);
  const [lifeInput, setLifeInput] = useState(String(player.life));
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Integração com LiveKit (Voz)
  let isSpeaking = false;
  try {
    const participants = useParticipants();
    const participant = participants.find(p => p.identity === player.userId);
    isSpeaking = participant?.isSpeaking || false;
  } catch (e) {
    // Caso não esteja dentro do LiveKitRoom ainda
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    }
    if (showMenu) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

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
  
  const allPlayers = Object.values(useGameStore(s => s.players));
  const opponents = allPlayers.filter(p => p.id !== player.id);

  return (
    <div
      className={`relative bg-panel/90 backdrop-blur border rounded-xl p-3 transition-all ${
        isSpeaking ? 'border-warning shadow-[0_0_15px_rgba(245,158,11,0.6)] scale-[1.02]' :
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
      <div className="flex items-center justify-between mb-2 relative">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${player.connected ? 'bg-success' : 'bg-warning'}`} />
          <span className="text-xs font-bold text-text truncate max-w-[80px]">{player.name}</span>
          
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

        {/* Menu de Status para o jogador atual */}
        {isMe && (
          <div ref={menuRef} className="relative">
            <button 
              onClick={() => setShowMenu(!showMenu)}
              className="p-1 text-text-muted hover:text-white transition-colors rounded"
            >
              <Settings className="w-4 h-4" />
            </button>
            
            {showMenu && (
              <div className="absolute top-full right-0 mt-1 w-48 bg-panel border border-panel-border rounded-lg shadow-2xl p-2 z-50 flex flex-col gap-2">
                <span className="text-[10px] uppercase font-bold text-text-muted pb-1 border-b border-panel-border">Status do Jogador</span>
                
                {/* Designações */}
                <div className="flex gap-2 mb-1">
                  <button onClick={() => { intents.toggleDesignation(room, 'MONARCH'); setShowMenu(false); }} className={`flex-1 flex flex-col items-center justify-center p-2 rounded text-[10px] font-bold border transition-colors ${player.isMonarch ? 'bg-warning/20 border-warning text-warning' : 'bg-table-deep border-panel-border hover:bg-panel-hover text-text-muted'}`}>
                    <Crown className="w-4 h-4 mb-1" />
                    Monarca
                  </button>
                  <button onClick={() => { intents.toggleDesignation(room, 'INITIATIVE'); setShowMenu(false); }} className={`flex-1 flex flex-col items-center justify-center p-2 rounded text-[10px] font-bold border transition-colors ${player.hasInitiative ? 'bg-primary/20 border-primary text-primary' : 'bg-table-deep border-panel-border hover:bg-panel-hover text-text-muted'}`}>
                    <Shield className="w-4 h-4 mb-1" />
                    Iniciativa
                  </button>
                </div>

                {/* Contadores */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs bg-table-deep p-1 rounded">
                    <span className="flex items-center gap-1 text-warning"><span className="text-[10px]">☠</span> Veneno</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => intents.addPlayerCounter(room, 'poison', -1)} className="text-danger hover:text-white px-1">-</button>
                      <span className="font-mono w-3 text-center">{player.poison}</span>
                      <button onClick={() => intents.addPlayerCounter(room, 'poison', 1)} className="text-success hover:text-white px-1">+</button>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between text-xs bg-table-deep p-1 rounded">
                    <span className="flex items-center gap-1 text-primary"><Zap className="w-3 h-3"/> Energia</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => intents.addPlayerCounter(room, 'energy', -1)} className="text-danger hover:text-white px-1">-</button>
                      <span className="font-mono w-3 text-center">{player.energy}</span>
                      <button onClick={() => intents.addPlayerCounter(room, 'energy', 1)} className="text-success hover:text-white px-1">+</button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs bg-table-deep p-1 rounded">
                    <span className="flex items-center gap-1 text-text-muted"><Star className="w-3 h-3"/> Exp</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => intents.addPlayerCounter(room, 'experience', -1)} className="text-danger hover:text-white px-1">-</button>
                      <span className="font-mono w-3 text-center">{player.experience}</span>
                      <button onClick={() => intents.addPlayerCounter(room, 'experience', 1)} className="text-success hover:text-white px-1">+</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
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
          <span className="flex items-center gap-0.5 text-warning" title="Veneno">
            ☠ {player.poison}
          </span>
        )}
        {player.energy > 0 && (
          <span className="flex items-center gap-0.5 text-primary" title="Energia">
            <Zap className="w-3 h-3" />{player.energy}
          </span>
        )}
        {player.experience > 0 && (
          <span className="flex items-center gap-0.5 text-text-muted" title="Experiência">
            <Star className="w-3 h-3" />{player.experience}
          </span>
        )}
      </div>

      {/* Dano de Comandante */}
      {opponents.length > 0 && (
        <div className="mt-3 border-t border-panel-border pt-2 space-y-1">
          <span className="text-[10px] uppercase font-bold text-text-muted flex items-center gap-1">
            <Shield className="w-3 h-3" /> Dano de Comandante
          </span>
          <div className="flex flex-col gap-1">
            {opponents.map(opp => {
              // commanderDamage pode ser undefined logo quando entra na sala
              const dmg = player.commanderDamage ? (player.commanderDamage[opp.id] || 0) : 0;
              return (
                <div key={opp.id} className="flex justify-between items-center text-xs bg-table-deep/50 px-2 py-1 rounded border border-panel-border">
                  <span className="truncate text-text-faint max-w-[70px]" title={opp.name}>{opp.name}</span>
                  <div className="flex items-center gap-1 font-mono">
                    {isMe && (
                      <button onClick={() => intents.setCommanderDamage(room, opp.id, -1)} className="text-danger hover:bg-danger/20 w-4 text-center rounded transition-colors">-</button>
                    )}
                    <span className={`w-5 text-center inline-block ${dmg >= 21 ? 'text-danger font-bold' : 'text-warning'}`}>{dmg}</span>
                    {isMe && (
                      <button onClick={() => intents.setCommanderDamage(room, opp.id, 1)} className="text-success hover:bg-success/20 w-4 text-center rounded transition-colors">+</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Grimório / Mão */}
      <div className="flex justify-between mt-2 text-[10px] text-text-faint bg-table-deep px-2 py-1 rounded">
        <span>📚 {player.libraryCount}</span>
        <span>🃏 {player.handCount}</span>
      </div>
    </div>
  );
}

export function LifePanel({ room }: LifePanelProps) {
  const playersMap = useGameStore(s => s.players);
  const players = Object.values(playersMap);
  const myId = useGameStore(s => s.mySessionId);

  return (
    <div className="pointer-events-none absolute top-20 left-4 flex flex-col gap-3 z-30 max-h-[80vh] overflow-y-auto custom-scrollbar pr-2 pb-4">
      {players.map(player => (
        <div key={player.id} className="pointer-events-auto">
          <PlayerCard player={player} room={room} isMe={player.id === myId} />
        </div>
      ))}
    </div>
  );
}
