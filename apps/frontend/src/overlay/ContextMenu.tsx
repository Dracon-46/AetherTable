'use client';

/**
 * ContextMenu.tsx — menu do botão direito na mesa.
 *
 * `openContextMenu` já era chamado pelo GameBoard (em carta, no grimório e no
 * fundo da mesa) e gravava `contextMenuCard` / `contextMenuPos` no store — mas
 * NENHUM componente lia esse estado. O botão direito simplesmente não fazia
 * nada, e com ele metade das ações de mesa ficava inacessível: virar, olhar,
 * moer, anotar, destacar, mandar para o cemitério, exilar.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { Room } from 'colyseus.js';
import {
  ArrowDownToLine,
  ArrowUpDown,
  Ban,
  Copy,
  Crosshair,
  Eye,
  FlipHorizontal,
  Hand,
  Layers,
  Link2,
  Link2Off,
  RefreshCw,
  RotateCcw,
  Search,
  Shuffle,
  Skull,
  Sparkles,
  StickyNote,
  Send,
  Swords,
  Trash2,
  Users,
} from 'lucide-react';
import { useGameStore, useUIStore } from '../store/game.store';
import { useCardCatalog } from '../cards/catalog';
import { intents } from '../net/intents';
import type { RoomState } from '../net/schema/RoomState';

interface ContextMenuProps {
  room: Room<RoomState>;
  /**
   * Liga o modo "escolha o alvo no tabuleiro". `true` = anexar, `false` = seta.
   * O gesto precisa de dois toques porque arrastar já significa mover a carta.
   */
  setModoAnexar: (anexar: boolean) => void;
}

interface Acao {
  rotulo: string;
  icone: React.ReactNode;
  perigo?: boolean;
  onClick: () => void;
}

