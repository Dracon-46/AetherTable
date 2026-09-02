'use client';

/**
 * CameraControls.tsx — Seletor de foco da mesa.
 *
 * Estava em `top-4 right-4` com `z-50` e `min-w-[200px]`: cobria a barra de
 * ações (z-30) e o cabeçalho do ChatLog (que começa em `top-16`, logo abaixo).
 * Agora é um botão compacto ancorado no topo direito com `z-20`, e o menu abre
 * dentro dos limites da tela.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useUIStore, useGameStore } from '../store/game.store';
import { Video, User, Users, ChevronDown } from 'lucide-react';

export function CameraControls() {
  const boardView = useUIStore((s) => s.boardView);
  const setBoardView = useUIStore((s) => s.setBoardView);
  const players = useGameStore((s) => s.players);
  const mySessionId = useGameStore((s) => s.mySessionId);

  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isOpen]);

  const opponents = Object.values(players).filter((p) => p.id !== mySessionId);

  /**
   * UM ALVO QUE SUMIU VOLTA PARA "TODOS".
   *
   * `boardView` guarda o sessionId do oponente escolhido. Quando essa pessoa
   * sai da sala — ou quando a partida é outra e os sessionIds mudaram — a
   * escolha aponta para um assento que não existe. O tabuleiro caía na própria
   * mesa e o seletor exibia "Mesa", um rótulo que não é nenhuma das opções:
   * escolher outro oponente parecia não fazer efeito, porque a tela já estava
   * no formato de faixa única.
   */
  useEffect(() => {
    if (boardView === 'ALL' || boardView === 'ME') return;
    if (players[boardView]) return;
    setBoardView('ALL');
  }, [boardView, players, setBoardView]);

  const label =
    boardView === 'ALL'
      ? 'Todos'
      : boardView === 'ME'
        ? 'Minha mesa'
        : (players[boardView]?.name ?? 'Todos');

  const item = (ativo: boolean) =>
    `w-full px-3 py-2.5 text-left text-sm transition-colors ${
      ativo ? 'bg-primary/20 font-bold text-primary' : 'text-text hover:bg-panel-hover'
    }`;

  return (
    // Sem `absolute`: quem posiciona e a fileira do topo direito, em
    // `play/[roomId]/page.tsx`. Ancorar aqui fazia a Camera e o menu da Mesa
    // disputarem o mesmo canto.
    <div ref={ref} className="pointer-events-auto relative">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="border-panel-border bg-panel/90 text-text hover:border-primary hover:text-primary flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium shadow-lg backdrop-blur transition-colors"
        title="Foco da câmera"
      >
        <Video className="text-primary h-4 w-4 shrink-0" />
        <span className="max-w-[7rem] truncate">{label}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="painel-entra border-panel-border bg-panel absolute right-0 top-full mt-1 flex w-56 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-lg border shadow-xl">
          <button
            onClick={() => {
              setBoardView('ALL');
              setIsOpen(false);
            }}
            className={item(boardView === 'ALL')}
          >
            <span className="flex items-center gap-2">
              <Users className="h-4 w-4" /> Visão geral (todos)
            </span>
          </button>
          <button
            onClick={() => {
              setBoardView('ME');
              setIsOpen(false);
            }}
            className={item(boardView === 'ME')}
          >
            <span className="flex items-center gap-2">
              <User className="h-4 w-4" /> Minha mesa
            </span>
          </button>

          {opponents.length > 0 && (
            <div className="border-panel-border border-t py-1">
              <span className="text-text-muted px-3 py-1 text-[10px] font-bold uppercase">
                Oponentes
              </span>
              {opponents.map((opp) => (
                <button
                  key={opp.id}
                  onClick={() => {
                    setBoardView(opp.id);
                    setIsOpen(false);
                  }}
                  className={`${item(boardView === opp.id)} flex items-center gap-2`}
                >
                  <span className="bg-danger h-2 w-2 shrink-0 rounded-full" />
                  <span className="truncate">Mesa de {opp.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
