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
 */

import React, { useState, useRef, useEffect } from 'react';
import { Heart, Skull, Zap, Star, Shield, Crown, Settings } from 'lucide-react';
import type { Room } from 'colyseus.js';
import { useGameStore, type PlayerData } from '../store/game.store';
import { intents } from '../net/intents';
import { useVoiceStore } from '../net/voice';
import { Avatar, TituloDeChat } from '../components/Avatar';
import { useCosmeticos, cosmeticosVisiveis } from '../cosmetics/store';
import type { RoomState } from '../net/schema/RoomState';

interface LifePanelProps {
  room: Room<RoomState>;
}

function PlayerCard({
  player,
  room,
  isMe,
  opponents,
  compacto,
}: {
  player: PlayerData;
  room: Room<RoomState>;
  isMe: boolean;
  opponents: PlayerData[];
  /** Faixa horizontal do mobile: só o essencial cabe. */
  compacto: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [lifeInput, setLifeInput] = useState(String(player.life));
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isSpeaking = useVoiceStore((s) => s.speaking.includes(player.userId));
  const permitirDeOponentes = useCosmeticos((s) => s.cosmeticosDeOponentes);
  const cosmeticos = cosmeticosVisiveis(player, isMe, permitirDeOponentes);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    }
    if (showMenu) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const handleLifeWheel = (e: React.WheelEvent) => {
    const delta = e.deltaY < 0 ? 1 : -1;
    intents.setLife(room, delta);
  };

  const handleLifeConfirm = () => {
    const v = parseInt(lifeInput, 10);
    if (!Number.isNaN(v)) intents.setLife(room, undefined, v);
    setEditing(false);
  };

  const lifePct = Math.max(0, Math.min(100, (player.life / 40) * 100));
  const lifeDanger = player.life <= 10;
  const lifeCritical = player.life <= 5;

  return (
    <div
      className={`bg-panel/90 relative shrink-0 rounded-xl border p-2 backdrop-blur transition-all sm:p-3 ${compacto ? 'w-36' : 'w-full'} ${
        isSpeaking
          ? 'border-warning shadow-[0_0_15px_rgba(245,158,11,0.6)]'
          : !player.connected
            ? 'border-warning/50 opacity-70'
            : player.conceded
              ? 'border-danger/50 opacity-60'
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
          {player.conceded && (
            <span title="Desistiu" className="shrink-0">
              <Skull className="text-danger h-3 w-3" aria-hidden="true" />
            </span>
          )}
        </div>

        {isMe && (
          <div ref={menuRef} className="relative shrink-0">
            <button
              onClick={() => setShowMenu((v) => !v)}
              className="text-text-muted rounded p-1 transition-colors hover:text-white"
              aria-label="Status do jogador"
            >
              <Settings className="h-4 w-4" />
            </button>

            {showMenu && (
              // Abre para a DIREITA e não para baixo: no canto esquerdo da tela
              // havia espaço de sobra ali, enquanto abrir para baixo cobria os
              // painéis dos outros jogadores.
              <div className="border-panel-border bg-panel absolute left-full top-0 z-40 ml-2 flex w-48 flex-col gap-2 rounded-lg border p-2 shadow-2xl">
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

                {(
                  [
                    ['POISON', 'Veneno', player.poison, 'text-warning'],
                    ['ENERGY', 'Energia', player.energy, 'text-primary'],
                    ['EXPERIENCE', 'Exp', player.experience, 'text-text-muted'],
                  ] as const
                ).map(([key, rotulo, valor, cor]) => (
                  <div
                    key={key}
                    className="bg-table-deep flex items-center justify-between rounded p-1 text-xs"
                  >
                    <span className={`flex items-center gap-1 ${cor}`}>
                      {key === 'ENERGY' ? (
                        <Zap className="h-3 w-3" />
                      ) : key === 'EXPERIENCE' ? (
                        <Star className="h-3 w-3" />
                      ) : (
                        <span className="text-[10px]">☠</span>
                      )}
                      {rotulo}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => intents.addPlayerCounter(room, key, -1)}
                        className="text-danger px-1 hover:text-white"
                      >
                        −
                      </button>
                      <span className="w-4 text-center font-mono">{valor}</span>
                      <button
                        onClick={() => intents.addPlayerCounter(room, key, 1)}
                        className="text-success px-1 hover:text-white"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {!compacto && cosmeticos.titleId !== 'nenhum' && (
        <div className="-mt-1 mb-2 flex">
          <TituloDeChat titleId={cosmeticos.titleId} />
        </div>
      )}

      {/* Vida — só editável pelo próprio jogador */}
      <div
        className="flex select-none items-center gap-2"
        onWheel={isMe ? handleLifeWheel : undefined}
      >
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
            className="border-primary text-primary w-16 border-b bg-transparent font-mono text-2xl font-bold outline-none"
          />
        ) : (
          <button
            type="button"
            disabled={!isMe}
            onClick={() => {
              setEditing(true);
              setLifeInput(String(player.life));
            }}
            className={`font-mono text-2xl font-bold ${lifeCritical ? 'text-danger' : 'text-text'} ${
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
              return (
                <div
                  key={opp.id}
                  className="border-panel-border bg-table-deep/50 flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs"
                >
                  <span className="text-text-faint min-w-0 truncate" title={opp.name}>
                    {opp.name}
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
  const players = Object.values(playersMap).sort((a, b) => a.seat - b.seat);

  return (
    // Duas formas, uma por classe de tela:
    //
    //  - MOBILE: faixa HORIZONTAL logo abaixo do botão de câmera. Uma coluna de
    //    quatro cartões de vida ocupa ~700px de altura — em 390x780 ela cobria a
    //    mesa inteira e ainda colidia com o log.
    //  - sm+: coluna à esquerda, com a altura limitada para não encostar na
    //    barra de ações da base (a colisão que sobrava em 820x600).
    //
    // `pointer-events-auto` fica no container que ROLA: com `none` (como estava)
    // a roda do mouse nunca chegava nele e a lista simplesmente não rolava.
    <div
      className={
        'custom-scrollbar pointer-events-auto absolute z-20 flex gap-2 ' +
        'inset-x-2 top-12 flex-row overflow-x-auto overflow-y-hidden pb-1' +
        'sm:inset-x-auto sm:left-3 sm:top-16 sm:w-44 sm:flex-col sm:gap-3' +
        'sm:max-h-[calc(100dvh-11rem)] sm:overflow-y-auto sm:overflow-x-visible sm:pb-2 sm:pr-1'
      }
    >
      {players.map((player) => (
        <React.Fragment key={player.id}>
          <div className="contents sm:hidden">
            <PlayerCard
              player={player}
              room={room}
              isMe={player.id === myId}
              opponents={players.filter((p) => p.id !== player.id)}
              compacto
            />
          </div>
          <div className="hidden sm:contents">
            <PlayerCard
              player={player}
              room={room}
              isMe={player.id === myId}
              opponents={players.filter((p) => p.id !== player.id)}
              compacto={false}
            />
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
