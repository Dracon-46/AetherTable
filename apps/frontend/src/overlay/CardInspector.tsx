'use client';

import React from 'react';
import { useUIStore } from '../store/game.store';
import { X } from 'lucide-react';
import { cardImageUrl } from '../canvas/textureCache';

export function CardInspector() {
  const inspectedCardId = useUIStore((s) => s.inspectedCardId);
  const setInspectedCard = useUIStore((s) => s.setInspectedCard);

  // O `useEffect` ficava DEPOIS de `if (!inspectedCardId) return null`. Abrir ou
  // fechar a inspeção mudava a quantidade de hooks executados no mesmo
  // componente e o React derrubava a árvore com "Rendered fewer hooks than
  // expected". Todo hook vem antes de qualquer retorno antecipado.
  React.useEffect(() => {
    if (!inspectedCardId) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInspectedCard(null);
    };
    window.addEventListener('keydown', handleEsc, true);
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [inspectedCardId, setInspectedCard]);

  if (!inspectedCardId) return null;

  return (
    <div
      className="border-panel-border bg-panel/95 pointer-events-auto absolute inset-y-0 right-0 z-40 flex w-[min(20rem,85vw)] flex-col border-l p-4 shadow-2xl backdrop-blur"
      role="dialog"
      aria-label="Inspeção de carta"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-text-muted text-sm font-bold">INSPEÇÃO</h3>
        <button
          onClick={() => setInspectedCard(null)}
          className="text-text-muted hover:bg-danger/20 hover:text-danger rounded p-1 transition-colors"
          aria-label="Fechar inspeção"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto pr-2">
        <div className="border-panel-border bg-table-deep relative flex aspect-[63/88] items-center justify-center overflow-hidden rounded-xl border shadow-lg">
          {/* Rota de imagem do nosso backend, nunca a API REST da Scryfall: a
              API tem limite de 10 req/s por IP e responde por redirect, o que
              fazia a inspeção falhar em silêncio numa mesa cheia. */}
          <img
            src={cardImageUrl(inspectedCardId, 'normal')}
            alt="Carta em inspeção"
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>

        <div className="border-panel-border bg-table-deep mt-4 rounded-lg border p-3">
          <p className="text-text-muted text-center text-xs">
            Pressione{' '}
            <kbd className="border-panel-border bg-panel text-text rounded border px-1 py-0.5">
              Esc
            </kbd>{' '}
            para fechar.
          </p>
        </div>
      </div>
    </div>
  );
}
