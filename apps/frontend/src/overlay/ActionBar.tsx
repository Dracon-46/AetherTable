'use client';

/**
 * ActionBar.tsx — Barra de Ações da Mesa (DOC-040 §2).
 *
 * ─── POR QUE ELA COMEÇA ESCONDIDA ──────────────────────────────────────────
 *
 * A barra tem quatorze botões e mora na borda inferior — exatamente sobre a
 * faixa de mão, que é a parte da mesa em que o jogador mais olha e onde ele
 * arrasta cartas. Fixa, ela cobre permanentemente ~64px do tabuleiro para
 * oferecer ações que se usam algumas vezes por turno.
 *
 * Recolhida, sobra uma seta. A preferência é lembrada (uiStore), então quem
 * gosta dela aberta não reabre a cada partida.
 *
 * ─── DOIS FREIOS QUE NÃO EXISTIAM ──────────────────────────────────────────
 *
 * 1. MULLIGAN. O botão ficava sempre ativo e devolvia a mão inteira ao grimório
 *    no turno seis. O servidor agora fecha a janela (`MULLIGAN_CLOSED`), e aqui
 *    o botão simplesmente some quando ela fecha — um botão que só produz erro é
 *    pior do que botão nenhum.
 *
 * 2. DADO E MOEDA. Cada rolagem é um broadcast para a mesa inteira e uma linha
 *    de log em todos os clientes. Segurar o botão gerava dezenas por segundo,
 *    todas dentro do limite geral de intenções — porque cada uma é uma intenção
 *    válida. O servidor tem o teto real; o contador aqui existe para o jogador
 *    VER o freio em vez de levar uma sequência de toasts de recusa.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Coins,
  Dices,
  BookOpen,
  Ghost,
  LogOut,
  Mic,
  MicOff,
  RefreshCcw,
  Repeat,
  Search,
  Shuffle,
  Trash2,
  Undo2,
  Users,
} from 'lucide-react';
import type { Room } from 'colyseus.js';
import { intents } from '../net/intents';
import { useRouter } from 'next/navigation';
import { useGameStore, useUIStore } from '../store/game.store';
import { useVoiceStore } from '../net/voice';
import { useToast } from '../components/Toast';
import type { RoomState } from '../net/schema/RoomState';
import { esquecerReconexao } from '@/net/reconexao';

interface ActionBarProps {
  room: Room<RoomState>;
}

const DICE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;

/**
 * Teto de sorteios do CLIENTE. Espelha `REALTIME_LIMITS` do servidor de
 * propósito: o servidor é quem decide (o cliente é adversário), mas repetir o
 * número aqui é o que transforma a recusa em algo previsível — o botão fica
 * cinza e diz quanto falta, em vez de aceitar o clique e devolver erro.
 */
const MAX_SORTEIOS = 5;
const JANELA_SORTEIO_MS = 8000;

/** Fecha um menu suspenso ao clicar fora dele. */
function useFecharAoClicarFora<T extends HTMLElement>(aberto: boolean, fechar: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!aberto) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) fechar();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [aberto, fechar]);
  return ref;
}

/**
 * Janela deslizante de sorteios.
 *
 * Devolve `permitir()` — que já avisa o jogador quando recusa — e `restantes`,
 * usado para esmaecer os botões antes do limite, e não depois.
 */
