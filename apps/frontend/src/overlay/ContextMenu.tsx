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
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Dices,
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

/**
 * ─── UM NÍVEL DE SUBMENU, EM PROFUNDIDADE E NÃO EM FLYOUT ──────────────────
 *
 * O menu do grimório tinha treze itens numa lista plana e ainda faltavam as
 * ações com quantidade ("ver X do topo", "mover X para o cemitério") — com
 * elas a lista passaria de vinte entradas num painel de `w-56` com
 * `max-h-[60dvh]`, ou seja: rolagem para achar "embaralhar".
 *
 * O submenu abre NO LUGAR da lista, com um "voltar" no cabeçalho, em vez de
 * voar para o lado. Três motivos concretos:
 *
 *   1. o painel é `fixed` e já precisa de correção de borda (`ajuste`) para não
 *      sair da tela; um flyout precisaria da mesma correção outra vez, agora
 *      podendo abrir para a esquerda ou para a direita;
 *   2. flyout depende de hover para manter aberto, e hover não existe em toque
 *      — no celular metade das ações da mesa ficaria inalcançável;
 *   3. a profundidade cabe no mesmo retângulo, então o `ajuste` calculado
 *      continua valendo.
 */
interface Acao {
  rotulo: string;
  icone: React.ReactNode;
  perigo?: boolean;
  /** Ação folha. Exclusivo com `itens` e `quantidade`. */
  onClick?: () => void;
  /** Abre um submenu no lugar da lista. */
  itens?: Acao[];
  /** Pede um número antes de executar. */
  quantidade?: {
    /** Texto acima do campo. Diz o que o número significa. */
    rotulo: string;
    padrao: number;
    min: number;
    max: number;
    executar: (n: number) => void;
  };
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
  /**
   * Preferência do jogador: "Anexar a…" sai do menu.
   *
   * Só a ENTRADA do gesto desaparece. `Desanexar` continua listado em qualquer
   * carta que já esteja anexada — desligar a preferência com um equipamento na
   * mesa não pode transformá-lo em algo impossível de separar.
   */
  const anexosDesativados = useUIStore((s) => s.anexosDesativados);
  const catalogo = useCardCatalog((s) => s.cartas);

  const cards = useGameStore((s) => s.cards);
  const players = useGameStore((s) => s.players);
  const myId = useGameStore((s) => s.mySessionId);

  const ref = useRef<HTMLDivElement>(null);
  const [ajuste, setAjuste] = useState({ x: 0, y: 0 });
  /** Submenu aberto. `null` = a lista raiz. */
  const [submenu, setSubmenu] = useState<Acao | null>(null);
  /** Ação esperando um número. `null` = ninguém. */
  const [pedindo, setPedindo] = useState<Acao | null>(null);
  const [qtd, setQtd] = useState(1);

