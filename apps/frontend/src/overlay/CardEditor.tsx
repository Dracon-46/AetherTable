'use client';

/**
 * CardEditor.tsx — editor de marcadores, P/T, dano e anotação.
 *
 * Estas quatro ações eram feitas com `window.prompt`. Um diálogo nativo trava a
 * aba inteira, não mostra o estado atual da carta, não valida nada, e num
 * celular abre um teclado sobre um alerta do sistema. Pior: `prompt` é
 * bloqueado por padrão dentro de iframes, então a ação simplesmente não
 * acontecia em alguns contextos — sem erro visível.
 *
 * Aqui o jogador vê o valor atual, ajusta com um clique, e a intenção
 * correspondente sai a cada mudança.
 */

import React from 'react';
import type { Room } from 'colyseus.js';
import { Minus, Plus, X } from 'lucide-react';
import { useGameStore, useUIStore } from '../store/game.store';
import { useCardMeta } from '../cards/catalog';
import { intents } from '../net/intents';
import type { RoomState } from '../net/schema/RoomState';

interface CardEditorProps {
  room: Room<RoomState>;
}

/** Marcadores que aparecem em quase toda partida de Commander. */
const MARCADORES_COMUNS = ['+1/+1', '-1/-1', 'lealdade', 'carga', 'veneno', 'tempo'] as const;

