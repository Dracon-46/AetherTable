'use client';

/**
 * TableMenu.tsx — ações de MESA que não pertencem a nenhuma carta.
 *
 * O catálogo (DOC-036 §7 e §8) lista uma família inteira de marcadores globais
 * — Dia/Noite, "O Anel te tenta", ordem de turno, rastreador de fase, sorteios,
 * desfazer — que não tinham nenhuma superfície na interface. As intenções
 * existiam no contrato; o jogador não tinha como emitir nenhuma delas.
 *
 * Vive num painel recolhido para não competir com a barra de ações, que é o
 * caminho das ações frequentes.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Room } from 'colyseus.js';
import {
  ChevronDown,
  Dices,
  Moon,
  RotateCcw,
  Shuffle,
  Sun,
  Undo2,
  Users,
  Zap,
  Eraser,
  Sparkles,
  Keyboard,
  Copy,
  Check,
  Flag,
  Maximize2,
  Minimize2,
  LogOut,
} from 'lucide-react';
import { useGameStore, useUIStore } from '../store/game.store';
import { intents } from '../net/intents';
import { AtalhosEditor } from './AtalhosEditor';
import type { RoomState } from '../net/schema/RoomState';

interface TableMenuProps {
  room: Room<RoomState>;
}

const FASES = ['Início', 'Compra', 'Principal 1', 'Combate', 'Principal 2', 'Final'] as const;

/**
 * ─── TELA CHEIA ────────────────────────────────────────────────────────────
 *
 * A mesa é montada em PIXELS REAIS da área útil e a escala da carta vem da
 * ALTURA (ver `montarMesaFocada`). Isso torna a barra de endereço do navegador
 * — 80 a 120px em desktop, mais em celular — uma perda direta de tamanho de
 * carta, e não só de "espaço".
 *
 * O estado NÃO é um `useState` que o botão alterna: o jogador sai da tela cheia
 * com Esc e com o F11 do navegador, sem passar por aqui. Um booleano local
 * ficaria dizendo "sair da tela cheia" numa janela normal. A fonte da verdade é
 * `document.fullscreenElement`, e o evento `fullscreenchange` é quem avisa.
 */
function useTelaCheia(): { cheia: boolean; alternar: () => void; suportado: boolean } {
  const [cheia, setCheia] = useState(false);
  const [suportado, setSuportado] = useState(false);

  useEffect(() => {
    // iOS Safari em iPhone não implementa a API no documento: o botão precisa
    // desaparecer, e não falhar em silêncio no clique.
    setSuportado(typeof document !== 'undefined' && Boolean(document.fullscreenEnabled));
    const aplicar = () => setCheia(Boolean(document.fullscreenElement));
    aplicar();
    document.addEventListener('fullscreenchange', aplicar);
    return () => document.removeEventListener('fullscreenchange', aplicar);
  }, []);

  const alternar = useCallback(() => {
    // `requestFullscreen` rejeita quando não há gesto do usuário ou quando a
    // página está num iframe sem `allow="fullscreen"`. Engolir a rejeição
    // mantém o painel utilizável; o estado real vem do evento, então nada
    // dessincroniza.
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  }, []);

  return { cheia, alternar, suportado };
}

