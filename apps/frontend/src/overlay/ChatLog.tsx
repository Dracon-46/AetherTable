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
import { useGameStore, useUIStore } from '../store/game.store';
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
  /**
   * O ESTADO RECOLHIDO VIROU PREFERÊNCIA.
   *
   * Era `useState` local: recolher o log e dar F5 no meio da partida trazia
   * ele de volta aberto, por cima do tabuleiro. Quem recolhe o log quer o log
   * recolhido — e agora o painel de Exibição também consegue mexer nele, o que
   * é impossível com estado privado do componente.
   */
  const aberto = useUIStore((s) => s.logAberto);
  const setAberto = useUIStore((s) => s.setLogAberto);
  const collapsed = !aberto;
  const [chatInput, setChatInput] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'CHAT' | 'ACTION'>('ALL');
  const scrollRef = useRef<HTMLDivElement>(null);
  const catalogo = useCardCatalog((s) => s.cartas);
  const permitirDeOponentes = useCosmeticos((s) => s.cosmeticosDeOponentes);
  const hidratar = useCardCatalog((s) => s.hidratar);

  /**
   * ─── O `setCollapsed(true)` NA MONTAGEM SAIU DAQUI ────────────────────────
   *
   * Havia um efeito que recolhia o log a cada montagem, para garantir o padrão
   * recolhido. Isso funcionava porque o estado era local e nascia do zero —
   * mas agora ele é uma PREFERÊNCIA persistida, e o efeito passaria por cima
   * dela: quem gosta do log aberto o veria fechar sozinho a cada entrada na
   * mesa, e o interruptor no painel de Exibição pareceria não guardar nada.
   *
   * O padrão continua sendo recolhido — ele mora em `logAberto: false`, no
   * valor inicial do store, que é o lugar de um padrão. O motivo original
   * segue valendo: o log é consulta, e aberto o tempo todo ele ocupa a coluna
   * direita inteira, justamente onde ficam as pilhas de cada faixa.
   */

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
    /* ─── O LOG MUDOU DE CANTO, E O MOTIVO É A COLUNA DE ZONAS ──────────────
       Ele vivia em `sm:right-3 sm:top-16`, e ali passou a cobrir exatamente o
       slot do COMANDANTE: a coluna de zonas agora é fixa no canto superior
       direito, com comando no topo. Num retrato da mesa o painel do log ficava
       por cima da carta do comandante — a carta que precisa estar visível a
       partida inteira, porque é ela que responde "para onde ele volta".

       Foi para a ESQUERDA, embaixo do painel de vida, onde já havia coluna de
       HUD reservada e nada do tabuleiro é desenhado. */
    <div className="pointer-events-none absolute bottom-16 left-2 z-20 flex w-[min(14rem,calc(100vw-1rem))] flex-col sm:bottom-14 sm:left-3 sm:top-auto">
      <div
        className={`border-panel-border bg-panel/90 pointer-events-auto flex items-center justify-between border px-2.5 py-1.5 backdrop-blur ${collapsed ? 'rounded-xl' : 'rounded-t-xl'}`}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <MessageSquare className="text-text-muted h-3.5 w-3.5 shrink-0" />
          <span className="text-text truncate text-[11px] font-bold">Log &amp; Chat</span>
          {/* Recolhido, o contador é a única pista de que houve movimento. Sem
              ele, "fechado" e "vazio" são a mesma coisa na tela. */}
          {collapsed && log.length > 0 && (
            <span className="bg-primary/20 text-primary shrink-0 rounded-full px-1.5 text-[10px] font-bold">
              {log.length > 99 ? '99+' : log.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setAberto(collapsed)}
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
            className="custom-scrollbar border-panel-border bg-panel/80 pointer-events-auto max-h-[24dvh] min-h-0 flex-1 overflow-y-auto border-x backdrop-blur"
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