export function CardEditor({ room }: CardEditorProps) {
  const cardId = useUIStore((s) => s.editingCardId);
  const fechar = useUIStore((s) => s.setEditingCard);
  const card = useGameStore((s) => (cardId ? s.cards[cardId] : undefined));
  const meta = useCardMeta(card?.scryfallId);

  const [nota, setNota] = React.useState('');
  const [novoMarcador, setNovoMarcador] = React.useState('');

  React.useEffect(() => {
    setNota(card?.note ?? '');
    setNovoMarcador('');
  }, [cardId, card?.note]);

  React.useEffect(() => {
    if (!cardId) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar(null);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [cardId, fechar]);

  if (!cardId || !card) return null;

  const face = card.isFlipped ? 1 : 0;
  const faceMeta = meta?.faces[face] ?? meta?.faces[0];
  const pImpresso = Number(faceMeta?.power ?? 0) || 0;
  const tImpresso = Number(faceMeta?.toughness ?? 0) || 0;
  const p = card.hasPtOverride ? card.powerOverride : pImpresso;
  const t = card.hasPtOverride ? card.toughnessOverride : tImpresso;

  const ajustarPt = (dp: number, dt: number) => intents.setPt(room, card.id, p + dp, t + dt, true);

  const chip =
    'rounded-md border border-panel-border bg-table-deep px-2 py-1 text-xs text-text transition-colors hover:border-primary hover:text-primary';

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) fechar(null);
      }}
    >
      <div className="modal-entra border-panel-border bg-panel flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-xl border shadow-2xl">
        <header className="border-panel-border flex items-center justify-between border-b px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-text truncate text-base font-bold">{faceMeta?.name ?? 'Carta'}</h2>
            {faceMeta?.typeLine && (
              <span className="text-text-muted truncate text-[11px]">{faceMeta.typeLine}</span>
            )}
          </div>
          <button
            onClick={() => fechar(null)}
            className="text-text-muted hover:bg-danger/20 shrink-0 rounded p-1.5 transition-colors hover:text-white"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {/* Marcadores */}
          <section>
            <span className="text-text-muted mb-2 block text-[10px] font-bold uppercase tracking-wider">
              Marcadores
            </span>

            <div className="flex flex-col gap-1.5">
              {Object.entries(card.counters ?? {}).map(([nome, valor]) => (
                <div
                  key={nome}
                  className="bg-table-deep flex items-center justify-between rounded-md px-2 py-1.5"
                >
                  <span className="text-text truncate font-mono text-xs">{nome}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => intents.addCounter(room, card.id, nome, -1)}
                      className="text-danger hover:bg-danger/20 rounded px-1.5"
                      aria-label={`Menos um ${nome}`}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-text w-7 text-center font-mono text-sm font-bold">
                      {valor}
                    </span>
                    <button
                      onClick={() => intents.addCounter(room, card.id, nome, 1)}
                      className="text-success hover:bg-success/20 rounded px-1.5"
                      aria-label={`Mais um ${nome}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {MARCADORES_COMUNS.map((m) => (
                <button
                  key={m}
                  onClick={() => intents.addCounter(room, card.id, m, 1)}
                  className={chip}
                >
                  + {m}
                </button>
              ))}
            </div>

            <div className="mt-2 flex gap-2">
              <input
                value={novoMarcador}
                onChange={(e) => setNovoMarcador(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  // O servidor aceita /^[a-z0-9_+-]{1,24}$/ (COUNTER_NAME_PATTERN):
                  // normalizar aqui evita uma rejeição silenciosa.
                  const nome = novoMarcador
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9_+-]/g, '');
                  if (!nome) return;
                  intents.addCounter(room, card.id, nome.slice(0, 24), 1);
                  setNovoMarcador('');
                }}
                placeholder="outro marcador…"
                maxLength={24}
                className="border-panel-border bg-table-deep text-text focus:border-primary min-w-0 flex-1 rounded-md border px-2 py-1.5 text-xs outline-none"
              />
              {Object.keys(card.counters ?? {}).length > 0 && (
                <button
                  onClick={() => intents.clearCounters(room, card.id)}
                  className="text-danger hover:bg-danger/10 shrink-0 rounded-md px-2 py-1.5 text-xs transition-colors"
                >
                  Limpar
                </button>
              )}
            </div>
          </section>

          {/* P/T */}
          <section>
            <span className="text-text-muted mb-2 block text-[10px] font-bold uppercase tracking-wider">
              Força / Resistência
              {!card.hasPtOverride && faceMeta?.power && (
                <span className="ml-1 font-normal normal-case tracking-normal">
                  (impresso {faceMeta.power}/{faceMeta.toughness})
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => ajustarPt(-1, 0)} className={chip}>
                −1 força
              </button>
              <span className="bg-table-deep text-text min-w-[4.5rem] rounded-md px-2 py-1.5 text-center font-mono text-sm font-bold">
                {p}/{t}
              </span>
              <button onClick={() => ajustarPt(1, 0)} className={chip}>
                +1 força
              </button>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <button onClick={() => ajustarPt(0, -1)} className={chip}>
                −1 resist.
              </button>
              <button onClick={() => ajustarPt(1, 1)} className={chip}>
                +1/+1
              </button>
              <button onClick={() => ajustarPt(0, 1)} className={chip}>
                +1 resist.
              </button>
            </div>
            {card.hasPtOverride && (
              <button
                onClick={() => intents.setPt(room, card.id, 0, 0, false)}
                className="text-text-muted hover:text-text mt-1.5 text-[11px] underline"
              >
                voltar ao P/T impresso
              </button>
            )}
          </section>

          {/* Dano */}
          <section>
            <span className="text-text-muted mb-2 block text-[10px] font-bold uppercase tracking-wider">
              Dano marcado
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => intents.setDamage(room, card.id, Math.max(0, card.damage - 1))}
                className={chip}
              >
                −1
              </button>
              <span className="bg-table-deep text-danger min-w-[3rem] rounded-md px-2 py-1.5 text-center font-mono text-sm font-bold">
                {card.damage}
              </span>
              <button
                onClick={() => intents.setDamage(room, card.id, card.damage + 1)}
                className={chip}
              >
                +1
              </button>
              {card.damage > 0 && (
                <button
                  onClick={() => intents.setDamage(room, card.id, 0)}
                  className="text-text-muted hover:text-text text-[11px] underline"
                >
                  limpar
                </button>
              )}
            </div>
          </section>

          {/* Anotação e destaque */}
          <section>
            <span className="text-text-muted mb-2 block text-[10px] font-bold uppercase tracking-wider">
              Anotação
            </span>
            <input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              onBlur={() => intents.setNote(room, card.id, nota)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') intents.setNote(room, card.id, nota);
              }}
              maxLength={120}
              placeholder="visível para todos na mesa"
              className="border-panel-border bg-table-deep text-text focus:border-primary w-full rounded-md border px-2 py-1.5 text-xs outline-none"
            />

            <div className="mt-2 flex items-center gap-2">
              <span className="text-text-muted text-[10px] uppercase">Destaque</span>
              {['#EF4444', '#F59E0B', '#22C55E', '#3B82F6', '#A855F7'].map((cor) => (
                <button
                  key={cor}
                  onClick={() => intents.setHighlight(room, card.id, cor)}
                  className={`h-5 w-5 rounded-full border-2 transition-transform hover:scale-110 ${
                    card.highlight === cor ? 'border-white' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: cor }}
                  aria-label={`Destacar com ${cor}`}
                />
              ))}
              <button
                onClick={() => intents.setHighlight(room, card.id, '')}
                className="text-text-muted hover:text-text text-[11px] underline"
              >
                nenhum
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
