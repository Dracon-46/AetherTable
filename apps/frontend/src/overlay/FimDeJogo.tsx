'use client';

/**
 * FimDeJogo.tsx — a mesa contando que alguém saiu, e quem ganhou.
 *
 * ─── POR QUE ISTO PRECISOU EXISTIR ─────────────────────────────────────────
 *
 * O motor nasceu sem condições de derrota (RN01: sandbox, sem regras). Na
 * prática, 21 de dano de comandante era um número que ficava vermelho, veneno
 * chegava a 10 e a partida seguia, e comprar de grimório vazio comprava menos
 * cartas em silêncio. Quem tinha perdido era combinado de viva-voz.
 *
 * Agora o servidor decide, e esta camada é onde a decisão vira algo que o
 * jogador VÊ. Duas telas, com pesos deliberadamente diferentes:
 *
 *   - PARA QUEM SAIU: um aviso próprio, que explica o motivo e some. Não é
 *     modal, e essa é a decisão central deste arquivo — o eliminado continua na
 *     sala, vendo a mesa e conversando (é o que RN01 protegia e que continua
 *     valendo). Uma cortina bloqueante transformaria "você perdeu" em "você foi
 *     expulso da tela", que é justamente o que não se quer.
 *
 *   - PARA A MESA: o fim da partida, quando sobra um. Esse sim ocupa a tela,
 *     porque não há mais partida atrás dele para atrapalhar.
 */

import React, { useEffect, useState } from 'react';
import { Skull, Trophy, X } from 'lucide-react';
import { useGameStore } from '../store/game.store';

const MOTIVO: Record<string, string> = {
  LIFE: 'sua vida chegou a zero',
  POISON: 'você acumulou 10 marcadores de veneno',
  COMMANDER: 'você levou 21 de dano de um mesmo comandante',
  DECKED: 'você tentou comprar de um grimório vazio',
  CONCEDED: 'você desistiu da partida',
};

export function FimDeJogo() {
  const players = useGameStore((s) => s.players);
  const myId = useGameStore((s) => s.mySessionId);
  const phase = useGameStore((s) => s.phase);

  const eu = myId ? players[myId] : undefined;
  const vivos = Object.values(players).filter((p) => !p.eliminated);
  const acabou = phase === 'CLOSING' && Object.keys(players).length > 1 && vivos.length === 1;
  const vencedor = acabou ? vivos[0] : undefined;

  /**
   * O aviso de derrota é dispensável — e precisa ser.
   *
   * `eliminated` é DERIVADO no servidor: se a vida voltar a subir (um `+1`, um
   * `INTENT_UNDO`), o jogador volta e o aviso some sozinho. Guardar o "já
   * fechei" por motivo evita que um vaivém de vida em torno de zero reabra o
   * mesmo aviso a cada ponto.
   */
  const [dispensado, setDispensado] = useState<string | null>(null);
  useEffect(() => {
    if (!eu?.eliminated) setDispensado(null);
  }, [eu?.eliminated]);

  const mostrarDerrota = Boolean(eu?.eliminated) && !acabou && dispensado !== eu?.eliminationReason;

  if (acabou && vencedor) {
    const venci = vencedor.id === myId;
    return (
      <div className="pointer-events-auto fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm">
        <div className="modal-entra border-panel-border bg-panel flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border p-8 text-center shadow-2xl">
          <Trophy className={`h-14 w-14 ${venci ? 'text-warning' : 'text-text-muted'}`} />
          <h1 className="text-2xl font-bold text-white">
            {venci ? 'Você venceu!' : `${vencedor.name} venceu`}
          </h1>
          <p className="text-text-muted text-sm">
            Todos os outros jogadores saíram do jogo. A mesa continua aberta — ninguém é
            desconectado.
          </p>
          <a
            href="/dashboard"
            className="bg-primary hover:bg-primary-hover rounded-lg px-6 py-2.5 text-sm font-bold text-white transition-colors"
          >
            Voltar para a Taverna
          </a>
        </div>
      </div>
    );
  }

  if (!mostrarDerrota || !eu) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[65] flex justify-center px-3">
      <div className="painel-entra border-danger/60 bg-panel/95 pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border p-3 shadow-2xl backdrop-blur">
        <span className="bg-danger/15 text-danger flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
          <Skull className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-text text-sm font-bold">Você saiu do jogo</p>
          <p className="text-text-muted text-xs leading-snug">
            {MOTIVO[eu.eliminationReason] ?? 'você saiu da partida'}. Você continua na sala e vendo
            a mesa.
          </p>
        </div>
        <button
          onClick={() => setDispensado(eu.eliminationReason)}
          className="text-text-muted hover:text-text shrink-0 rounded p-1 transition-colors"
          aria-label="Dispensar aviso"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
