'use client';

/**
 * OlhadaPanel.tsx — o que "olhar X do topo" (e "do fundo") mostra.
 *
 * ─── O DEFEITO QUE ESTE PAINEL FECHA ───────────────────────────────────────
 *
 * O menu do grimório oferecia "Olhar o fundo", "Olhar X do topo" e "Olhar X
 * do fundo". O servidor concedia a olhada, registrava no log público e mandava
 * as cartas só para o dono (`revealToOwner`) — e o cliente gravava a lista
 * num `peek` que NENHUM componente lia. O jogador clicava, a mesa inteira lia
 * "fulano olhou 3 cartas do topo", e ele não via nada.
 *
 * ─── PAINEL LATERAL, NÃO MODAL ─────────────────────────────────────────────
 *
 * O scry é uma transação (`ScryModal`): decide e confirma de uma vez. Olhar
 * não é — Sensei's Divining Top, Courser of Kruphix e companhia olham e
 * DEPOIS jogam, compram ou reordenam com a mesa visível. Por isso o painel
 * fica de lado e não escurece o tabuleiro.
 *
 * ─── O QUE CADA GESTO VIRA ─────────────────────────────────────────────────
 *
 *   - reordenar (arrastar ou ↑/↓) e "devolver em ordem aleatória" viram
 *     `INTENT_ARRANGE_PEEKED`: a olhada sobrevive à reordenação manual e é
 *     revogada na aleatória (senão "aleatória" seria "a ordem que eu sei");
 *   - mandar uma carta para outra zona é `INTENT_CHANGE_ZONE`, e a carta some
 *     daqui porque saiu do grimório;
 *   - fechar revoga a olhada (`INTENT_CLOSE_PEEK`). Olhar não é licença
 *     permanente (RN13).
 */

import React from 'react';
import type { Room } from 'colyseus.js';
import {
  ArrowDown,
  ArrowUp,
  Ban,
  Eye,
  GripVertical,
  Hand,
  Layers,
  MoreVertical,
  Shuffle,
  Skull,
  Swords,
  X,
} from 'lucide-react';
import { useGameStore, useTableStore, useUIStore } from '../store/game.store';
import { intents } from '../net/intents';
import { cardImageUrl } from '../canvas/textureCache';
import { useCardCatalog, useHidratarCartas } from '../cards/catalog';
import type { RoomState } from '../net/schema/RoomState';
import { useFecharComEsc } from './useFecharComEsc';

interface OlhadaPanelProps {
  room: Room<RoomState>;
}

/** Filtro por tipo: rótulo em português, termo da linha de tipo da Scryfall. */
const TIPOS: Array<[string, string]> = [
  ['Criatura', 'Creature'],
  ['Terreno', 'Land'],
  ['Instantâneo', 'Instant'],
  ['Feitiço', 'Sorcery'],
  ['Artefato', 'Artifact'],
  ['Encantamento', 'Enchantment'],
  ['Planeswalker', 'Planeswalker'],
  ['Batalha', 'Battle'],
];

const NOME_DA_ZONA: Record<string, string> = {
  LIBRARY: 'grimório',
  HAND: 'mão',
  GRAVEYARD: 'cemitério',
  EXILE: 'exílio',
};

