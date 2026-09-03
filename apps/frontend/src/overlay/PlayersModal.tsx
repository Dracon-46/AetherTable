'use client';

/**
 * PlayersModal.tsx — quem está na mesa, e o que dá para fazer com cada um.
 *
 * Era um placar somente-leitura com um rodapé confessando que expulsar não
 * existia. Todo o resto do jogo social — pedir para ver a mão de alguém,
 * mandar uma permanente para a mesa de outro, tirar da sala quem entrou com um
 * código vazado — ou não tinha superfície nenhuma, ou existia no servidor sem
 * botão que a alcançasse.
 *
 * PEDIR NÃO É VER. `INTENT_REQUEST_VIEW` só faz chegar um convite ao dono da
 * zona; a identidade das cartas só sai do servidor depois de ele aceitar
 * (RN13). É por isso que o botão diz "pedir", e não "ver".
 */

import React, { useState } from 'react';
import type { Room } from 'colyseus.js';
import { useUIStore, useGameStore } from '../store/game.store';
import { X, Users, Mic, Eye, BookOpen, Send, UserX, Crown, Flag } from 'lucide-react';
import { useVoiceStore } from '../net/voice';
import { intents } from '../net/intents';
import { useToast } from '../components/Toast';
import type { RoomState } from '../net/schema/RoomState';
import { useFecharComEsc } from './useFecharComEsc';
import { DenunciarJogador } from './DenunciarJogador';

interface PlayersModalProps {
  room: Room<RoomState>;
}

