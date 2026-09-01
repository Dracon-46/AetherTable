'use client';

/**
 * ScryModal.tsx — decisão de scry / surveil.
 *
 * DOC-036 §2.2 é explícito: scry e surveil são TRANSAÇÕES, não "olhar e depois
 * mover". Se fossem duas ações separadas, os oponentes veriam o grimório
 * encolher antes de a decisão existir — e um jogador poderia abandonar a mesa
 * no meio, deixando cartas em limbo.
 *
 * Por isso a tela abre com o resultado que só o dono recebeu (`scryOpened`, via
 * `client.send`), e só ao confirmar envia UMA intenção com a decisão inteira.
 */

import React from 'react';
import type { Room } from 'colyseus.js';
import { ArrowDown, ArrowUp, Check, Skull } from 'lucide-react';
import { useTableStore } from '../store/game.store';
import { intents } from '../net/intents';
import { cardImageUrl } from '../canvas/textureCache';
import type { RoomState } from '../net/schema/RoomState';

interface ScryModalProps {
  room: Room<RoomState>;
}

type Destino = 'TOPO' | 'FORA';

export function ScryModal({ room }: ScryModalProps) {
  const scry = useTableStore((s) => s.scry);
  const fecharScry = useTableStore((s) => s.fecharScry);

  const [destinos, setDestinos] = React.useState<Record<string, Destino>>({});

  // Cada abertura começa do zero: reaproveitar a escolha anterior faria o
  // jogador confirmar sem querer o que decidiu no scry passado.
  React.useEffect(() => {
    if (!scry) return;
    setDestinos(Object.fromEntries(scry.cards.map((c) => [c.id, 'TOPO' as Destino])));
  }, [scry]);

  if (!scry) return null;

  const ehSurveil = scry.mode === 'SURVEIL';
  const rotuloFora = ehSurveil ? 'Cemitério' : 'Fundo';

  const confirmar = () => {
    const fora = scry.cards.filter((c) => destinos[c.id] === 'FORA').map((c) => c.id);
    // A ordem do topo é a ordem em que aparecem na tela, de cima para baixo.
    const topo = scry.cards.filter((c) => destinos[c.id] !== 'FORA').map((c) => c.id);

    if (ehSurveil) intents.surveilCommit(room, fora, topo);
    else intents.scryCommit(room, fora, topo);

    fecharScry();
  };

  const mover = (id: string, direcao: -1 | 1) => {
    // Reordenar o topo importa: scry 3 sem poder ordenar é meio scry.
    const idx = scry.cards.findIndex((c) => c.id === id);
    const alvo = idx + direcao;
    if (idx < 0 || alvo < 0 || alvo >= scry.cards.length) return;
    const copia = [...scry.cards];
    const [item] = copia.splice(idx, 1);
    if (item) copia.splice(alvo, 0, item);
    useTableStore.setState({ scry: { ...scry, cards: copia } });
  };

  return (
    <div className="z-60 pointer-events-auto fixed inset-0 flex items-center justify-center overflow-y-auto bg-black/85 p-4 backdrop-blur-sm">
      <div className="modal-entra border-panel-border bg-panel my-auto w-full max-w-3xl rounded-2xl border p-5 shadow-2xl sm:p-6">
        <header className="mb-5">
          <h2 className="text-text text-xl font-bold sm:text-2xl">
            {ehSurveil ? 'Surveil' : 'Scry'} {scry.cards.length}
          </h2>
          <p className="text-text-muted mt-1 text-sm">
            Escolha o que fica no topo e o que vai para {rotuloFora.toLowerCase()}. A ordem da lista
            é a ordem do topo do grimório.
          </p>
        </header>

        <ul className="flex flex-col gap-3">
          {scry.cards.map((c, i) => {
            const fora = destinos[c.id] === 'FORA';
            return (
              <li
                key={c.id}
                className={`flex items-center gap-3 rounded-xl border p-2 transition-colors sm:gap-4 sm:p-3 ${
                  fora ? 'border-danger/50 bg-danger/5' : 'border-panel-border bg-table-deep'
                }`}
              >
                <div className="flex shrink-0 flex-col gap-1">
                  <button
                    onClick={() => mover(c.id, -1)}
                    disabled={i === 0 || fora}
                    className="border-panel-border text-text-muted hover:text-text rounded border p-1 transition-colors disabled:opacity-30"
                    aria-label="Subir"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => mover(c.id, 1)}
                    disabled={i === scry.cards.length - 1 || fora}
                    className="border-panel-border text-text-muted hover:text-text rounded border p-1 transition-colors disabled:opacity-30"
                    aria-label="Descer"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                {c.scryfallId ? (
                  <img
                    src={cardImageUrl(c.scryfallId, 'small')}
                    alt="Carta do topo"
                    className="border-panel-border h-24 w-[68px] shrink-0 rounded-lg border object-cover sm:h-28 sm:w-20"
                  />
                ) : (
                  <div className="border-panel-border bg-panel h-24 w-[68px] shrink-0 rounded-lg border sm:h-28 sm:w-20" />
                )}

                <div className="min-w-0 flex-1">
                  <span className="text-text-muted text-xs font-bold uppercase tracking-wider">
                    {fora ? rotuloFora : `Topo · posição ${i + 1}`}
                  </span>
                </div>

                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => setDestinos((d) => ({ ...d, [c.id]: 'TOPO' }))}
                    className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                      fora
                        ? 'bg-table-deep text-text-muted hover:text-text'
                        : 'bg-primary text-white'
                    }`}
                  >
                    Topo
                  </button>
                  <button
                    onClick={() => setDestinos((d) => ({ ...d, [c.id]: 'FORA' }))}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                      fora
                        ? 'bg-danger text-white'
                        : 'bg-table-deep text-text-muted hover:text-text'
                    }`}
                  >
                    {ehSurveil ? (
                      <Skull className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowDown className="h-3.5 w-3.5" />
                    )}
                    {rotuloFora}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <footer className="mt-6 flex justify-end">
          <button
            onClick={confirmar}
            className="bg-primary hover:bg-primary-hover flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-bold text-white shadow-lg transition-all active:scale-95"
          >
            <Check className="h-4 w-4" />
            Confirmar
          </button>
        </footer>
      </div>
    </div>
  );
}
