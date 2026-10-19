/**
 * credencial-de-voz.ts — do passe de voz do game-server à credencial do
 * LiveKit.
 *
 * ─── O SEAT TOKEN DEIXOU DE VALER PARA A VOZ ───────────────────────────────
 *
 * A credencial do LiveKit era pedida com o seat token (`X-Passe-De-Mesa`).
 * Só que a API emite seat token para qualquer código de sala — e a vitrine
 * lista os códigos das mesas públicas. Agora a prova de "esta conta está NESTA
 * sala" é o passe de voz, que só o game-server emite, e só a quem ele de fato
 * aceitou na sala.
 */

import { useEffect, useState } from 'react';
import type { Room } from 'colyseus.js';
import type { PasseDeVozEvent } from '@aethertable/shared-types';
import { API_URL } from '@/lib/api';

/**
 * Guarda o passe de voz que o game-server manda ao aceitar a entrada, e de
 * novo a cada reconexão.
 *
 * ─── PRECISA SER REGISTRADO NO MESMO TICK DO JOIN ─────────────────────────
 *
 * O servidor envia o passe logo depois do estado inicial, e o colyseus.js
 * DESCARTA mensagem sem handler registrado. Registrar no `useRoomSync` — num
 * efeito, depois do render que o `setRoom` provoca — chegaria tarde: quem
 * chama isto é o `.then` do `joinOrCreate`/`reconnect`.
 */
export function escutarPasseDeVoz(
  room: Pick<Room, 'onMessage'>,
  aoReceber: (passe: string) => void,
): void {
  room.onMessage('passe-de-voz', (payload: PasseDeVozEvent) => {
    if (typeof payload.token === 'string' && payload.token) aoReceber(payload.token);
  });
}

interface PedidoDeVoz {
  roomId: string;
  accessToken: string | null;
  /** O passe recebido do game-server; `null` até ele chegar. */
  passeDeVoz: string | null;
  /** `NEXT_PUBLIC_LIVEKIT_URL`; vazio = a mesa roda sem voz. */
  servidorDeVoz: string;
}

/** A credencial do LiveKit para esta sala, ou `null` enquanto não houver voz. */
export function useCredencialDeVoz({
  roomId,
  accessToken,
  passeDeVoz,
  servidorDeVoz,
}: PedidoDeVoz): string | null {
  const [credencial, setCredencial] = useState<string | null>(null);

  useEffect(() => {
    // Sem servidor de voz não há a quem conectar; sem passe, a API recusaria.
    // Esperar o passe é o caminho: ele chega logo depois da entrada.
    if (!servidorDeVoz || !roomId || !accessToken || !passeDeVoz) return;
    let ativo = true;

    fetch(`${API_URL}/matches/${encodeURIComponent(roomId)}/voice-token`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'X-Passe-De-Voz': passeDeVoz },
    })
      // `token: null` (com `motivo`) é a voz desligada: a mesa segue sem ela.
      .then((res) => (res.ok ? (res.json() as Promise<{ token?: string | null }>) : null))
      .then((data) => {
        if (ativo && data?.token) setCredencial(data.token);
      })
      .catch((err) => console.error('Voice token falhou:', err));

    return () => {
      ativo = false;
    };
  }, [roomId, accessToken, passeDeVoz, servidorDeVoz]);

  return credencial;
}