  /**
   * Fechar o menu ou trocar de alvo volta para a raiz.
   *
   * Sem isto, reabrir o menu num alvo diferente reaproveitava o submenu do
   * alvo anterior — botão direito numa carta mostrando "Mover do topo" do
   * grimório.
   */
  useEffect(() => {
    setSubmenu(null);
    setPedindo(null);
  }, [aberto, alvo]);

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
    // `submenu` e `pedindo` entram nas dependências porque mudam a ALTURA do
    // painel: um submenu aberto perto do rodapé estourava a janela e os
    // últimos itens ficavam inalcançáveis — o mesmo defeito que este efeito
    // existe para corrigir na abertura.
  }, [aberto, pos.x, pos.y, submenu, pedindo]);

  if (!aberto || !alvo) return null;

  const executar = (fn: () => void) => () => {
    fn();
    fechar();
  };

  let titulo = 'Mesa';
  let acoes: Acao[] = [];

  if (alvo === 'library') {
    titulo = 'Grimório';
    /**
     * ─── AS AÇÕES COM QUANTIDADE ───────────────────────────────────────────
     *
     * O menu só oferecia números fixos: "Moer 1", "Exilar 1 do topo", "Topo
     * para o fundo" — sempre uma carta. Quem precisa moer sete, olhar as três
     * do topo ou mandar quatro para o fundo tinha de repetir o clique, e cada
     * repetição é uma intenção a mais no limite de 30/s.
     *
     * As intenções SEMPRE aceitaram quantidade (`MillIntent.amount` vai até
     * 100, `PeekIntent` até 100, `RevealTopIntent` até 20): o que faltava era
     * onde digitar. Os tetos abaixo são os do schema — pedir mais seria erro
     * de validação depois do clique.
     */
    acoes = [
      {
        rotulo: 'Comprar 1',
        icone: <Hand className="h-4 w-4" />,
        onClick: executar(() => intents.draw(room, 1)),
      },
      {
        rotulo: 'Comprar…',
        icone: <Layers className="h-4 w-4" />,
        itens: [
          {
            rotulo: 'Comprar 7',
            icone: <Layers className="h-4 w-4" />,
            onClick: executar(() => intents.draw(room, 7)),
          },
          {
            rotulo: 'Comprar X…',
            icone: <Layers className="h-4 w-4" />,
            quantidade: {
              rotulo: 'Quantas cartas comprar',
              padrao: 2,
              min: 1,
              max: 20,
              executar: (n) => intents.draw(room, n),
            },
          },
          {
            rotulo: 'Comprar até 7 na mão',
            icone: <Hand className="h-4 w-4" />,
            onClick: executar(() => intents.drawUpTo(room, 7)),
          },
        ],
      },
      {
        rotulo: 'Ver…',
        icone: <Eye className="h-4 w-4" />,
        itens: [
          {
            rotulo: 'A carta do topo',
            icone: <Eye className="h-4 w-4" />,
            onClick: executar(() => intents.peek(room, 'LIBRARY', 1, 'TOP')),
          },
          {
            rotulo: 'X cartas do topo…',
            icone: <Eye className="h-4 w-4" />,
            quantidade: {
              rotulo: 'Quantas cartas do topo',
              padrao: 3,
              min: 1,
              max: 20,
              executar: (n) => intents.peek(room, 'LIBRARY', n, 'TOP'),
            },
          },
          {
            rotulo: 'A carta do fundo',
            icone: <ArrowDownToLine className="h-4 w-4" />,
            onClick: executar(() => intents.peek(room, 'LIBRARY', 1, 'BOTTOM')),
          },
          {
            rotulo: 'X cartas do fundo…',
            icone: <ArrowDownToLine className="h-4 w-4" />,
            quantidade: {
              rotulo: 'Quantas cartas do fundo',
              padrao: 3,
              min: 1,
              max: 20,
              executar: (n) => intents.peek(room, 'LIBRARY', n, 'BOTTOM'),
            },
          },
          {
            rotulo: 'O grimório inteiro (tutor)',
            icone: <Search className="h-4 w-4" />,
            onClick: executar(() => {
              setZoneOwner(myId);
              setInspectedZone('LIBRARY');
            }),
          },
        ],
      },
      {
        rotulo: 'Scry e surveil…',
        icone: <ArrowUpDown className="h-4 w-4" />,
        itens: [
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
            rotulo: 'Scry X…',
            icone: <ArrowUpDown className="h-4 w-4" />,
            quantidade: {
              rotulo: 'Quantas cartas olhar',
              padrao: 3,
              min: 1,
              max: 10,
              executar: (n) => intents.scry(room, n),
            },
          },
          {
            rotulo: 'Surveil 1',
            icone: <Skull className="h-4 w-4" />,
            onClick: executar(() => intents.surveil(room, 1)),
          },
          {
            rotulo: 'Surveil X…',
            icone: <Skull className="h-4 w-4" />,
            quantidade: {
              rotulo: 'Quantas cartas olhar',
              padrao: 2,
              min: 1,
              max: 10,
              executar: (n) => intents.surveil(room, n),
            },
          },
        ],
      },
      {
        rotulo: 'Revelar…',
        icone: <Eye className="h-4 w-4" />,
        itens: [
          {
            rotulo: 'A carta do topo',
            icone: <Eye className="h-4 w-4" />,
            onClick: executar(() => intents.revealTop(room, 1)),
          },
          {
            rotulo: 'X cartas do topo…',
            icone: <Eye className="h-4 w-4" />,
            quantidade: {
              rotulo: 'Quantas cartas revelar',
              padrao: 2,
              min: 1,
              max: 20,
              executar: (n) => intents.revealTop(room, n),
            },
          },
          {
            // Vermelho de propósito: revela o grimório INTEIRO para a mesa e
            // não há como desfazer isso sem reembaralhar. `INTENT_UNDO` não
            // reverte revelação — está em `NAO_REVERSIVEIS`.
            rotulo: 'O grimório inteiro',
            icone: <Eye className="h-4 w-4" />,
            perigo: true,
            onClick: executar(() => intents.revealZone(room, 'LIBRARY', 'ALL')),
          },
        ],
      },
      {
        rotulo: 'Mover do topo…',
        icone: <ArrowDownToLine className="h-4 w-4" />,
        itens: [
          {
            rotulo: '1 para o cemitério',
            icone: <Skull className="h-4 w-4" />,
            onClick: executar(() => intents.mill(room, 1, 'GRAVEYARD')),
          },
          {
            rotulo: 'X para o cemitério…',
            icone: <Skull className="h-4 w-4" />,
            quantidade: {
              rotulo: 'Quantas cartas moer',
              padrao: 3,
              min: 1,
              max: 100,
              executar: (n) => intents.mill(room, n, 'GRAVEYARD'),
            },
          },
          {
            rotulo: '1 para o exílio',
            icone: <Ban className="h-4 w-4" />,
            onClick: executar(() => intents.mill(room, 1, 'EXILE')),
          },
          {
            rotulo: 'X para o exílio…',
            icone: <Ban className="h-4 w-4" />,
            quantidade: {
              rotulo: 'Quantas cartas exilar',
              padrao: 3,
              min: 1,
              max: 100,
              executar: (n) => intents.mill(room, n, 'EXILE'),
            },
          },
          {
            rotulo: '1 para o fundo',
            icone: <ArrowDownToLine className="h-4 w-4" />,
            onClick: executar(() => intents.moveTopToBottom(room, 1)),
          },
          {
            rotulo: 'X para o fundo…',
            icone: <ArrowDownToLine className="h-4 w-4" />,
            quantidade: {
              rotulo: 'Quantas cartas para o fundo',
              padrao: 2,
              min: 1,
              max: 100,
              executar: (n) => intents.moveTopToBottom(room, n),
            },
          },
        ],
      },
      {
        rotulo: 'Mover tudo…',
        icone: <ArrowDownToLine className="h-4 w-4" />,
        itens: [
          {
            // 100 é o teto de `MillIntent`, e o handler já corta pelo tamanho
            // real do grimório (`Math.min(amount, grimorio.length)`). Um deck
            // de Commander tem 99 mais o comandante, então o teto cobre.
            rotulo: 'O grimório para o cemitério',
            icone: <Skull className="h-4 w-4" />,
            perigo: true,
            onClick: executar(() => intents.mill(room, 100, 'GRAVEYARD')),
          },
          {
            rotulo: 'O grimório para o exílio',
            icone: <Ban className="h-4 w-4" />,
            perigo: true,
            onClick: executar(() => intents.mill(room, 100, 'EXILE')),
          },
        ],
      },
      {
        rotulo: 'Carta aleatória',
        icone: <Dices className="h-4 w-4" />,
        onClick: executar(() => intents.randomCard(room, 'LIBRARY')),
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
          ...(card.attachedTo || !anexosDesativados
            ? [
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
                    // Anexar é um gesto de dois passos, como a seta: escolher a
                    // carta de destino no tabuleiro. Reaproveita o mesmo modo.
                    setArrowSource(card.id);
                    setModoAnexar(true);
                  }),
                },
              ]
            : []),
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

  const lista = submenu?.itens ?? acoes;
  const cabecalho = pedindo?.rotulo ?? submenu?.rotulo ?? titulo;
  const podeVoltar = Boolean(submenu || pedindo);

  const voltar = () => {
    // Do prompt de quantidade volta-se para o submenu que o continha, e não
    // para a raiz: quem errou o número quer o item vizinho, não recomeçar.
    if (pedindo) setPedindo(null);
    else setSubmenu(null);
  };

  const abrir = (a: Acao) => {
    if (a.quantidade) {
      setQtd(a.quantidade.padrao);
      setPedindo(a);
      return;
    }
    if (a.itens) {
      setSubmenu(a);
      return;
    }
    a.onClick?.();
  };

  return (
    <div
      ref={ref}
      className="painel-entra border-panel-border bg-panel/95 pointer-events-auto fixed z-50 w-56 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border shadow-2xl backdrop-blur"
      style={{ left: pos.x + ajuste.x, top: pos.y + ajuste.y }}
      role="menu"
    >
      {podeVoltar ? (
        <button
          onClick={voltar}
          className="border-panel-border bg-panel-hover text-text-muted hover:text-primary flex w-full items-center gap-1.5 border-b px-3 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
          {cabecalho}
        </button>
      ) : (
        <div className="border-panel-border bg-panel-hover text-text-muted border-b px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider">
          {cabecalho}
        </div>
      )}

      {pedindo?.quantidade ? (
        <form
          className="flex flex-col gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const q = pedindo.quantidade!;
            q.executar(Math.min(q.max, Math.max(q.min, qtd)));
            fechar();
          }}
        >
          <label className="text-text-faint text-[10px] leading-snug">
            {pedindo.quantidade.rotulo} ({pedindo.quantidade.min}–{pedindo.quantidade.max})
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              autoFocus
              min={pedindo.quantidade.min}
              max={pedindo.quantidade.max}
              value={qtd}
              onChange={(e) => setQtd(Number(e.target.value))}
              /* `select()` no foco: o valor padrão fica marcado e digitar um
                 número o substitui, em vez de virar "31" a partir de "3". */
              onFocus={(e) => e.target.select()}
              className="border-panel-border bg-table-deep text-text focus:border-primary w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none"
            />
            <button
              type="submit"
              className="bg-primary hover:bg-primary-hover flex shrink-0 items-center gap-1 rounded-md px-3 py-1.5 text-xs font-bold text-white transition-colors"
            >
              <Check className="h-3.5 w-3.5" />
              OK
            </button>
          </div>
        </form>
      ) : (
        <div className="custom-scrollbar max-h-[60dvh] overflow-y-auto py-1">
          {lista.map((a) => (
            <button
              key={a.rotulo}
              onClick={() => abrir(a)}
              role="menuitem"
              className={`hover:bg-panel-hover flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                a.perigo ? 'text-danger hover:bg-danger/10' : 'text-text'
              }`}
            >
              {a.icone}
              <span className="min-w-0 flex-1 truncate">{a.rotulo}</span>
              {/* A seta diz que o item ABRE algo em vez de agir. Sem ela, o
                  jogador clica esperando a ação e recebe outra lista. */}
              {(a.itens || a.quantidade) && (
                <ChevronRight className="text-text-faint h-3.5 w-3.5 shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
