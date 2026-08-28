import React from 'react';
import type { Room } from 'colyseus.js';
import { useUIStore, useGameStore } from '../store/game.store';
import { X, Users, Trash2, Mic, MicOff } from 'lucide-react';
import { useParticipants } from '@livekit/components-react';

interface PlayersModalProps {
  room: Room<any>;
}

export function PlayersModal({ room }: PlayersModalProps) {
  const { activeModals, toggleModal } = useUIStore();
  const playersMap = useGameStore(s => s.players);
  const players = Object.values(playersMap);
  const myId = useGameStore(s => s.mySessionId);
  
  if (!activeModals.players) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-auto">
      <div className="bg-panel border border-panel-border rounded-xl shadow-2xl w-[600px] max-w-[90vw] max-h-[80vh] flex flex-col animate-[fadeIn_0.2s_ease-out]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-panel-border">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="text-primary w-5 h-5" />
            Jogadores Conectados
          </h2>
          <button 
            onClick={() => toggleModal('players')}
            className="p-2 text-text hover:text-white hover:bg-danger/20 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 flex flex-col gap-3">
          {players.map(player => (
            <div key={player.id} className="flex items-center justify-between p-4 bg-table-deep border border-panel-border rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary">
                  {player.name.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">{player.name}</span>
                    {player.id === myId && <span className="text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded font-bold uppercase">Você</span>}
                    <span className={`w-2 h-2 rounded-full ${player.connected ? 'bg-success' : 'bg-warning'}`} title={player.connected ? 'Conectado' : 'Desconectado'} />
                  </div>
                  <span className="text-xs text-text-muted">Cartas: {player.libraryCount} (G) / {player.handCount} (M)</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Aqui poderíamos adicionar ações de microfone (mute para o meu próprio microfone) ou Kick se o usuário tiver admin role, mas num sandbox, todo mundo pode kikar. */}
                {player.id !== myId && (
                  <button 
                    onClick={() => {
                      if (window.confirm(`Você tem certeza que quer remover ${player.name} da sala?`)) {
                        // Não há um intent de kick no servidor ainda, mas podemos enviar um aviso.
                        window.alert('O recurso de banir/expulsar ainda não está integrado no backend.');
                      }
                    }}
                    className="p-2 text-text-faint hover:text-danger hover:bg-danger/20 rounded transition-colors"
                    title="Expulsar Jogador"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
