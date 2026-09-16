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
import { ExibicaoControls } from '@/overlay/ExibicaoControls';
import { ContextMenu } from '@/overlay/ContextMenu';
import { ScryModal } from '@/overlay/ScryModal';
import { TableMenu } from '@/overlay/TableMenu';
import { SelectionBar } from '@/overlay/SelectionBar';
import { CardHoverPreview } from '@/overlay/CardHoverPreview';
import { CardEditor } from '@/overlay/CardEditor';
import { useAtalhosDaMesa } from '@/net/atalhos';
import { useCosmeticos } from '@/cosmetics/store';
import { useHidratarPreferencias } from '@/store/useHidratarPreferencias';
import { RoomLobby } from '@/overlay/RoomLobby';
import { MulliganModal } from '@/overlay/MulliganModal';
import { CronometroDeTurno } from '@/overlay/CronometroDeTurno';
import { PlayersModal } from '@/overlay/PlayersModal';
import { ViewRequestPrompt } from '@/overlay/ViewRequestPrompt';
import { FimDeJogo } from '@/overlay/FimDeJogo';
import { SorteioOverlay } from '@/overlay/SorteioOverlay';
import { VoiceBridge } from '@/net/voice';
import { ToastHost } from '@/components/Toast';
import { mensagemDeConexao } from '@/net/erros';
import { esquecerReconexao, guardarReconexao, lerReconexao } from '@/net/reconexao';
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
   * ─── QUEM SO ASSISTE NAO VE CONTROLE DE MESA ────────────────────────────
   *
   * Quem manda e o TOKEN: o servidor barra toda intencao de espectador menos o
   * chat, e nao existe caminho de cliente que contorne isso. O que esta flag
   * governa e a TELA — mostrar uma barra de acoes que so produz erro seria
   * exatamente o "botao que promete o que nao existe".
   *
   * `?espectador=1` na URL nao entra nesta conta de proposito. Ele so serve
   * para a pagina saber o que desenhar no instante entre a conexao e o primeiro
   * patch; a verdade vem do estado, que vem do token.
   */
  const souEspectador = useGameStore((s) => s.souEspectador);

  /**
   * Gesto de dois toques compartilhado por SETA e ANEXAR: o menu de contexto
   * arma o modo, o tabuleiro recebe o segundo clique. Arrastar já significa
   * "mover a carta", então nenhum dos dois pode ser um arraste.
   */
  const [modoAnexar, setModoAnexar] = useState(false);
  const encerrarGesto = useCallback(() => setModoAnexar(false), []);

  // Teclado da mesa. Só depois de a partida começar: na sala de espera as
  // teclas pertencem ao lobby.
  useAtalhosDaMesa(room, phase !== 'WAITING' && !souEspectador);

  // Anuncia os cosméticos equipados assim que a sala aceita a conexão. Eles
  // vivem no cliente (localStorage) porque a mesa não pode esperar um
  // round-trip de API para saber com que sleeve desenhar as cartas — mas os
  // OUTROS jogadores só sabem por aqui.
  /**
   * Hidrata da conta ANTES de anunciar a sala.
   *
   * `INTENT_SET_COSMETICS` avisa a mesa com que sleeve desenhar minhas cartas.
   * Sem esta linha, entrar direto num link de mesa (sem passar pela taverna)
   * anunciaria o que estivesse no `localStorage` deste navegador — o padrao,
   * numa maquina nova — e o jogador apareceria para a mesa com um visual que
   * ele nao escolheu. O efeito abaixo reenvia quando os valores chegam.
   */
  useHidratarPreferencias();

  const sleeveId = useCosmeticos((s) => s.sleeveId);
  const playmatId = useCosmeticos((s) => s.playmatId);
  const borderId = useCosmeticos((s) => s.borderId);
  const titleId = useCosmeticos((s) => s.titleId);
  const petId = useCosmeticos((s) => s.petId);

  useEffect(() => {
    // Espectador nao tem `Player` para vestir: a intencao seria recusada como
    // SPECTATOR e viraria um erro na tela dele a cada troca de cosmetico.
    if (!room || souEspectador) return;
    intents.setCosmetics(room, { sleeveId, playmatId, borderId, titleId, petId });
  }, [room, souEspectador, sleeveId, playmatId, borderId, titleId, petId]);

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

    /**
     * Guarda a chave de volta assim que a sala responde.
     *
     * O `reconnectionToken` do Colyseus muda a cada conexão, então ele precisa
     * ser regravado inclusive depois de uma reconexão bem-sucedida — senão a
     * segunda recarga seguida usaria a chave da primeira, que já queimou.
     */
    const guardar = (r: Colyseus.Room<RoomState>) => {
      joinedRoom = r;
      guardarReconexao(roomId, r.reconnectionToken);
      setRoom(r);
    };

    const entrarDoZero = () =>
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
          guardar(r);
        });

    const guardada = lerReconexao(roomId);

    /**
     * Reconectar PRIMEIRO, entrar do zero só se não der.
     *
     * O seat token é de uso único (`jtisUsados` no servidor): depois da
     * primeira entrada ele é recusado com TOKEN_ALREADY_USED para sempre. Como
     * ele vive na query string, um F5 reenviava exatamente o token queimado — e
     * o jogador levava "conexão recusada" numa sala em que o assento dele ainda
     * estava guardado, esperando por 90 segundos que ninguém usava.
     *
     * A chave de reconexão resolve porque ela NÃO é o seat token: o Colyseus a
     * emite por conexão e ela vale enquanto a janela de `allowReconnection`
     * estiver aberta.
     */
    const promessa = guardada
      ? client
          .reconnect<RoomState>(guardada, RoomState)
          .then((r) => {
            if (!active) {
              void r.leave();
              return;
            }
            guardar(r);
          })
          .catch(() => {
            /**
             * Janela fechada, token já usado, ou a sala morreu. Nenhum desses é
             * erro para mostrar: o caminho normal é tentar entrar do zero, e é
             * ali que o servidor diz o motivo de verdade se também recusar.
             */
            esquecerReconexao(roomId);
            if (!active) return;
            return entrarDoZero();
          })
      : entrarDoZero();

    void promessa.catch((e) => {
      if (!active) return;
      console.error('Colyseus join error', e);
      // O servidor SEMPRE soube qual dos casos era — `onAuth` lança
      // INVALID_TOKEN, TOKEN_EXPIRED ou TOKEN_ALREADY_USED. Esta linha
      // colapsava os três num chute com três hipóteses, e o jogador ficava
      // sem saber qual delas era a dele nem o que fazer a respeito.
      setError(mensagemDeConexao(e));
    });

    return () => {
      active = false;
      /**
       * `leave(false)` — saída NÃO consentida, e a diferença é tudo.
       *
       * `leave()` sem argumento é consentida, e o servidor trata saída
       * consentida como "o jogador clicou em sair": remove o assento na hora,
       * sem janela de reconexão. Este cleanup roda em toda desmontagem —
       * inclusive na de um F5 — então a recarga destruía o próprio assento
       * antes de tentar voltar para ele.
       *
       * Sair de verdade continua funcionando: a barra de ações manda
       * `INTENT_LEAVE` antes de fechar, que remove o jogador pelo caminho
       * explícito, e `esquecerReconexao` apaga a chave.
       */
      if (joinedRoom) void joinedRoom.leave(false);
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
          {/*
            O CRACHÁ FIXO DA SALA SAIU.

            Ele ocupava o canto superior esquerdo a partida inteira para mostrar
            um código que só se usa uma vez: na hora de convidar alguém. Depois
            disso é decoração ancorada em cima do tabuleiro. O código continua
            em dois lugares onde ele é de fato procurado — a sala de espera, com
            botão de copiar, e o painel "Mesa" no topo direito.
          */}

          {/* Fileira do topo direito: Camera e Mesa lado a lado. Cada um
              ancorado no proprio canto se sobrepunha ao outro e ao log. */}
          {/* `flex-wrap` porque agora são TRÊS painéis: em tela estreita, três
              botões lado a lado com o rótulo escondido cabem, mas com o
              rótulo visível (>= sm) eles empurrariam o log para fora. */}
          <div className="pointer-events-none absolute right-2 top-2 z-30 flex max-w-[calc(100vw-1rem)] flex-wrap items-start justify-end gap-2 sm:right-3 sm:top-3">
            {/* Ele se esconde sozinho quando a mesa não combinou cronômetro —
                ver `CronometroDeTurno`. */}
            <CronometroDeTurno />
            <ExibicaoControls />
            <CameraControls />
            {!souEspectador && <TableMenu room={room} />}
          </div>
          {/* O painel de vida CONTINUA visivel para a plateia: e a informacao
              mais importante da partida, e assistir sem ela e assistir no
              escuro. O `pointer-events-none` desliga os controles em vez de
              esconder o painel — o espectador le tudo e nao clica em nada. */}
          <div className={souEspectador ? 'pointer-events-none contents' : 'contents'}>
            <LifePanel room={room} />
          </div>
          <ChatLog room={room} />
          {!souEspectador && <ActionBar room={room} />}
          {!souEspectador && <SelectionBar room={room} />}
          <CardHoverPreview />
          <CardInspector />
        </div>
      )}

      {/* Camadas bloqueantes e modais — fora do wrapper recortado. */}
      {emPartida && (
        <>
          {/* Todos estes AGEM sobre a mesa. Para a plateia eles nao ficam
              desabilitados, ficam ausentes: nao ha acao nenhuma neles que um
              espectador possa praticar, entao um menu cinza so ocuparia a tela
              e convidaria ao clique. */}
          {!souEspectador && (
            <>
              <TokenPicker room={room} />
              <ZoneInspector room={room} />
              <ContextMenu room={room} setModoAnexar={setModoAnexar} />
              <ScryModal room={room} />
              <CardEditor room={room} />
              <PlayersModal room={room} />
            </>
          )}
          {/* Pedidos de "me deixa ver sua mão". Fora do wrapper recortado: eles
              chegam a qualquer momento e precisam ficar por cima do HUD. */}
          {!souEspectador && <ViewRequestPrompt room={room} />}
          {/* Derrota e vitória. Fora do wrapper recortado: o fim de partida
              ocupa a tela inteira. */}
          <FimDeJogo />
          {/* Espectador nao tem mao inicial para decidir. */}
          {!souEspectador && <MulliganModal room={room} />}
          <SorteioOverlay />
        </>
      )}

      <RoomLobby room={room} maxClients={maxClients} gameType={gameType} />

      {/* Sem isto, nenhum toast desta tela aparece: o `ToastHost` estava
          montado só no deckbuilder, então toda rejeição da mesa era escrita
          num store que ninguém renderizava. */}
      <ToastHost />
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
