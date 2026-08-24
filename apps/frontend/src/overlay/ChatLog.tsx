'use client';

/**
 * ChatLog.tsx — Log de ações + chat mesclado (DOC-003 F15).
 * 
 * O log é a memória compartilhada da partida (DOC-041 §1.4).
 * Logs NUNCA revelam identidade de carta oculta.
 */

import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, Minimize2, ChevronDown } from 'lucide-react';
import type { Room } from 'colyseus.js';
import { useGameStore } from '../store/game.store';
import { intents } from '../net/intents';

const LOG_TYPE_COLORS: Record<string, string> = {
  DRAW: 'text-primary',
  PLAY: 'text-success',
  ZONE_CHANGE: 'text-text-muted',
  ZONE_CHANGE_HIDDEN: 'text-text-faint',
  SHUFFLE: 'text-text-muted',
  PEEK: 'text-warning',
  SEARCH: 'text-warning',
  TAP: 'text-text-muted',
  UNTAP: 'text-text-muted',
  COUNTER: 'text-success',
  LIFE: 'text-danger',
  CMD_DAMAGE: 'text-danger',
  DICE: 'text-speaking',
  TOKEN: 'text-success',
  SYSTEM: 'text-text-faint',
  CHAT: 'text-text',
};

interface ChatLogProps {
  room: Room<any>;
}

export function ChatLog({ room }: ChatLogProps) {
  const log = useGameStore(s => s.log);
  const players = useGameStore(s => s.players);
  const myId = useGameStore(s => s.mySessionId);
  const [collapsed, setCollapsed] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'CHAT' | 'ACTION'>('ALL');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll ao fundo ao receber nova mensagem
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [log.length]);

  const filtered = log.filter(e => {
    if (filter === 'CHAT') return e.type === 'CHAT';
    if (filter === 'ACTION') return e.type !== 'CHAT';
    return true;
  });

  const handleSendChat = () => {
    const text = chatInput.trim();
    if (!text || text.length > 500) return;
    intents.chat(room, text);
    setChatInput('');
  };

  const getPlayerName = (actorId: string) => {
    return players[actorId]?.name ?? actorId.slice(0, 6);
  };

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div
      className="pointer-events-none absolute right-3 top-16 z-30 flex flex-col"
      style={{ width: 280 }}
    >
      {/* Header do chat */}
      <div className="pointer-events-auto flex items-center justify-between bg-panel/90 backdrop-blur border border-panel-border rounded-t-xl px-3 py-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-text-muted" />
          <span className="text-xs font-bold text-text">Log & Chat</span>
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-text-muted hover:text-text transition-colors"
        >
          {collapsed ? <ChevronDown className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Filtros */}
          <div className="pointer-events-auto flex bg-panel/90 backdrop-blur border-x border-panel-border">
            {(['ALL', 'ACTION', 'CHAT'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 py-1 text-[10px] font-bold uppercase transition-colors ${
                  filter === f ? 'text-primary border-b border-primary' : 'text-text-faint hover:text-text-muted'
                }`}
              >
                {f === 'ALL' ? 'Todos' : f === 'ACTION' ? 'Ações' : 'Chat'}
              </button>
            ))}
          </div>

          {/* Lista de entradas */}
          <div
            ref={scrollRef}
            className="pointer-events-auto flex-1 bg-panel/80 backdrop-blur border-x border-panel-border overflow-y-auto"
            style={{ maxHeight: 300 }}
          >
            {filtered.length === 0 ? (
              <p className="text-[10px] text-text-faint text-center py-6">Nenhuma ação ainda...</p>
            ) : (
              <div className="p-2 space-y-1">
                {filtered.map(entry => (
                  <div key={entry.id} className="text-[11px] leading-relaxed">
                    {entry.type === 'CHAT' ? (
                      <span>
                        <span className={`font-bold ${entry.actorId === myId ? 'text-primary' : 'text-success'}`}>
                          {getPlayerName(entry.actorId)}:{' '}
                        </span>
                        <span className="text-text">{entry.text}</span>
                      </span>
                    ) : (
                      <span>
                        <span className="text-text-faint">[{formatTimestamp(entry.timestamp)}] </span>
                        <span className={LOG_TYPE_COLORS[entry.type] ?? 'text-text-muted'}>{entry.text}</span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Input de chat */}
          <div className="pointer-events-auto flex bg-panel/90 backdrop-blur border border-panel-border rounded-b-xl overflow-hidden">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSendChat(); }}
              placeholder="Diga algo..."
              maxLength={500}
              className="flex-1 bg-transparent text-xs text-text px-3 py-2 outline-none placeholder-text-faint"
            />
            <button
              onClick={handleSendChat}
              className="px-3 py-2 text-primary hover:text-primary-hover transition-colors text-xs font-bold"
            >
              →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
