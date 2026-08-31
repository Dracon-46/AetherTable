'use client';

import React from 'react';
import { useUIStore, useGameStore } from '../store/game.store';
import { X, Users, Mic } from 'lucide-react';
import { useVoiceStore } from '../net/voice';

export function PlayersModal() {
  const activeModals = useUIStore((s) => s.activeModals);
  const toggleModal = useUIStore((s) => s.toggleModal);
  const playersMap = useGameStore((s) => s.players);
  const myId = useGameStore((s) => s.mySessionId);
  const speaking = useVoiceStore((s) => s.speaking);

  if (!activeModals.players) return null;

  const players = Object.values(playersMap).sort((a, b) => a.seat - b.seat);

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) toggleModal('players');
      }}
    >
      <div className="modal-entra border-panel-border bg-panel flex max-h-[80dvh] w-full max-w-xl flex-col overflow-hidden rounded-xl border shadow-2xl">
        <div className="border-panel-border flex items-center justify-between border-b px-4 py-4 sm:px-6">
          <h2 className="flex items-center gap-2 text-lg font-bold text-white sm:text-xl">
            <Users className="text-primary h-5 w-5" />
            Jogadores conectados
          </h2>
          <button
            onClick={() => toggleModal('players')}
            className="text-text hover:bg-danger/20 rounded p-2 transition-colors hover:text-white"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-6">
          {players.map((player) => (
            <div
              key={player.id}
              className="border-panel-border bg-table-deep flex items-center gap-3 rounded-lg border p-3 sm:p-4"
            >
              <div className="bg-primary/20 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold">
                {player.name.substring(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-bold text-white">{player.name}</span>
                  {player.id === myId && (
                    <span className="bg-primary/20 text-primary rounded px-2 py-0.5 text-[10px] font-bold uppercase">
                      Você
                    </span>
                  )}
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${player.connected ? 'bg-success' : 'bg-warning'}`}
                    title={player.connected ? 'Conectado' : 'Desconectado'}
                  />
                  {speaking.includes(player.userId) && (
                    <Mic className="text-speaking h-3.5 w-3.5 shrink-0" aria-label="Falando" />
                  )}
                </div>
                <span className="text-text-muted text-xs">
                  Assento {player.seat + 1} · {player.libraryCount} no grimório · {player.handCount}{' '}
                  na mão
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* O botão de expulsar abria um `window.confirm` seguido de um
            `window.alert` dizendo que o recurso não existe. Um diálogo nativo
            para anunciar uma funcionalidade ausente é pior que não ter o botão. */}
        <p className="border-panel-border text-text-faint border-t px-4 py-3 text-center text-[11px] sm:px-6">
          Expulsar jogadores ainda não está disponível no servidor.
        </p>
      </div>
    </div>
  );
}