export function OlhadaPanel({ room }: OlhadaPanelProps) {
  const olhada = useTableStore((s) => s.peek);
  const setPeek = useTableStore((s) => s.setPeek);
  const cards = useGameStore((s) => s.cards);
  const myId = useGameStore((s) => s.mySessionId);
  const catalogo = useCardCatalog((s) => s.cartas);
  const setInspectedCard = useUIStore((s) => s.setInspectedCard);

  /**
   * A ordem é local até sair na intenção, pelo mesmo motivo do `ScryModal`:
   * regravar o store a cada arraste recriaria `olhada` e o efeito de abertura
   * zeraria o resto do estado.
   */
  const [ordem, setOrdem] = React.useState<string[]>([]);
  const [emFoco, setEmFoco] = React.useState<string | null>(null);
  const [menuDe, setMenuDe] = React.useState<string | null>(null);
  const [arrastando, setArrastando] = React.useState<string | null>(null);
  const [texto, setTexto] = React.useState('');
  const [tipo, setTipo] = React.useState('');
  const [cmc, setCmc] = React.useState('');

  React.useEffect(() => {
    if (!olhada) return;
    setOrdem(olhada.cards.map((c) => c.id));
    setEmFoco(olhada.cards[0]?.id ?? null);
    setMenuDe(null);
    setTexto('');
    setTipo('');
    setCmc('');
  }, [olhada]);

  useHidratarCartas(olhada ? olhada.cards.map((c) => c.scryfallId) : []);

  const fechar = React.useCallback(() => {
    intents.closePeek(room);
    setPeek(null);
  }, [room, setPeek]);

  useFecharComEsc(Boolean(olhada), fechar);

  /**
   * Só as que CONTINUAM onde foram olhadas. Comprar, jogar ou moer uma delas
   * (por aqui ou pela mesa) a tira da lista; a identidade vem do mapa vivo,
   * não do evento, para nunca mostrar carta que a olhada já não cobre.
   */
  const vivas = olhada
    ? ordem.filter((id) => {
        const c = cards[id];
        return !!c && c.zone === olhada.zone && c.ownerId === myId && !!c.scryfallId;
      })
    : [];

  // Tudo saiu da zona olhada: não sobra o que mostrar, e a olhada não cobre
  // mais nada. Fecha sozinho em vez de deixar um painel vazio na tela.
  const vazio = Boolean(olhada) && ordem.length > 0 && vivas.length === 0;
  React.useEffect(() => {
    if (vazio) fechar();
  }, [vazio, fechar]);

  if (!olhada) return null;

  const doGrimorio = olhada.motivo === 'PEEK' && olhada.zone === 'LIBRARY';
  const ponta = olhada.from;
  const outraPonta = ponta === 'TOP' ? 'BOTTOM' : 'TOP';

  const meta = (id: string) => {
    const sf = cards[id]?.scryfallId;
    return sf ? catalogo[sf] : undefined;
  };

  const filtrando = Boolean(texto.trim() || tipo || cmc);
  const visiveis = vivas.filter((id) => {
    const m = meta(id);
    if (texto.trim() && !(m?.name ?? '').toLowerCase().includes(texto.trim().toLowerCase())) {
      return false;
    }
    if (tipo && !(m?.typeLine ?? '').includes(tipo)) return false;
    if (cmc) {
      const v = m?.cmc ?? 0;
      if (cmc === '7+' ? v < 7 : v !== Number(cmc)) return false;
    }
    return true;
  });

  /** Grava uma ordem nova e a manda ao servidor como reordenação manual. */
  const reordenar = (nova: string[]) => {
    setOrdem(nova);
    const enviar = nova.filter((id) => vivas.includes(id));
    if (enviar.length > 0) intents.arrangePeeked(room, enviar, ponta, false);
  };

  const mover = (id: string, direcao: -1 | 1) => {
    const i = vivas.indexOf(id);
    const alvo = i + direcao;
    if (i < 0 || alvo < 0 || alvo >= vivas.length) return;
    const nova = [...vivas];
    const [item] = nova.splice(i, 1);
    if (item) nova.splice(alvo, 0, item);
    reordenar(nova);
  };

  const soltarSobre = (alvo: string) => {
    if (!arrastando || arrastando === alvo) return;
    const nova = vivas.filter((id) => id !== arrastando);
    nova.splice(nova.indexOf(alvo), 0, arrastando);
    setArrastando(null);
    reordenar(nova);
  };

  /** Uma carta para a ponta OLHADA é reordenar; para a outra, é trocar de lugar. */
  const paraPonta = (id: string, destino: 'TOP' | 'BOTTOM') => {
    if (doGrimorio && destino === ponta) {
      reordenar([id, ...vivas.filter((x) => x !== id)]);
      return;
    }
    // Fundo = índice 0; sem índice, o servidor empilha no topo.
    intents.changeZone(
      room,
      id,
      'LIBRARY',
      undefined,
      undefined,
      destino === 'BOTTOM' ? 0 : undefined,
    );
  };

  const acoesDe = (id: string) =>
    [
      olhada.zone !== 'HAND' && {
        rotulo: 'Mão',
        icone: <Hand className="h-3.5 w-3.5" />,
        fazer: () => intents.changeZone(room, id, 'HAND'),
      },
      {
        rotulo: 'Campo',
        icone: <Swords className="h-3.5 w-3.5" />,
        fazer: () => intents.changeZone(room, id, 'BATTLEFIELD', 0, 0),
      },
      {
        rotulo: 'Campo virada',
        icone: <Layers className="h-3.5 w-3.5" />,
        fazer: () =>
          intents.changeZone(room, id, 'BATTLEFIELD', 0, 0, undefined, { faceDown: true }),
      },
      {
        rotulo: 'Cemitério',
        icone: <Skull className="h-3.5 w-3.5" />,
        fazer: () => intents.changeZone(room, id, 'GRAVEYARD'),
      },
      {
        rotulo: 'Exílio',
        icone: <Ban className="h-3.5 w-3.5" />,
        fazer: () => intents.changeZone(room, id, 'EXILE'),
      },
      {
        rotulo: 'Exílio virada',
        icone: <Ban className="h-3.5 w-3.5" />,
        fazer: () =>
          intents.changeZone(room, id, 'EXILE', undefined, undefined, undefined, {
            faceDown: true,
          }),
      },
      {
        rotulo: 'Topo do grimório',
        icone: <ArrowUp className="h-3.5 w-3.5" />,
        fazer: () => paraPonta(id, 'TOP'),
      },
      {
        rotulo: 'Fundo do grimório',
        icone: <ArrowDown className="h-3.5 w-3.5" />,
        fazer: () => paraPonta(id, 'BOTTOM'),
      },
      {
        rotulo: 'Ver informações',
        icone: <Eye className="h-3.5 w-3.5" />,
        fazer: () => {
          const sf = cards[id]?.scryfallId;
          if (sf) setInspectedCard(sf);
        },
      },
    ].filter(Boolean) as Array<{ rotulo: string; icone: React.ReactNode; fazer: () => void }>;

  const embaralharBloco = (destino: 'TOP' | 'BOTTOM') => {
    if (vivas.length > 0) intents.arrangePeeked(room, vivas, destino, true);
    setPeek(null);
  };

  const titulo =
    olhada.motivo === 'RANDOM'
      ? `Carta sorteada · ${NOME_DA_ZONA[olhada.zone] ?? olhada.zone}`
      : `${ponta === 'TOP' ? 'Topo' : 'Fundo'} do grimório · ${vivas.length} carta${vivas.length === 1 ? '' : 's'}`;

  const foco = emFoco && vivas.includes(emFoco) ? emFoco : vivas[0];
  const focoSf = foco ? cards[foco]?.scryfallId : undefined;

  return (
    <aside
      className="painel-entra border-panel-border bg-panel/95 pointer-events-auto fixed inset-y-0 right-0 z-50 flex w-full max-w-xs flex-col border-l shadow-2xl backdrop-blur sm:max-w-sm"
      role="dialog"
      aria-label={titulo}
    >
      <header className="border-panel-border flex items-start justify-between gap-2 border-b p-4">
        <div>
          <h2 className="text-text text-base font-bold leading-tight">{titulo}</h2>
          {doGrimorio && (
            <p className="text-text-faint mt-1 text-[11px] leading-snug">
              {ponta === 'TOP'
                ? 'A primeira da lista é a próxima compra. Arraste para reordenar.'
                : 'A primeira da lista é a do fundo. Arraste para reordenar.'}
            </p>
          )}
        </div>
        <button
          onClick={fechar}
          className="text-text-muted hover:bg-panel-hover hover:text-text rounded p-1 transition-colors"
          aria-label="Fechar"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      {focoSf && (
        <div className="flex justify-center px-4 pt-3">
          <img
            src={cardImageUrl(focoSf, 'normal')}
            alt={meta(foco!)?.name ?? 'Carta'}
            className="border-panel-border aspect-[63/88] w-40 rounded-lg border object-cover shadow-lg sm:w-48"
          />
        </div>
      )}

      {vivas.length > 1 && (
        <div className="flex flex-col gap-2 px-4 pt-3">
          <div className="flex gap-2">
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="border-panel-border bg-table-deep text-text min-w-0 flex-1 rounded-md border px-2 py-1.5 text-xs"
              aria-label="Filtrar por tipo"
            >
              <option value="">Qualquer tipo</option>
              {TIPOS.map(([rotulo, termo]) => (
                <option key={termo} value={termo}>
                  {rotulo}
                </option>
              ))}
            </select>
            <select
              value={cmc}
              onChange={(e) => setCmc(e.target.value)}
              className="border-panel-border bg-table-deep text-text w-24 rounded-md border px-2 py-1.5 text-xs"
              aria-label="Filtrar por valor de mana"
            >
              <option value="">VM</option>
              {['0', '1', '2', '3', '4', '5', '6', '7+'].map((v) => (
                <option key={v} value={v}>
                  VM {v}
                </option>
              ))}
            </select>
          </div>
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Filtrar pelo nome"
            className="border-panel-border bg-table-deep text-text focus:border-primary rounded-md border px-2 py-1.5 text-xs focus:outline-none"
          />
          {/* Reordenar com filtro ligado mexeria em cartas que estão fora da
              tela. Melhor dizer por que as alças sumiram do que deixá-las e
              produzir uma ordem que o jogador não viu. */}
          {filtrando && doGrimorio && (
            <p className="text-text-faint text-[10px]">Limpe os filtros para reordenar.</p>
          )}
        </div>
      )}

      <ol className="custom-scrollbar mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {visiveis.map((id) => {
          const posicao = vivas.indexOf(id);
          const nome = meta(id)?.name ?? '…';
          const podeReordenar = doGrimorio && !filtrando && vivas.length > 1;
          return (
            <li
              key={id}
              draggable={podeReordenar}
              onDragStart={() => setArrastando(id)}
              onDragOver={(e) => podeReordenar && e.preventDefault()}
              onDrop={() => soltarSobre(id)}
              onDragEnd={() => setArrastando(null)}
              onMouseEnter={() => setEmFoco(id)}
              className={`rounded-md ${arrastando === id ? 'opacity-40' : ''} ${
                foco === id ? 'bg-panel-hover' : ''
              }`}
            >
              <div className="flex items-center gap-1.5 px-1 py-1.5">
                {podeReordenar ? (
                  <GripVertical className="text-text-faint h-4 w-4 shrink-0 cursor-grab" />
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <span className="text-text-faint w-5 shrink-0 text-right text-[10px] tabular-nums">
                  {posicao + 1}
                </span>
                <button
                  onClick={() => setEmFoco(id)}
                  className="text-text min-w-0 flex-1 truncate text-left text-sm"
                  title={nome}
                >
                  {nome}
                </button>
                {/* ↑/↓ além do arraste: arrastar com o dedo não existe em
                    HTML5 drag-and-drop, e no celular a ordem ficaria presa. */}
                {podeReordenar && (
                  <>
                    <button
                      onClick={() => mover(id, -1)}
                      disabled={posicao === 0}
                      className="text-text-muted hover:text-text rounded p-0.5 disabled:opacity-25"
                      aria-label="Subir"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => mover(id, 1)}
                      disabled={posicao === vivas.length - 1}
                      className="text-text-muted hover:text-text rounded p-0.5 disabled:opacity-25"
                      aria-label="Descer"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
                <button
                  onClick={() => setMenuDe(menuDe === id ? null : id)}
                  className="text-text-muted hover:bg-panel hover:text-text rounded p-1"
                  aria-label={`Ações da carta ${nome}`}
                  aria-expanded={menuDe === id}
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </div>
              {menuDe === id && (
                <div className="grid grid-cols-2 gap-1 px-2 pb-2" role="menu">
                  {acoesDe(id).map((a) => (
                    <button
                      key={a.rotulo}
                      role="menuitem"
                      onClick={() => {
                        a.fazer();
                        setMenuDe(null);
                      }}
                      className="border-panel-border bg-table-deep text-text hover:border-primary hover:text-primary flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] transition-colors"
                    >
                      {a.icone}
                      <span className="truncate">{a.rotulo}</span>
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
        {visiveis.length === 0 && vivas.length > 0 && (
          <li className="text-text-faint px-2 py-6 text-center text-xs">
            Nenhuma carta com esse filtro.
          </li>
        )}
      </ol>

      <footer className="border-panel-border grid grid-cols-2 gap-2 border-t p-3">
        {doGrimorio && vivas.length > 1 && (
          <>
            <button
              onClick={() => embaralharBloco(ponta)}
              className="border-panel-border bg-table-deep text-text hover:border-primary flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-[11px] font-bold leading-tight transition-colors"
            >
              <Shuffle className="h-3.5 w-3.5 shrink-0" />
              De volta em ordem aleatória
            </button>
            <button
              onClick={() => embaralharBloco(outraPonta)}
              className="border-panel-border bg-table-deep text-text hover:border-primary flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-[11px] font-bold leading-tight transition-colors"
            >
              <Shuffle className="h-3.5 w-3.5 shrink-0" />
              {outraPonta === 'BOTTOM' ? 'No fundo' : 'No topo'} em ordem aleatória
            </button>
          </>
        )}
        <button
          onClick={fechar}
          className="border-panel-border text-text hover:bg-panel-hover rounded-md border px-2 py-2 text-xs font-bold transition-colors"
        >
          Fechar
        </button>
        {olhada.zone === 'LIBRARY' && (
          <button
            onClick={() => {
              intents.shuffle(room, 'LIBRARY');
              setPeek(null);
            }}
            className="bg-primary hover:bg-primary-hover flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-bold text-white transition-colors"
          >
            <Shuffle className="h-3.5 w-3.5" />
            Fechar e embaralhar
          </button>
        )}
      </footer>
    </aside>
  );
}
