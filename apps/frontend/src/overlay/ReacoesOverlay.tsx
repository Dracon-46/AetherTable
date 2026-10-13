'use client';

/**
 * ReacoesOverlay.tsx — os balões de reação da mesa.
 *
 * A reação é um gesto, não uma jogada: chega por `broadcast`, vira um balão
 * com o nome de quem reagiu e some em três segundos. Nada fica no log — o log
 * é a auditoria da partida, e um "👍" lá no meio empurraria para cima a linha
 * que alguém estava procurando.
 *
 * Os balões empilham no alto, ao centro, e não ao lado do assento de cada um:
 * a posição do assento muda com o estilo de mesa (focada, empilhada, grade) e
 * com a câmera, e um balão que aponta para o lugar errado é pior que um balão
 * que diz o nome.
 */

import { useEffect } from 'react';
import type { Reacao } from '@aethertable/shared-types';
import { useGameStore, useTableStore } from '../store/game.store';
import { ROTULO_DA_REACAO } from './reacoes';

export function ReacoesOverlay() {
  const reacoes = useTableStore((s) => s.reacoes);
  const expirar = useTableStore((s) => s.expirarReacoes);
  const players = useGameStore((s) => s.players);
  const myId = useGameStore((s) => s.mySessionId);

  // Um relógio só enquanto houver balão na tela: parado, ele não custa nada.
  useEffect(() => {
    if (reacoes.length === 0) return;
    const t = setInterval(expirar, 400);
    return () => clearInterval(t);
  }, [reacoes.length, expirar]);

  if (reacoes.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-16 z-40 flex flex-col items-center gap-1.5"
      role="status"
      aria-live="polite"
    >
      {reacoes.map((r) => {
        const meta = ROTULO_DA_REACAO[r.tipo as Reacao];
        if (!meta) return null;
        const nome = r.actorId === myId ? 'Você' : (players[r.actorId]?.name ?? 'Alguém');
        return (
          <div
            key={r.id}
            className="animate-sorteio-entrada border-panel-border bg-panel/90 flex items-center gap-2 rounded-full border px-3 py-1 shadow-lg backdrop-blur"
          >
            <span className="text-2xl leading-none" aria-hidden>
              {meta.emoji}
            </span>
            <span className="text-text text-xs font-semibold">
              {nome} <span className="text-text-muted font-normal">· {meta.rotulo}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
