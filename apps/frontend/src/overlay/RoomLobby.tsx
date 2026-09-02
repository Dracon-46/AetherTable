'use client';

/**
 * RoomLobby.tsx — sala de espera: onde a mesa se organiza ANTES de jogar.
 *
 * ─── O QUE MUDOU, E POR QUE ────────────────────────────────────────────────
 *
 * A versão anterior era um placar: mostrava quem tinha entrado e dava ao
 * anfitrião um botão de "Iniciar partida" que funcionava a qualquer momento.
 * Três decisões que pertencem a este momento aconteciam em outro lugar — ou não
 * aconteciam:
 *
 *   1. O GRIMÓRIO era escolhido lá atrás, no painel, e viajava dentro do seat
 *      token. Quer dizer: era preciso decidir com que baralho jogar antes de
 *      saber quem sentou na mesa e que formato ia rolar. Trocar de ideia
 *      significava sair e pedir um passe novo — só que o passe é de uso único
 *      (FR-20), e o assento antigo ainda estava ocupado.
 *
 *   2. Não existia PRONTO. O anfitrião iniciava quando quisesse, e como a mão
 *      inicial é comprada no `INTENT_START_MATCH`, quem ainda estava escolhendo
 *      deck entrava na partida com zero cartas e passava a mesa inteira
 *      assistindo.
 *
 *   3. Não existia REMOVER. Numa sala privada cujo código circula em grupo,
 *      basta ele vazar uma vez para um estranho sentar — e a única saída era
 *      todo mundo sair e criar outra sala.
 *
 * As três agora vivem aqui, que é o único momento em que ainda dá para mudar de
 * ideia sem estragar a partida de mais alguém.
 */

