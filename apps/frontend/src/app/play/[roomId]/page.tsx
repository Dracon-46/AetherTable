'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import * as Colyseus from 'colyseus.js';
import { WS_URL } from '@/lib/api';

// Konva falha no SSR, então precisamos importar o GameBoard dinamicamente
const GameBoard = dynamic(() => import('./GameBoard'), { ssr: false });

export default function PlayRoomPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = params.roomId as string;
  const token = searchParams.get('token');

  const [room, setRoom] = useState<Colyseus.Room | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!roomId || !token) {
      setError('Sala ou Token ausente.');
      return;
    }

    const client = new Colyseus.Client(WS_URL);

    client.joinById(roomId, { seatToken: token })
      .then((joinedRoom) => {
        setRoom(joinedRoom);
      })
      .catch((e) => {
        console.error('Colyseus join error', e);
        setError('Falha ao conectar na Mesa. O token pode ser inválido ou a sala está cheia.');
      });

    return () => {
      if (room) {
        room.leave();
      }
    };
  }, [roomId, token]);

  if (error) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background text-text flex-col gap-4">
        <h1 className="text-2xl font-bold text-danger">Conexão Recusada</h1>
        <p className="text-text-muted">{error}</p>
        <button 
          onClick={() => window.location.href = '/dashboard'}
          className="px-4 py-2 bg-panel border border-panel-border rounded hover:border-primary transition-colors"
        >
          Voltar para a Taverna
        </button>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background text-text flex-col gap-4">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="animate-pulse">Sincronizando com a mesa de jogo...</p>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-[#111111] overflow-hidden relative">
      <GameBoard room={room} />
      
      {/* UI Overlay Simples */}
      <div className="absolute top-4 left-4 bg-panel/80 backdrop-blur border border-panel-border px-4 py-2 rounded shadow-lg flex flex-col pointer-events-none">
        <span className="text-xs text-text-muted">SALA</span>
        <span className="font-mono font-bold text-primary tracking-widest">{roomId}</span>
      </div>
    </div>
  );
}