export function TableMenu({ room }: TableMenuProps) {
  const [aberto, setAberto] = useState(false);
  const [mostrarAtalhos, setMostrarAtalhos] = useState(false);
  /** Duas etapas para as ações destrutivas. `null` = nada pendente. */
  const [confirmando, setConfirmando] = useState<'desistir' | 'reiniciar' | 'sair' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { cheia, alternar: alternarTelaCheia, suportado: telaCheiaSuportada } = useTelaCheia();

  const players = useGameStore((s) => s.players);
  const myId = useGameStore((s) => s.mySessionId);
  const roomCode = useGameStore((s) => s.roomId);
  const turn = useGameStore((s) => s.turn);
  const activePlayerId = useGameStore((s) => s.activePlayerId);
  // O que a mesa combinou na sala de espera. O servidor recusa
  // `INTENT_FETCH_FROM_SIDEBOARD` quando isto é falso — o botão só reflete
  // aqui a mesma regra, para o jogador não descobrir clicando.
  const sideboardPermitido = useGameStore((s) => s.config.sideboardPermitido);
  const [copiado, setCopiado] = useState(false);
  const dayNight = useGameStore((s) => s.dayNight);
  const turnPhase = useGameStore((s) => s.turnPhase);
  const setInspectedZone = useUIStore((s) => s.setInspectedZone);

  const eu = myId ? players[myId] : undefined;
  const souAnfitriao = eu?.seat === 0;

  /**
   * O TURNO É DE QUEM ESTÁ NA VEZ — inclusive para ANDAR o contador.
   *
   * "Passar o turno" já era protegido no servidor; "Avançar para o turno N" não
   * era, e é este menu que o emite (`INTENT_SET_TURN`). Qualquer jogador
   * empurrava o contador da mesa por cima da jogada de quem estava na vez.
   *
   * O servidor recusa agora (`NOT_YOUR_TURN`), e aqui o botão precisa dizer
   * isso ANTES do clique: deixá-lo ativo transformaria a regra nova num toast
   * de erro repetido.
   */
  const minhaVez = !activePlayerId || activePlayerId === myId;
  const nomeDaVez = activePlayerId ? (players[activePlayerId]?.name ?? null) : null;
  const tituloDaVez = minhaVez
    ? undefined
    : `A vez é de ${nomeDaVez ?? 'outro jogador'} — só quem está na vez mexe no turno`;

  useEffect(() => {
    if (!aberto) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setAberto(false);
        // Uma confirmação pendente não pode sobreviver ao fechamento: reabrir o
        // painel com "Confirmar" já armado é um clique acidental de distância
        // de apagar a partida da mesa inteira.
        setConfirmando(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [aberto]);

  const secao = 'border-t border-panel-border px-3 py-2.5 first:border-t-0';
  const rotulo = 'mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-text-muted';
  const chip =
    'rounded-md border border-panel-border bg-table-deep px-2 py-1.5 text-xs text-text transition-colors hover:border-primary hover:text-primary';

  return (
    // Ver CameraControls: a fileira do topo direito e quem posiciona.
    <div ref={ref} className="pointer-events-auto relative">
      <button
        onClick={() => setAberto((v) => !v)}
        className="border-panel-border bg-panel/90 text-text hover:border-primary hover:text-primary flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium shadow-lg backdrop-blur transition-colors"
        title="Ações da mesa"
      >
        <Sparkles className="text-warning h-4 w-4 shrink-0" />
        <span className="hidden sm:inline">Mesa</span>
        <span className="text-text-muted font-mono text-[10px]">T{turn}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${aberto ? 'rotate-180' : ''}`}
        />
      </button>

      {aberto && (
        // O painel tem ~726px de altura: sem limite ele passava do rodapé em
        // qualquer tela de 720p e as últimas seções ficavam inalcançáveis.
        <div className="painel-entra custom-scrollbar border-panel-border bg-panel absolute right-0 top-full mt-1 max-h-[calc(100dvh-5rem)] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border shadow-2xl">
          {/* CÓDIGO DA SALA.
              Mudou de lugar: era um crachá fixo no canto superior esquerdo do
              tabuleiro, ocupando espaço a partida inteira para mostrar um dado
              que só se usa na hora de convidar alguém. Aqui ele fica a um
              clique, junto das outras coisas que se consultam de vez em quando. */}
          <div className={secao}>
            <span className={rotulo}>Código da sala</span>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(roomCode);
                  setCopiado(true);
                  setTimeout(() => setCopiado(false), 2000);
                } catch {
                  /* sem permissão de clipboard — o código está na tela */
                }
              }}
              className={`${chip} flex w-full items-center justify-between gap-2`}
              title="Copiar o código para convidar alguém"
            >
              <span className="text-primary font-mono text-sm font-bold tracking-widest">
                {roomCode}
              </span>
              {copiado ? (
                <Check className="text-success h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {/* Turno e fase — marcadores visuais (F29). O motor não impõe turno. */}
          <div className={secao}>
            <span className={rotulo}>Turno {turn}</span>
            <div className="flex flex-wrap gap-1">
              {FASES.map((f) => (
                <button
                  key={f}
                  onClick={() => intents.setTurn(room, undefined, f)}
                  disabled={!minhaVez}
                  title={tituloDaVez}
                  className={`${chip} disabled:cursor-not-allowed disabled:opacity-40 ${turnPhase === f ? 'border-primary text-primary' : ''}`}
                >
                  {f}
                </button>
              ))}
            </div>
            <button
              onClick={() => intents.setTurn(room, turn + 1, FASES[0])}
              disabled={!minhaVez}
              title={tituloDaVez}
              className={`${chip} mt-1.5 w-full disabled:cursor-not-allowed disabled:opacity-40`}
            >
              Avançar para o turno {turn + 1}
            </button>
            {!minhaVez && nomeDaVez && (
              <span className="text-text-faint mt-1 block text-[10px]">
                A vez é de {nomeDaVez}.
              </span>
            )}
          </div>

          {/* Dia / Noite */}
          <div className={secao}>
            <span className={rotulo}>Dia / Noite</span>
            <div className="flex gap-1">
              {(
                [
                  ['DAY', 'Dia', <Sun key="s" className="h-3.5 w-3.5" />],
                  ['NIGHT', 'Noite', <Moon key="m" className="h-3.5 w-3.5" />],
                  ['NEITHER', 'Nenhum', null],
                ] as const
              ).map(([valor, texto, icone]) => (
                <button
                  key={valor}
                  onClick={() => intents.setDayNight(room, valor)}
                  className={`${chip} flex flex-1 items-center justify-center gap-1 ${
                    dayNight === valor ? 'border-warning text-warning' : ''
                  }`}
                >
                  {icone}
                  {texto}
                </button>
              ))}
            </div>
          </div>

          {/* O Anel te tenta */}
          <div className={secao}>
            <span className={rotulo}>O Anel te tenta · nível {eu?.ringLevel ?? 0}</span>
            <div className="flex gap-1">
              {[0, 1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  onClick={() => intents.setRing(room, n)}
                  className={`${chip} flex-1 ${eu?.ringLevel === n ? 'border-warning text-warning' : ''}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Taxa de comandante */}
          <div className={secao}>
            <span className={rotulo}>Taxa de comandante</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => intents.setCommanderTax(room, -2)}
                className={`${chip} flex-1`}
              >
                −2
              </button>
              <span className="text-text w-8 text-center font-mono text-sm">
                {eu?.commanderTax ?? 0}
              </span>
              <button onClick={() => intents.setCommanderTax(room, 2)} className={`${chip} flex-1`}>
                +2
              </button>
            </div>
          </div>

          {/* Sorteios — sempre CSPRNG no servidor (RN06) */}
          <div className={secao}>
            <span className={rotulo}>Sorteio</span>
            <div className="flex flex-col gap-1">
              <button
                onClick={() => intents.randomPlayer(room)}
                className={`${chip} flex items-center gap-2`}
              >
                <Users className="h-3.5 w-3.5" /> Jogador aleatório
              </button>
              <button
                onClick={() => intents.randomCard(room, 'HAND')}
                className={`${chip} flex items-center gap-2`}
              >
                <Dices className="h-3.5 w-3.5" /> Carta aleatória da mão
              </button>
              <button
                onClick={() => intents.discardRandom(room, 1)}
                className={`${chip} flex items-center gap-2`}
              >
                <Dices className="h-3.5 w-3.5" /> Descartar 1 ao acaso
              </button>
            </div>
          </div>

          {/* Manutenção de fim de turno e reserva */}
          <div className={secao}>
            <span className={rotulo}>Mesa</span>
            <div className="flex flex-col gap-1">
              <button
                onClick={() => intents.clearDamage(room)}
                className={`${chip} flex items-center gap-2`}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Limpar dano marcado
              </button>
              <button
                onClick={() => intents.clearArrows(room, 'MINE')}
                className={`${chip} flex items-center gap-2`}
              >
                <Eraser className="h-3.5 w-3.5" /> Apagar minhas setas
              </button>
              {/* Desabilitado COM O MOTIVO ESCRITO, e não escondido: a zona
                  continua existindo e o deck do jogador continua tendo reserva.
                  Sumir com o botão faria parecer que a reserva não existe nesta
                  mesa; deixá-lo cinza sem explicação faria parecer defeito. */}
              <button
                onClick={() => setInspectedZone('SIDEBOARD')}
                disabled={!sideboardPermitido}
                title={
                  sideboardPermitido
                    ? undefined
                    : 'Esta mesa combinou jogar sem reserva. O anfitrião pode liberar na sala de espera.'
                }
                className={`${chip} flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <Zap className="h-3.5 w-3.5" />
                {sideboardPermitido ? 'Abrir reserva (sideboard)' : 'Reserva desativada pela mesa'}
              </button>
              <button
                onClick={() => intents.returnZone(room, 'GRAVEYARD', 'LIBRARY', true)}
                className={`${chip} flex items-center gap-2`}
              >
                <Shuffle className="h-3.5 w-3.5" /> Cemitério → grimório
              </button>
            </div>
          </div>

          {/* Tela cheia — devolve a faixa da barra de endereço ao tabuleiro, e
              como a escala da carta vem da ALTURA útil, ela vira carta maior. */}
          {telaCheiaSuportada && (
            <div className={secao}>
              <button
                onClick={alternarTelaCheia}
                className={`${chip} flex w-full items-center gap-2`}
                title="A barra do navegador come 80–120px de altura, e a altura é o que define o tamanho da carta."
              >
                {cheia ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
                {cheia ? 'Sair da tela cheia' : 'Tela cheia'}
              </button>
            </div>
          )}

          {/* Atalhos de teclado — o editor e o listener leem a MESMA fonte
              (`ACOES_DE_ATALHO` + a preferência da conta). Documentar num lugar
              e implementar em outro é como um atalho vira mentira. */}
          <div className={secao}>
            <button
              onClick={() => setMostrarAtalhos((v) => !v)}
              className={`${chip} flex w-full items-center gap-2`}
            >
              <Keyboard className="h-3.5 w-3.5" />
              {mostrarAtalhos ? 'Esconder atalhos' : 'Atalhos de teclado'}
            </button>
            {mostrarAtalhos && <AtalhosEditor />}
          </div>

          {/* ── FIM DE PARTIDA ──────────────────────────────────────────
              `INTENT_CONCEDE` e `INTENT_RESET_MATCH` existiam no servidor e no
              emissor do cliente, e NENHUMA tela os chamava: desistir da partida
              — a única forma de um jogador sair do jogo sem sair da sala — não
              tinha botão em lugar nenhum, e o ícone de caveira do painel de
              vida nunca podia acender.

              As duas são destrutivas, então pedem confirmação. Em DUAS ETAPAS
              no próprio painel, e não `window.confirm`: o diálogo nativo trava
              a aba inteira (numa mesa em tempo real, isso é o oponente jogando
              enquanto você não vê nada) e já foi removido daqui antes. */}
          <div className={secao}>
            <span className={rotulo}>Fim de partida</span>

            {eu?.conceded ? (
              <p className="text-text-faint text-[11px] leading-snug">
                Você desistiu desta partida. Continua na sala e vendo tudo — a mesa só sabe que você
                saiu do jogo.
              </p>
            ) : confirmando === 'desistir' ? (
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    intents.concede(room);
                    setConfirmando(null);
                    setAberto(false);
                  }}
                  className="bg-danger flex-1 rounded-md px-2 py-1.5 text-xs font-bold text-white"
                >
                  Confirmar
                </button>
                <button onClick={() => setConfirmando(null)} className={`${chip} flex-1`}>
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmando('desistir')}
                className={`${chip} text-danger hover:border-danger hover:text-danger flex w-full items-center gap-2`}
                title="Marca você como fora do jogo. Não remove você da sala."
              >
                <Flag className="h-3.5 w-3.5" /> Desistir da partida
              </button>
            )}

            {souAnfitriao &&
              (confirmando === 'reiniciar' ? (
                <div className="mt-1.5 flex gap-1">
                  <button
                    onClick={() => {
                      intents.resetMatch(room);
                      setConfirmando(null);
                      setAberto(false);
                    }}
                    className="bg-danger flex-1 rounded-md px-2 py-1.5 text-xs font-bold text-white"
                  >
                    Apagar e voltar
                  </button>
                  <button onClick={() => setConfirmando(null)} className={`${chip} flex-1`}>
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmando('reiniciar')}
                  className={`${chip} mt-1.5 flex w-full items-center gap-2`}
                  title="Zera vida, contadores e turno de TODOS e devolve a mesa à sala de espera."
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reiniciar partida
                </button>
              ))}

            {/* ── SAIR DA SALA DURANTE A PARTIDA ────────────────────────────
                "Sair da sala" existia SÓ na sala de espera. Depois de a partida
                começar, a única saída era fechar a aba — o que deixa o assento
                pendurado em `disconnectedAt` esperando reconexão, e a mesa fica
                com um jogador que não vai voltar sem ninguém poder tirá-lo.

                Fica separado de "Desistir": desistir marca você como fora do
                JOGO e mantém você na sala vendo tudo; sair é sair. Confundir os
                dois é o tipo de clique que não dá para desfazer. */}
            {confirmando === 'sair' ? (
              <div className="mt-1.5 flex gap-1">
                <button
                  onClick={() => {
                    intents.leave(room);
                    room.leave();
                    router.push('/dashboard');
                  }}
                  className="bg-danger flex-1 rounded-md px-2 py-1.5 text-xs font-bold text-white"
                >
                  Sair agora
                </button>
                <button onClick={() => setConfirmando(null)} className={`${chip} flex-1`}>
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmando('sair')}
                className={`${chip} mt-1.5 flex w-full items-center gap-2`}
                title="Deixa a sala e volta para a taverna. Diferente de desistir: você não fica mais vendo a mesa."
              >
                <LogOut className="h-3.5 w-3.5" /> Sair da sala
              </button>
            )}
          </div>

          {/* Desfazer */}
          <div className={secao}>
            <button
              onClick={() => intents.undo(room)}
              className="bg-table-deep text-text hover:bg-panel-hover flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-bold transition-colors"
              title="Desfaz a última ação própria, até 10 segundos atrás. Não desfaz sorteio nem revelação."
            >
              <Undo2 className="h-4 w-4" />
              Desfazer última ação
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
