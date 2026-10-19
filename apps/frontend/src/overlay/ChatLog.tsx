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
 *
 * ─── DIVIDIR E DESTACAR ────────────────────────────────────────────────────
 *
 * Numa mesa de quatro, o chat some no meio de centenas de "virou", "comprou",
 * "moveu". "Dividir" põe chat e ações em duas listas, cada uma com a própria
 * rolagem. "Abrir em janela" leva o log para uma janela à parte — num segundo
 * monitor ele fica inteiro à vista sem cobrir a mesa. A janela é um PORTAL do
 * React, não uma página nova: continua ligada à mesma sala e aos mesmos
 * stores, sem segunda conexão e sem segundo assento.
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen,
  ChevronDown,
  Columns2,
  Dices,
  ExternalLink,
  Heart,
  Layers,
  List,
  MessageSquare,
  Minimize2,
} from 'lucide-react';
import { useToast } from '../components/Toast';
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

/**
 * ─── FILTRO POR ASSUNTO, NÃO SÓ "AÇÃO OU CHAT" ──────────────────────────────
 *
 * Cada entrada do log já carrega o tipo, e as abas só sabiam separar chat do
 * resto. "Quanto de vida eu perdi?" e "quem embaralhou?" eram perguntas que se
 * respondiam rolando o log inteiro. As abas usam ícone porque o painel tem
 * 14rem: seis rótulos escritos não cabem.
 */
type Filtro = 'ALL' | 'CHAT' | 'CARTAS' | 'GRIMORIO' | 'VIDA' | 'DADOS';

const TIPOS_DO_FILTRO: Record<Exclude<Filtro, 'ALL'>, ReadonlySet<string>> = {
  CHAT: new Set(['CHAT']),
  CARTAS: new Set([
    'PLAY',
    'ZONE_CHANGE',
    'ZONE_CHANGE_HIDDEN',
    'DISCARD',
    'TAP',
    'UNTAP',
    'COUNTER',
    'TOKEN',
  ]),
  GRIMORIO: new Set(['DRAW', 'MILL', 'SHUFFLE', 'PEEK', 'SEARCH']),
  VIDA: new Set(['LIFE', 'CMD_DAMAGE']),
  DADOS: new Set(['DICE']),
};

const ABAS: { id: Filtro; rotulo: string; Icone: typeof List }[] = [
  { id: 'ALL', rotulo: 'Tudo', Icone: List },
  { id: 'CHAT', rotulo: 'Chat', Icone: MessageSquare },
  { id: 'CARTAS', rotulo: 'Cartas', Icone: Layers },
  { id: 'GRIMORIO', rotulo: 'Grimório', Icone: BookOpen },
  { id: 'VIDA', rotulo: 'Vida', Icone: Heart },
  { id: 'DADOS', rotulo: 'Dados e moedas', Icone: Dices },
];

interface ChatLogProps {
  room: Room<RoomState>;
}

type EntradaDoLog = ReturnType<typeof useGameStore.getState>['log'][number];

/**
 * Uma lista do log, com rolagem própria que acompanha a entrada nova. Com o
 * log dividido são duas, e cada uma precisa descer sozinha.
 */