import React, { useEffect, useState } from 'react';
import type { Room } from 'colyseus.js';
import { Check, Copy, Crown, DoorOpen, Library, Loader2, Play, UserX, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '../store/game.store';
import { useAuthStore } from '../store/auth.store';
import { intents } from '../net/intents';
import { API_URL } from '@/lib/api';
import type { RoomState } from '../net/schema/RoomState';

interface RoomLobbyProps {
  room: Room<RoomState>;
  /** Lugares contratados na criação da sala (vem da querystring). */
  maxClients?: number;
  gameType?: string;
}

interface DeckResumo {
  id: string;
  name: string;
  cardCount?: number;
  formatId?: string;
}

export function RoomLobby({ room, maxClients, gameType }: RoomLobbyProps) {
  const router = useRouter();
  const phase = useGameStore((s) => s.phase);
  const playersMap = useGameStore((s) => s.players);
  const myId = useGameStore((s) => s.mySessionId);
  const roomId = useGameStore((s) => s.roomId);
  const accessToken = useAuthStore((s) => s.accessToken);

  const [copiado, setCopiado] = useState(false);
  const [iniciando, setIniciando] = useState(false);
  const [decks, setDecks] = useState<DeckResumo[]>([]);
  const [carregandoDecks, setCarregandoDecks] = useState(true);
  const [deckEscolhido, setDeckEscolhido] = useState('');

  /**
   * A lista de grimórios vem para DENTRO da mesa.
   *
   * Antes ela só existia no painel: a sala de espera não tinha como oferecer a
   * escolha porque não sabia quais decks a conta tinha. O custo é uma
   * requisição por entrada na sala, fora de qualquer caminho crítico.
   */
  useEffect(() => {
    if (!accessToken) return;
    let ativo = true;
    fetch(`${API_URL}/decks`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((dados: DeckResumo[]) => {
        if (!ativo) return;
        setDecks(Array.isArray(dados) ? dados : []);
      })
      .catch(() => {
        /* sem lista, o jogador ainda pode ter entrado com deck pelo passe */
      })
      .finally(() => {
        if (ativo) setCarregandoDecks(false);
      });
    return () => {
      ativo = false;
    };
  }, [accessToken]);

  if (phase !== 'WAITING') return null;

  const players = Object.values(playersMap).sort((a, b) => a.seat - b.seat);
  const eu = myId ? playersMap[myId] : undefined;
  const souAnfitriao = eu?.seat === 0;
  const anfitriao = players.find((p) => p.seat === 0);

  // `maxSeats` vive no estado da sala: quem entra pelo código nunca recebeu a
  // querystring do criador, e o lobby dele mostrava um número inventado.
  const lugares = Math.max(room.state?.maxSeats ?? maxClients ?? players.length, players.length, 2);
  const codigo = room.state?.roomCode || roomId;
  const formato = room.state?.gameType || gameType || 'COMMANDER';

  const tenhoGrimorio = (eu?.libraryCount ?? 0) > 0;
  const faltamProntos = players.filter((p) => p.connected && !p.ready && p.seat !== 0);
  const semGrimorio = players.filter((p) => p.libraryCount === 0);
  const podeIniciar = faltamProntos.length === 0 && semGrimorio.length === 0 && players.length >= 1;

  const copiarCodigo = async () => {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* navegador sem permissão de clipboard — o código está visível na tela */
    }
  };

  const escolherDeck = (id: string) => {
    setDeckEscolhido(id);
    intents.setDeck(room, id);
  };

  const sair = () => {
    intents.leave(room);
    room.leave();
    router.push('/dashboard');
  };

  return (
    <div className="z-60 bg-table-deep/95 pointer-events-auto fixed inset-0 flex items-start justify-center overflow-y-auto p-4 backdrop-blur-sm sm:items-center">
      <div className="modal-entra border-panel-border bg-panel my-auto w-full max-w-3xl rounded-2xl border shadow-2xl">
        {/* Cabeçalho */}
        <div className="border-panel-border border-b p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-text text-xl font-bold sm:text-2xl">Sala de espera</h1>
              <p className="text-text-muted mt-1 text-sm">
                Escolha o grimório, confirme que está pronto. O anfitrião só inicia com a mesa
                inteira pronta.
              </p>
            </div>

            <button
              onClick={copiarCodigo}
              className="border-panel-border bg-table-deep hover:border-primary flex shrink-0 items-center gap-3 rounded-lg border px-4 py-2.5 transition-colors"
              title="Copiar código da sala"
            >
              <div className="text-left">
                <span className="text-text-muted block text-[10px] font-bold uppercase">
                  Código
                </span>
                <span className="text-primary block font-mono text-lg font-bold tracking-widest">
                  {codigo}
                </span>
              </div>
              {copiado ? (
                <Check className="text-success h-4 w-4" />
              ) : (
                <Copy className="text-text-muted h-4 w-4" />
              )}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="border-panel-border bg-table-deep text-text-muted rounded-full border px-3 py-1">
              Formato: <span className="text-text">{formato}</span>
            </span>
            <span className="border-panel-border bg-table-deep text-text-muted rounded-full border px-3 py-1">
              Lugares:{' '}
              <span className="text-text">
                {players.length}/{lugares}
              </span>
            </span>
          </div>
        </div>

        {/* Escolha do grimório */}
        <div className="border-panel-border border-b p-5 sm:p-6">
          <h2 className="text-text-muted mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <Library className="h-4 w-4" />
            Seu grimório
          </h2>

          {carregandoDecks ? (
            <p className="text-text-faint flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Buscando seus decks…
            </p>
          ) : decks.length === 0 ? (
            <p className="text-text-faint text-sm">
              Nenhum deck na conta. Volte à Taverna e monte um antes de jogar.
            </p>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <select
                value={deckEscolhido}
                onChange={(e) => escolherDeck(e.target.value)}
                className="bg-table-deep border-panel-border text-text focus:border-primary min-w-0 flex-1 rounded-md border px-4 py-2.5 focus:outline-none"
              >
                <option value="" disabled>
                  {eu?.deckName ? `Atual: ${eu.deckName}` : '— escolha um grimório —'}
                </option>
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.cardCount ?? 0} cartas)
                  </option>
                ))}
              </select>

              <span
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold ${
                  tenhoGrimorio
                    ? 'border-success/40 bg-success/10 text-success'
                    : 'border-warning/40 bg-warning/10 text-warning'
                }`}
              >
                {tenhoGrimorio
                  ? `${eu?.deckName || 'Grimório'} · ${eu?.libraryCount ?? 0} cartas`
                  : 'Nenhum grimório na mesa'}
              </span>
            </div>
          )}
        </div>

        {/* Assentos */}
        <div className="p-5 sm:p-6">
          <h2 className="text-text-muted mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <Users className="h-4 w-4" />
            Jogadores
          </h2>

          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Array.from({ length: lugares }).map((_, assento) => {
              const p = players.find((pl) => pl.seat === assento);
              return (
                <li
                  key={assento}
                  className={`flex items-center gap-3 rounded-lg border p-3 ${
                    p
                      ? p.ready || p.seat === 0
                        ? 'border-success/40 bg-success/5'
                        : 'border-panel-border bg-table-deep'
                      : 'border-panel-border/60 border-dashed bg-transparent'
                  }`}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      p ? 'bg-primary/20 text-primary' : 'bg-panel text-text-faint'
                    }`}
                  >
                    {p ? p.name.substring(0, 2).toUpperCase() : assento + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    {p ? (
                      <>
                        <div className="flex items-center gap-1.5">
                          <span className="text-text truncate text-sm font-medium">{p.name}</span>
                          {p.seat === 0 && (
                            <Crown
                              className="text-warning h-3.5 w-3.5 shrink-0"
                              aria-label="Anfitrião"
                            />
                          )}
                          {p.id === myId && (
                            <span className="bg-primary/20 text-primary shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase">
                              Você
                            </span>
                          )}
                        </div>
                        <span className="text-text-faint flex flex-wrap items-center gap-1.5 text-xs">
                          {p.libraryCount > 0
                            ? `${p.deckName || 'Grimório'} · ${p.libraryCount} cartas`
                            : 'Sem grimório escolhido'}
                          {p.seat !== 0 && (
                            <span
                              className={
                                p.ready ? 'text-success font-bold' : 'text-warning font-bold'
                              }
                            >
                              {p.ready ? '· pronto' : '· aguardando'}
                            </span>
                          )}
                        </span>
                      </>
                    ) : (
                      <span className="text-text-faint text-sm">Aguardando jogador…</span>
                    )}
                  </div>

                  {p && !p.connected && (
                    <span className="text-warning shrink-0 text-[10px] font-bold uppercase">
                      offline
                    </span>
                  )}

                  {/* Remover: só o anfitrião, e nunca a si mesmo — sair da
                      própria sala é "Sair da sala", não um chute em si. */}
                  {p && souAnfitriao && p.id !== myId && (
                    <button
                      onClick={() => intents.kickPlayer(room, p.id)}
                      className="text-text-faint hover:bg-danger/10 hover:text-danger shrink-0 rounded p-1.5 transition-colors"
                      title={`Remover ${p.name} da sala`}
                      aria-label={`Remover ${p.name} da sala`}
                    >
                      <UserX className="h-4 w-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Ações */}
        <div className="border-panel-border flex flex-col gap-3 border-t p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <button
            onClick={sair}
            className="text-text-muted hover:text-danger flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
          >
            <DoorOpen className="h-4 w-4" />
            Sair da sala
          </button>

          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
            {/* Pronto: o anfitrião não precisa — o clique dele em "Iniciar" já
                é a confirmação, e pedir os dois seria a mesma decisão duas vezes. */}
            {!souAnfitriao && (
              <button
                onClick={() => intents.setReady(room, !eu?.ready)}
                disabled={!tenhoGrimorio && !eu?.ready}
                className={`flex items-center justify-center gap-2 rounded-lg px-6 py-3 text-sm font-bold shadow-lg transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
                  eu?.ready
                    ? 'bg-success/20 text-success border-success/50 border'
                    : 'bg-success text-white'
                }`}
                title={
                  tenhoGrimorio
                    ? undefined
                    : 'Escolha um grimório antes de confirmar que está pronto'
                }
              >
                <Check className="h-4 w-4" />
                {eu?.ready ? 'Pronto (clique para desfazer)' : 'Estou pronto'}
              </button>
            )}

            {souAnfitriao ? (
              <div className="flex flex-col items-stretch gap-1">
                <button
                  onClick={() => {
                    setIniciando(true);
                    intents.startMatch(room);
                    // O servidor pode recusar (alguém sem grimório entrou no
                    // meio): sem soltar o botão, o anfitrião ficava com um
                    // spinner eterno e nenhuma forma de tentar de novo.
                    setTimeout(() => setIniciando(false), 2500);
                  }}
                  disabled={iniciando || !podeIniciar}
                  className="bg-primary hover:bg-primary-hover flex items-center justify-center gap-2 rounded-lg px-6 py-3 text-sm font-bold text-white shadow-lg transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {iniciando ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Iniciar partida
                </button>
                {!podeIniciar && (
                  <span className="text-warning max-w-xs text-right text-[11px]">
                    {semGrimorio.length > 0
                      ? `Sem grimório: ${semGrimorio.map((p) => p.name).join(', ')}`
                      : `Faltam confirmar: ${faltamProntos.map((p) => p.name).join(', ')}`}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-text-muted flex items-center justify-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Aguardando {anfitriao?.name ?? 'o anfitrião'} iniciar…
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
