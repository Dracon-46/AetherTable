'use client';

if (typeof Symbol.metadata === 'undefined') {
  (Symbol as unknown as { metadata: symbol }).metadata = Symbol.for('Symbol.metadata');
}

import { useCallback, useEffect, useState } from 'react';
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
import { ContextMenu } from '@/overlay/ContextMenu';
import { ScryModal } from '@/overlay/ScryModal';
import { TableMenu } from '@/overlay/TableMenu';
import { SelectionBar } from '@/overlay/SelectionBar';
import { CardHoverPreview } from '@/overlay/CardHoverPreview';
import { CardEditor } from '@/overlay/CardEditor';
import { useAtalhosDaMesa } from '@/net/atalhos';
import { useCosmeticos } from '@/cosmetics/store';
import { RoomLobby } from '@/overlay/RoomLobby';
import { MulliganModal } from '@/overlay/MulliganModal';
import { PlayersModal } from '@/overlay/PlayersModal';
import { VoiceBridge } from '@/net/voice';
import { useAuthStore } from '@/store/auth.store';
import { useGameStore } from '@/store/game.store';
import { intents } from '@/net/intents';
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';

// Konva falha no SSR, então o GameBoard entra dinamicamente.
const GameBoard = dynamic(() => import('@/canvas/GameBoard'), { ssr: false });

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
  const phase = useGameStore((s) => s.phase);

  /**
   * Gesto de dois toques compartilhado por SETA e ANEXAR: o menu de contexto
   * arma o modo, o tabuleiro recebe o segundo clique. Arrastar já significa
   * "mover a carta", então nenhum dos dois pode ser um arraste.
   */
  const [modoAnexar, setModoAnexar] = useState(false);
  const encerrarGesto = useCallback(() => setModoAnexar(false), []);

  // Teclado da mesa. Só depois de a partida começar: na sala de espera as
  // teclas pertencem ao lobby.
  useAtalhosDaMesa(room, phase !== 'WAITING');

  // Anuncia os cosméticos equipados assim que a sala aceita a conexão. Eles
  // vivem no cliente (localStorage) porque a mesa não pode esperar um
  // round-trip de API para saber com que sleeve desenhar as cartas — mas os
  // OUTROS jogadores só sabem por aqui.
  const sleeveId = useCosmeticos((s) => s.sleeveId);
  const playmatId = useCosmeticos((s) => s.playmatId);
  const borderId = useCosmeticos((s) => s.borderId);
  const titleId = useCosmeticos((s) => s.titleId);
  const petId = useCosmeticos((s) => s.petId);

  useEffect(() => {
    if (!room) return;
    intents.setCosmetics(room, { sleeveId, playmatId, borderId, titleId, petId });
  }, [room, sleeveId, playmatId, borderId, titleId, petId]);

  useEffect(() => {
    if (!roomId || !accessToken) return;
    let active = true;

    fetch(`${API_URL}/matches/${roomId}/voice-token`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data?.token) setVoiceToken(data.token);
      })
      .catch((err) => console.error('Voice token falhou:', err));

    return () => {
      active = false;
    };
  }, [roomId, accessToken]);

  useEffect(() => {
    if (!roomId || !token) {
      setError('Sala ou token ausente.');
      return;
    }

    let active = true;
    let joinedRoom: Colyseus.Room<RoomState> | null = null;
    const client = new Colyseus.Client(WS_URL);

    client
      .joinOrCreate<RoomState>(
        AETHER_ROOM,
        { roomCode: roomId, seatToken: token, maxClients, gameType },
        RoomState,
      )
      .then((r) => {
        if (!active) {
          void r.leave();
          return;
        }
        joinedRoom = r;
        setRoom(r);
      })
      .catch((e) => {
        if (!active) return;
        console.error('Colyseus join error', e);
        setError('Falha ao conectar na mesa. O token pode ser inválido ou a sala está cheia.');
      });

    return () => {
      active = false;
      if (joinedRoom) void joinedRoom.leave();
    };
  }, [roomId, token, maxClients, gameType]);

  if (error) {
    return (
      <div className="bg-background text-text flex min-h-dvh w-full flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-danger text-2xl font-bold">Conexão recusada</h1>
        <p className="text-text-muted">{error}</p>
        <button
          onClick={() => {
            window.location.href = '/dashboard';
          }}
          className="border-panel-border bg-panel hover:border-primary rounded border px-4 py-2 transition-colors"
        >
          Voltar para a Taverna
        </button>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="bg-background text-text flex min-h-dvh w-full flex-col items-center justify-center gap-4">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <p className="animate-pulse">Sincronizando com a mesa de jogo…</p>
      </div>
    );
  }

  const emPartida = phase !== 'WAITING';

  const Content = (
    // `data-lock-scroll` faz o CSS global travar a rolagem SÓ nesta tela; antes
    // o `overflow-hidden` estava no <body> e quebrava todas as outras páginas.
    <div
      data-lock-scroll
      className="relative h-dvh w-full overflow-hidden bg-[#111111]"
      onContextMenu={(e) => e.preventDefault()}
    >
      <GameBoard room={room} modoAnexar={modoAnexar} onAlvoEscolhido={encerrarGesto} />

      {/*
        Camada 2 — HUD. O wrapper anterior era `absolute inset-0 z-10
        overflow-hidden` e envolvia TAMBÉM os modais: o `overflow-hidden`
        recortava qualquer modal maior que a viewport, e o `z-10` os prendia
        abaixo do resto. Agora só o HUD ancorado vive aqui; modais são irmãos,
        em `fixed`, livres para ocupar a tela inteira.
      */}
      {emPartida && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <div className="border-panel-border bg-panel/80 pointer-events-auto absolute left-2 top-2 hidden flex-col rounded border px-3 py-1.5 shadow-lg backdrop-blur sm:flex">
            <span className="text-text-muted text-[10px]">SALA</span>
            <span className="text-primary font-mono text-sm font-bold tracking-widest">
              {roomId}
            </span>
          </div>

          {/* Fileira do topo direito: Camera e Mesa lado a lado. Cada um
              ancorado no proprio canto se sobrepunha ao outro e ao log. */}
          <div className="pointer-events-none absolute right-2 top-2 z-30 flex items-start justify-end gap-2 sm:right-3 sm:top-3">
            <CameraControls />
            <TableMenu room={room} />
          </div>
          <LifePanel room={room} />
          <ChatLog room={room} />
          <ActionBar room={room} />
          <SelectionBar room={room} />
          <CardHoverPreview />
          <CardInspector />
        </div>
      )}

      {/* Camadas bloqueantes e modais — fora do wrapper recortado. */}
      {emPartida && (
        <>
          <TokenPicker room={room} />
          <ZoneInspector room={room} />
          <ContextMenu room={room} setModoAnexar={setModoAnexar} />
          <ScryModal room={room} />
          <CardEditor room={room} />
          <PlayersModal />
          <MulliganModal room={room} />
        </>
      )}

      <RoomLobby room={room} maxClients={maxClients} gameType={gameType} />
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
        <VoiceBridge />
        {Content}
      </LiveKitRoom>
    );
  }

  return Content;
}
