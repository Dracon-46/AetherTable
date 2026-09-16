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
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Crown,
  DoorOpen,
  Eye,
  Library,
  Loader2,
  Play,
  Settings2,
  UserX,
  Users,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  CRONOMETROS_DE_TURNO,
  NOME_DA_COMUNICACAO,
  NOME_DO_IDIOMA,
  REGRA_DO_MULLIGAN,
  TIPOS_DE_MULLIGAN,
  acharFormato,
  nomeDoCronometro,
  nomeDoNivelDePoder,
  type IdiomaDeMesa,
  type ModoDeComunicacao,
  type TipoDeMulligan,
} from '@aethertable/shared-types';
import { useGameStore } from '../store/game.store';
import { useAuthStore } from '../store/auth.store';
import { intents } from '../net/intents';
import { API_URL } from '@/lib/api';
import type { RoomState } from '../net/schema/RoomState';
import { esquecerReconexao } from '@/net/reconexao';

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

  const config = useGameStore((s) => s.config);
  const espectadoresMap = useGameStore((s) => s.espectadores);
  const souEspectador = useGameStore((s) => s.souEspectador);

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
    // Espectador não escolhe grimório: buscar a lista dele seria uma requisição
    // por entrada para alimentar um seletor que nunca aparece.
    if (!accessToken || souEspectador) {
      setCarregandoDecks(false);
      return;
    }
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
  }, [accessToken, souEspectador]);

  if (phase !== 'WAITING') return null;

  const players = Object.values(playersMap).sort((a, b) => a.seat - b.seat);
  const espectadores = Object.values(espectadoresMap);
  const eu = myId ? playersMap[myId] : undefined;
  // Espectador nunca é anfitrião: ele não tem `seat` nenhum. A checagem
  // explícita está aqui para o leitor não precisar deduzir isso de `undefined`.
  const souAnfitriao = !souEspectador && eu?.seat === 0;
  const anfitriao = players.find((p) => p.seat === 0);

  // `maxSeats` vive no estado da sala: quem entra pelo código nunca recebeu a
  // querystring do criador, e o lobby dele mostrava um número inventado.
  /**
   * ─── O PISO ERA 2, E ISSO DESFAZIA A MESA DE UM JOGADOR ────────────────────
   *
   * É o MESMO defeito que o `Math.max(2, ...)` do `onCreate` já tinha causado
   * uma vez, agora do lado do cliente: uma mesa solo (`freeform` com um
   * assento) abria a sala de espera anunciando "1/2", com um lugar vazio
   * esperando alguém que nunca vinha. DOC-037 §7.1 chama o solo de caso de uso
   * número 1 do documento de visão.
   *
   * `players.length` continua no piso por outro motivo, esse legítimo: se o
   * estado ainda não chegou e já há três pessoas na lista, mostrar "3/1" seria
   * pior do que arredondar para cima.
   */
  const lugares = Math.max(room.state?.maxSeats ?? maxClients ?? players.length, players.length, 1);
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

  /**
   * ─── A ORDEM DE ASSENTOS USA UMA INTENÇÃO QUE JÁ EXISTIA ─────────────────
   *
   * `INTENT_SET_TURN_ORDER` tinha handler no servidor e emissor no cliente
   * desde sempre, e NENHUMA TELA a chamava. Ela não estava faltando: estava sem
   * interface. Criar uma segunda intenção para a mesma coisa teria deixado duas
   * no contrato, uma delas morta.
   *
   * O handler já exige anfitrião — e precisa: a ordem VIVE nos assentos, e o
   * assento 0 é o anfitrião, então reescrever assentos é como se promover.
   */
  const moverAssento = (indice: number, direcao: -1 | 1) => {
    const alvo = indice + direcao;
    if (alvo < 0 || alvo >= players.length) return;

    const ordem = players.map((p) => p.id);
    const atual = ordem[indice];
    const vizinho = ordem[alvo];
    if (!atual || !vizinho) return;
    ordem[indice] = vizinho;
    ordem[alvo] = atual;

    intents.setTurnOrder(room, ordem);
  };

  /** Manda só o campo que mudou — ver `SetRoomConfigPayload`. */
  const ajustarRegra = (patch: Parameters<typeof intents.setRoomConfig>[1]) => {
    intents.setRoomConfig(room, patch);
  };

  const sair = () => {
    esquecerReconexao(room.roomId);
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

        {/* Escolha do grimório — não existe para quem está assistindo. Um
            seletor de deck numa sessão sem assento prometeria um lugar na mesa
            que o passe de espectador não dá. */}
        {souEspectador ? (
          <div className="border-panel-border border-b p-5 sm:p-6">
            <h2 className="text-text-muted mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
              <Eye className="h-4 w-4" />
              Você está assistindo
            </h2>
            <p className="text-text-muted text-sm">
              Você vê a mesa e o chat, e pode comentar. Mão, grimório e reserva dos jogadores
              continuam ocultos — assistir não revela informação escondida de ninguém.
            </p>
          </div>
        ) : (
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
                  aria-label="Seu grimório"
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
        )}

        {/* ─── Configurações de jogo ───────────────────────────────────────
            VISÍVEL PARA TODOS, editável só pelo anfitrião.

            Esconder isto do convidado seria repetir o defeito que levou
            `maxSeats` e `gameType` para o estado: ele precisa saber o mulligan
            e o cronômetro ANTES de marcar pronto — são as regras com que ele
            está concordando ao clicar.

            Para quem não é anfitrião, os valores aparecem como TEXTO, não como
            controles desabilitados: um `<select>` cinza convida ao clique e não
            explica nada. */}
        <div className="border-panel-border border-b p-5 sm:p-6">
          <h2 className="text-text-muted mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <Settings2 className="h-4 w-4" />
            Configurações de jogo
            {!souAnfitriao && (
              <span className="text-text-faint normal-case tracking-normal">
                · definidas pelo anfitrião
              </span>
            )}
          </h2>

          {souAnfitriao ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-text-muted mb-1.5 block text-xs font-medium">
                  Tipo de mulligan
                </label>
                <select
                  value={config.tipoDeMulligan}
                  aria-label="Tipo de mulligan"
                  onChange={(e) =>
                    ajustarRegra({ tipoDeMulligan: e.target.value as TipoDeMulligan })
                  }
                  className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
                >
                  {TIPOS_DE_MULLIGAN.map((t) => (
                    <option key={t} value={t}>
                      {t === 'COMMANDER' ? 'Commander' : t === 'LONDON' ? 'London' : 'Livre'}
                    </option>
                  ))}
                </select>
                <p className="text-text-faint mt-1 text-xs">
                  {REGRA_DO_MULLIGAN[config.tipoDeMulligan as TipoDeMulligan]}
                </p>
              </div>

              <div>
                <label className="text-text-muted mb-1.5 block text-xs font-medium">
                  Cronômetro de turno
                </label>
                <select
                  value={config.cronometroDeTurno}
                  aria-label="Cronômetro de turno"
                  onChange={(e) => ajustarRegra({ cronometroDeTurno: Number(e.target.value) })}
                  className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
                >
                  {CRONOMETROS_DE_TURNO.map((s) => (
                    <option key={s} value={s}>
                      {nomeDoCronometro(s)}
                    </option>
                  ))}
                </select>
                {/* O cronômetro CONTA E AVISA, nunca age (RN01). Dizer isso
                    aqui evita a expectativa de que ele passa o turno sozinho —
                    que seria a primeira regra que o servidor impõe. */}
                <p className="text-text-faint mt-1 text-xs">
                  Ele conta e destaca quando estoura. Quem passa o turno é o jogador.
                </p>
              </div>

              <div>
                <label className="text-text-muted mb-1.5 block text-xs font-medium">
                  Quem começa
                </label>
                <select
                  value={config.ordemPelosAssentos ? '__assentos__' : config.jogadorInicial}
                  aria-label="Quem começa"
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '__assentos__') {
                      ajustarRegra({ ordemPelosAssentos: true, jogadorInicial: '' });
                    } else {
                      ajustarRegra({ ordemPelosAssentos: false, jogadorInicial: v });
                    }
                  }}
                  className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
                >
                  <option value="">Sortear no início</option>
                  <option value="__assentos__">Primeiro assento</option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {/* Até esta fatia, quem clicava em "iniciar" começava — e só o
                    anfitrião pode clicar. Era uma vantagem silenciosa dele em
                    todas as partidas. */}
                <p className="text-text-faint mt-1 text-xs">
                  O sorteio é do servidor, e vai para o log da partida.
                </p>
              </div>

              <div>
                <label className="text-text-muted mb-1.5 block text-xs font-medium">Reserva</label>
                <button
                  type="button"
                  onClick={() => ajustarRegra({ sideboardPermitido: !config.sideboardPermitido })}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    config.sideboardPermitido
                      ? 'border-success/50 bg-success/10 text-success'
                      : 'border-panel-border bg-table-deep text-text-muted'
                  }`}
                >
                  {config.sideboardPermitido
                    ? 'Reserva liberada durante a partida'
                    : 'Sem reserva durante a partida'}
                </button>
                {/* A zona continua existindo: o que o interruptor governa é o
                    ACESSO a ela durante a partida. */}
                <p className="text-text-faint mt-1 text-xs">
                  A zona continua existindo — isto governa o acesso durante a partida.
                </p>
              </div>
            </div>
          ) : (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {[
                {
                  rotulo: 'Mulligan',
                  valor: REGRA_DO_MULLIGAN[config.tipoDeMulligan as TipoDeMulligan],
                },
                {
                  rotulo: 'Cronômetro',
                  valor:
                    config.cronometroDeTurno > 0
                      ? `${nomeDoCronometro(config.cronometroDeTurno)} por turno — só avisa`
                      : 'Desligado',
                },
                {
                  rotulo: 'Quem começa',
                  valor: config.jogadorInicial
                    ? (playersMap[config.jogadorInicial]?.name ?? 'Um jogador escolhido')
                    : config.ordemPelosAssentos
                      ? 'O primeiro assento'
                      : 'Sorteio no início',
                },
                {
                  rotulo: 'Reserva',
                  valor: config.sideboardPermitido
                    ? 'Liberada durante a partida'
                    : 'Sem reserva durante a partida',
                },
              ].map(({ rotulo, valor }) => (
                <div key={rotulo} className="flex flex-col">
                  <dt className="text-text-faint text-xs">{rotulo}</dt>
                  <dd className="text-text">{valor}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {/* Assentos */}
        <div className="p-5 sm:p-6">
          <h2 className="text-text-muted mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <Users className="h-4 w-4" />
            Jogadores
            {souAnfitriao && players.length > 1 && (
              <span className="text-text-faint normal-case tracking-normal">
                · use as setas para ordenar os assentos
              </span>
            )}
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

                  {/* Setas de ordem: só o anfitrião, e só quando há mais de um
                      assento ocupado para trocar. Elas emitem
                      `INTENT_SET_TURN_ORDER`, que já existia sem tela. */}
                  {p && souAnfitriao && players.length > 1 && (
                    <div className="flex shrink-0 flex-col">
                      <button
                        onClick={() => moverAssento(assento, -1)}
                        disabled={assento === 0}
                        className="text-text-faint hover:text-text rounded p-0.5 transition-colors disabled:pointer-events-none disabled:opacity-25"
                        title="Subir um assento"
                        aria-label={`Subir ${p.name} um assento`}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => moverAssento(assento, 1)}
                        disabled={assento >= players.length - 1}
                        className="text-text-faint hover:text-text rounded p-0.5 transition-colors disabled:pointer-events-none disabled:opacity-25"
                        title="Descer um assento"
                        aria-label={`Descer ${p.name} um assento`}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
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

          {/* A plateia. Lista à parte, igual no servidor: espectador não ocupa
              assento e não entra em nenhuma regra de mesa. */}
          {espectadores.length > 0 && (
            <div className="border-panel-border mt-4 border-t pt-3">
              <h3 className="text-text-faint mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
                <Eye className="h-3.5 w-3.5" />
                Assistindo ({espectadores.length})
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {espectadores.map((e) => (
                  <span
                    key={e.id}
                    className={`border-panel-border bg-table-deep rounded-full border px-2.5 py-1 text-xs ${
                      e.id === myId ? 'text-primary font-bold' : 'text-text-muted'
                    }`}
                  >
                    {e.name}
                    {e.id === myId ? ' (você)' : ''}
                  </span>
                ))}
              </div>
            </div>
          )}
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
                é a confirmação, e pedir os dois seria a mesma decisão duas
                vezes. O espectador também não: ele não entra na conta de
                `INTENT_START_MATCH`, e um botão "estou pronto" sugeriria que a
                partida espera por ele. */}
            {!souAnfitriao && !souEspectador && (
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

        {/* Rodapé com o que a mesa é — visível para todos, inclusive plateia. */}
        <div className="border-panel-border text-text-faint flex flex-wrap gap-x-4 gap-y-1 border-t px-5 py-3 text-xs sm:px-6">
          <span>{acharFormato(config.gameType).nome}</span>
          <span>{NOME_DO_IDIOMA[config.idioma as IdiomaDeMesa] ?? config.idioma}</span>
          <span>
            {NOME_DA_COMUNICACAO[config.comunicacao as ModoDeComunicacao] ?? config.comunicacao}
          </span>
          <span>{config.visibilidade === 'PUBLICA' ? 'Pública' : 'Privada'}</span>
          {/* "declarado" fica escrito também aqui: é o mesmo motivo do painel —
              não existe calculador de bracket, e o número é etiqueta. */}
          {config.nivelDePoder > 0 && (
            <span>Nível {nomeDoNivelDePoder(config.nivelDePoder)} (declarado)</span>
          )}
        </div>
      </div>
    </div>
  );
}
