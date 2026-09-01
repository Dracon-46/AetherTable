'use client';

/**
 * CardHoverPreview.tsx — prévia da carta sob o cursor.
 *
 * Numa mesa de EDH a carta desenhada tem ~120px de largura: o texto é
 * ilegível, e mesmo a arte fica ambígua entre impressões. Todo VTT sério
 * resolve isso com uma prévia grande no canto — sem ela, a única forma de ler
 * uma carta era Alt-clicar e abrir a gaveta de inspeção, um gesto por carta.
 *
 * A prévia mostra a face VISÍVEL (uma carta transformada mostra o verso) e o
 * texto de regras vindo do catálogo, não da imagem.
 */

import React from 'react';
import { useGameStore, useUIStore } from '../store/game.store';
import { useCardMeta } from '../cards/catalog';
import { cardImageUrl } from '../canvas/textureCache';

export function CardHoverPreview() {
  const hoveredCardId = useUIStore((s) => s.hoveredCardId);
  const inspectedCardId = useUIStore((s) => s.inspectedCardId);
  const cards = useGameStore((s) => s.cards);

  const card = hoveredCardId ? cards[hoveredCardId] : undefined;
  const visivel = Boolean(card?.scryfallId) && !card?.faceDown;
  const meta = useCardMeta(visivel ? card?.scryfallId : null);

  // A gaveta de inspeção ocupa o mesmo canto: duas prévias empilhadas seria
  // ruído, e a inspeção é a intencional das duas.
  if (!visivel || !card || inspectedCardId) return null;

  const face = card.isFlipped ? 1 : 0;
  const faceMeta = meta?.faces[face] ?? meta?.faces[0];

  return (
    <div className="painel-entra border-panel-border bg-panel/95 pointer-events-none absolute bottom-28 right-2 z-40 hidden w-56 flex-col overflow-hidden rounded-xl border shadow-2xl backdrop-blur lg:flex">
      <img
        src={cardImageUrl(card.scryfallId, 'normal', face === 1 ? 'back' : 'front')}
        alt={faceMeta?.name ?? 'Carta'}
        className="aspect-[63/88] w-full object-cover"
      />

      {faceMeta && (
        <div className="flex flex-col gap-1 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-text truncate text-sm font-bold">{faceMeta.name}</span>
            {faceMeta.manaCost && (
              <span className="text-text-muted shrink-0 font-mono text-[11px]">
                {faceMeta.manaCost}
              </span>
            )}
          </div>
          <span className="text-text-muted text-[11px]">{faceMeta.typeLine}</span>
          {faceMeta.oracleText && (
            <p className="custom-scrollbar text-text-faint max-h-28 overflow-y-auto whitespace-pre-line text-[11px] leading-snug">
              {faceMeta.oracleText}
            </p>
          )}
          {faceMeta.power && faceMeta.toughness && (
            <span className="text-text self-end font-mono text-xs font-bold">
              {faceMeta.power}/{faceMeta.toughness}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
