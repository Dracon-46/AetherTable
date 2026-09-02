'use client';

/**
 * ViewRequestPrompt.tsx — "fulano quer ver a sua mão".
 *
 * ─── POR QUE ISTO É UM PAINEL, E NÃO UM TOAST ──────────────────────────────
 *
 * Um toast some sozinho. Aqui o silêncio não pode ser interpretado como
 * resposta: enquanto o dono da zona não decide, a permissão simplesmente não
 * existe (RN13), e um aviso que evapora deixaria quem pediu esperando por algo
 * que nunca vai chegar — sem saber se foi recusado ou se o outro nem viu.
 *
 * Por isso o pedido fica na tela até virar "mostrar" ou "recusar", e as duas
 * respostas mandam evento de volta a quem pediu.
 *
 * Ele NÃO é modal de propósito: um pedido chegando no meio de um combate não
 * pode travar a mesa de quem o recebeu. Fica ancorado, por cima do HUD, e a
 * partida segue atrás dele.
 */

import React from 'react';
import type { Room } from 'colyseus.js';
import { Eye, BookOpen, Check, X, Skull, Ban } from 'lucide-react';
import { useTableStore } from '../store/game.store';
import { intents } from '../net/intents';
import type { RoomState } from '../net/schema/RoomState';

interface ViewRequestPromptProps {
  room: Room<RoomState>;
}

const ROTULO: Record<string, string> = {
  HAND: 'a sua mão',
  LIBRARY: 'o seu grimório',
  GRAVEYARD: 'o seu cemitério',
  EXILE: 'o seu exílio',
};

function IconeDaZona({ zone }: { zone: string }) {
  if (zone === 'LIBRARY') return <BookOpen className="h-4 w-4" />;
  if (zone === 'GRAVEYARD') return <Skull className="h-4 w-4" />;
  if (zone === 'EXILE') return <Ban className="h-4 w-4" />;
  return <Eye className="h-4 w-4" />;
}

export function ViewRequestPrompt({ room }: ViewRequestPromptProps) {
  const pedidos = useTableStore((s) => s.pedidosDeVista);
  const remover = useTableStore((s) => s.removerPedidoDeVista);

  if (pedidos.length === 0) return null;

  const responder = (requesterId: string, zone: string, aceitar: boolean) => {
    intents.respondView(room, requesterId, zone, aceitar);
    remover(requesterId, zone);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-3">
      {pedidos.map((p) => (
        <div
          key={`${p.requesterId}:${p.zone}`}
          className="painel-entra border-warning/50 bg-panel/95 pointer-events-auto flex w-full max-w-md flex-col gap-3 rounded-xl border p-3 shadow-2xl backdrop-blur sm:flex-row sm:items-center"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="bg-warning/15 text-warning flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
              <IconeDaZona zone={p.zone} />
            </span>
            <p className="text-text min-w-0 text-xs leading-snug">
              <span className="font-bold">{p.requesterName}</span> quer ver{' '}
              <span className="font-bold">{ROTULO[p.zone] ?? 'uma zona sua'}</span>.
              <span className="text-text-faint block">
                Enquanto você não responder, ninguém vê nada.
              </span>
            </p>
          </div>

          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => responder(p.requesterId, p.zone, true)}
              className="bg-success flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white transition-transform active:scale-95"
            >
              <Check className="h-3.5 w-3.5" />
              Mostrar
            </button>
            <button
              onClick={() => responder(p.requesterId, p.zone, false)}
              className="border-panel-border text-text-muted hover:border-danger hover:text-danger flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Recusar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
