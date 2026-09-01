'use client';

/**
 * SorteioOverlay.tsx — o dado e a moeda aparecendo na mesa.
 *
 * POR QUE ESTE COMPONENTE EXISTE
 *
 * A corrente do dado estava inteira menos a última peça: a ActionBar disparava
 * `INTENT_ROLL_DICE`, o servidor sorteava e transmitia `dice`, o `useRoomSync`
 * guardava o resultado no `tableStore` — e nada o desenhava. Da cadeira do
 * jogador, girar o dado era indistinguível de não girar: o número só existia
 * como uma linha de log, que rolava e sumia. Daí "girar dados não funciona".
 *
 * A moeda estava um passo atrás: `INTENT_FLIP_COIN` nem transmitia evento, só
 * escrevia no log. O broadcast foi adicionado no registry do game-server.
 *
 * ─── DECISÕES ──────────────────────────────────────────────────────────────
 *
 * O sorteio aparece para a MESA INTEIRA, não só para quem girou. Um dado que só
 * o autor vê não resolve nada: o uso real é decidir quem começa, resolver um
 * coin flip de carta, desempatar — todos casos em que a mesa precisa testemunhar
 * o mesmo número.
 *
 * O valor final é renderizado desde o primeiro quadro, por baixo do giro. A
 * animação NUNCA sorteia números por conta própria: se ela mostrasse valores
 * falsos durante o giro, um quadro perdido ou um `prefers-reduced-motion`
 * deixariam um número que nunca existiu na tela.
 */

import { useEffect, useState } from 'react';
import { useGameStore, useTableStore } from '../store/game.store';

/** Quanto o resultado fica na tela antes de se despedir. */
const DURACAO_MS = 2600;
/** Duração da saída — precisa bater com `.animate-sorteio-saida` no globals.css. */
const SAIDA_MS = 350;

/** Pontos das faces de um d6, em grade 3x3. Só o d6 ganha pips. */
const PIPS: Record<number, Array<[number, number]>> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [0, 2],
    [2, 0],
    [2, 2],
  ],
  5: [
    [0, 0],
    [0, 2],
    [1, 1],
    [2, 0],
    [2, 2],
  ],
  6: [
    [0, 0],
    [0, 1],
    [0, 2],
    [2, 0],
    [2, 1],
    [2, 2],
  ],
};

function FaceDoDado({ sides, result }: { sides: number; result: number }) {
  const pips = sides === 6 ? PIPS[result] : undefined;

  if (!pips) {
    // d20, d100, d4… não têm pips que alguém reconheça: vale o número.
    return (
      <span className="font-mono text-4xl font-black tabular-nums text-slate-900">{result}</span>
    );
  }

  return (
    <div className="grid h-14 w-14 grid-cols-3 grid-rows-3 gap-1 p-1">
      {Array.from({ length: 9 }).map((_, i) => {
        const linha = Math.floor(i / 3);
        const coluna = i % 3;
        const aceso = pips.some(([l, c]) => l === linha && c === coluna);
        return (
          <span
            key={i}
            className={`rounded-full ${aceso ? 'bg-slate-900' : 'bg-transparent'}`}
            aria-hidden
          />
        );
      })}
    </div>
  );
}

export function SorteioOverlay() {
  const sorteio = useTableStore((s) => s.ultimoSorteio);
  const limparSorteio = useTableStore((s) => s.limparSorteio);
  const players = useGameStore((s) => s.players);
  const myId = useGameStore((s) => s.mySessionId);

  const [saindo, setSaindo] = useState(false);

  // `sorteio.em` na dependência, e não `sorteio`: dois d20 seguidos com o mesmo
  // resultado produzem objetos diferentes mas o mesmo conteúdo. Sem o carimbo
  // de tempo, o segundo giro não reiniciaria a animação.
  const em = sorteio?.em ?? 0;

  useEffect(() => {
    if (!em) return;
    setSaindo(false);

    const aSair = setTimeout(() => setSaindo(true), DURACAO_MS - SAIDA_MS);
    const aLimpar = setTimeout(() => limparSorteio(), DURACAO_MS);

    return () => {
      clearTimeout(aSair);
      clearTimeout(aLimpar);
    };
  }, [em, limparSorteio]);

  if (!sorteio) return null;

  const autor = players[sorteio.actorId];
  const nome = sorteio.actorId === myId ? 'Você' : (autor?.name ?? 'Alguém');

  const legenda =
    sorteio.tipo === 'DADO' ? `${nome} rolou d${sorteio.sides}` : `${nome} girou a moeda`;

  return (
    // `pointer-events-none`: o sorteio passa por cima da mesa, mas nunca rouba
    // um clique — quem está no meio de um arrasto não pode ser interrompido.
    <div
      className={`pointer-events-none absolute inset-0 z-40 flex items-center justify-center ${
        saindo ? 'animate-sorteio-saida' : 'animate-sorteio-entrada'
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3">
        <div style={{ perspective: '600px' }}>
          {sorteio.tipo === 'DADO' ? (
            <div
              className="animate-dado-rolar flex h-24 w-24 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-300 shadow-[0_10px_40px_rgba(0,0,0,0.55)] ring-2 ring-white/70"
              style={{ transformStyle: 'preserve-3d' }}
            >
              <FaceDoDado sides={sorteio.sides} result={sorteio.result} />
            </div>
          ) : (
            <div
              className={`animate-moeda-girar flex h-24 w-24 items-center justify-center rounded-full text-sm font-black tracking-wide shadow-[0_10px_40px_rgba(0,0,0,0.55)] ring-4 ${
                sorteio.result === 'CARA'
                  ? 'bg-gradient-to-br from-amber-200 to-amber-500 text-amber-950 ring-amber-200/70'
                  : 'bg-gradient-to-br from-slate-200 to-slate-500 text-slate-900 ring-slate-200/70'
              }`}
              style={{ transformStyle: 'preserve-3d' }}
            >
              {sorteio.result}
            </div>
          )}
        </div>

        <span className="rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
          {legenda}
          {sorteio.tipo === 'DADO' && (
            <span className="text-warning ml-1.5 font-mono text-base font-black">
              {sorteio.result}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
