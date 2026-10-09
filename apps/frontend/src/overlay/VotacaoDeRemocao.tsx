'use client';

/**
 * VotacaoDeRemocao.tsx — "fulano propôs remover sicrano da mesa".
 *
 * ─── POR QUE ESTADO, E NÃO MENSAGEM ────────────────────────────────────────
 *
 * A votação vive no `RoomState` (`votacaoAlvo` e companhia), e não num evento
 * avulso como o pedido de vista. Quem reconecta no meio, ou entra atrasado,
 * precisa ver a votação que está correndo — senão ela nunca fecharia, porque
 * o voto que falta é justamente o de quem não recebeu o aviso.
 *
 * Como o `ViewRequestPrompt`, NÃO é modal: uma votação aberta no meio de um
 * combate não pode travar a mesa de quem a recebe.
 */

import React, { useEffect, useState } from 'react';
import type { Room } from 'colyseus.js';
import { Check, UserX, X } from 'lucide-react';
import { useGameStore } from '../store/game.store';
import { intents } from '../net/intents';
import type { RoomState } from '../net/schema/RoomState';

/** Mesma checagem de fronteira do servidor (`visibility.ts:contem`). */
const votou = (lista: string, sid: string) => lista.split(',').includes(sid);

export function VotacaoDeRemocao({ room }: { room: Room<RoomState> }) {
  const config = useGameStore((s) => s.config);
  const players = useGameStore((s) => s.players);
  const myId = useGameStore((s) => s.mySessionId);
  const [agora, setAgora] = useState(() => Date.now());

  // Aberta é o que o SERVIDOR diz: ele encerra a votação no prazo. Comparar o
  // prazo com o relógio deste navegador escondia o painel de quem estava com o
  // relógio adiantado — e esse jogador nunca via a votação para responder.
  const aberta = Boolean(config.votacaoAlvo);

  // O relógio só anda com votação aberta: um intervalo permanente re-renderiza
  // o painel uma vez por segundo durante a partida inteira, à toa.
  useEffect(() => {
    if (!config.votacaoAlvo) return;
    const id = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [config.votacaoAlvo]);

  if (!aberta || !myId) return null;

  const alvo = players[config.votacaoAlvo];
  const autor = players[config.votacaoAutor];
  const votantes = Object.values(players).filter((p) => p.connected && p.id !== config.votacaoAlvo);
  const sim = votantes.filter((p) => votou(config.votacaoSim, p.id)).length;
  const segundos = Math.max(0, Math.ceil((config.votacaoExpiraEm - agora) / 1000));
  const souAlvo = myId === config.votacaoAlvo;
  const jaVotei = votou(config.votacaoSim, myId);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-[60] flex justify-center px-3">
      <div className="painel-entra border-danger/50 bg-panel/95 pointer-events-auto flex w-full max-w-md flex-col gap-3 rounded-xl border p-3 shadow-2xl backdrop-blur sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="bg-danger/15 text-danger flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
            <UserX className="h-4 w-4" />
          </span>
          <p className="text-text min-w-0 text-xs leading-snug">
            {souAlvo ? (
              <>A mesa está votando para remover você.</>
            ) : (
              <>
                <span className="font-bold">{autor?.name ?? 'Alguém'}</span> propôs remover{' '}
                <span className="font-bold">{alvo?.name ?? 'um jogador'}</span> da mesa.
              </>
            )}
            <span className="text-text-faint block">
              {sim}/{votantes.length} a favor · {segundos}s · um “não” encerra a votação
            </span>
          </p>
        </div>

        {!souAlvo && !jaVotei && (
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => intents.voteKick(room, config.votacaoAlvo, true)}
              className="bg-danger flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white transition-transform active:scale-95"
            >
              <Check className="h-3.5 w-3.5" />
              Remover
            </button>
            <button
              onClick={() => intents.voteKick(room, config.votacaoAlvo, false)}
              className="border-panel-border text-text-muted hover:border-success hover:text-success flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Manter
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
