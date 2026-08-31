'use client';

/**
 * RoomLobby.tsx — tela de gerenciamento da sala, ANTES de a partida começar.
 *
 * Esta tela não existia. O fluxo era: dashboard → `POST /matches/create` →
 * redirect direto para `/play/:code`, e o servidor marcava
 * `state.phase = 'PLAYING'` no primeiro `onJoin`. Não havia momento algum para
 * conferir quem entrou, compartilhar o código ou decidir começar — a partida
 * simplesmente já estava rodando quando a tela abria.
 *
 * Agora a sala nasce em `WAITING`. Quem criou (assento 0) é o anfitrião e
 * dispara `INTENT_START_MATCH`; os demais veem a lista de assentos preenchendo.
 */

import React, { useState } from 'react';
import type { Room } from 'colyseus.js';
import { Check, Copy, Crown, DoorOpen, Loader2, Play, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '../store/game.store';
import { intents } from '../net/intents';
import type { RoomState } from '../net/schema/RoomState';

interface RoomLobbyProps {
  room: Room<RoomState>;
  /** Lugares contratados na criação da sala (vem da querystring). */
  maxClients?: number;
  gameType?: string;
}

export function RoomLobby({ room, maxClients, gameType }: RoomLobbyProps) {
  const router = useRouter();
  const phase = useGameStore((s) => s.phase);
  const playersMap = useGameStore((s) => s.players);
  const myId = useGameStore((s) => s.mySessionId);
  const roomId = useGameStore((s) => s.roomId);

  const [copiado, setCopiado] = useState(false);
  const [iniciando, setIniciando] = useState(false);

  if (phase !== 'WAITING') return null;

  const players = Object.values(playersMap).sort((a, b) => a.seat - b.seat);
  const eu = myId ? playersMap[myId] : undefined;
  const souAnfitriao = eu?.seat === 0;
  const lugares = Math.max(maxClients ?? players.length, players.length, 2);
  const codigo = room.state?.roomCode || roomId;

  const copiarCodigo = async () => {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* navegador sem permissão de clipboard — o código está visível na tela */
    }
  };

  const sair = () => {
    room.leave();
    router.push('/dashboard');
  };

  return (
    <div className="z-60 bg-table-deep/95 pointer-events-auto fixed inset-0 flex items-start justify-center overflow-y-auto p-4 backdrop-blur-sm sm:items-center">
      <div className="modal-entra border-panel-border bg-panel my-auto w-full max-w-2xl rounded-2xl border shadow-2xl">
        {/* Cabeçalho */}
        <div className="border-panel-border border-b p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-text text-xl font-bold sm:text-2xl">Sala de espera</h1>
              <p className="text-text-muted mt-1 text-sm">
                A partida começa quando o anfitrião iniciar.
              </p>
            </div>

            <button
              onClick={copiarCodigo}
              className="border-panel-border bg-table-deep hover:border-primary flex shrink-0 items-center gap-3 rounded-lg border px-4 py-2.5 transition-colors"
              title="Copiar código da sala"
            >
              <div className="text-left">
                <span className="text-text-muted block text-[10px] font-bold uppercase">
                  Código
                </span>
                <span className="text-primary block font-mono text-lg font-bold tracking-widest">
                  {codigo}
                </span>
              </div>
              {copiado ? (
                <Check className="text-success h-4 w-4" />
              ) : (
                <Copy className="text-text-muted h-4 w-4" />
              )}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="border-panel-border bg-table-deep text-text-muted rounded-full border px-3 py-1">
              Formato: <span className="text-text">{gameType ?? 'Commander'}</span>
            </span>
            <span className="border-panel-border bg-table-deep text-text-muted rounded-full border px-3 py-1">
              Lugares:{' '}
              <span className="text-text">
                {players.length}/{lugares}
              </span>
            </span>
          </div>
        </div>

        {/* Assentos */}
        <div className="p-5 sm:p-6">
          <h2 className="text-text-muted mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <Users className="h-4 w-4" />
            Jogadores
          </h2>

          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Array.from({ length: lugares }).map((_, assento) => {
              const p = players.find((pl) => pl.seat === assento);
              return (
                <li
                  key={assento}
                  className={`flex items-center gap-3 rounded-lg border p-3 ${
                    p
                      ? 'border-panel-border bg-table-deep'
                      : 'border-panel-border/60 border-dashed bg-transparent'
                  }`}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      p ? 'bg-primary/20 text-primary' : 'bg-panel text-text-faint'
                    }`}
                  >
                    {p ? p.name.substring(0, 2).toUpperCase() : assento + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    {p ? (
                      <>
                        <div className="flex items-center gap-1.5">
                          <span className="text-text truncate text-sm font-medium">{p.name}</span>
                          {p.seat === 0 && (
                            <Crown
                              className="text-warning h-3.5 w-3.5 shrink-0"
                              aria-label="Anfitrião"
                            />
                          )}
                          {p.id === myId && (
                            <span className="bg-primary/20 text-primary shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase">
                              Você
                            </span>
                          )}
                        </div>
                        <span className="text-text-faint text-xs">
                          {p.libraryCount > 0
                            ? `Grimório pronto (${p.libraryCount} cartas)`
                            : 'Carregando grimório…'}
                        </span>
                      </>
                    ) : (
                      <span className="text-text-faint text-sm">Aguardando jogador…</span>
                    )}
                  </div>
                  {p && !p.connected && (
                    <span className="text-warning shrink-0 text-[10px] font-bold uppercase">
                      offline
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Ações */}
        <div className="border-panel-border flex flex-col gap-3 border-t p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <button
            onClick={sair}
            className="text-text-muted hover:text-danger flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
          >
            <DoorOpen className="h-4 w-4" />
            Sair da sala
          </button>

          {souAnfitriao ? (
            <button
              onClick={() => {
                setIniciando(true);
                intents.startMatch(room);
              }}
              disabled={iniciando}
              className="bg-primary hover:bg-primary-hover flex items-center justify-center gap-2 rounded-lg px-6 py-3 text-sm font-bold text-white shadow-lg transition-all active:scale-95 disabled:opacity-60"
            >
              {iniciando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Iniciar partida
            </button>
          ) : (
            <span className="text-text-muted flex items-center justify-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Aguardando o anfitrião iniciar…
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