function useFreioDeSorteio() {
  const carimbos = useRef<number[]>([]);
  const [restantes, setRestantes] = useState(MAX_SORTEIOS);

  const recalcular = useCallback(() => {
    const agora = Date.now();
    carimbos.current = carimbos.current.filter((t) => agora - t < JANELA_SORTEIO_MS);
    setRestantes(Math.max(0, MAX_SORTEIOS - carimbos.current.length));
    return carimbos.current.length;
  }, []);

  // O contador precisa VOLTAR sozinho: sem o relógio, o botão só destravava no
  // próximo clique — quer dizer, no clique que ia ser recusado.
  useEffect(() => {
    const t = setInterval(recalcular, 500);
    return () => clearInterval(t);
  }, [recalcular]);

  const permitir = useCallback(() => {
    const usados = recalcular();
    if (usados >= MAX_SORTEIOS) {
      const maisAntigo = carimbos.current[0] ?? Date.now();
      const faltam = Math.ceil((JANELA_SORTEIO_MS - (Date.now() - maisAntigo)) / 1000);
      useToast
        .getState()
        .mostrar(`Calma com os sorteios — tente de novo em ${Math.max(1, faltam)} s.`, 'info');
      return false;
    }
    carimbos.current.push(Date.now());
    setRestantes(Math.max(0, MAX_SORTEIOS - carimbos.current.length));
    return true;
  }, [recalcular]);

  return { permitir, restantes };
}

