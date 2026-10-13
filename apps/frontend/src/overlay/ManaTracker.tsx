'use client';

/**
 * ManaTracker.tsx — o pool de mana (W/U/B/R/G/C) de cada jogador.
 *
 * Sem motor de regras (RN01) não existe mana de verdade: este painel é um
 * CONTADOR que o jogador marca e limpa. Mesmo assim ele resolve um problema
 * real — Dark Ritual, Cabal Coffers, Mana Geyser, "o que ainda está flutuando?"
 * — que até aqui se resolvia de cabeça ou num papel ao lado do teclado.
 *
 * Clique soma 1; botão direito (ou Shift+clique) tira 1. O próprio pool é
 * editável; o dos outros só aparece, porque o servidor não aceita alvo nesta
 * intenção — não existe caminho para mexer no pool alheio.
 */

import type { Room } from 'colyseus.js';
import { X, Eraser } from 'lucide-react';
import { CORES_DE_MANA, type CorDeMana } from '@aethertable/shared-types';
import { useGameStore, useUIStore } from '../store/game.store';
import { intents } from '../net/intents';
import type { RoomState } from '../net/schema/RoomState';

/** Cores das bolinhas: a do símbolo de mana, com texto que contraste. */
const ESTILO: Record<CorDeMana, { fundo: string; texto: string; nome: string }> = {
  W: { fundo: '#F8F3D6', texto: '#3B3524', nome: 'Branco' },
  U: { fundo: '#0E68AB', texto: '#FFFFFF', nome: 'Azul' },
  B: { fundo: '#2B2622', texto: '#E7E1D7', nome: 'Preto' },
  R: { fundo: '#D3202A', texto: '#FFFFFF', nome: 'Vermelho' },
  G: { fundo: '#00733E', texto: '#FFFFFF', nome: 'Verde' },
  C: { fundo: '#B8B2AC', texto: '#1F1B18', nome: 'Incolor' },
};

interface ManaTrackerProps {
  room: Room<RoomState>;
}

export function ManaTracker({ room }: ManaTrackerProps) {
  const aberto = useUIStore((s) => s.manaAberto);
  const setAberto = useUIStore((s) => s.setManaAberto);
  const players = useGameStore((s) => s.players);
  const myId = useGameStore((s) => s.mySessionId);

  if (!aberto) return null;

  const meu = players[myId]?.manaPool ?? {};
  const total = Object.values(meu).reduce((a, b) => a + b, 0);
  const outros = Object.values(players)
    .filter((p) => p.id !== myId && Object.values(p.manaPool ?? {}).some((v) => v > 0))
    .sort((a, b) => a.seat - b.seat);

  return (
    <aside
      className="painel-entra border-panel-border bg-panel/95 pointer-events-auto absolute left-2 top-1/2 z-30 flex w-14 -translate-y-1/2 flex-col items-center gap-1.5 rounded-xl border py-2 shadow-xl backdrop-blur"
      aria-label="Rastreador de mana"
    >
      <button
        onClick={() => setAberto(false)}
        className="text-text-faint hover:text-text rounded p-0.5"
        aria-label="Fechar o rastreador de mana"
        title="Fechar (M)"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      {CORES_DE_MANA.map((cor) => {
        const valor = meu[cor] ?? 0;
        const e = ESTILO[cor];
        return (
          <button
            key={cor}
            onClick={(ev) => intents.ajustarMana(room, cor, ev.shiftKey ? -1 : 1)}
            onContextMenu={(ev) => {
              ev.preventDefault();
              intents.ajustarMana(room, cor, -1);
            }}
            className={`flex h-9 w-9 items-center justify-center rounded-full font-mono text-sm font-black shadow transition-transform hover:scale-110 ${
              valor === 0 ? 'opacity-45' : 'ring-2 ring-white/60'
            }`}
            style={{ background: e.fundo, color: e.texto }}
            title={`${e.nome}: ${valor} — clique soma, botão direito tira`}
            aria-label={`${e.nome}: ${valor}`}
          >
            {valor > 0 ? valor : cor}
          </button>
        );
      })}
      <button
        onClick={() => intents.limparMana(room)}
        disabled={total === 0}
        className="text-text-muted hover:text-danger mt-0.5 rounded p-1 disabled:opacity-30"
        aria-label="Esvaziar o pool de mana"
        title="Esvaziar o pool"
      >
        <Eraser className="h-4 w-4" />
      </button>

      {/* O pool dos outros: só leitura, e só de quem tem algo flutuando. */}
      {outros.length > 0 && (
        <div className="border-panel-border mt-1 flex w-full flex-col gap-1 border-t px-1 pt-1.5">
          {outros.map((p) => (
            <div key={p.id} className="flex flex-col items-center" title={p.name}>
              <span className="text-text-faint w-full truncate text-center text-[9px]">
                {p.name}
              </span>
              <div className="flex flex-wrap justify-center gap-0.5">
                {CORES_DE_MANA.filter((c) => (p.manaPool?.[c] ?? 0) > 0).map((c) => (
                  <span
                    key={c}
                    className="rounded px-1 font-mono text-[9px] font-bold"
                    style={{ background: ESTILO[c].fundo, color: ESTILO[c].texto }}
                  >
                    {p.manaPool[c]}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