export function ContextMenu({ room, setModoAnexar }: ContextMenuProps) {
  const aberto = useUIStore((s) => s.activeModals.context);
  const alvo = useUIStore((s) => s.contextMenuCard);
  const pos = useUIStore((s) => s.contextMenuPos);
  const fechar = useUIStore((s) => s.closeContextMenu);
  const setInspectedZone = useUIStore((s) => s.setInspectedZone);
  const setInspectedCard = useUIStore((s) => s.setInspectedCard);
  const setArrowSource = useUIStore((s) => s.setArrowSource);
  const setEditingCard = useUIStore((s) => s.setEditingCard);
  const setZoneOwner = useUIStore((s) => s.setZoneOwner);
  const catalogo = useCardCatalog((s) => s.cartas);

  const cards = useGameStore((s) => s.cards);
  const players = useGameStore((s) => s.players);
  const myId = useGameStore((s) => s.mySessionId);

  const ref = useRef<HTMLDivElement>(null);
  const [ajuste, setAjuste] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!aberto) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) fechar();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [aberto, fechar]);

  // Mantém o menu inteiro dentro da janela: perto da borda direita/inferior ele
  // saía da tela e ficava inalcançável.
  useEffect(() => {
    if (!aberto || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const dx = Math.min(0, window.innerWidth - (pos.x + r.width) - 8);
    const dy = Math.min(0, window.innerHeight - (pos.y + r.height) - 8);
    setAjuste({ x: dx, y: dy });
  }, [aberto, pos.x, pos.y]);

  if (!aberto || !alvo) return null;

  const executar = (fn: () => void) => () => {
    fn();
    fechar();
  };

  let titulo = 'Mesa';
  let acoes: Acao[] = [];

  if (alvo === 'library') {
    titulo = 'Grimório';
    acoes = [
      {
        rotulo: 'Comprar 1',
        icone: <Hand className="h-4 w-4" />,
        onClick: executar(() => intents.draw(room, 1)),
      },
      {
        rotulo: 'Comprar 7',
        icone: <Layers className="h-4 w-4" />,
        onClick: executar(() => intents.draw(room, 7)),
      },
      {
        rotulo: 'Olhar o topo (scry)',
        icone: <Eye className="h-4 w-4" />,
        onClick: executar(() => intents.peek(room, 'LIBRARY', 1, 'TOP')),
      },
      {
        rotulo: 'Buscar (tutor)',
        icone: <Search className="h-4 w-4" />,
        onClick: executar(() => {
          setZoneOwner(myId);
          setInspectedZone('LIBRARY');
        }),
      },
      {
        rotulo: 'Scry 1',
        icone: <ArrowUpDown className="h-4 w-4" />,
        onClick: executar(() => intents.scry(room, 1)),
      },
      {
        rotulo: 'Scry 2',
        icone: <ArrowUpDown className="h-4 w-4" />,
        onClick: executar(() => intents.scry(room, 2)),
      },
      {
        rotulo: 'Surveil 1',
        icone: <Skull className="h-4 w-4" />,
        onClick: executar(() => intents.surveil(room, 1)),
      },
      {
        rotulo: 'Revelar o topo',
        icone: <Eye className="h-4 w-4" />,
        onClick: executar(() => intents.revealTop(room, 1)),
      },
      {
        rotulo: 'Topo para o fundo',
        icone: <ArrowDownToLine className="h-4 w-4" />,
        onClick: executar(() => intents.moveTopToBottom(room, 1)),
      },
      {
        rotulo: 'Moer 1 para o cemitério',
        icone: <ArrowDownToLine className="h-4 w-4" />,
        onClick: executar(() => intents.mill(room, 1, 'GRAVEYARD')),
      },
      {
        rotulo: 'Exilar 1 do topo',
        icone: <Ban className="h-4 w-4" />,
        onClick: executar(() => intents.mill(room, 1, 'EXILE')),
      },
      {
        rotulo: 'Comprar até 7 na mão',
        icone: <Hand className="h-4 w-4" />,
        onClick: executar(() => intents.drawUpTo(room, 7)),
      },
      {
        rotulo: 'Embaralhar',
        icone: <Shuffle className="h-4 w-4" />,
        onClick: executar(() => intents.shuffle(room, 'LIBRARY')),
      },
    ];
  } else if (alvo === 'zone') {
    titulo = 'Mesa';
    acoes = [
      /**
       * COMPRAR ABRE O MENU DA MESA.
       *
       * "Comprar 1" só existia no menu do GRIMÓRIO — ou seja, era preciso
       * acertar a pilha com o botão direito. Comprar é a ação mais repetida da
       * partida inteira; exigir mira para ela, enquanto "virar tudo" está a um
       * clique de qualquer ponto da mesa, inverte a prioridade. O menu do
       * grimório continua existindo, com as opções que só fazem sentido lá
       * (scry, tutor, moer, embaralhar).
       */
      {
        rotulo: 'Comprar 1',
        icone: <Hand className="h-4 w-4" />,
        onClick: executar(() => intents.draw(room, 1)),
      },
      {
        rotulo: 'Comprar 7',
        icone: <Layers className="h-4 w-4" />,
        onClick: executar(() => intents.draw(room, 7)),
      },
      {
        rotulo: 'Desvirar tudo',
        icone: <RotateCcw className="h-4 w-4" />,
        onClick: executar(() => intents.untapAll(room)),
      },
      {
        rotulo: 'Ver cemitério',
        icone: <Skull className="h-4 w-4" />,
        onClick: executar(() => {
          setZoneOwner(myId);
          setInspectedZone('GRAVEYARD');
        }),
      },
      {
        rotulo: 'Ver exílio',
        icone: <Ban className="h-4 w-4" />,
        onClick: executar(() => {
          setZoneOwner(myId);
          setInspectedZone('EXILE');
        }),
      },
      {
        rotulo: 'Virar tudo',
        icone: <RefreshCw className="h-4 w-4" />,
        onClick: executar(() => intents.tapAll(room)),
      },
      {
        rotulo: 'Ver reserva (sideboard)',
        icone: <Layers className="h-4 w-4" />,
        onClick: executar(() => {
          setZoneOwner(myId);
          setInspectedZone('SIDEBOARD');
        }),
      },
      {
        rotulo: 'Revelar minha mão',
        icone: <Users className="h-4 w-4" />,
        onClick: executar(() => intents.revealZone(room, 'HAND', 'ALL')),
      },
      {
        rotulo: 'Descartar a mão',
        icone: <Skull className="h-4 w-4" />,
        perigo: true,
        onClick: executar(() => intents.discardAll(room)),
      },
      {
        rotulo: 'Apagar minhas setas',
        icone: <Crosshair className="h-4 w-4" />,
        onClick: executar(() => intents.clearArrows(room, 'MINE')),
      },
      {
        rotulo: 'Limpar tokens',
        icone: <Trash2 className="h-4 w-4" />,
        perigo: true,
        onClick: executar(() => intents.clearTokens(room)),
      },
    ];
  } else {
    const card = cards[alvo];
    if (!card) return null;
    const meu = card.controllerId === myId;
    // O título era "Carta". Agora que existe catálogo, é o nome de verdade —
    // com quatro menus abertos numa mesa cheia, isso é a diferença entre saber
    // e adivinhar em qual permanente se está agindo.
    const nomeCarta = card.scryfallId ? catalogo[card.scryfallId]?.name : undefined;
    titulo = nomeCarta ?? (card.zone === 'COMMAND' ? 'Comandante' : 'Carta');

    acoes = [
      {
        rotulo: 'Inspecionar',
        icone: <Eye className="h-4 w-4" />,
        onClick: executar(() => card.scryfallId && setInspectedCard(card.scryfallId)),
      },
    ];

    if (meu) {
      if (card.zone === 'COMMAND') {
        acoes.push({
          rotulo: 'Conjurar comandante',
          icone: <Sparkles className="h-4 w-4" />,
          onClick: executar(() => intents.castCommander(room, card.id)),
        });
      }
      if (card.zone === 'BATTLEFIELD') {
        acoes.push(
          {
            rotulo: card.isTapped ? 'Desvirar' : 'Virar',
            icone: <RotateCcw className="h-4 w-4" />,
            onClick: executar(() => intents.tap(room, card.id, !card.isTapped)),
          },
          {
            rotulo: card.faceDown ? 'Virar para cima' : 'Virar para baixo',
            icone: <Layers className="h-4 w-4" />,
            onClick: executar(() => intents.setFaceDown(room, card.id, !card.faceDown)),
          },
          {
            rotulo: '+1/+1',
            icone: <Sparkles className="h-4 w-4" />,
            onClick: executar(() => intents.addCounter(room, card.id, '+1/+1', 1)),
          },
          {
            rotulo: '−1/−1',
            icone: <Sparkles className="h-4 w-4" />,
            onClick: executar(() => intents.addCounter(room, card.id, '-1/-1', 1)),
          },
          {
            rotulo: 'Limpar marcadores',
            icone: <Trash2 className="h-4 w-4" />,
            onClick: executar(() => intents.clearCounters(room, card.id)),
          },
          {
            rotulo: 'Trazer para frente',
            icone: <Layers className="h-4 w-4" />,
            onClick: executar(() => intents.bringToFront(room, card.id)),
          },
        );
      }

      if (card.zone === 'BATTLEFIELD') {
        acoes.push(
          {
            rotulo: 'Transformar (outra face)',
            icone: <FlipHorizontal className="h-4 w-4" />,
            onClick: executar(() => intents.transform(room, card.id)),
          },
          {
            rotulo: card.attachedTo ? 'Desanexar' : 'Anexar a…',
            icone: card.attachedTo ? (
              <Link2Off className="h-4 w-4" />
            ) : (
              <Link2 className="h-4 w-4" />
            ),
            onClick: executar(() => {
              if (card.attachedTo) {
                intents.detach(room, card.id);
                return;
              }
              // Anexar é um gesto de dois passos, como a seta: escolher a carta
              // de destino no tabuleiro. Reaproveita o mesmo modo.
              setArrowSource(card.id);
              setModoAnexar(true);
            }),
          },
          {
            // Um único painel para marcadores, P/T, dano, anotação e destaque.
            // Antes eram quatro `window.prompt` — diálogo nativo que trava a
            // aba, não mostra o valor atual e não valida nada.
            rotulo: 'Marcadores, P/T e dano…',
            icone: <Swords className="h-4 w-4" />,
            onClick: executar(() => setEditingCard(card.id)),
          },
          {
            // Cópia de permanente: sai deslocada da original e entra marcada
            // como `isCopy`, para o jogador saber qual sai da mesa no fim.
            rotulo: 'Copiar para a mesa',
            icone: <Copy className="h-4 w-4" />,
            onClick: executar(() => intents.copyCard(room, card.id)),
          },
          {
            rotulo: 'Apontar seta para…',
            icone: <Crosshair className="h-4 w-4" />,
            onClick: executar(() => {
              setArrowSource(card.id);
              setModoAnexar(false);
            }),
          },
        );

        /**
         * ENVIAR PARA A MESA DE OUTRO JOGADOR.
         *
         * `INTENT_SET_CONTROLLER` existia no servidor desde sempre e NENHUMA
         * tela o emitia: doar uma criatura, ou resolver qualquer efeito de
         * troca de controle, não tinha superfície nenhuma. Uma entrada por
         * oponente em vez de um submenu porque a mesa tem no máximo sete —
         * e um submenu a mais é um clique a mais numa ação que já é rara.
         *
         * Quem controla passa a desenhar a carta na PRÓPRIA faixa: é isso que
         * faz "dar o controle" e "mandar para a mesa dele" serem a mesma coisa.
         */
        Object.values(players)
          .filter((p) => p.id !== myId)
          .sort((a, b) => a.seat - b.seat)
          .forEach((p) => {
            acoes.push({
              rotulo: `Enviar para a mesa de ${p.name}`,
              icone: <Send className="h-4 w-4" />,
              onClick: executar(() => intents.giveCard(room, card.id, p.id)),
            });
          });
      }

      acoes.push(
        {
          rotulo: 'Revelar para a mesa',
          icone: <Eye className="h-4 w-4" />,
          onClick: executar(() => intents.reveal(room, [card.id], 'ALL')),
        },
        {
          rotulo: 'Ocultar de novo',
          icone: <Ban className="h-4 w-4" />,
          onClick: executar(() => intents.unreveal(room, [card.id])),
        },
        // "Definir como comandante" ficava aqui e foi REMOVIDO de propósito.
        //
        // Comandante é decisão de construção de deck, não de mesa. Promover uma
        // carta qualquer a comandante no meio da partida contorna a validação
        // de formato inteira: o backend confere na entrada que o deck tem um
        // comandante legal, e essa checagem não vale nada se qualquer carta na
        // mão puder virar comandante depois, com imposto próprio e dano de
        // comandante contando a favor de quem a promoveu.
        //
        // O `INTENT_SET_COMMANDER` continua existindo no game-server para o
        // provisionamento inicial do deck. O que sai é o atalho da mesa.
        {
          rotulo: 'Para a mão',
          icone: <Hand className="h-4 w-4" />,
          onClick: executar(() => intents.changeZone(room, card.id, 'HAND')),
        },
        {
          rotulo: 'Para o cemitério',
          icone: <Skull className="h-4 w-4" />,
          onClick: executar(() => intents.changeZone(room, card.id, 'GRAVEYARD')),
        },
        {
          rotulo: 'Exilar',
          icone: <Ban className="h-4 w-4" />,
          onClick: executar(() => intents.changeZone(room, card.id, 'EXILE')),
        },
        {
          rotulo: 'Topo do grimório',
          icone: <ArrowDownToLine className="h-4 w-4" />,
          onClick: executar(() => intents.changeZone(room, card.id, 'LIBRARY')),
        },
      );

      if (card.isToken) {
        acoes.push({
          rotulo: 'Destruir token',
          icone: <Trash2 className="h-4 w-4" />,
          perigo: true,
          onClick: executar(() => intents.destroyToken(room, card.id)),
        });
      } else {
        acoes.push({
          rotulo: card.note ? 'Editar anotação' : 'Anotar',
          icone: <StickyNote className="h-4 w-4" />,
          onClick: executar(() => setEditingCard(card.id)),
        });
      }
    }
  }

  return (
    <div
      ref={ref}
      className="painel-entra border-panel-border bg-panel/95 pointer-events-auto fixed z-50 w-56 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border shadow-2xl backdrop-blur"
      style={{ left: pos.x + ajuste.x, top: pos.y + ajuste.y }}
      role="menu"
    >
      <div className="border-panel-border bg-panel-hover text-text-muted border-b px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider">
        {titulo}
      </div>
      <div className="custom-scrollbar max-h-[60dvh] overflow-y-auto py-1">
        {acoes.map((a) => (
          <button
            key={a.rotulo}
            onClick={a.onClick}
            role="menuitem"
            className={`hover:bg-panel-hover flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
              a.perigo ? 'text-danger hover:bg-danger/10' : 'text-text'
            }`}
          >
            {a.icone}
            {a.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}