export function ActionBar({ room }: ActionBarProps) {
  const router = useRouter();
  const toggleModal = useUIStore((s) => s.toggleModal);
  const setInspectedZone = useUIStore((s) => s.setInspectedZone);
  const setZoneOwner = useUIStore((s) => s.setZoneOwner);
  const aberta = useUIStore((s) => s.barraAberta);
  const setAberta = useUIStore((s) => s.setBarraAberta);

  const [showDice, setShowDice] = useState(false);
  const [drawAmount, setDrawAmount] = useState(1);
  const [showDraw, setShowDraw] = useState(false);

  const myId = useGameStore((s) => s.mySessionId);
  const activePlayerId = useGameStore((s) => s.activePlayerId);
  const players = useGameStore((s) => s.players);
  const cards = useGameStore((s) => s.cards);
  const turn = useGameStore((s) => s.turn);
  const eu = myId ? players[myId] : undefined;

  // Sem vez definida (antes do primeiro turno, ou depois de um reset) qualquer
  // um pode destravar a rotação — é o que o servidor faz.
  const minhaVez = !activePlayerId || activePlayerId === myId;
  const nomeDaVez = activePlayerId ? (players[activePlayerId]?.name ?? null) : null;

  /**
   * A janela de mulligan, do lado do cliente.
   *
   * Espelha `mulliganPermitido()` do servidor. Repetir a regra aqui não é
   * duplicação inútil: o servidor decide, mas quem esconde o botão é a tela — e
   * um botão visível que sempre devolve "MULLIGAN_CLOSED" ensina o jogador a
   * ignorar os avisos da mesa.
   */
  const jaJogou = Object.values(cards).some(
    (c) =>
      c.ownerId === myId &&
      (c.zone === 'BATTLEFIELD' || c.zone === 'GRAVEYARD' || c.zone === 'EXILE'),
  );
  const podeMulligan = Boolean(eu) && !eu?.keptHand && turn <= 1 && !jaJogou;

  const voiceAvailable = useVoiceStore((s) => s.available);
  const micEnabled = useVoiceStore((s) => s.micEnabled);
  const toggleMic = useVoiceStore((s) => s.toggleMic);

  const { permitir: permitirSorteio, restantes } = useFreioDeSorteio();

  const diceRef = useFecharAoClicarFora<HTMLDivElement>(showDice, () => setShowDice(false));
  const drawRef = useFecharAoClicarFora<HTMLDivElement>(showDraw, () => setShowDraw(false));

  const handleDice = (sides: number) => {
    setShowDice(false);
    if (!permitirSorteio()) return;
    intents.rollDice(room, sides);
  };

  const handleCoin = () => {
    if (!permitirSorteio()) return;
    intents.flipCoin(room);
  };

  const handleDraw = () => {
    intents.draw(room, Math.max(1, Math.min(20, drawAmount)));
    setShowDraw(false);
  };

  const handleLeave = () => {
    // Apaga a chave ANTES de fechar: sem isto, voltar para esta mesa na mesma
    // aba tentaria reconectar num assento que acabou de ser abandonado de
    // propósito, e a falha atrasaria a entrada nova com um round-trip inútil.
    esquecerReconexao(room.roomId);
    intents.leave(room);
    room.leave();
    router.push('/dashboard');
  };

  const btn =
    'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text transition-colors hover:bg-panel-hover';
  const iconBtn =
    'flex shrink-0 items-center justify-center rounded-lg p-2 text-text transition-colors hover:bg-panel-hover';

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col items-center gap-1 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {/* A aba. Sempre visível, sempre no mesmo lugar: é a única parte da barra
          que o jogador precisa encontrar sem procurar. */}
      <button
        onClick={() => setAberta(!aberta)}
        className="border-panel-border bg-panel/95 text-text-muted hover:text-primary hover:border-primary pointer-events-auto flex items-center gap-1.5 rounded-full border px-4 py-1 text-[11px] font-bold shadow-lg backdrop-blur transition-colors"
        aria-expanded={aberta}
        title={aberta ? 'Esconder a barra de ações' : 'Mostrar a barra de ações'}
      >
        {aberta ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        <span>Ações</span>
      </button>

      {aberta && (
        <div className="no-scrollbar border-panel-border bg-panel/95 pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border px-2 py-2 shadow-xl backdrop-blur">
          {/* Comprar carta */}
          <div className="relative shrink-0" ref={drawRef}>
            <button
              onClick={() => intents.draw(room, 1)}
              onContextMenu={(e) => {
                e.preventDefault();
                setShowDraw((v) => !v);
              }}
              title="Comprar 1 carta (botão direito para escolher a quantidade)"
              className={`${btn} hover:text-primary`}
            >
              <BookOpen className="h-4 w-4" />
              <span className="hidden sm:inline">Comprar</span>
            </button>
            {showDraw && (
              <div className="border-panel-border bg-panel absolute bottom-full left-0 mb-2 rounded-lg border p-2 shadow-xl">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={drawAmount}
                    onChange={(e) => setDrawAmount(Number(e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleDraw();
                    }}
                    className="border-panel-border bg-table-deep text-text w-16 rounded border px-2 py-1 text-xs"
                  />
                  <button
                    onClick={handleDraw}
                    className="bg-primary hover:bg-primary-hover rounded px-3 py-1 text-xs text-white"
                  >
                    Comprar
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => {
              setZoneOwner(myId);
              setInspectedZone('LIBRARY');
            }}
            title="Buscar no grimório"
            className={`${btn} hover:text-warning`}
          >
            <Search className="h-4 w-4" />
            <span className="hidden lg:inline">Buscar</span>
          </button>

          <button
            onClick={() => intents.shuffle(room)}
            title="Embaralhar grimório"
            className={`${btn} hover:text-primary`}
          >
            <Shuffle className="h-4 w-4" />
            <span className="hidden lg:inline">Embaralhar</span>
          </button>

          <button
            onClick={() => intents.untapAll(room)}
            title="Desvirar todas as cartas (início do turno)"
            className={`${btn} hover:text-success`}
          >
            <RefreshCcw className="h-4 w-4" />
            <span className="hidden lg:inline">Desvirar</span>
          </button>

          {/* O SERVIDOR RECUSA SE NÃO FOR A SUA VEZ — o botão precisa dizer isso
              ANTES do clique. Fica visível (para saber de quem é a vez) mas
              desabilitado, e dourado quando é a sua. */}
          <button
            onClick={() => intents.passTurn(room)}
            disabled={!minhaVez}
            title={
              minhaVez
                ? 'Passar o turno'
                : nomeDaVez
                  ? `A vez é de ${nomeDaVez} — só quem está na vez passa o turno`
                  : 'Aguardando o início da rotação de turnos'
            }
            className={`${btn} ${
              minhaVez
                ? 'border-[#facc15]/60 text-[#facc15] hover:text-[#facc15]'
                : 'cursor-not-allowed opacity-40'
            }`}
          >
            <ChevronUp className="h-4 w-4" />
            <span className="hidden lg:inline">Turno</span>
          </button>

          <div className="bg-panel-border mx-1 h-5 w-px shrink-0" />

          <button
            onClick={handleCoin}
            disabled={restantes === 0}
            title={
              restantes === 0
                ? 'Muitos sorteios seguidos — aguarde alguns segundos'
                : `Girar moeda (${restantes} sorteios disponíveis)`
            }
            className={`${iconBtn} hover:text-speaking disabled:cursor-not-allowed disabled:opacity-30`}
          >
            <Coins className="h-4 w-4" />
          </button>

          <button
            onClick={() => toggleModal('players')}
            title="Jogadores: pedir para ver a mão, enviar cartas, remover da sala"
            className={`${iconBtn} hover:text-primary`}
          >
            <Users className="h-4 w-4" />
          </button>

          {/* Dados */}
          <div className="relative shrink-0" ref={diceRef}>
            <button
              onClick={() => setShowDice((v) => !v)}
              disabled={restantes === 0}
              title={
                restantes === 0
                  ? 'Muitos sorteios seguidos — aguarde alguns segundos'
                  : `Rolar dado (${restantes} sorteios disponíveis)`
              }
              className={`${iconBtn} hover:text-speaking disabled:cursor-not-allowed disabled:opacity-30`}
            >
              <Dices className="h-4 w-4" />
            </button>
            {showDice && (
              <div className="border-panel-border bg-panel absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-xl border p-2 shadow-xl">
                <div className="grid grid-cols-4 gap-1">
                  {DICE_SIDES.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleDice(s)}
                      className="bg-panel-hover text-text hover:bg-speaking/20 hover:text-speaking rounded px-2 py-1.5 font-mono text-xs transition-colors"
                    >
                      D{s}
                    </button>
                  ))}
                </div>
                <p className="text-text-faint mt-1.5 text-center text-[10px]">
                  {restantes} de {MAX_SORTEIOS} nesta janela
                </p>
              </div>
            )}
          </div>

          {/* Mulligan só existe enquanto a janela dele existe. */}
          {podeMulligan && (
            <button
              onClick={() => intents.mulligan(room)}
              title="Fazer mulligan (só antes da primeira jogada)"
              className={`${iconBtn} hover:text-primary`}
            >
              <Repeat className="h-4 w-4" />
            </button>
          )}

          <button
            onClick={() => toggleModal('tokens')}
            title="Gerar token"
            className={`${iconBtn} hover:text-primary`}
          >
            <Ghost className="h-4 w-4" />
          </button>

          <button
            onClick={() => intents.clearTokens(room)}
            title="Remover todos os tokens"
            className={`${iconBtn} hover:text-danger`}
          >
            <Trash2 className="h-4 w-4" />
          </button>

          <button
            onClick={() => intents.undo(room)}
            title="Desfazer a última ação própria (até 10 s). Não desfaz sorteio nem revelação."
            className={`${iconBtn} hover:text-warning`}
          >
            <Undo2 className="h-4 w-4" />
          </button>

          <div className="bg-panel-border mx-1 h-5 w-px shrink-0" />

          {voiceAvailable && (
            <button
              onClick={toggleMic}
              title={micEnabled ? 'Mutar microfone' : 'Ativar microfone'}
              className={`${iconBtn} ${
                micEnabled
                  ? 'hover:bg-speaking/20 hover:text-speaking'
                  : 'bg-danger/10 text-danger hover:bg-danger hover:text-white'
              }`}
            >
              {micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            </button>
          )}

          <button
            onClick={handleLeave}
            title="Sair da sala"
            className={`${iconBtn} text-text-faint hover:bg-danger/10 hover:text-danger`}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