function ListaDoLog({
  entradas,
  vazio,
  className,
  render,
}: {
  entradas: EntradaDoLog[];
  vazio: string;
  className: string;
  render: (e: EntradaDoLog) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [entradas.length]);
  return (
    <div ref={ref} className={`custom-scrollbar min-h-0 overflow-y-auto ${className}`}>
      {entradas.length === 0 ? (
        <p className="text-text-faint py-6 text-center text-[10px]">{vazio}</p>
      ) : (
        <div className="space-y-1 p-2">
          {entradas.map((e) => (
            <div key={e.id} className="break-words text-[11px] leading-relaxed">
              {render(e)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Prepara a janela destacada: as MESMAS folhas de estilo (as `<style>` do dev
 * e os `<link>` do build), as mesmas classes e atributos de tema do `<html>`
 * e do `<body>` — sem isso o portal renderizaria HTML cru, sem os tokens de
 * cor. Devolve o nó onde o portal monta.
 */
function prepararJanela(janela: Window): HTMLElement {
  const doc = janela.document;
  doc.title = 'Log da mesa — AetherTable';
  doc.head.querySelectorAll('[data-aether-copia]').forEach((n) => n.remove());
  document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => {
    const copia = n.cloneNode(true) as HTMLElement;
    copia.setAttribute('data-aether-copia', '');
    if (copia instanceof HTMLLinkElement) copia.href = (n as HTMLLinkElement).href;
    doc.head.appendChild(copia);
  });
  for (const attr of Array.from(document.documentElement.attributes)) {
    doc.documentElement.setAttribute(attr.name, attr.value);
  }
  doc.body.className = `${document.body.className} bg-table-deep text-text font-sans`;
  doc.body.style.margin = '0';
  let raiz = doc.getElementById('aether-log');
  if (!raiz) {
    raiz = doc.createElement('div');
    raiz.id = 'aether-log';
    doc.body.appendChild(raiz);
  }
  return raiz;
}

export function ChatLog({ room }: ChatLogProps) {
  const log = useGameStore((s) => s.log);
  const players = useGameStore((s) => s.players);
  const espectadores = useGameStore((s) => s.espectadores);
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
  const [filter, setFilter] = useState<Filtro>('ALL');
  const dividido = useUIStore((s) => s.logDividido);
  const setDividido = useUIStore((s) => s.setLogDividido);
  const avisar = useToast((s) => s.mostrar);
  /** A janela destacada e o nó onde o portal monta. `null` = log na mesa. */
  const [destacado, setDestacado] = useState<{ janela: Window; raiz: HTMLElement } | null>(null);
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

  // Fechar a janela pelo X dela devolve o log à mesa; sair da mesa (ou fechar
  // a aba principal) fecha a janela — sem a mesa, ela não teria o que mostrar.
  useEffect(() => {
    if (!destacado) return;
    const { janela } = destacado;
    const vigia = window.setInterval(() => {
      if (janela.closed) setDestacado(null);
    }, 500);
    const fecharJunto = () => janela.close();
    window.addEventListener('beforeunload', fecharJunto);
    return () => {
      window.clearInterval(vigia);
      window.removeEventListener('beforeunload', fecharJunto);
    };
  }, [destacado]);

  const janelaRef = useRef<Window | null>(null);
  useEffect(() => {
    janelaRef.current = destacado?.janela ?? null;
  }, [destacado]);
  useEffect(() => () => janelaRef.current?.close(), []);

  const destacar = () => {
    const janela = window.open('', 'aethertable-log', 'popup,width=440,height=720');
    if (!janela) {
      avisar('O navegador bloqueou a janela. Libere pop-ups para este site.', 'erro');
      return;
    }
    setDestacado({ janela, raiz: prepararJanela(janela) });
  };

  // O servidor manda `{Carta}` + o id; quem conhece nomes é o cliente.
  // Cartas que já saíram da mesa continuam nomeáveis no histórico porque o
  // catálogo é um cache por impressão, não um espelho do estado.
  React.useEffect(() => {
    hidratar(log.map((e) => e.scryfallId));
  }, [log, hidratar]);

  const nomeDaCarta = (entry: { scryfallId?: string }) =>
    (entry.scryfallId && catalogo[entry.scryfallId]?.name) || 'uma carta';

  const filtered = filter === 'ALL' ? log : log.filter((e) => TIPOS_DO_FILTRO[filter].has(e.type));
  // Dividido, a aba "Chat" sai (o chat tem a lista dele) e as outras filtram
  // só as ações.
  const filtroDasAcoes = filter === 'CHAT' ? 'ALL' : filter;
  const acoes = log.filter(
    (e) =>
      e.type !== 'CHAT' &&
      (filtroDasAcoes === 'ALL' || TIPOS_DO_FILTRO[filtroDasAcoes].has(e.type)),
  );
  const conversa = log.filter((e) => e.type === 'CHAT');

  const handleSendChat = () => {
    const text = chatInput.trim();
    if (!text || text.length > 500) return;
    intents.chat(room, text);
    setChatInput('');
  };

  /**
   * A plateia entra na busca pelo mesmo motivo que ela entra no `nomeDe` do
   * servidor: o chat é a única coisa que um espectador dispara, e sem esta
   * linha o comentário dele aparecia assinado com seis caracteres do sessionId
   * — que não identifica ninguém para quem está lendo.
   */
  const getPlayerName = (actorId: string) =>
    players[actorId]?.name ?? espectadores[actorId]?.name ?? actorId.slice(0, 6);
  const formatTimestamp = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const renderEntrada = (entry: EntradaDoLog) =>
    entry.type === 'CHAT' ? (
      <span className="inline-flex flex-wrap items-baseline gap-1">
        {(entry.actorId === myId || permitirDeOponentes) && (
          <TituloDeChat titleId={players[entry.actorId]?.chatTitle} />
        )}
        <span className={`font-bold ${entry.actorId === myId ? 'text-primary' : 'text-success'}`}>
          {getPlayerName(entry.actorId)}:
        </span>
        <span className="text-text">{entry.text}</span>
      </span>
    ) : (
      <span>
        <span className="text-text-faint">[{formatTimestamp(entry.timestamp)}] </span>
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
    );

  const abas = dividido ? ABAS.filter((a) => a.id !== 'CHAT') : ABAS;
  const abaAtiva = dividido ? filtroDasAcoes : filter;

  const botaoDividir = (
    <button
      onClick={() => setDividido(!dividido)}
      aria-pressed={dividido}
      title={dividido ? 'Juntar chat e ações' : 'Separar chat e ações'}
      aria-label={dividido ? 'Juntar chat e ações' : 'Separar chat e ações'}
      className={`transition-colors ${dividido ? 'text-primary' : 'text-text-muted hover:text-text'}`}
    >
      <Columns2 className="h-3.5 w-3.5" />
    </button>
  );

  /** Abas, lista(s) e campo de chat — iguais na mesa e na janela destacada. */
  const corpo = (naJanela: boolean) => (
    <>
      <div className="border-panel-border bg-panel/90 pointer-events-auto flex border-x backdrop-blur">
        {abas.map(({ id, rotulo, Icone }) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            title={rotulo}
            aria-label={rotulo}
            aria-pressed={abaAtiva === id}
            className={`flex flex-1 items-center justify-center py-1.5 transition-colors ${
              abaAtiva === id
                ? 'border-primary text-primary border-b'
                : 'text-text-faint hover:text-text-muted'
            }`}
          >
            <Icone className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>

      {dividido ? (
        <>
          <ListaDoLog
            entradas={acoes}
            vazio="Nenhuma ação ainda…"
            render={renderEntrada}
            className={`border-panel-border bg-panel/80 pointer-events-auto border-x backdrop-blur ${
              naJanela ? 'flex-[3]' : 'max-h-[16dvh]'
            }`}
          />
          <p className="border-panel-border bg-panel/90 text-text-faint pointer-events-auto flex items-center gap-1.5 border-x border-t px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider backdrop-blur">
            <MessageSquare className="h-3 w-3" /> Chat
          </p>
          <ListaDoLog
            entradas={conversa}
            vazio="Ninguém falou ainda."
            render={renderEntrada}
            className={`border-panel-border bg-panel/80 pointer-events-auto border-x backdrop-blur ${
              naJanela ? 'flex-[2]' : 'max-h-[12dvh]'
            }`}
          />
        </>
      ) : (
        <ListaDoLog
          entradas={filtered}
          vazio="Nenhuma ação ainda…"
          render={renderEntrada}
          className={`border-panel-border bg-panel/80 pointer-events-auto flex-1 border-x backdrop-blur ${
            naJanela ? '' : 'max-h-[24dvh]'
          }`}
        />
      )}

      <div
        className={`border-panel-border bg-panel/90 pointer-events-auto flex overflow-hidden border backdrop-blur ${
          naJanela ? '' : 'rounded-b-xl'
        }`}
      >
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
  );

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
        <div className="flex shrink-0 items-center gap-2">
          {!collapsed && !destacado && (
            <>
              {botaoDividir}
              <button
                onClick={destacar}
                title="Abrir em outra janela"
                aria-label="Abrir o log em outra janela"
                className="text-text-muted hover:text-text transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button
            onClick={() => setAberto(collapsed)}
            className="text-text-muted hover:text-text transition-colors"
            aria-label={collapsed ? 'Expandir log' : 'Recolher log'}
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {!collapsed &&
        (destacado ? (
          <div className="border-panel-border bg-panel/90 text-text-muted pointer-events-auto rounded-b-xl border border-t-0 p-2.5 text-[11px] backdrop-blur">
            O log está aberto em outra janela.{' '}
            <button
              onClick={() => {
                destacado.janela.close();
                setDestacado(null);
              }}
              className="text-primary hover:text-primary-hover font-semibold"
            >
              Trazer de volta
            </button>
          </div>
        ) : (
          corpo(false)
        ))}

      {destacado &&
        createPortal(
          <div className="flex h-screen flex-col">
            <div className="border-panel-border bg-panel flex items-center justify-between border px-3 py-2">
              <span className="text-text flex items-center gap-1.5 text-sm font-bold">
                <MessageSquare className="text-text-muted h-4 w-4" /> Log &amp; Chat
              </span>
              {botaoDividir}
            </div>
            {corpo(true)}
          </div>,
          destacado.raiz,
        )}
    </div>
  );
}
