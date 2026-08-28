'use client';

if (typeof Symbol.metadata === 'undefined') {
  (Symbol as any).metadata = Symbol.for('Symbol.metadata');
}

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import * as Colyseus from 'colyseus.js';
import { WS_URL, API_URL } from '@/lib/api';
import { AETHER_ROOM } from '@aethertable/shared-types';
import { useRoomSync } from '@/net/useRoomSync';
import { RoomState } from '@/net/schema/RoomState';
import { LifePanel } from '@/overlay/LifePanel';
import { ActionBar } from '@/overlay/ActionBar';
import { ChatLog } from '@/overlay/ChatLog';
import { CardInspector } from '@/overlay/CardInspector';
import { TokenPicker } from '@/overlay/TokenPicker';
import { ZoneInspector } from '@/overlay/ZoneInspector';
import { CameraControls } from '@/overlay/CameraControls';
import { useAuthStore } from '@/store/auth.store';
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import { MulliganModal } from '../../../overlay/MulliganModal';
import { PlayersModal } from '../../../overlay/PlayersModal';

// Konva falha no SSR, então precisamos importar o GameBoard dinamicamente
const GameBoard = dynamic(() => import('../../../canvas/GameBoard'), { ssr: false });

export default function PlayRoomPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = params.roomId as string;
  const token = searchParams.get('token');
  const maxClientsParam = searchParams.get('maxClients');
  const gameTypeParam = searchParams.get('gameType');
  const maxClients = maxClientsParam ? parseInt(maxClientsParam, 10) : undefined;
  const gameType = gameTypeParam || undefined;

  const { accessToken } = useAuthStore();
  const [room, setRoom] = useState<Colyseus.Room<RoomState> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceToken, setVoiceToken] = useState<string | null>(null);

  useRoomSync(room);

  useEffect(() => {
    if (!roomId || !accessToken) return;
    let active = true;
    
    fetch(`${API_URL}/matches/${roomId}/voice-token`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    .then(res => res.json())
    .then(data => {
      if (active && data.token) setVoiceToken(data.token);
    })
    .catch(err => console.error('Voice token falhou:', err));
    
    return () => { active = false; };
  }, [roomId, accessToken]);

  useEffect(() => {
    if (!roomId || !token) {
      setError('Sala ou Token ausente.');
      return;
    }

    let active = true;
    let joinedRoom: Colyseus.Room<RoomState> | null = null;
    const client = new Colyseus.Client(WS_URL);

    client.joinOrCreate<RoomState>(AETHER_ROOM, { roomCode: roomId, seatToken: token, maxClients, gameType }, RoomState)
      .then((r) => {
        if (!active) {
          r.leave();
          return;
        }
        joinedRoom = r;
        setRoom(r);
      })
      .catch((e) => {
        if (!active) return;
        console.error('Colyseus join error', e);
        setError('Falha ao conectar na Mesa. O token pode ser inválido ou a sala está cheia.');
      });

    return () => {
      active = false;
      if (joinedRoom) {
        joinedRoom.leave();
      }
    };
  }, [roomId, token, maxClients, gameType]);

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

  const Content = (
    <div className="h-screen w-full bg-[#111111] overflow-hidden relative">
      <GameBoard room={room} />
      
      {/* UI Overlay (Camada 2) */}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {/* Info da Sala */}
        <div className="absolute top-4 left-4 bg-panel/80 backdrop-blur border border-panel-border px-4 py-2 rounded shadow-lg flex flex-col pointer-events-auto">
          <span className="text-xs text-text-muted">SALA</span>
          <span className="font-mono font-bold text-primary tracking-widest">{roomId}</span>
        </div>

        <CameraControls />
        <LifePanel room={room} />
        <ActionBar room={room} />
        <ChatLog room={room} />
        <CardInspector />
        <TokenPicker room={room} />
        <ZoneInspector room={room} />
        <MulliganModal room={room} />
        <PlayersModal room={room} />
      </div>
    </div>
  );

  if (voiceToken) {
    return (
      <LiveKitRoom
        video={false}
        audio={true}
        token={voiceToken}
        serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL || 'wss://aether-livekit-mock.livekit.cloud'}
        connect={true}
      >
        <RoomAudioRenderer />
        {Content}
      </LiveKitRoom>
    );
  }

  return Content;
}
