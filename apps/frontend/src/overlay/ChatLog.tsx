'use client';

/**
 * ChatLog.tsx — Log de ações + chat mesclado (DOC-003 F15).
 *
 * O log é a memória compartilhada da partida (DOC-041 §1.4).
 * Logs NUNCA revelam identidade de carta oculta.
 *
 * LAYOUT (auditoria): o painel tinha 280px fixos ancorados em `right-3 top-16`
 * e ficava exatamente debaixo do painel de Câmera, que tinha z maior. Agora
 * fica abaixo da Câmera por posicionamento (não por sorte de z-index), começa
 * recolhido no mobile e nunca ultrapassa a largura da viewport.
 */

import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, Minimize2, ChevronDown } from 'lucide-react';
import type { Room } from 'colyseus.js';
import { useGameStore } from '../store/game.store';
import { useCardCatalog } from '../cards/catalog';
import { TituloDeChat } from '../components/Avatar';
import { useCosmeticos } from '../cosmetics/store';
import { intents } from '../net/intents';
import type { RoomState } from '../net/schema/RoomState';

const LOG_TYPE_COLORS: Record<string, string> = {
  DRAW: 'text-primary',
  PLAY: 'text-success',
  ZONE_CHANGE: 'text-text-muted',
  ZONE_CHANGE_HIDDEN: 'text-text-faint',
  SHUFFLE: 'text-text-muted',
  PEEK: 'text-warning',
  SEARCH: 'text-warning',
  TAP: 'text-text-muted',
  UNTAP: 'text-text-muted',
  COUNTER: 'text-success',
  LIFE: 'text-danger',
  CMD_DAMAGE: 'text-danger',
  DICE: 'text-speaking',
  TOKEN: 'text-success',
  SYSTEM: 'text-text-faint',
  CHAT: 'text-text',
};

interface ChatLogProps {
  room: Room<RoomState>;
}

export function ChatLog({ room }: ChatLogProps) {
  const log = useGameStore((s) => s.log);
  const players = useGameStore((s) => s.players);
  const myId = useGameStore((s) => s.mySessionId);
  const [collapsed, setCollapsed] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'CHAT' | 'ACTION'>('ALL');
  const scrollRef = useRef<HTMLDivElement>(null);
  const catalogo = useCardCatalog((s) => s.cartas);
  const permitirDeOponentes = useCosmeticos((s) => s.cosmeticosDeOponentes);
  const hidratar = useCardCatalog((s) => s.hidratar);

  // Recolhido por padrão em telas estreitas: aberto, o painel cobria metade da
  // mesa e impedia arrastar cartas do lado direito.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) setCollapsed(true);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [log.length]);

  // O servidor manda `{Carta}` + o id; quem conhece nomes é o cliente.
  // Cartas que já saíram da mesa continuam nomeáveis no histórico porque o
  // catálogo é um cache por impressão, não um espelho do estado.
  React.useEffect(() => {
    hidratar(log.map((e) => e.scryfallId));
  }, [log, hidratar]);

  const nomeDaCarta = (entry: { scryfallId?: string }) =>
    (entry.scryfallId && catalogo[entry.scryfallId]?.name) || 'uma carta';

  const filtered = log.filter((e) => {
    if (filter === 'CHAT') return e.type === 'CHAT';
    if (filter === 'ACTION') return e.type !== 'CHAT';
    return true;
  });

  const handleSendChat = () => {
    const text = chatInput.trim();
    if (!text || text.length > 500) return;
    intents.chat(room, text);
    setChatInput('');
  };

  const getPlayerName = (actorId: string) => players[actorId]?.name ?? actorId.slice(0, 6);
  const formatTimestamp = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    // No mobile o log fica ANCORADO NA BASE (acima da barra de ações): no topo
    // ele caía exatamente sobre a faixa de vida dos jogadores.
    <div className="pointer-events-none absolute bottom-16 right-2 z-20 flex w-[min(17.5rem,calc(100vw-1rem))] flex-col sm:bottom-auto sm:right-3 sm:top-16">
      <div className="border-panel-border bg-panel/90 pointer-events-auto flex items-center justify-between rounded-t-xl border px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <MessageSquare className="text-text-muted h-4 w-4" />
          <span className="text-text text-xs font-bold">Log &amp; Chat</span>
        </div>
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="text-text-muted hover:text-text transition-colors"
          aria-label={collapsed ? 'Expandir log' : 'Recolher log'}
        >
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="border-panel-border bg-panel/90 pointer-events-auto flex border-x backdrop-blur">
            {(['ALL', 'ACTION', 'CHAT'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 py-1 text-[10px] font-bold uppercase transition-colors ${
                  filter === f
                    ? 'border-primary text-primary border-b'
                    : 'text-text-faint hover:text-text-muted'
                }`}
              >
                {f === 'ALL' ? 'Todos' : f === 'ACTION' ? 'Ações' : 'Chat'}
              </button>
            ))}
          </div>

          <div
            ref={scrollRef}
            className="custom-scrollbar border-panel-border bg-panel/80 pointer-events-auto max-h-[35dvh] min-h-0 flex-1 overflow-y-auto border-x backdrop-blur"
          >
            {filtered.length === 0 ? (
              <p className="text-text-faint py-6 text-center text-[10px]">Nenhuma ação ainda…</p>
            ) : (
              <div className="space-y-1 p-2">
                {filtered.map((entry) => (
                  <div key={entry.id} className="break-words text-[11px] leading-relaxed">
                    {entry.type === 'CHAT' ? (
                      <span className="inline-flex flex-wrap items-baseline gap-1">
                        {(entry.actorId === myId || permitirDeOponentes) && (
                          <TituloDeChat titleId={players[entry.actorId]?.chatTitle} />
                        )}
                        <span
                          className={`font-bold ${entry.actorId === myId ? 'text-primary' : 'text-success'}`}
                        >
                          {getPlayerName(entry.actorId)}:
                        </span>
                        <span className="text-text">{entry.text}</span>
                      </span>
                    ) : (
                      <span>
                        <span className="text-text-faint">
                          [{formatTimestamp(entry.timestamp)}]{' '}
                        </span>
                        <span className={LOG_TYPE_COLORS[entry.type] ?? 'text-text-muted'}>
                          {entry.text.includes('{Carta}') ? (
                            <>
                              {entry.text.split('{Carta}')[0]}
                              <span className="text-text font-semibold">{nomeDaCarta(entry)}</span>
                              {entry.text.split('{Carta}')[1]}
                            </>
                          ) : (
                            entry.text
                          )}
                        </span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-panel-border bg-panel/90 pointer-events-auto flex overflow-hidden rounded-b-xl border backdrop-blur">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendChat();
              }}
              placeholder="Diga algo…"
              maxLength={500}
              className="text-text placeholder:text-text-faint min-w-0 flex-1 bg-transparent px-3 py-2 text-xs outline-none"
            />
            <button
              onClick={handleSendChat}
              className="text-primary hover:text-primary-hover px-3 py-2 text-xs font-bold transition-colors"
              aria-label="Enviar"
            >
              →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
