'use client';

/**
 * PilhaPanel.tsx — a pilha da mesa.
 *
 * A zona `STACK` existia no contrato desde o começo e nada a desenhava: não
 * havia como dizer "estou conjurando isto" sem jogar a carta direto no campo,
 * nem como mostrar à mesa a cópia de um Twincast. O tabuleiro só desenha as
 * zonas que conhece, então a pilha ganhou um painel próprio.
 *
 * ─── ORDEM DA MESA, NÃO DE CADA JOGADOR ────────────────────────────────────
 *
 * O topo é o maior `zIndex` entre as cartas na pilha (o servidor o atribui ao
 * entrar — ver `aplicarEfeitosDeZona`). A resposta do oponente aparece por
 * cima da sua mágica, como na mesa física.
 *
 * ─── RESOLVER É MOVER ──────────────────────────────────────────────────────
 *
 * Sem motor de regras (RN01), "resolver" é mandar a carta para onde ela vai:
 * permanente para o campo, instantâneo e feitiço para o cemitério. Só quem
 * controla a carta tem os botões; a mesa inteira vê a pilha.
 */

import type { Room } from 'colyseus.js';
import { Ban, Copy, Hand, Layers, Skull, Swords, Trash2 } from 'lucide-react';
import { useGameStore, useUIStore } from '../store/game.store';
import { useCardCatalog, useHidratarCartas } from '../cards/catalog';
import { cardImageUrl } from '../canvas/textureCache';
import { intents } from '../net/intents';
import type { RoomState } from '../net/schema/RoomState';

interface PilhaPanelProps {
  room: Room<RoomState>;
  /** A plateia vê a pilha e não age sobre ela. */
  espectador?: boolean;
}

export function PilhaPanel({ room, espectador = false }: PilhaPanelProps) {
  const cards = useGameStore((s) => s.cards);
  const players = useGameStore((s) => s.players);
  const myId = useGameStore((s) => s.mySessionId);
  const catalogo = useCardCatalog((s) => s.cartas);
  const setHoveredCard = useUIStore((s) => s.setHoveredCard);
  const setInspectedCard = useUIStore((s) => s.setInspectedCard);

  const pilha = Object.values(cards)
    .filter((c) => c.zone === 'STACK')
    .sort((a, b) => b.zIndex - a.zIndex);

  useHidratarCartas(pilha.map((c) => c.scryfallId));

  if (pilha.length === 0) return null;

  return (
    <aside
      className="painel-entra border-panel-border bg-panel/95 pointer-events-auto absolute left-1/2 top-16 z-30 w-[min(22rem,calc(100vw-1rem))] -translate-x-1/2 overflow-hidden rounded-xl border shadow-2xl backdrop-blur"
      aria-label="Pilha"
    >
      <header className="border-panel-border bg-panel-hover flex items-center gap-2 border-b px-3 py-1.5">
        <Layers className="text-primary h-4 w-4" />
        <span className="text-text text-xs font-bold uppercase tracking-wider">
          Pilha · {pilha.length}
        </span>
        <span className="text-text-faint ml-auto text-[10px]">o topo resolve primeiro</span>
      </header>
      <ol className="custom-scrollbar max-h-[40dvh] overflow-y-auto p-1.5">
        {pilha.map((c, i) => {
          const meta = c.scryfallId ? catalogo[c.scryfallId] : undefined;
          const nome = c.faceDown ? 'Carta virada' : (meta?.name ?? '…');
          const meu = c.controllerId === myId;
          const permanente = /creature|artifact|enchantment|planeswalker|battle|land/i.test(
            meta?.typeLine ?? '',
          );
          const botao =
            'text-text-muted hover:bg-table-deep hover:text-primary rounded p-1 transition-colors';
          return (
            <li
              key={c.id}
              className={`flex items-center gap-2 rounded-lg px-1.5 py-1 ${i === 0 ? 'bg-primary/10' : ''}`}
              onMouseEnter={() => setHoveredCard(c.id)}
              onMouseLeave={() => setHoveredCard(null)}
            >
              <button
                onClick={() => c.scryfallId && setInspectedCard(c.scryfallId)}
                className="shrink-0"
                aria-label={`Ver ${nome}`}
              >
                {c.scryfallId && !c.faceDown ? (
                  <img
                    src={cardImageUrl(c.scryfallId, 'small')}
                    alt=""
                    className="border-panel-border h-10 w-7 rounded border object-cover"
                  />
                ) : (
                  <div className="border-panel-border bg-table-deep h-10 w-7 rounded border" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-text truncate text-xs font-semibold">
                  {nome}
                  {c.isCopy && <span className="text-[#A78BFA]"> · cópia</span>}
                </p>
                <p className="text-text-faint truncate text-[10px]">
                  {c.controllerId === myId ? 'Você' : (players[c.controllerId]?.name ?? '—')}
                  {i === 0 && ' · topo'}
                </p>
              </div>
              <div className={`flex shrink-0 items-center ${espectador ? 'hidden' : ''}`}>
                {/* Copiar não exige ser o dono: Twincast copia a mágica de
                    QUALQUER jogador, e a cópia é de quem copiou. */}
                <button
                  onClick={() => intents.copyCard(room, c.id, 'STACK')}
                  className={botao}
                  title="Criar cópia na pilha"
                  aria-label="Criar cópia na pilha"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                {meu && (
                  <>
                    <button
                      onClick={() => intents.changeZone(room, c.id, 'BATTLEFIELD', 0, 0)}
                      className={`${botao} ${permanente ? 'text-success' : ''}`}
                      title="Resolver no campo"
                      aria-label="Resolver no campo"
                    >
                      <Swords className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => intents.changeZone(room, c.id, 'GRAVEYARD')}
                      className={`${botao} ${!permanente ? 'text-success' : ''}`}
                      title={c.isToken ? 'Resolver (a cópia some)' : 'Resolver no cemitério'}
                      aria-label="Resolver no cemitério"
                    >
                      {c.isToken ? (
                        <Trash2 className="h-3.5 w-3.5" />
                      ) : (
                        <Skull className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => intents.changeZone(room, c.id, 'EXILE')}
                      className={botao}
                      title="Exilar"
                      aria-label="Exilar"
                    >
                      <Ban className="h-3.5 w-3.5" />
                    </button>
                    {!c.isToken && (
                      <button
                        onClick={() => intents.changeZone(room, c.id, 'HAND')}
                        className={botao}
                        title="Voltar para a mão"
                        aria-label="Voltar para a mão"
                      >
                        <Hand className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
