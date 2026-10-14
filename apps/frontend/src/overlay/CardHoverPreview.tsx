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

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGameStore, useUIStore } from '../store/game.store';
import { useCardMeta } from '../cards/catalog';
import { cardImageUrl } from '../canvas/textureCache';

/** Folga entre o cursor e a prévia, e entre a prévia e a borda da janela. */
const AFASTAMENTO = 24;
const MARGEM = 8;

export function CardHoverPreview() {
  const hoveredCardId = useUIStore((s) => s.hoveredCardId);
  const inspectedCardId = useUIStore((s) => s.inspectedCardId);
  const aoLado = useUIStore((s) => s.previaAoLado);
  const cards = useGameStore((s) => s.cards);

  const card = hoveredCardId ? cards[hoveredCardId] : undefined;
  const visivel = Boolean(card?.scryfallId) && !card?.faceDown;
  const meta = useCardMeta(visivel ? card?.scryfallId : null);

  /**
   * ─── AO LADO DA CARTA, DO LADO QUE TEM ESPAÇO ────────────────────────────
   *
   * A prévia fixa no canto inferior direito cobria justamente as pilhas do
   * jogador e obrigava o olho a atravessar a tela. Com a preferência ligada,
   * ela acompanha o cursor e troca de lado na metade da janela — à direita da
   * carta na metade esquerda, à esquerda na metade direita — e encosta na
   * borda em vez de sair da tela. O canvas não expõe o retângulo da carta
   * ao DOM; o cursor está sobre ela, e é uma âncora boa o bastante.
   */
  const ponteiro = useRef({ x: 0, y: 0 });
  const caixa = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!aoLado) return;
    const aoMover = (e: PointerEvent) => {
      ponteiro.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', aoMover, { passive: true });
    return () => window.removeEventListener('pointermove', aoMover);
  }, [aoLado]);

  useLayoutEffect(() => {
    if (!aoLado || !hoveredCardId || !caixa.current) {
      setPos(null);
      return;
    }
    const { x, y } = ponteiro.current;
    const { width, height } = caixa.current.getBoundingClientRect();
    const left =
      x < window.innerWidth / 2
        ? Math.min(x + AFASTAMENTO, window.innerWidth - width - MARGEM)
        : Math.max(MARGEM, x - AFASTAMENTO - width);
    const top = Math.min(
      Math.max(MARGEM, y - height / 2),
      Math.max(MARGEM, window.innerHeight - height - MARGEM),
    );
    setPos({ left, top });
  }, [aoLado, hoveredCardId, meta]);

  // A gaveta de inspeção ocupa o mesmo canto: duas prévias empilhadas seria
  // ruído, e a inspeção é a intencional das duas.
  if (!visivel || !card || inspectedCardId) return null;

  const face = card.isFlipped ? 1 : 0;
  const faceMeta = meta?.faces[face] ?? meta?.faces[0];

  return (
    <div
      ref={caixa}
      className={
        aoLado
          ? 'border-panel-border bg-panel/95 pointer-events-none fixed z-40 flex w-48 flex-col overflow-hidden rounded-xl border shadow-2xl backdrop-blur sm:w-56'
          : 'painel-entra border-panel-border bg-panel/95 pointer-events-none absolute bottom-28 right-2 z-40 hidden w-56 flex-col overflow-hidden rounded-xl border shadow-2xl backdrop-blur lg:flex'
      }
      // Antes da primeira medição, invisível: aparecer no canto (0, 0) e
      // pular para o lugar certo no quadro seguinte é um piscar na tela.
      style={aoLado ? (pos ?? { left: -9999, top: 0, visibility: 'hidden' }) : undefined}
    >
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