export function PlayersModal({ room }: PlayersModalProps) {
  const activeModals = useUIStore((s) => s.activeModals);
  const toggleModal = useUIStore((s) => s.toggleModal);
  const selectedCardIds = useUIStore((s) => s.selectedCardIds);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const playersMap = useGameStore((s) => s.players);
  const cards = useGameStore((s) => s.cards);
  const myId = useGameStore((s) => s.mySessionId);
  const speaking = useVoiceStore((s) => s.speaking);

  /**
   * O jogador que está sendo denunciado, se algum.
   *
   * Estado aqui e não no `uiStore`: a denúncia é sobre UMA pessoa e morre
   * quando o modal fecha — não é preferência nem estado da mesa, e persistir um
   * alvo de denúncia entre partidas seria só uma forma de reabrir o formulário
   * apontado para quem não está mais na sala.
   */
  const [denunciando, setDenunciando] = useState<{
    id: string;
    userId: string;
    name: string;
  } | null>(null);

  // Hook ANTES de qualquer retorno antecipado: o `CardInspector` já derrubou a
  // mesa uma vez por chamar um `useEffect` depois de um `return null`.
  useFecharComEsc(activeModals.players, () => toggleModal('players'));

  if (!activeModals.players) return null;

  const players = Object.values(playersMap).sort((a, b) => a.seat - b.seat);
  const eu = myId ? playersMap[myId] : undefined;
  const souAnfitriao = eu?.seat === 0;

  /**
   * As permanentes selecionadas que EU controlo e que estão no campo.
   *
   * "Enviar para a mesa de" é uma ação sobre a seleção, não sobre um menu de
   * carta: quem doa criaturas costuma doar em bloco, e abrir o menu de contexto
   * de cada uma é o tipo de atrito que faz a função deixar de ser usada.
   */
  const enviaveis = selectedCardIds
    .map((id) => cards[id])
    .filter((c) => c && c.controllerId === myId && c.zone === 'BATTLEFIELD');

  const enviar = (alvoId: string) => {
    enviaveis.forEach((c) => c && intents.giveCard(room, c.id, alvoId));
    useToast
      .getState()
      .mostrar(
        `${enviaveis.length} permanente(s) enviada(s) para ${playersMap[alvoId]?.name ?? 'o jogador'}.`,
        'sucesso',
      );
    clearSelection();
  };

  const pedir = (alvoId: string, zone: 'HAND' | 'LIBRARY') => {
    intents.requestView(room, alvoId, zone);
    useToast
      .getState()
      .mostrar(
        `Pedido enviado. ${playersMap[alvoId]?.name ?? 'O jogador'} precisa aceitar.`,
        'info',
      );
  };

  const remover = (alvoId: string) => {
    intents.kickPlayer(room, alvoId);
  };

  const acao =
    'flex items-center gap-1.5 rounded-md border border-panel-border bg-panel px-2.5 py-1.5 text-[11px] text-text transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) toggleModal('players');
      }}
    >
      <div className="modal-entra border-panel-border bg-panel flex max-h-[85dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border shadow-2xl">
        <div className="border-panel-border flex items-center justify-between border-b px-4 py-4 sm:px-6">
          <h2 className="flex items-center gap-2 text-lg font-bold text-white sm:text-xl">
            <Users className="text-primary h-5 w-5" />
            Jogadores na mesa
          </h2>
          <button
            onClick={() => toggleModal('players')}
            className="text-text hover:bg-danger/20 rounded p-2 transition-colors hover:text-white"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {enviaveis.length > 0 && (
          <p className="border-panel-border bg-primary/10 text-primary border-b px-4 py-2 text-xs sm:px-6">
            {enviaveis.length} permanente(s) selecionada(s) — escolha para quem enviar.
          </p>
        )}

        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-6">
          {players.map((player) => {
            const souEu = player.id === myId;
            // Quem já tem permissão sobre a minha mão / grimório aparece com o
            // pedido marcado: insistir num pedido já aceito é ruído.
            const jaVejoMao = (player.sharedZones?.HAND ?? '').split(',').includes(myId);
            const jaVejoGrimorio = (player.sharedZones?.LIBRARY ?? '').split(',').includes(myId);

            return (
              <div
                key={player.id}
                className="border-panel-border bg-table-deep flex flex-col gap-3 rounded-lg border p-3 sm:p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="bg-primary/20 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold">
                    {player.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-bold text-white">{player.name}</span>
                      {player.seat === 0 && (
                        <Crown className="text-warning h-3.5 w-3.5" aria-label="Anfitrião" />
                      )}
                      {souEu && (
                        <span className="bg-primary/20 text-primary rounded px-2 py-0.5 text-[10px] font-bold uppercase">
                          Você
                        </span>
                      )}
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${player.connected ? 'bg-success' : 'bg-warning'}`}
                        title={player.connected ? 'Conectado' : 'Desconectado'}
                      />
                      {speaking.includes(player.userId) && (
                        <Mic className="text-speaking h-3.5 w-3.5 shrink-0" aria-label="Falando" />
                      )}
                    </div>
                    <span className="text-text-muted text-xs">
                      Assento {player.seat + 1} · {player.life} PV · {player.libraryCount} no
                      grimório · {player.handCount} na mão
                    </span>
                  </div>
                </div>

                {!souEu && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => pedir(player.id, 'HAND')}
                      disabled={jaVejoMao}
                      className={acao}
                      title={
                        jaVejoMao
                          ? 'Você já tem permissão para ver esta mão'
                          : 'Pede permissão para ver a mão. Ele decide.'
                      }
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {jaVejoMao ? 'Mão liberada' : 'Pedir para ver a mão'}
                    </button>

                    <button
                      onClick={() => pedir(player.id, 'LIBRARY')}
                      disabled={jaVejoGrimorio}
                      className={acao}
                      title={
                        jaVejoGrimorio
                          ? 'Você já tem permissão para ver este grimório'
                          : 'Pede permissão para ver o grimório. Ele decide.'
                      }
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                      {jaVejoGrimorio ? 'Grimório liberado' : 'Pedir para ver o baralho'}
                    </button>

                    <button
                      onClick={() => enviar(player.id)}
                      disabled={enviaveis.length === 0}
                      className={acao}
                      title={
                        enviaveis.length === 0
                          ? 'Selecione uma ou mais permanentes suas no campo primeiro'
                          : `Passa o controle para ${player.name} — a carta vai para a mesa dele`
                      }
                    >
                      <Send className="h-3.5 w-3.5" />
                      Enviar carta para a mesa dele
                    </button>

                    {/* ── DENUNCIAR ────────────────────────────────────────
                        A tabela `reports` existia no banco desde o início e
                        NENHUMA tela escrevia nela: denunciar era impossível, e
                        a fila da moderação nunca enchia por construção.

                        Fica ao lado de "remover da sala" porque as duas são a
                        resposta a uma conduta — mas só o anfitrião remove, e
                        qualquer pessoa denuncia. Numa mesa em que o próprio
                        anfitrião é o problema, expulsar não é uma opção
                        disponível a quem sofre. */}
                    <button
                      onClick={() =>
                        setDenunciando({
                          id: player.id,
                          userId: player.userId,
                          name: player.name,
                        })
                      }
                      disabled={!player.userId}
                      className="border-warning/40 text-warning hover:bg-warning/20 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                      title={
                        player.userId
                          ? `Envia uma denúncia à moderação com as últimas linhas do log`
                          : 'Este jogador não tem conta identificada nesta sala'
                      }
                    >
                      <Flag className="h-3.5 w-3.5" />
                      Denunciar
                    </button>

                    {souAnfitriao && (
                      <button
                        onClick={() => remover(player.id)}
                        className="border-danger/40 text-danger hover:bg-danger flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] transition-colors hover:text-white"
                        title={`Remove ${player.name} da sala imediatamente`}
                      >
                        <UserX className="h-3.5 w-3.5" />
                        Remover da sala
                      </button>
                    )}
                  </div>
                )}

                {/* Quem eu deixei ver minhas zonas — e como fechar. Uma
                    permissão sem forma de revogar não é permissão, é entrega. */}
                {souEu && Object.keys(player.sharedZones ?? {}).length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-text-muted text-[11px] font-bold uppercase">
                      Você abriu:
                    </span>
                    {Object.entries(player.sharedZones ?? {}).flatMap(([zona, lista]) =>
                      String(lista)
                        .split(',')
                        .filter(Boolean)
                        .map((sid) => (
                          <button
                            key={`${zona}:${sid}`}
                            onClick={() => intents.revokeView(room, sid, zona)}
                            className="border-warning/40 bg-warning/10 text-warning hover:border-danger hover:bg-danger/20 hover:text-danger flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors"
                            title="Fechar esta zona para este jogador"
                          >
                            {zona === 'HAND' ? 'mão' : zona === 'LIBRARY' ? 'grimório' : zona} →{' '}
                            {playersMap[sid]?.name ?? sid.slice(0, 6)}
                            <X className="h-3 w-3" />
                          </button>
                        )),
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {denunciando && (
        <DenunciarJogador jogador={denunciando} onFechar={() => setDenunciando(null)} />
      )}
    </div>
  );
}
