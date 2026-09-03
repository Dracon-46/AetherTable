'use client';

/**
 * LifePanel.tsx — Painel de Vida e Contadores do Jogador (DOC-003 F11).
 *
 * CORREÇÕES DA AUDITORIA
 *
 * 1. `useParticipants()` era chamado dentro de um `try/catch` para detectar a
 *    ausência do LiveKit. Isso é hook condicional: quando a voz conectava, o
 *    componente passava a executar um hook a mais e o React derrubava a mesa.
 *    Agora quem fala vem do `useVoiceStore`, alimentado pelo `VoiceBridge`.
 *
 * 2. O container tinha `pointer-events-none` E `overflow-y-auto`: a lista de
 *    jogadores nunca rolava, porque a roda do mouse não chegava no elemento.
 *
 * 3. Em telas baixas a coluna cobria a mesa inteira. Agora ela é limitada e
 *    vira uma faixa compacta no mobile.
 *
 * ─── POR QUE SÓ A SUA VIDA APARECE ─────────────────────────────────────────
 *
 * O painel desenhava um cartão COMPLETO por jogador: avatar, título, vida,
 * veneno, energia, experiência, dano de comandante por oponente, grimório e
 * mão. Numa mesa de quatro isso é uma coluna de ~700px encostada na borda
 * esquerda — mais alta que a maioria das telas — para mostrar, sobre os
 * oponentes, números que já estão escritos na faixa deles no tabuleiro
 * ("Fulano · 34 PV").
 *
 * Agora o padrão é UM cartão: o seu. O resto da mesa continua a um clique, no
 * botão de expandir — que é onde o dano de comandante e os contadores alheios
 * fazem sentido, porque são consultados algumas vezes por partida, não o tempo
 * todo. A preferência é lembrada.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Gauge,
  Heart,
  Skull,
  Ticket,
  Radiation,
  Zap,
  Star,
  Shield,
  Crown,
  Settings,
  ChevronDown,
  ChevronUp,
  Minus,
} from 'lucide-react';
import type { Room } from 'colyseus.js';
import { useGameStore, useUIStore, type PlayerData } from '../store/game.store';
import { intents } from '../net/intents';
import { useVoiceStore } from '../net/voice';
import { Avatar, TituloDeChat } from '../components/Avatar';
import { useCosmeticos, cosmeticosVisiveis } from '../cosmetics/store';
import { useCardCatalog } from '../cards/catalog';
import type { RoomState } from '../net/schema/RoomState';

interface LifePanelProps {
  room: Room<RoomState>;
}

function PlayerCard({
  player,
  room,
  isMe,
  naVez,
  opponents,
  compacto,
}: {
  player: PlayerData;
  room: Room<RoomState>;
  isMe: boolean;
  /** É a vez deste jogador. Marcador visual — o motor não impõe turno (F29). */
  naVez: boolean;
  opponents: PlayerData[];
  /** Faixa horizontal do mobile: só o essencial cabe. */
  compacto: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [lifeInput, setLifeInput] = useState(String(player.life));
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  /** Posição do menu em coordenadas de viewport — ver `abrirMenu`. */
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const isSpeaking = useVoiceStore((s) => s.speaking.includes(player.userId));
  const cards = useGameStore((s) => s.cards);
  const players = useGameStore((s) => s.players);
  const catalogo = useCardCatalog((s) => s.cartas);
  const permitirDeOponentes = useCosmeticos((s) => s.cosmeticosDeOponentes);
  const cosmeticos = cosmeticosVisiveis(player, isMe, permitirDeOponentes);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const alvo = event.target as Node;
      // O menu vive num portal, FORA desta árvore: sem checar o botão também,
      // o clique que abre seria lido como clique fora e fecharia na hora.
      if (menuRef.current?.contains(alvo) || botaoRef.current?.contains(alvo)) return;
      setShowMenu(false);
    }
    if (showMenu) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  /**
   * Abre o menu de status ancorado ao botão, em coordenadas de VIEWPORT.
   *
   * ─── POR QUE PORTAL, E NÃO `absolute` ──────────────────────────────────────
   *
   * O menu era `absolute left-full`, quer dizer: para fora da borda direita do
   * cartão. Só que o cartão mora dentro da coluna de vida, que em `sm+` tem
   * `overflow-y-auto` para rolar quando há muitos jogadores. Pelo CSS, quando um
   * eixo é `auto` e o outro é `visible`, o `visible` VIRA `auto` — não existe
   * "recorta em cima e embaixo, mas deixa vazar dos lados". A coluna passava a
   * recortar horizontalmente e o menu, que abre justamente para o lado, era
   * cortado inteiro. O botão respondia ao clique e nada aparecia.
   *
   * Um portal no `body` sai de qualquer `overflow` e de qualquer contexto de
   * empilhamento de ancestral. O preço é posicionar à mão, que é o que a medida
   * do `getBoundingClientRect` abaixo faz.
   */
  const abrirMenu = useCallback(() => {
    if (showMenu) {
      setShowMenu(false);
      return;
    }
    const r = botaoRef.current?.getBoundingClientRect();
    if (!r) return;

    const LARGURA = 192; // w-48
    const ALTURA_ESTIMADA = 340;
    // Vira para a esquerda do botão quando não há espaço à direita, e sobe o
    // bastante para não sair pela base numa tela baixa.
    const left = Math.min(r.right + 8, window.innerWidth - LARGURA - 8);
    const top = Math.min(r.top, Math.max(8, window.innerHeight - ALTURA_ESTIMADA - 8));

    setMenuPos({ top, left: Math.max(8, left) });
    setShowMenu(true);
  }, [showMenu]);

  /**
   * Rolar a coluna ou redimensionar a janela deixaria o menu para trás, preso
   * na coordenada antiga (ele é `fixed`, posicionado à mão). Mais honesto
   * fechá-lo do que exibi-lo desalinhado.
   *
   * ─── MAS SÓ QUANDO A ROLAGEM O AFETA ───────────────────────────────────
   *
   * O listener era `scroll` com `capture: true`, o que pega QUALQUER rolagem
   * de QUALQUER elemento da página. E o log da mesa se auto-rola para o fim a
   * cada linha nova — ou seja, a cada ação de qualquer jogador.
   *
   * O resultado: ajustar contadores era quase impossível. Cada clique em
   * "+veneno" gerava uma linha de log, o log rolava, o evento subia capturado,
   * e o menu fechava na cara do jogador. Quem tentava chegar a dez marcadores
   * reabria o menu dez vezes — e foi assim que o teste de veneno parou em 8.
   *
   * A rolagem só desloca o menu se aconteceu num ANCESTRAL do botão que o
   * ancora. O log não é ancestral de nada aqui; a coluna de vida e o documento
   * são.
   */
  useEffect(() => {
    if (!showMenu) return;
    const fechar = () => setShowMenu(false);
    const fecharSeDeslocou = (e: Event) => {
      const alvo = e.target;
      const botao = botaoRef.current;
      if (!botao) return;
      // `document` não é `Node.contains`-ável a partir de si mesmo em todos os
      // casos, mas rolagem de documento move tudo: fecha.
      if (alvo === document || alvo === window) return fechar();
      if (alvo instanceof Node && alvo.contains(botao)) fechar();
    };
    window.addEventListener('resize', fechar);
    window.addEventListener('scroll', fecharSeDeslocou, true);
    return () => {
      window.removeEventListener('resize', fechar);
      window.removeEventListener('scroll', fecharSeDeslocou, true);
    };
  }, [showMenu]);

  const handleLifeConfirm = () => {
    const v = parseInt(lifeInput, 10);
    if (!Number.isNaN(v)) intents.setLife(room, undefined, v);
    setEditing(false);
  };

  /**
   * Nome do comandante de um jogador, para a linha de dano.
   *
   * `isCommander` vem do DECK e acompanha a carta por todas as zonas — a zona
   * de comando não serve para essa pergunta, porque o comandante passa a maior
   * parte da partida fora dela. Parceiros aparecem juntos.
   *
   * Cai no nome do jogador quando o catálogo ainda não hidratou ou quando o
   * deck não tem comandante (formato sem comandante): é melhor mostrar algo
   * verdadeiro do que um traço.
   */
  const nomeDoComandante = (playerId: string): string => {
    const nomes = Object.values(cards)
      .filter((c) => c.isCommander && c.ownerId === playerId && c.scryfallId)
      .map((c) => catalogo[c.scryfallId]?.name)
      .filter((n): n is string => Boolean(n));
    if (nomes.length === 0) return players[playerId]?.name ?? 'comandante';
    return nomes.join(' + ');
  };

  const lifePct = Math.max(0, Math.min(100, (player.life / 40) * 100));
  const lifeDanger = player.life <= 10;
  const lifeCritical = player.life <= 5;

  return (
    <div
      // A borda dourada da VEZ vem antes de "quem está falando": as duas são
      // temporárias, mas de quem é a vez decide o que a mesa inteira faz a
      // seguir. Quem fala já tem o próprio áudio como sinal.
      className={`bg-panel/90 relative shrink-0 rounded-xl border p-2 backdrop-blur transition-all ${compacto ? 'w-36' : 'w-full'} ${
        naVez
          ? // A borda dourada basta. O halo de 18px que existia aqui era a "luz
            // em volta do usuário": ele sangrava para fora do painel, esbarrava
            // no tabuleiro e pulsava junto com o brilho da faixa em foco no
            // canvas — dois avisos concorrentes para o mesmo fato.
            'border-2 border-[#facc15]'
          : isSpeaking
            ? 'border-warning'
            : player.eliminated
              ? // Fora do jogo: o cartao apaga, mas continua na tela. O
                // eliminado nao sai da sala, e a mesa precisa continuar vendo
                // a vida e o dano com que ele terminou.
                'border-danger/60 opacity-50 grayscale'
              : !player.connected
                ? 'border-warning/50 opacity-70'
                : 'border-panel-border'
      }`}
    >
      {/* Barra de vida */}
      <div
        className="absolute bottom-0 left-0 h-0.5 rounded-b-xl transition-all duration-300"
        style={{
          width: `${lifePct}%`,
          background: lifeCritical ? '#EF4444' : lifeDanger ? '#F59E0B' : '#22C55E',
        }}
      />

      {/* Nome e status.
          O título de cosmético fica numa LINHA PRÓPRIA: colocado ao lado do
          nome, o badge empurrava o nome para fora do painel de 176px e o
          jogador virava "O." — o cosmético comendo justamente a informação
          que ele deveria decorar. */}
      <div className="relative mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {compacto ? (
            <div
              className={`h-2 w-2 shrink-0 rounded-full ${player.connected ? 'bg-success' : 'bg-warning'}`}
            />
          ) : (
            <Avatar
              nome={player.name}
              avatarUrl={player.avatarUrl}
              borderId={cosmeticos.borderId}
              tamanho="sm"
            />
          )}
          {naVez && (
            <span
              title="É a vez deste jogador"
              className="shrink-0 text-[10px] font-bold text-[#facc15]"
              aria-label="É a vez deste jogador"
            >
              ▶
            </span>
          )}
          <span className="text-text min-w-0 flex-1 truncate text-xs font-bold" title={player.name}>
            {player.name}
          </span>

          {player.isMonarch && (
            <span title="Monarca" className="shrink-0">
              <Crown className="text-warning h-3 w-3" aria-hidden="true" />
            </span>
          )}
          {player.hasInitiative && (
            <span title="Iniciativa" className="shrink-0">
              <Shield className="text-primary h-3 w-3" aria-hidden="true" />
            </span>
          )}
          {player.eliminated && (
            <span
              title={
                player.eliminationReason === 'CONCEDED' ? 'Desistiu da partida' : 'Fora do jogo'
              }
              className="shrink-0"
            >
              <Skull className="text-danger h-3 w-3" aria-hidden="true" />
            </span>
          )}
        </div>

        {isMe && (
          <div className="shrink-0">
            <button
              ref={botaoRef}
              onClick={abrirMenu}
              className="text-text-muted rounded p-1 transition-colors hover:text-white"
              aria-label="Status do jogador"
              aria-expanded={showMenu}
            >
              <Settings className="h-4 w-4" />
            </button>

            {showMenu &&
              menuPos &&
              typeof document !== 'undefined' &&
              createPortal(
                // `fixed` + portal no body: fora do `overflow` da coluna de vida
                // e de qualquer contexto de empilhamento acima daqui.
                <div
                  ref={menuRef}
                  style={{ top: menuPos.top, left: menuPos.left }}
                  className="border-panel-border bg-panel fixed z-[55] flex w-48 flex-col gap-2 rounded-lg border p-2 shadow-2xl"
                >
                  <span className="border-panel-border text-text-muted border-b pb-1 text-[10px] font-bold uppercase">
                    Status do Jogador
                  </span>

                  <div className="mb-1 flex gap-2">
                    <button
                      onClick={() => {
                        intents.toggleDesignation(room, 'MONARCH');
                        setShowMenu(false);
                      }}
                      className={`flex flex-1 flex-col items-center justify-center rounded border p-2 text-[10px] font-bold transition-colors ${
                        player.isMonarch
                          ? 'border-warning bg-warning/20 text-warning'
                          : 'border-panel-border bg-table-deep text-text-muted hover:bg-panel-hover'
                      }`}
                    >
                      <Crown className="mb-1 h-4 w-4" />
                      Monarca
                    </button>
                    <button
                      onClick={() => {
                        intents.toggleDesignation(room, 'INITIATIVE');
                        setShowMenu(false);
                      }}
                      className={`flex flex-1 flex-col items-center justify-center rounded border p-2 text-[10px] font-bold transition-colors ${
                        player.hasInitiative
                          ? 'border-primary bg-primary/20 text-primary'
                          : 'border-panel-border bg-table-deep text-text-muted hover:bg-panel-hover'
                      }`}
                    >
                      <Shield className="mb-1 h-4 w-4" />
                      Iniciativa
                    </button>
                  </div>

                  {/*
                  Os cinco contadores de jogador que o servidor conhece. RAD e
                  ingresso já tinham intent (`INTENT_ADD_PLAYER_COUNTER`) e
                  campo no schema, mas nenhuma UI — só existiam para quem lesse
                  o código.
                */}
                  {(
                    [
                      [
                        'POISON',
                        'Veneno',
                        player.poison,
                        'text-warning',
                        <Skull key="i" className="h-3 w-3" />,
                      ],
                      [
                        'ENERGY',
                        'Energia',
                        player.energy,
                        'text-primary',
                        <Zap key="i" className="h-3 w-3" />,
                      ],
                      [
                        'EXPERIENCE',
                        'Exp',
                        player.experience,
                        'text-text-muted',
                        <Star key="i" className="h-3 w-3" />,
                      ],
                      [
                        'RAD',
                        'Radiação',
                        player.rad,
                        'text-success',
                        <Radiation key="i" className="h-3 w-3" />,
                      ],
                      [
                        'TICKET',
                        'Ingresso',
                        player.ticket,
                        'text-speaking',
                        <Ticket key="i" className="h-3 w-3" />,
                      ],
                    ] as const
                  ).map(([key, rotulo, valor, cor, icone]) => (
                    <div
                      key={key}
                      className="bg-table-deep flex items-center justify-between rounded p-1 text-xs"
                    >
                      <span className={`flex items-center gap-1 ${cor}`}>
                        {icone}
                        {rotulo}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => intents.addPlayerCounter(room, key, -1)}
                          className="text-danger px-1 hover:text-white"
                          aria-label={`Reduzir ${rotulo}`}
                        >
                          −
                        </button>
                        <span className="w-5 text-center font-mono">{valor}</span>
                        <button
                          onClick={() => intents.addPlayerCounter(room, key, 1)}
                          className="text-success px-1 hover:text-white"
                          aria-label={`Aumentar ${rotulo}`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}

                  {/*
                  Velocidade (Aetherdrift) não é contador comum: vai de 0 a 4 e
                  nunca desce, então tem intent própria (`INTENT_SET_SPEED`) com
                  valor absoluto em vez de delta.
                */}
                  <div className="bg-table-deep flex items-center justify-between rounded p-1 text-xs">
                    <span className="text-danger flex items-center gap-1">
                      <Gauge className="h-3 w-3" />
                      Velocidade
                    </span>
                    <div className="flex items-center gap-1">
                      {[0, 1, 2, 3, 4].map((v) => (
                        <button
                          key={v}
                          onClick={() => intents.setSpeed(room, v)}
                          aria-label={`Velocidade ${v}`}
                          aria-pressed={player.speed === v}
                          className={`h-5 w-5 rounded font-mono text-[10px] transition-colors ${
                            player.speed === v
                              ? 'bg-danger font-bold text-white'
                              : 'bg-panel text-text-muted hover:bg-panel-hover'
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>,
                document.body,
              )}
          </div>
        )}
      </div>

      {!compacto && cosmeticos.titleId !== 'nenhum' && (
        <div className="-mt-1 mb-2 flex">
          <TituloDeChat titleId={cosmeticos.titleId} />
        </div>
      )}

      {/*
        Vida — só editável pelo próprio jogador.

        ─── A RODA DO MOUSE SAIU DAQUI ────────────────────────────────────────

        Girar a roda sobre este bloco somava e subtraía vida. Parecia atalho, e
        era uma armadilha: com o painel expandido a coluna PRECISA rolar, e a
        roda que o jogador usa para descer até o terceiro cartão caía sobre a
        vida do primeiro e a alterava — em silêncio, sem confirmação, num número
        que decide a partida. Um gesto escondido que corrompe estado enquanto
        você tenta navegar é pior do que gesto nenhum.

        Ajustar continua a um clique: os botões −1/+1 abaixo, ou clicar no total
        para digitar.
      */}
      <div className="flex select-none items-center gap-2">
        <Heart
          className={`h-4 w-4 shrink-0 ${
            lifeCritical ? 'text-danger' : lifeDanger ? 'text-warning' : 'text-success'
          }`}
        />
        {editing && isMe ? (
          <input
            autoFocus
            type="number"
            value={lifeInput}
            onChange={(e) => setLifeInput(e.target.value)}
            onBlur={handleLifeConfirm}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleLifeConfirm();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="border-primary text-primary w-14 border-b bg-transparent font-mono text-xl font-bold outline-none"
          />
        ) : (
          <button
            type="button"
            disabled={!isMe}
            onClick={() => {
              setEditing(true);
              setLifeInput(String(player.life));
            }}
            className={`font-mono text-xl font-bold ${lifeCritical ? 'text-danger' : 'text-text'} ${
              isMe ? 'cursor-pointer' : 'cursor-default'
            }`}
          >
            {player.life}
          </button>
        )}
      </div>

      {isMe && (
        <div className="mt-2 flex gap-1">
          <button
            onClick={() => intents.setLife(room, -1)}
            className="bg-danger/20 text-danger hover:bg-danger/40 flex-1 rounded py-1 text-xs transition-colors"
          >
            −1
          </button>
          <button
            onClick={() => intents.setLife(room, 1)}
            className="bg-success/20 text-success hover:bg-success/40 flex-1 rounded py-1 text-xs transition-colors"
          >
            +1
          </button>
        </div>
      )}

      {/* Contadores ativos */}
      {!compacto && (player.poison > 0 || player.energy > 0 || player.experience > 0) && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {player.poison > 0 && (
            <span className="text-warning flex items-center gap-0.5" title="Veneno">
              ☠ {player.poison}
            </span>
          )}
          {player.energy > 0 && (
            <span className="text-primary flex items-center gap-0.5" title="Energia">
              <Zap className="h-3 w-3" />
              {player.energy}
            </span>
          )}
          {player.experience > 0 && (
            <span className="text-text-muted flex items-center gap-0.5" title="Experiência">
              <Star className="h-3 w-3" />
              {player.experience}
            </span>
          )}
        </div>
      )}

      {/* Dano de Comandante */}
      {!compacto && opponents.length > 0 && (
        <div className="border-panel-border mt-3 space-y-1 border-t pt-2">
          <span className="text-text-muted flex items-center gap-1 text-[10px] font-bold uppercase">
            <Shield className="h-3 w-3" /> Dano de Comandante
          </span>
          <div className="flex flex-col gap-1">
            {opponents.map((opp) => {
              const dmg = player.commanderDamage?.[opp.id] ?? 0;
              const comandante = nomeDoComandante(opp.id);
              return (
                <div
                  key={opp.id}
                  className="border-panel-border bg-table-deep/50 flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs"
                >
                  {/* O NOME DO COMANDANTE, não o do jogador.
                      "21 de dano de aether_bruno" não diz nada que a tela já
                      não mostre; "21 de Krenko, Mob Boss" é a informação que a
                      mesa usa — ainda mais com parceiros, em que o mesmo
                      jogador tem dois comandantes que contam separado. */}
                  <span
                    className="text-text-faint min-w-0 truncate"
                    title={`${comandante} — comandante de ${opp.name}`}
                  >
                    {comandante}
                  </span>
                  <div className="flex shrink-0 items-center gap-1 font-mono">
                    {isMe && (
                      <button
                        onClick={() => intents.setCommanderDamage(room, opp.id, -1)}
                        className="text-danger hover:bg-danger/20 w-4 rounded text-center transition-colors"
                      >
                        −
                      </button>
                    )}
                    <span
                      className={`inline-block w-5 text-center ${
                        dmg >= 21 ? 'text-danger font-bold' : 'text-warning'
                      }`}
                    >
                      {dmg}
                    </span>
                    {isMe && (
                      <button
                        onClick={() => intents.setCommanderDamage(room, opp.id, 1)}
                        className="text-success hover:bg-success/20 w-4 rounded text-center transition-colors"
                      >
                        +
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Grimório / Mão */}
      <div className="bg-table-deep text-text-faint mt-2 flex justify-between rounded px-2 py-1 text-[10px]">
        <span title="Cartas no grimório">📚 {player.libraryCount}</span>
        <span title="Cartas na mão">🃏 {player.handCount}</span>
      </div>
    </div>
  );
}

export function LifePanel({ room }: LifePanelProps) {
  const playersMap = useGameStore((s) => s.players);
  const myId = useGameStore((s) => s.mySessionId);
  const activePlayerId = useGameStore((s) => s.activePlayerId);
  const modo = useUIStore((s) => s.vidaModo);
  const setModo = useUIStore((s) => s.setVidaModo);

  const todos = Object.values(playersMap).sort((a, b) => a.seat - b.seat);
  const eu = myId ? playersMap[myId] : undefined;

  /**
   * MINIMIZADO NÃO É "SUMIU".
   *
   * Um painel que desaparece por inteiro deixa a mesa sem o número que mais se
   * consulta na partida, e obriga o jogador a lembrar onde estava o botão de
   * trazê-lo de volta. O selo resolve os dois: mostra o próprio total e É o
   * botão de restaurar.
   */
  if (modo === 'minima') {
    return (
      <div className="pointer-events-none absolute inset-x-2 top-12 z-20 flex sm:inset-x-auto sm:left-3 sm:top-16">
        <button
          onClick={() => setModo('minha')}
          className="border-panel-border bg-panel/90 text-text hover:border-primary pointer-events-auto flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 shadow-lg backdrop-blur transition-colors"
          title="Mostrar o painel de vida"
        >
          <Heart className="text-success h-3.5 w-3.5" />
          <span className="font-mono text-sm font-bold">{eu?.life ?? 40}</span>
          <ChevronDown className="text-text-muted h-3 w-3" />
        </button>
      </div>
    );
  }

  const visiveis = modo === 'mesa' ? todos : eu ? [eu] : [];

  const cartao = (player: PlayerData, compacto: boolean) => (
    <PlayerCard
      player={player}
      room={room}
      isMe={player.id === myId}
      naVez={player.id === activePlayerId}
      opponents={todos.filter((p) => p.id !== player.id)}
      compacto={compacto}
    />
  );

  const botao =
    'border-panel-border bg-panel/90 text-text-muted hover:text-primary hover:border-primary pointer-events-auto flex shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[10px] font-bold uppercase backdrop-blur transition-colors';

  return (
    /**
     * ─── OS BOTÕES FICAM FORA DA ÁREA QUE ROLA ─────────────────────────────
     *
     * Antes era tudo um contêiner só: os cartões E os controles dentro do mesmo
     * `overflow-y-auto`. Com a mesa expandida o conteúdo passava da altura
     * máxima, os controles desciam junto com a rolagem e sumiam — e como a
     * coluna termina colada na borda inferior, não havia pista de que ainda
     * havia conteúdo abaixo. A leitura era "abri a mesa toda e não consigo
     * descer".
     *
     * Agora o pai só posiciona, o miolo rola, e os controles são irmãos fixos
     * embaixo: nunca saem do lugar, seja qual for o número de jogadores.
     */
    <div className="pointer-events-none absolute inset-x-2 top-12 z-20 flex flex-col gap-2 sm:inset-x-auto sm:left-3 sm:top-16 sm:max-h-[calc(100dvh-9rem)] sm:w-40">
      <div
        className={
          // AS BARRAS NO FIM DE CADA LINHA NÃO SÃO ESTILO: sem elas a última
          // classe de uma linha cola na primeira da seguinte e o Tailwind
          // ignora as duas. Foi assim que `sm:max-h-` sumiu daqui uma vez, e
          // sem altura máxima `overflow-y-auto` não tem o que rolar.
          'custom-scrollbar pointer-events-auto flex min-h-0 gap-2 ' +
          'flex-row overflow-x-auto overflow-y-hidden pb-1' +
          'sm:flex-col sm:gap-2 sm:overflow-y-auto sm:overflow-x-hidden sm:pb-1 sm:pr-1'
        }
      >
        {visiveis.map((player) => (
          <React.Fragment key={player.id}>
            <div className="contents sm:hidden">{cartao(player, true)}</div>
            <div className="hidden sm:contents">{cartao(player, false)}</div>
          </React.Fragment>
        ))}
      </div>

      <div className="flex shrink-0 gap-1">
        <button onClick={() => setModo('minima')} className={botao} title="Minimizar o painel">
          <Minus className="h-3 w-3" /> minimizar
        </button>

        {todos.length > 1 && (
          <button
            onClick={() => setModo(modo === 'mesa' ? 'minha' : 'mesa')}
            className={`${botao} flex-1`}
            title={
              modo === 'mesa'
                ? 'Mostrar só a sua vida'
                : 'Mostrar a mesa inteira (dano de comandante, contadores)'
            }
          >
            {modo === 'mesa' ? (
              <>
                <ChevronUp className="h-3 w-3" /> só a minha
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" /> mesa ({todos.length})
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
