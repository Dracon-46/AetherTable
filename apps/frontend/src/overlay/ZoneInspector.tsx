'use client';

import React from 'react';
import { X, ArrowUpCircle, Hand, Shuffle, Crown } from 'lucide-react';
import type { Room } from 'colyseus.js';
import { useGameStore, useUIStore } from '../store/game.store';
import { intents } from '../net/intents';
import type { RoomState } from '../net/schema/RoomState';
import { cardImageUrl } from '../canvas/textureCache';
import { useCardCatalog, useHidratarCartas } from '../cards/catalog';
import { chaveDaZona, ordenarDoTopo } from '../store/ordem-de-zona';

interface ZoneInspectorProps {
  room: Room<RoomState>;
}

const TITULOS: Record<string, string> = {
  GRAVEYARD: 'Cemitério',
  EXILE: 'Exílio',
  LIBRARY: 'Busca no Grimório (Tutor)',
  SIDEBOARD: 'Reserva (Sideboard)',
  HAND: 'Mão',
};

export function ZoneInspector({ room }: ZoneInspectorProps) {
  const inspectedZone = useUIStore((s) => s.inspectedZone);
  const setInspectedZone = useUIStore((s) => s.setInspectedZone);
  const inspectedZoneOwner = useUIStore((s) => s.inspectedZoneOwner);
  const cardsMap = useGameStore((s) => s.cards);
  const players = useGameStore((s) => s.players);
  const myId = useGameStore((s) => s.mySessionId);
  const zoneOrder = useGameStore((s) => s.zoneOrder);
  const catalogo = useCardCatalog((s) => s.cartas);

  // De quem é a zona aberta. Cemitério e exílio são públicos: clicar na pilha
  // de um oponente tem de abrir a pilha DELE.
  const dono = inspectedZoneOwner ?? myId;
  const minha = dono === myId;

  // Mesmo defeito do CardInspector: o `useEffect` estava depois do
  // `return null`. Abrir o grimório mudava a contagem de hooks e derrubava a
  // mesa — era exatamente o "o grimório não funciona".
  // Hook antes de qualquer retorno antecipado (ver o cabeçalho do
  // CardInspector: foi essa a violação que derrubava a mesa).
  useHidratarCartas(
    Object.values(cardsMap)
      .filter((c) => c.zone === inspectedZone && c.ownerId === dono)
      .map((c) => c.scryfallId),
  );

  React.useEffect(() => {
    if (!inspectedZone) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInspectedZone(null);
    };
    window.addEventListener('keydown', handleEsc, true);
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [inspectedZone, setInspectedZone]);

  // Abrir uma zona oculta exige que o servidor conceda a visibilidade; fechar
  // exige revogar. Sem isso a busca mostrava só versos de carta.
  //
  // `INTENT_SEARCH_ZONE` é a intenção certa aqui (DOC-036 item 16): ela abre a
  // zona INTEIRA e registra a busca no log público — os oponentes precisam
  // saber que houve um tutor, mesmo sem saber o que foi buscado. O
  // `INTENT_PEEK {amount:100}` que estava aqui era um contorno que mentia no
  // log ("olhou as 100 do topo").
  React.useEffect(() => {
    // Só faz sentido (e só é autorizado) para a PRÓPRIA zona oculta. Não existe
    // intenção para abrir zona oculta alheia — é o que torna a trapaça
    // inexprimível, e não apenas proibida (DOC-036 §1.2).
    if (!minha) return;
    if (inspectedZone !== 'LIBRARY' && inspectedZone !== 'SIDEBOARD') return;
    intents.searchZone(room, inspectedZone);
    return () => {
      intents.closePeek(room);
    };
  }, [inspectedZone, minha, room]);

  if (!inspectedZone) return null;

  /**
   * A lista sai NA ORDEM DA PILHA, do topo para o fundo.
   *
   * Antes era a ordem de inserção do mapa `cards`: abrir o cemitério mostrava
   * as cartas embaralhadas em relação à pilha real, e "a de cima" ficava no
   * meio da grade. Para o grimório isso era pior ainda — buscar (tutor) exibia
   * uma ordem que não correspondia a nada, e depois de um scry a conferência
   * ficava impossível.
   */
  const zoneCards = ordenarDoTopo(
    Object.values(cardsMap).filter((c) => c.zone === inspectedZone && c.ownerId === dono),
    zoneOrder[chaveDaZona(dono, inspectedZone)],
  );

  const handleShuffleAndClose = () => {
    intents.shuffle(room, 'LIBRARY');
    setInspectedZone(null);
  };

  /**
   * Quem é o dono da zona vê aqui quem está olhando junto — e pode fechar.
   *
   * Uma permissão concedida sem forma de revogar não é uma permissão, é uma
   * entrega. O servidor já tem `INTENT_REVOKE_VIEW`; este é o único lugar da
   * interface em que a lista de quem enxerga a zona aparece.
   */
  const observadores = (players[dono]?.sharedZones?.[inspectedZone] ?? '')
    .split(',')
    .filter(Boolean);

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) setInspectedZone(null);
      }}
    >
      <div className="modal-entra border-panel-border bg-panel flex h-full max-h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border shadow-2xl">
        {/* Header — empilha no mobile em vez de espremer o botão para fora */}
        <div className="border-panel-border bg-panel-hover flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-text flex flex-wrap items-center gap-2 text-lg font-bold sm:text-xl">
            {TITULOS[inspectedZone] ?? inspectedZone}
            {!minha && (
              <span className="text-text-muted text-sm font-normal">
                de {players[dono]?.name ?? 'outro jogador'}
              </span>
            )}
            <span className="border-panel-border bg-panel text-text-muted rounded-full border px-2 py-0.5 text-sm font-normal">
              {zoneCards.length} cartas
            </span>
          </h2>

          {minha && observadores.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-text-muted text-[11px] font-bold uppercase">Vendo junto:</span>
              {observadores.map((sid) => (
                <button
                  key={sid}
                  onClick={() => intents.revokeView(room, sid, inspectedZone)}
                  className="border-warning/40 bg-warning/10 text-warning hover:bg-danger/20 hover:border-danger hover:text-danger flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors"
                  title="Fechar esta zona para este jogador"
                >
                  {players[sid]?.name ?? sid.slice(0, 6)}
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            {minha &&
              (inspectedZone === 'GRAVEYARD' || inspectedZone === 'EXILE') &&
              zoneCards.length > 0 && (
                <button
                  onClick={() => {
                    intents.returnZone(room, inspectedZone, 'LIBRARY', true);
                    setInspectedZone(null);
                  }}
                  className="border-panel-border bg-table-deep text-text hover:border-primary hover:text-primary flex items-center gap-2 rounded border px-3 py-2 text-sm font-bold transition-colors"
                  title="Devolve a zona inteira ao grimório e embaralha"
                >
                  <Shuffle className="h-4 w-4" />
                  <span className="hidden sm:inline">Tudo ao grimório</span>
                </button>
              )}
            {minha && inspectedZone === 'LIBRARY' && (
              <button
                onClick={handleShuffleAndClose}
                className="bg-primary hover:bg-primary-hover flex items-center gap-2 rounded px-4 py-2 text-sm font-bold text-white shadow-lg transition-colors"
              >
                <Shuffle className="h-4 w-4" />
                <span className="hidden sm:inline">Embaralhar e Fechar</span>
                <span className="sm:hidden">Embaralhar</span>
              </button>
            )}
            <button
              onClick={() => setInspectedZone(null)}
              className="text-text-muted hover:bg-danger/80 rounded p-1 transition-colors hover:text-white"
              title="Fechar (sem embaralhar)"
              aria-label="Fechar"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* Grid de cartas */}
        <div className="custom-scrollbar bg-table-deep/50 min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {zoneCards.length === 0 ? (
            <div className="text-text-muted flex h-full items-center justify-center text-center">
              Nenhuma carta aqui.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
              {zoneCards.map((card) => (
                <div key={card.id} className="group relative flex flex-col items-center">
                  <div className="group-hover:border-primary relative aspect-[63/88] w-full overflow-hidden rounded-xl border border-transparent shadow-lg transition-all">
                    {card.scryfallId ? (
                      <img
                        src={cardImageUrl(card.scryfallId, 'normal')}
                        alt="Carta"
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="text-text-faint flex h-full w-full items-center justify-center bg-[#2c2216] text-[10px]">
                        oculta
                      </div>
                    )}

                    {/* Ações: no toque ficam sempre visíveis (não existe hover
                        no celular, e antes os botões eram inalcançáveis lá).
                        Numa zona alheia não há ação nenhuma a oferecer: o
                        servidor recusaria, e um botão que sempre falha é pior
                        que botão nenhum. */}
                    {minha && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 opacity-100 backdrop-blur-[2px] transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                        <button
                          onClick={() => {
                            if (inspectedZone === 'SIDEBOARD') {
                              intents.fetchFromSideboard(room, card.id, 'HAND');
                            } else {
                              intents.changeZone(room, card.id, 'HAND');
                            }
                            if (inspectedZone !== 'LIBRARY') setInspectedZone(null);
                          }}
                          className="border-panel-border bg-panel hover:border-primary hover:bg-primary flex w-5/6 items-center justify-center gap-1.5 rounded border px-2 py-1.5 text-xs text-white shadow-lg transition-colors"
                        >
                          <Hand className="h-3.5 w-3.5" />
                          Mão
                        </button>
                        <button
                          onClick={() => {
                            if (inspectedZone === 'SIDEBOARD') {
                              intents.fetchFromSideboard(room, card.id, 'BATTLEFIELD');
                            } else {
                              intents.changeZone(room, card.id, 'BATTLEFIELD', 960, 480);
                            }
                            if (inspectedZone !== 'LIBRARY') setInspectedZone(null);
                          }}
                          className="border-panel-border bg-panel hover:border-success hover:bg-success flex w-5/6 items-center justify-center gap-1.5 rounded border px-2 py-1.5 text-xs text-white shadow-lg transition-colors"
                        >
                          <ArrowUpCircle className="h-3.5 w-3.5" />
                          Campo
                        </button>
                        {inspectedZone === 'LIBRARY' && (
                          <button
                            onClick={() => {
                              intents.changeZone(room, card.id, 'COMMAND');
                              setInspectedZone(null);
                            }}
                            className="border-panel-border bg-panel hover:border-warning hover:bg-warning flex w-5/6 items-center justify-center gap-1.5 rounded border px-2 py-1.5 text-xs text-white shadow-lg transition-colors"
                          >
                            <Crown className="h-3.5 w-3.5" />
                            Comando
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <span
                    className="text-text-muted mt-1 w-full truncate text-center text-[11px]"
                    title={card.scryfallId ? catalogo[card.scryfallId]?.name : undefined}
                  >
                    {card.scryfallId ? (catalogo[card.scryfallId]?.name ?? '…') : 'oculta'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
