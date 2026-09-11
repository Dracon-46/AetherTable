'use client';

/**
 * GameBoard.tsx — Mesa de Jogo com React-Konva (DOC-040 §2).
 *
 * A geometria vive em `layout.ts`: a mesa é dividida em FAIXAS, uma por
 * assento, e as coordenadas de permanente são relativas à faixa de quem a
 * controla. Ver o cabeçalho daquele arquivo para o porquê.
 *
 * Regras de performance que este componente respeita (DOC-040 §3.2):
 *   - a posição de cada carta é DERIVADA, nunca gravada no store durante o
 *     render;
 *   - texturas são compartilhadas por `scryfallId` (textureCache);
 *   - `listening: false` em tudo que não é interativo;
 *   - `INTENT_MOVE_CARD` sai no máximo 20x/s (throttle em net/intents.ts).
 */

import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import {
  Stage,
  Layer,
  Rect,
  Text,
  Group,
  Image as KonvaImage,
  Circle,
  Arrow,
  Line,
} from 'react-konva';
import type { Room } from 'colyseus.js';
import Konva from 'konva';
import { useGameStore, useTableStore, useUIStore, type CardData } from '../store/game.store';
import { getTexture } from './textureCache';
import { chaveDaZona, idDoTopo } from '../store/ordem-de-zona';
import { useCardCatalog, type CardMeta } from '../cards/catalog';
import { caminhoDoPet, playmatCanvas, sleeveCanvas } from '../cosmetics/render';
import { cosmeticosVisiveis, useCosmeticos } from '../cosmetics/store';
import { acharPet } from '@aethertable/shared-types';
import { intents } from '../net/intents';
import type { RoomState } from '../net/schema/RoomState';
import {
  CARD_W,
  CARD_H,
  encaixarNaGrade,
  escalasDaMesaFocada,
  montarGrade,
  montarMesa,
  montarMesaFocada,
  posicaoNaMao,
  posicaoNoCampo,
  posicaoNoComando,
  paraCoordenadaRelativa,
  zonaSolta,
  type Faixa,
  type Mesa,
  type Ponto,
} from './layout';

interface GameBoardProps {
  room: Room<RoomState>;
  modoAnexar: boolean;
  onAlvoEscolhido: () => void;
}

/**
 * Base da faixa. OPACA, e não um véu translúcido.
 *
 * Eram `rgba(...,0.055)` e `rgba(...,0.30)` desenhados POR CIMA do playmat —
 * que já embute 40% de preto por diretriz (DOC-060 §2.2). Somados, a arte
 * chegava com quase 60% de escurecimento: nítida no seletor de cosméticos,
 * quase invisível na mesa. Agora a base fica ATRÁS e o playmat por cima dela.
 */
const COR_FAIXA_FOCO = 'rgba(15,23,42,0.55)';
const COR_FAIXA = 'rgba(15,23,42,0.72)';
/** Borda de quem está na vez. Dourado, e nunca usado para mais nada. */
const COR_VEZ = 'rgba(250,204,21,0.9)';
/** Âmbar da zona de comando — a mesma família do ícone de coroa da UI. */
const COR_COMANDO = 'rgba(69,53,22,0.42)';
const COR_COMANDO_BORDA = 'rgba(251,191,36,0.35)';

/** Uma carta pronta para desenhar: dado do servidor + posição derivada. */
interface CartaPosicionada {
  card: CardData;
  pos: Ponto;
  /** Faixa em que a carta vive, quando é uma permanente. */
  faixa: Faixa | null;
  arrastavel: boolean;
  /** Mostra a frente (identidade conhecida) ou o verso. */
  frente: boolean;
  /** Índice da face visível — 1 numa carta de dupla face transformada. */
  face: number;
  escala: number;
  /** Sleeve de quem é DONO da carta: o verso da carta é dele, não de quem a controla. */
  sleeveId: string;
}

// ─── Sprite ──────────────────────────────────────────────────────────────────

interface CardSpriteProps {
  item: CartaPosicionada;
  meta: CardMeta | null;
  room: Room<RoomState>;
  isSelected: boolean;
  onContextMenu: (cardId: string, x: number, y: number) => void;
  onInspect: (scryfallId: string) => void;
  onAlvo: ((cardId: string) => void) | null;
  onSelecionar: (cardId: string, aditivo: boolean) => void;
  onHover: (cardId: string | null) => void;
}

const CardSprite = React.memo(function CardSprite({
  item,
  meta,
  room,
  isSelected,
  onContextMenu,
  onInspect,
  onAlvo,
  onSelecionar,
  onHover,
}: CardSpriteProps) {
  const { card, pos, faixa, arrastavel, frente, face, escala, sleeveId } = item;
  const myId = useGameStore((s) => s.mySessionId);
  /**
   * As duas preferências abaixo são lidas por SPRITE, e não pelo tabuleiro.
   *
   * Alternar qualquer uma delas re-renderiza todas as cartas — o que é
   * exatamente o desejado e acontece algumas vezes por partida, não por
   * quadro. Passá-las por prop obrigaria a memoização do `CardSprite` a
   * invalidar por um campo novo em cada item posicionado.
   */
  const alinharNaGrade = useUIStore((s) => s.alinharNaGrade);
  const custoDeManaNaMao = useUIStore((s) => s.custoDeManaNaMao);
  const isController = card.controllerId === myId;
  const isLocked = Boolean(card.lockedBy) && card.lockedBy !== myId;
  const isDraggingMe = card.lockedBy === myId;

  const w = CARD_W * escala;
  const h = CARD_H * escala;

  const [imgEl, setImgEl] = useState<HTMLImageElement | HTMLCanvasElement | null>(null);

  useEffect(() => {
    // Carta oculta mostra o SLEEVE, desenhado localmente. Nada de rede, e
    // nada de arte da WotC (DOC-060 §2.1).
    if (!frente || !card.scryfallId) {
      setImgEl(sleeveCanvas(sleeveId));
      return;
    }

    let active = true;
    const alvo = getTexture(card.scryfallId, 'normal', face === 1 ? 'back' : 'front');

    if (alvo.complete) {
      // DOC-060 §4: a mesa nunca fica sem verso enquanto a arte carrega.
      setImgEl(alvo.naturalWidth > 0 ? alvo : sleeveCanvas(sleeveId));
      return;
    }

    setImgEl(null);
    const onLoad = () => {
      if (active && alvo.naturalWidth > 0) setImgEl(alvo);
    };
    alvo.addEventListener('load', onLoad);
    return () => {
      active = false;
      alvo.removeEventListener('load', onLoad);
    };
  }, [card.scryfallId, frente, face, sleeveId]);

  const rotation = card.isTapped ? 90 : (card.rotation ?? 0);
  const [drag, setDrag] = useState<Ponto | null>(null);
  const visivel = drag ?? pos;

  /**
   * MOVIMENTO INTERPOLADO.
   *
   * Sem isto a carta TELEPORTA: uma compra, um mulligan ou um efeito que move
   * seis permanentes de uma vez viram um piscar de posições, e é impossível
   * acompanhar o que saiu de onde. O patch do Colyseus chega a 20 Hz — a
   * interpolação é o que transforma esses saltos em movimento.
   *
   * Nunca interpola o que o PRÓPRIO jogador está arrastando: ali a carta tem de
   * seguir o dedo sem atraso.
   */
  const grupoRef = useRef<Konva.Group>(null);
  const reduzido = useMovimentoReduzido();

  useEffect(() => {
    const node = grupoRef.current;
    if (!node || drag) return;

    const alvo = { x: pos.x, y: pos.y, rotation };
    const distancia = Math.hypot(node.x() - alvo.x, node.y() - alvo.y);

    if (reduzido || distancia < 1) {
      node.position({ x: alvo.x, y: alvo.y });
      node.rotation(alvo.rotation);
      return;
    }

    // Percursos longos (mão → campo) ganham um pouco mais de tempo; ajustes
    // finos continuam instantâneos ao olho.
    const duracao = Math.min(0.34, 0.12 + distancia / 2600);
    node.to({ ...alvo, duration: duracao, easing: Konva.Easings.EaseOut });
  }, [pos.x, pos.y, rotation, drag, reduzido]);

  const handleDragStart = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      if (!isController || !arrastavel) {
        e.target.stopDrag();
        return;
      }
      intents.grab(room, card.id);
    },
    [room, card.id, isController, arrastavel],
  );

  const handleDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const x = Math.round(e.target.x());
      const y = Math.round(e.target.y());
      setDrag({ x, y });
      if (!faixa) return;
      const rel = paraCoordenadaRelativa(faixa, x, y);
      intents.moveCard(room, card.id, rel.x, rel.y);
    },
    [room, card.id, faixa],
  );

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const x = Math.round(e.target.x());
      const y = Math.round(e.target.y());
      setDrag(null);

      const minhaFaixa = faixa;
      // Soltar abaixo da última faixa = faixa de mão.
      const naMao = minhaFaixa ? y > minhaFaixa.topo + minhaFaixa.altura : true;

      if (naMao && card.zone !== 'HAND') {
        intents.changeZone(room, card.id, 'HAND');
        return;
      }
      if (!minhaFaixa) return;

      // Quem decide a zona é a geometria — ver `zonaSolta` em layout.ts. Antes
      // daqui só existiam mão e campo: soltar sobre o cemitério, o exílio, o
      // grimório ou a zona de comando caía no ramo do campo, e o clamp de
      // `posicaoNoCampo` devolvia a carta para o meio da mesa.
      const destino = zonaSolta(minhaFaixa, x, y);

      if (destino !== 'BATTLEFIELD') {
        if (card.zone !== destino) intents.changeZone(room, card.id, destino);
        return;
      }

      /**
       * O encaixe na grade acontece AQUI e não em `handleDragMove`.
       *
       * Durante o arraste a carta acompanha o cursor livremente; o encaixe é o
       * último passo, no instante em que ela é soltada. Encaixar durante o
       * movimento faz a carta pular a cada meia célula e o arraste parece
       * travado — e, pior, cada pulo emitiria um `INTENT_MOVE_CARD`.
       */
      const bruta = paraCoordenadaRelativa(minhaFaixa, x, y);
      const rel = alinharNaGrade ? encaixarNaGrade(minhaFaixa, bruta) : bruta;
      if (card.zone !== 'BATTLEFIELD')
        intents.changeZone(room, card.id, 'BATTLEFIELD', rel.x, rel.y);
      else intents.release(room, card.id, rel.x, rel.y);
    },
    [room, card.id, card.zone, faixa, alinharNaGrade],
  );

  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const evt = e.evt as MouseEvent;
      if (evt.button === 2) return;

      if (onAlvo) {
        onAlvo(card.id);
        return;
      }

      if (evt.altKey) {
        if (card.scryfallId) onInspect(card.scryfallId);
        return;
      }

      if (evt.shiftKey || evt.ctrlKey || evt.metaKey) {
        onSelecionar(card.id, true);
        return;
      }

      if (evt.detail === 2 && isController && card.zone === 'BATTLEFIELD') {
        intents.tap(room, card.id, !card.isTapped);
        return;
      }

      onSelecionar(card.id, false);
    },
    [
      room,
      card.id,
      card.scryfallId,
      card.isTapped,
      card.zone,
      isController,
      onInspect,
      onAlvo,
      onSelecionar,
    ],
  );

  const handleRightClick = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      const p = e.target.getStage()?.getPointerPosition();
      if (p) onContextMenu(card.id, p.x, p.y);
    },
    [card.id, onContextMenu],
  );

  const faceMeta = meta?.faces[face] ?? meta?.faces[0];
  const ptImpresso =
    faceMeta?.power && faceMeta?.toughness ? `${faceMeta.power}/${faceMeta.toughness}` : null;
  const ptExibido = card.hasPtOverride
    ? `${card.powerOverride}/${card.toughnessOverride}`
    : ptImpresso;

  return (
    <Group
      ref={grupoRef}
      x={visivel.x}
      y={visivel.y}
      draggable={arrastavel && isController && !isLocked}
      rotation={rotation}
      offsetX={w / 2}
      offsetY={h / 2}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onTap={handleClick}
      onContextMenu={handleRightClick}
      onMouseEnter={() => onHover(card.id)}
      onMouseLeave={() => onHover(null)}
      opacity={card.phasedOut ? 0.4 : 1}
    >
      <Rect
        width={w}
        height={h}
        fill={frente ? '#1e1e2e' : '#2a2a3a'}
        cornerRadius={6}
        shadowColor="black"
        shadowBlur={isDraggingMe ? 20 : 6}
        shadowOpacity={isDraggingMe ? 0.8 : 0.4}
        shadowOffsetY={isDraggingMe ? 8 : 3}
        perfectDrawEnabled={false}
      />

      {imgEl && (
        <KonvaImage
          image={imgEl}
          width={w}
          height={h}
          cornerRadius={6}
          perfectDrawEnabled={false}
          listening={false}
        />
      )}

      {/* Enquanto a textura não chega, o NOME já dá para jogar. Antes ficava
          um retângulo com "…" e ninguém sabia o que era a carta. */}
      {!imgEl && frente && (
        <Text
          text={faceMeta?.name ?? '…'}
          width={w - 10}
          height={h}
          x={5}
          align="center"
          verticalAlign="middle"
          fill="#94A3B8"
          fontSize={11 * escala}
          listening={false}
        />
      )}

      {isLocked && (
        <Rect width={w} height={h} fill="rgba(239,68,68,0.25)" cornerRadius={6} listening={false} />
      )}

      {isSelected && (
        <Rect
          width={w}
          height={h}
          stroke="#3B82F6"
          strokeWidth={3}
          cornerRadius={6}
          fill="rgba(59,130,246,0.12)"
          listening={false}
        />
      )}

      {card.highlight && (
        <Rect
          width={w}
          height={h}
          stroke={card.highlight}
          strokeWidth={3}
          cornerRadius={6}
          listening={false}
        />
      )}

      {/* Marcadores nomeados */}
      {Object.entries(card.counters ?? {}).map(([name, value], idx) => (
        <Group key={name} x={4 + idx * 24 * escala} y={h - 20 * escala} listening={false}>
          <Circle
            radius={10 * escala}
            fill={name.includes('+1') ? '#22C55E' : name.includes('-1') ? '#EF4444' : '#3B82F6'}
          />
          <Text
            text={String(value)}
            fontSize={9 * escala}
            fill="white"
            width={20 * escala}
            height={20 * escala}
            offsetX={10 * escala}
            offsetY={10 * escala}
            align="center"
            verticalAlign="middle"
          />
        </Group>
      ))}

      {/* ── CUSTO DE MANA NA MÃO ─────────────────────────────────────────
          Numa mesa sem motor de regras, decidir o que jogar no turno é uma
          conta que o jogador faz de cabeça — e a arte em 120px não entrega o
          custo de forma legível quando a mão tem oito cartas em leque, porque
          o canto superior direito de cada carta fica coberto pela vizinha.

          Só na PRÓPRIA mão, e só na frente: no campo de batalha o custo já foi
          pago e o selo brigaria com marcadores, dano e P/T pelo mesmo pixel. */}
      {custoDeManaNaMao && card.zone === 'HAND' && frente && faceMeta?.manaCost && (
        <Group x={w / 2} y={11 * escala} listening={false}>
          <Rect
            x={-30 * escala}
            y={-10 * escala}
            width={60 * escala}
            height={20 * escala}
            fill="rgba(0,0,0,0.82)"
            cornerRadius={5}
          />
          <Text
            text={faceMeta.manaCost}
            width={60 * escala}
            height={20 * escala}
            offsetX={30 * escala}
            offsetY={10 * escala}
            align="center"
            verticalAlign="middle"
            fontSize={11 * escala}
            fontStyle="bold"
            fill="#F8FAFC"
            ellipsis
            wrap="none"
          />
        </Group>
      )}

      {/* P/T: o sobreposto vence o impresso, e a cor diz qual dos dois é. */}
      {ptExibido && card.zone === 'BATTLEFIELD' && frente && (
        <Group x={w / 2} y={h - 11 * escala} listening={false}>
          <Rect
            x={-24 * escala}
            y={-10 * escala}
            width={48 * escala}
            height={20 * escala}
            fill="rgba(0,0,0,0.82)"
            cornerRadius={5}
          />
          <Text
            text={ptExibido}
            width={48 * escala}
            height={20 * escala}
            offsetX={24 * escala}
            offsetY={10 * escala}
            align="center"
            verticalAlign="middle"
            fontSize={12 * escala}
            fontStyle="bold"
            fill={card.hasPtOverride ? '#FBBF24' : '#F8FAFC'}
          />
        </Group>
      )}

      {card.damage > 0 && (
        <Group x={w - 14 * escala} y={14 * escala} listening={false}>
          <Circle radius={11 * escala} fill="#EF4444" />
          <Text
            text={String(card.damage)}
            fontSize={10 * escala}
            fill="white"
            width={22 * escala}
            height={22 * escala}
            offsetX={11 * escala}
            offsetY={11 * escala}
            align="center"
            verticalAlign="middle"
          />
        </Group>
      )}

      {card.note && (
        <Group x={4} y={h - 34 * escala} listening={false}>
          <Rect width={w - 8} height={14 * escala} fill="rgba(0,0,0,0.75)" cornerRadius={3} />
          <Text
            text={card.note}
            width={w - 12}
            height={14 * escala}
            x={2}
            align="center"
            verticalAlign="middle"
            fontSize={9 * escala}
            fill="#E2E8F0"
            ellipsis
            wrap="none"
          />
        </Group>
      )}

      {card.goadedBy && (
        <Text text="provocada" fontSize={8 * escala} fill="#F59E0B" x={4} y={4} listening={false} />
      )}

      {card.faceDown && (
        <Text text="face ↓" fontSize={9 * escala} fill="#94A3B8" x={4} y={4} listening={false} />
      )}

      {face === 1 && (
        <Text
          text="⟲"
          fontSize={13 * escala}
          fill="#FBBF24"
          x={w - 16 * escala}
          y={h - 20 * escala}
          listening={false}
        />
      )}
    </Group>
  );
});

// ─── Pilhas ──────────────────────────────────────────────────────────────────

function Pilha({
  rotulo,
  centro,
  quantidade,
  cor,
  verso,
  versoImagem,
  topo,
  escala,
  onClick,
  onContextMenu,
}: {
  rotulo: string;
  centro: Ponto;
  quantidade: number;
  cor: string;
  verso: boolean;
  /** Sleeve de quem é dono da pilha — o verso das cartas dele (DOC-060). */
  versoImagem?: HTMLCanvasElement | null;
  topo?: HTMLImageElement | null;
  escala: number;
  onClick?: () => void;
  onContextMenu?: (x: number, y: number) => void;
}) {
  const camadas = Math.min(3, Math.max(1, Math.ceil(quantidade / 12)));
  const w = CARD_W * escala;
  const h = CARD_H * escala;

  /**
   * O BOTÃO DIREITO NÃO COMPRA.
   *
   * O Konva dispara `click` para QUALQUER botão do mouse — inclusive o direito,
   * que também dispara `contextmenu`. Na pilha do grimório os dois handlers
   * estavam ligados: um clique com o botão direito abria o menu de contexto E
   * comprava uma carta. Da cadeira do jogador, o grimório roubava uma carta
   * toda vez que ele tentava abrir as opções — e o menu que aparecia por cima
   * escondia justamente a mão onde a carta tinha acabado de cair.
   *
   * `button === 2` é o direito; `1` é o do meio. Só o esquerdo (`0`) e o toque
   * (que não traz `button`) compram.
   */
  const cliqueEsquerdo = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const evt = e.evt as MouseEvent;
    if (typeof evt?.button === 'number' && evt.button !== 0) return;
    onClick?.();
  };

  return (
    <Group
      x={centro.x}
      y={centro.y}
      offsetX={w / 2}
      offsetY={h / 2}
      onClick={onClick ? cliqueEsquerdo : undefined}
      onTap={onClick}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        e.cancelBubble = true;
        const p = e.target.getStage()?.getPointerPosition();
        if (p && onContextMenu) onContextMenu(p.x, p.y);
      }}
    >
      {Array.from({ length: camadas }).map((_, i) => (
        <Rect
          key={i}
          x={i * 2}
          y={-i * 2}
          width={w}
          height={h}
          fill={cor}
          stroke="rgba(255,255,255,0.08)"
          cornerRadius={6}
          listening={i === camadas - 1}
          perfectDrawEnabled={false}
        />
      ))}

      {topo && !verso && (
        <KonvaImage image={topo} width={w} height={h} cornerRadius={6} listening={false} />
      )}

      {/* O SLEEVE APARECE AQUI, E SÓ AQUI.
          O cosmético mais visível da mesa é o verso do grimório — é a única
          carta virada para baixo que fica na tela a partida inteira. A pilha
          desenhava um retângulo cinza fixo (`cor`) e ignorava o sleeve
          equipado: quem escolhia um protetor nas configurações não via
          diferença nenhuma na mesa, o que virou "os cosméticos não aparecem". */}
      {verso && versoImagem && quantidade > 0 && (
        <KonvaImage
          image={versoImagem}
          width={w}
          height={h}
          cornerRadius={6}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}

      <Text
        text={rotulo}
        y={-16 * escala}
        width={w}
        align="center"
        fontSize={10 * escala}
        fontStyle="bold"
        fill="rgba(255,255,255,0.45)"
        listening={false}
      />

      <Group x={w / 2} y={h} listening={false}>
        <Rect x={-17} y={-11} width={34} height={20} fill="rgba(0,0,0,0.8)" cornerRadius={10} />
        <Text
          text={String(quantidade)}
          width={34}
          height={20}
          offsetX={17}
          offsetY={11}
          align="center"
          verticalAlign="middle"
          fontSize={12}
          fontStyle="bold"
          fill="#E2E8F0"
        />
      </Group>
    </Group>
  );
}

// ─── Zona de comando ─────────────────────────────────────────────────────────

/**
 * Slot da zona de comando de uma faixa.
 *
 * NÃO é uma `Pilha`, e a diferença é o motivo de este componente existir. As
 * outras zonas se desenham a partir do próprio conteúdo: sem cartas, não há o
 * que mostrar, e tudo bem. A de comando é o contrário — precisa estar visível
 * JUSTAMENTE quando está vazia, porque é aí que ela responde à única pergunta
 * que importa: para onde o comandante volta quando morrer.
 *
 * A refatoração que trocou o plano único de 1920x1080 pelas faixas por assento
 * levou junto o `ZoneOutline label="COMANDO"` e recriou só as quatro pilhas da
 * direita. O `LARGURA_COMANDO` continuou reservado e os comandantes continuaram
 * sendo posicionados aqui — só que flutuando sobre nada.
 */
function SlotComando({
  centro,
  quantidade,
  escala,
}: {
  centro: Ponto;
  quantidade: number;
  escala: number;
}) {
  const w = CARD_W * escala;
  const h = CARD_H * escala;
  const vazia = quantidade === 0;

  return (
    <Group x={centro.x} y={centro.y} offsetX={w / 2} offsetY={h / 2} listening={false}>
      <Rect
        width={w}
        height={h}
        fill={COR_COMANDO}
        stroke={COR_COMANDO_BORDA}
        strokeWidth={1}
        // Tracejado só quando vazia: cheia, a moldura sólida emoldura a carta;
        // vazia, o tracejado a lê como espaço reservado e não como carta virada
        // para baixo.
        dash={vazia ? [7, 5] : undefined}
        cornerRadius={6}
      />
      <Text
        text="COMANDO"
        y={-16 * escala}
        width={w}
        align="center"
        fontSize={10 * escala}
        fontStyle="bold"
        fill="rgba(251,191,36,0.75)"
      />
      {quantidade > 1 && (
        <Group x={w / 2} y={h}>
          <Rect x={-17} y={-11} width={34} height={20} fill="rgba(0,0,0,0.8)" cornerRadius={10} />
          <Text
            text={String(quantidade)}
            width={34}
            height={20}
            offsetX={17}
            offsetY={11}
            align="center"
            verticalAlign="middle"
            fontSize={12}
            fontStyle="bold"
            fill="#FCD34D"
          />
        </Group>
      )}
    </Group>
  );
}

// ─── Mascote ─────────────────────────────────────────────────────────────────

/**
 * Mascote da faixa. Discreto de propósito: fica no canto, é pequeno e se move
 * devagar. Um enfeite que disputa atenção com as cartas deixa de ser enfeite e
 * vira ruído — e a mesa já é densa.
 *
 * Respeita `prefers-reduced-motion`: quem pediu menos movimento vê a silhueta
 * parada, não uma silhueta pulsando.
 */
function Mascote({ petId, x, y }: { petId: string; x: number; y: number }) {
  const pet = acharPet(petId);
  const pontos = caminhoDoPet(pet);
  const [t, setT] = useState(0);
  const reduzido = useMovimentoReduzido();

  useEffect(() => {
    if (!pontos || reduzido) return;
    let raf = 0;
    const inicio = performance.now();
    const passo = (agora: number) => {
      setT((agora - inicio) / 1000);
      raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [pontos, reduzido]);

  if (!pontos) return null;

  const R = 17;
  const fase = Math.sin(t * 1.6);
  const dy = pet.animacao === 'flutuar' ? fase * 5 : 0;
  const escala = pet.animacao === 'pulsar' ? 1 + fase * 0.07 : 1;
  const giro = pet.animacao === 'balancar' ? fase * 7 : 0;

  return (
    <Group x={x} y={y + dy} rotation={giro} scaleX={escala} scaleY={escala} listening={false}>
      <Circle radius={R * 1.5} fill={pet.cor} opacity={0.1} />
      <Line
        points={pontos.flatMap(([px, py]) => [px * R, py * R])}
        closed
        fill={pet.cor}
        opacity={0.85}
        stroke="rgba(0,0,0,0.45)"
        strokeWidth={1.5}
      />
      {/* Olhos: é o que faz a silhueta virar bicho. */}
      <Circle x={-R * 0.28} y={-R * 0.12} radius={2.2} fill="#0b0f16" />
      <Circle x={R * 0.28} y={-R * 0.12} radius={2.2} fill="#0b0f16" />
    </Group>
  );
}

/** `prefers-reduced-motion` do sistema. */
function useMovimentoReduzido(): boolean {
  const [reduzido, setReduzido] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const aplicar = () => setReduzido(mq.matches);
    aplicar();
    mq.addEventListener('change', aplicar);
    return () => mq.removeEventListener('change', aplicar);
  }, []);
  return reduzido;
}

// ─── GameBoard ───────────────────────────────────────────────────────────────

export default function GameBoard({ room, modoAnexar, onAlvoEscolhido }: GameBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cards = useGameStore((s) => s.cards);
  const players = useGameStore((s) => s.players);
  const myId = useGameStore((s) => s.mySessionId);
  const arrows = useGameStore((s) => s.arrows);
  /** De quem é a vez. Só marcador visual — o motor não impõe turno (F29). */
  const activePlayerId = useGameStore((s) => s.activePlayerId);

  const openContextMenu = useUIStore((s) => s.openContextMenu);
  const setInspectedCard = useUIStore((s) => s.setInspectedCard);
  const setInspectedZone = useUIStore((s) => s.setInspectedZone);
  const setZoneOwner = useUIStore((s) => s.setZoneOwner);
  const selectedCardIds = useUIStore((s) => s.selectedCardIds);
  const boardView = useUIStore((s) => s.boardView);
  const trilhoAberto = useUIStore((s) => s.trilhoAberto);
  const estiloDeMesa = useUIStore((s) => s.estiloDeMesa);
  const seguirTurno = useUIStore((s) => s.seguirTurno);
  const fatorCarta = useUIStore((s) => s.fatorCarta);
  const registrarEscalaDaMesa = useUIStore((s) => s.registrarEscalaDaMesa);
  const setBoardView = useUIStore((s) => s.setBoardView);
  const arrowSource = useUIStore((s) => s.arrowSource);
  const setArrowSource = useUIStore((s) => s.setArrowSource);
  const toggleSelectedCard = useUIStore((s) => s.toggleSelectedCard);
  const setSelectedCards = useUIStore((s) => s.setSelectedCards);
  const setHoveredCard = useUIStore((s) => s.setHoveredCard);

  const pings = useTableStore((s) => s.pings);
  const expirarPings = useTableStore((s) => s.expirarPings);

  const zoneOrder = useGameStore((s) => s.zoneOrder);
  const catalogo = useCardCatalog((s) => s.cartas);
  const hidratar = useCardCatalog((s) => s.hidratar);
  const cosmeticosDeOponentes = useCosmeticos((s) => s.cosmeticosDeOponentes);

  const [dims, setDims] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const medir = () => setDims({ w: el.clientWidth, h: el.clientHeight });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    window.addEventListener('orientationchange', medir);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', medir);
    };
  }, []);

  useEffect(() => {
    if (pings.length === 0) return;
    const t = setInterval(expirarPings, 500);
    return () => clearInterval(t);
  }, [pings.length, expirarPings]);

  // Toda carta visível é hidratada: sem isso a mesa não sabe o nome de nada.
  useEffect(() => {
    hidratar(Object.values(cards).map((c) => c.scryfallId));
  }, [cards, hidratar]);

  const [estreito, setEstreito] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const aplicar = () => setEstreito(!mq.matches);
    aplicar();
    mq.addEventListener('change', aplicar);
    return () => mq.removeEventListener('change', aplicar);
  }, []);

  // ── Geometria da mesa ────────────────────────────────────────────────────
  /**
   * ─── MARGENS DO HUD ────────────────────────────────────────────────────────
   *
   * O que sobra depois delas É a mesa — não existe mais "encolher para caber".
   * Por isso elas encolheram: os 244px que a coluna da direita reservava para o
   * log viravam carta menor, e o log nasce recolhido e flutuante. Cada pixel
   * devolvido aqui vira carta maior, porque a escala vem da ALTURA útil.
   *
   * Sobra apenas: a coluna do painel de vida à esquerda, a fileira de botões no
   * topo e a aba da barra de ações embaixo.
   */
  const margens = estreito
    ? { esquerda: 6, direita: 6, topo: 118, base: 10 }
    : { esquerda: 168, direita: 10, topo: 44, base: 10 };

  /**
   * Tenho carta na reserva?
   *
   * Memo PRÓPRIO, e não uma leitura dentro do memo da mesa, porque `cards`
   * muda a cada movimento de carta e a geometria da mesa não pode ser
   * remontada nessa frequência. Aqui a varredura devolve um BOOLEANO: a mesa
   * só é remontada quando ele vira, o que acontece no pré-jogo e quase nunca
   * durante a partida.
   */
  const temReserva = useMemo(
    () => Object.values(cards).some((c) => c.zone === 'SIDEBOARD' && c.ownerId === myId),
    [cards, myId],
  );

  const utilW = Math.max(320, dims.w - margens.esquerda - margens.direita);
  const utilH = Math.max(300, dims.h - margens.topo - margens.base);

  /**
   * Publica a escala para o painel de exibição.
   *
   * A conta vive em `layout.ts` e é a MESMA que `montarMesaFocada` usa — o
   * painel não recalcula nada por conta própria, senão seria uma segunda fonte
   * da verdade envelhecendo em silêncio.
   */
  useEffect(() => {
    const { efetiva, pedida } = escalasDaMesaFocada(utilH, fatorCarta);
    registrarEscalaDaMesa(efetiva, pedida);
  }, [utilH, fatorCarta, registrarEscalaDaMesa]);

  const mesa: Mesa = useMemo(() => {
    const porAssento = Object.values(players)
      .filter((p) => p.id !== myId)
      .sort((a, b) => a.seat - b.seat)
      .map((p) => p.id);

    /**
     * QUEM APARECE GRANDE.
     *
     * O padrão é a minha mesa. O seletor de câmera pode apontar para um
     * oponente — e nesse caso ele troca de lugar comigo: ele ocupa a tela e eu
     * vou para o trilho. `boardView` guarda um sessionId, que muda a cada
     * conexão, então um alvo que já não existe cai de volta em mim em vez de
     * desenhar uma mesa vazia.
     */
    const alvoValido = boardView !== 'ALL' && boardView !== 'ME' && Boolean(players[boardView]);
    const foco = (alvoValido ? boardView : myId) || myId || '—';

    /** Todos menos quem está grande, na ordem de assento. */
    const noTrilho = (myId ? [...porAssento, myId] : porAssento).filter((id) => id !== foco);

    /**
     * ─── TRÊS ARRANJOS, E O JOGADOR ESCOLHE ────────────────────────────────
     *
     * `montarMesa` e `montarGrade` existem em `layout.ts` desde sempre,
     * completos e testados, e ficaram SEM CHAMADOR quando a mesa focada virou
     * o arranjo fixo. Continuaram no código e deixaram de existir para quem
     * joga. "Quero ver as quatro mesas" contra "quero a minha grande" depende
     * do momento da partida, não de quem escreveu este arquivo.
     *
     * A ordem dos dois antigos é OPONENTES PRIMEIRO e eu por último — a faixa
     * de baixo é a de quem está olhando, como numa mesa de verdade. A focada
     * usa outra convenção (foco + trilho), e é por isso que a chamada não é a
     * mesma para os três.
     */
    if (estiloDeMesa === 'empilhada') {
      return montarMesa([...porAssento, myId || '—'], foco, { estreito });
    }
    if (estiloDeMesa === 'grade') {
      return montarGrade([...porAssento, myId || '—'], foco);
    }

    return montarMesaFocada({
      largura: utilW,
      altura: utilH,
      focoId: foco,
      oponentes: noTrilho,
      /**
       * Em tela estreita o trilho não abre: não há largura para uma miniatura
       * legível, e sobrepor a mesa de um oponente ao campo de 390px esconderia
       * justamente as cartas do jogador. No celular a troca de assento continua
       * pelo painel de Câmera.
       */
      trilhoAberto: trilhoAberto && !estreito,
      fatorCarta,
      temReserva,
    });
  }, [
    players,
    myId,
    boardView,
    trilhoAberto,
    estreito,
    utilW,
    utilH,
    fatorCarta,
    temReserva,
    estiloDeMesa,
  ]);

  /**
   * ─── ESCALA 1, SEM CENTRALIZAR ─────────────────────────────────────────────
   *
   * A mesa já vem com o tamanho exato da área útil, em pixels. Multiplicar por
   * uma escala aqui é o que produzia a carta de 74px: a geometria antiga
   * devolvia um plano de 1920 de largura e esta linha o reduzia a 61%.
   *
   * O deslocamento é só a margem — não há sobra para centralizar nem câmera
   * para somar.
   */
  /**
   * ─── DOIS SISTEMAS DE COORDENADA, E A ESCALA DEPENDE DE QUAL ────────────
   *
   * `montarMesaFocada` devolve a mesa JÁ no tamanho da área útil, em pixels
   * reais — multiplicar por uma escala ali é o que produzia a carta de 74px: a
   * geometria devolvia um plano de 1920 e a linha o reduzia a 61%.
   *
   * `montarMesa` e `montarGrade` devolvem um PLANO LÓGICO (1920 de largura), e
   * precisam ser reduzidos para caber. `min` dos dois eixos, e não `utilW /
   * largura`: reduzir só pela largura deixa a mesa alta transbordar embaixo, e
   * a mão — que fica na base — sai da tela.
   *
   * A sobra vira centralização. Sem ela a mesa gruda no canto superior
   * esquerdo e a assimetria fica visível na primeira tela ultrawide.
   */
  const usaPlanoLogico = estiloDeMesa !== 'focada';
  const escala = usaPlanoLogico ? Math.min(utilW / mesa.largura, utilH / mesa.altura) : 1;
  const offsetX = usaPlanoLogico
    ? margens.esquerda + (utilW - mesa.largura * escala) / 2
    : margens.esquerda;
  const offsetY = usaPlanoLogico ? margens.topo + (utilH - mesa.altura * escala) / 2 : margens.topo;

  // ── Derivação do que vai para a tela ─────────────────────────────────────
  const { itens, resumoFaixas } = useMemo(() => {
    const lista = Object.values(cards);
    const temIdentidade = (c: CardData) => Boolean(c.scryfallId) && !c.faceDown;
    const daZona = (zona: string, dono?: string) =>
      lista.filter((c) => c.zone === zona && (dono === undefined || c.ownerId === dono));

    const out: CartaPosicionada[] = [];

    /** O verso de uma carta é o sleeve de QUEM É DONO dela. */
    const sleeveDe = (ownerId: string) =>
      cosmeticosVisiveis(players[ownerId], ownerId === myId, cosmeticosDeOponentes).sleeveId;

    for (const faixa of mesa.faixas) {
      // A escala vem da CÉLULA, não do foco: na grade as células são iguais e o
      // foco é só cor de borda. Derivar de `emFoco` aqui encolhia três das
      // quatro células de uma grade que deveria ser uniforme.
      const escalaFaixa = faixa.escala;

      // Campo de batalha: quem CONTROLA define a faixa. É a semântica correta —
      // roubar uma criatura a traz para o seu lado da mesa.
      for (const c of lista.filter(
        (x) => x.zone === 'BATTLEFIELD' && x.controllerId === faixa.playerId,
      )) {
        out.push({
          card: c,
          pos: posicaoNoCampo(faixa, c.x, c.y),
          faixa,
          arrastavel: true,
          frente: temIdentidade(c),
          face: c.isFlipped ? 1 : 0,
          escala: escalaFaixa,
          sleeveId: sleeveDe(c.ownerId),
        });
      }

      // Comando.
      daZona('COMMAND', faixa.playerId).forEach((c, i) => {
        out.push({
          card: c,
          pos: posicaoNoComando(i, faixa.comando),
          faixa,
          arrastavel: faixa.playerId === myId,
          frente: temIdentidade(c),
          face: c.isFlipped ? 1 : 0,
          escala: escalaFaixa,
          sleeveId: sleeveDe(c.ownerId),
        });
      });
    }

    // Minha mão, na base. Só existe quando a MINHA faixa está na mesa: no
    // celular, olhando a mesa de um oponente, a mão não tem onde ficar.
    const minhaMao = myId && mesa.porJogador.has(myId) ? daZona('HAND', myId) : [];
    minhaMao.forEach((c, i) => {
      out.push({
        card: c,
        pos: posicaoNaMao(i, minhaMao.length, mesa),
        faixa: myId ? (mesa.porJogador.get(myId) ?? null) : null,
        arrastavel: true,
        frente: temIdentidade(c),
        face: c.isFlipped ? 1 : 0,
        escala: 1,
        sleeveId: sleeveDe(c.ownerId),
      });
    });

    const contar = (zona: string, dono: string) => daZona(zona, dono).length;

    /**
     * O id do TOPO de uma zona, pela ordem real do servidor.
     *
     * `zoneOrder` guarda o topo no FIM da lista (DOC-032 §2). Antes de ele ser
     * espelhado, isto era `Object.values(cards).filter(...)` e o "topo" era a
     * ordem de inserção no mapa — ou seja, uma carta qualquer da pilha.
     */
    const idDaZonaNoTopo = (zona: string, dono: string): string | undefined =>
      idDoTopo(zoneOrder[chaveDaZona(dono, zona)]);

    const topoDe = (zona: string, dono: string) => {
      const id = idDaZonaNoTopo(zona, dono);
      const ultima = id ? cards[id] : undefined;
      return ultima && temIdentidade(ultima)
        ? getTexture(ultima.scryfallId, 'normal', ultima.isFlipped ? 'back' : 'front')
        : null;
    };

    const resumo = mesa.faixas.map((faixa) => {
      const p = players[faixa.playerId];
      const cosmeticos = cosmeticosVisiveis(p, faixa.playerId === myId, cosmeticosDeOponentes);
      return {
        faixa,
        player: p,
        playmat: playmatCanvas(cosmeticos.playmatId),
        // O verso das pilhas ocultas daquele jogador. Ver `Pilha`.
        verso: sleeveCanvas(cosmeticos.sleeveId),
        petId: cosmeticos.petId,
        library: p?.libraryCount ?? contar('LIBRARY', faixa.playerId),
        command: contar('COMMAND', faixa.playerId),
        graveyard: contar('GRAVEYARD', faixa.playerId),
        exile: contar('EXILE', faixa.playerId),
        sideboard: contar('SIDEBOARD', faixa.playerId),
        topoCemiterio: topoDe('GRAVEYARD', faixa.playerId),
        topoExilio: topoDe('EXILE', faixa.playerId),
        /**
         * O grimório mostra a carta do topo QUANDO a identidade dela está
         * liberada — é o que faz "revelar o topo" e o modo "topo revelado"
         * aparecerem na mesa. Sem revelação, `temIdentidade` é falso e a pilha
         * volta ao verso do protetor.
         */
        topoGrimorio: topoDe('LIBRARY', faixa.playerId),
      };
    });

    return { itens: out, resumoFaixas: resumo };
  }, [cards, zoneOrder, players, myId, mesa, cosmeticosDeOponentes]);

  const ancoras = useMemo(() => {
    const mapa = new Map<string, Ponto>();
    for (const item of itens) mapa.set(item.card.id, item.pos);
    for (const faixa of mesa.faixas) {
      mapa.set(faixa.playerId, { x: faixa.rotulo.x + 90, y: faixa.rotulo.y + 8 });
    }
    return mapa;
  }, [itens, mesa]);

  /**
   * ─── A CÂMERA SEGUE DE QUEM É A VEZ ────────────────────────────────────────
   *
   * Quando o jogador liga `seguirTurno`, passar o turno leva a tela para a mesa
   * de quem entrou na vez — sem ninguém precisar abrir o painel de câmera.
   *
   * Três decisões dentro deste efeito:
   *
   *  1. QUEM ESTÁ NA VEZ VÊ A PRÓPRIA MESA. Quando `activePlayerId` sou eu, a
   *     visão volta para 'ME' em vez de ficar apontada para o vizinho anterior.
   *  2. SÓ MEXE QUANDO A VEZ MUDA, não a cada render: `boardView` fora das
   *     dependências de propósito. Incluí-lo faria o efeito reverter qualquer
   *     escolha manual de câmera no mesmo instante em que o jogador a fizesse —
   *     o painel de câmera pareceria não funcionar durante o turno alheio.
   *  3. UM ASSENTO QUE JÁ SAIU não é destino: `players[id]` é conferido antes,
   *     senão a mesa seria desenhada em branco.
   */
  useEffect(() => {
    if (!seguirTurno || !activePlayerId) return;
    if (activePlayerId === myId) {
      setBoardView('ME');
      return;
    }
    if (players[activePlayerId]) setBoardView(activePlayerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlayerId, seguirTurno, myId, setBoardView]);

  const handleContextMenu = useCallback(
    (cardId: string, x: number, y: number) => openContextMenu(cardId, x, y),
    [openContextMenu],
  );
  const handleInspect = useCallback((s: string) => setInspectedCard(s), [setInspectedCard]);
  const handleHover = useCallback((id: string | null) => setHoveredCard(id), [setHoveredCard]);

  const handleSelecionar = useCallback(
    (cardId: string, aditivo: boolean) => {
      if (aditivo) toggleSelectedCard(cardId);
      else setSelectedCards([cardId]);
    },
    [toggleSelectedCard, setSelectedCards],
  );

  const handleAlvo = useCallback(
    (alvoId: string) => {
      if (!arrowSource) return;
      if (alvoId !== arrowSource) {
        if (modoAnexar) intents.attach(room, arrowSource, alvoId);
        else intents.arrow(room, arrowSource, alvoId);
      }
      setArrowSource(null);
      onAlvoEscolhido();
    },
    [arrowSource, modoAnexar, room, setArrowSource, onAlvoEscolhido],
  );

  useEffect(() => {
    if (!arrowSource) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setArrowSource(null);
      onAlvoEscolhido();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [arrowSource, setArrowSource, onAlvoEscolhido]);

  /**
   * ─── NÃO EXISTE MAIS ZOOM NEM ARRASTE DE CÂMERA ──────────────────────────
   *
   * `handleWheel` e o `panRef` viviam aqui. Os dois existiam para compensar
   * uma mesa que não cabia na tela — com `montarMesaFocada` a mesa É a tela, e
   * afastar a câmera só serviria para voltar a ter carta ilegível.
   *
   * A roda do mouse continua com `preventDefault` no `Stage`: sem ele o
   * navegador rola a página por trás do Canvas.
   */

  /** Abre uma zona de pilha, lembrando de quem ela é. */
  const abrirZona = useCallback(
    (zona: 'GRAVEYARD' | 'EXILE' | 'LIBRARY' | 'SIDEBOARD', dono: string) => {
      setZoneOwner(dono);
      setInspectedZone(zona);
    },
    [setZoneOwner, setInspectedZone],
  );

  /**
   * O MEU PLAYMAT É O FUNDO DA TELA, E NÃO UM RETÂNGULO DENTRO DELA.
   *
   * Ele era desenhado DENTRO da camada do Konva, recortado na minha faixa e
   * sujeito à mesma escala e ao mesmo pan das cartas. Duas consequências:
   * ocupava uma fração da tela (uma faixa entre outras) e, ao dar zoom, o
   * "tapete" crescia junto e mostrava a costura nas bordas — que é justamente o
   * contrário do que um tapete faz numa mesa.
   *
   * Aqui ele sai da camada desenhada e vira o fundo do contêiner: cobre a
   * viewport inteira, e o zoom/pan da câmera passa a mexer só no tabuleiro que
   * está POR CIMA dele. O tapete fica parado; as cartas é que se movem.
   */
  const meuPlaymat = useMemo(() => {
    const cosmeticos = cosmeticosVisiveis(myId ? players[myId] : undefined, true, true);
    const canvas = playmatCanvas(cosmeticos.playmatId);
    // `toDataURL` roda uma vez por troca de playmat, não por quadro: o canvas é
    // cacheado por id em `cosmetics/render.ts`.
    return canvas ? canvas.toDataURL() : null;
  }, [players, myId]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      {meuPlaymat && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: `url(${meuPlaymat})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}
      {dims.w > 0 && dims.h > 0 && (
        <Stage
          width={dims.w}
          height={dims.h}
          style={{ background: 'transparent', touchAction: 'none' }}
          onWheel={(e) => e.evt.preventDefault()}
          onContextMenu={(e) => e.evt.preventDefault()}
        >
          <Layer scale={{ x: escala, y: escala }} x={offsetX} y={offsetY}>
            {/* Fundo: ping e menu da mesa. Já não arrasta a câmera. */}
            <Rect
              width={mesa.largura}
              height={mesa.altura}
              fill="rgba(0,0,0,0.001)"
              onContextMenu={(e) => {
                e.evt.preventDefault();
                const p = e.target.getStage()?.getPointerPosition();
                if (p) openContextMenu('zone', p.x, p.y);
              }}
              onClick={(e) => {
                const evt = e.evt as MouseEvent;
                // Konva dispara `click` para todo botão do mouse: sem isto, o
                // botão direito abria o menu da mesa E limpava a seleção — quer
                // dizer, o menu abria já sem alvo nenhum.
                if (typeof evt?.button === 'number' && evt.button !== 0) return;
                const p = e.target.getStage()?.getPointerPosition();
                if (evt.altKey && p) {
                  intents.ping(room, (p.x - offsetX) / escala, (p.y - offsetY) / escala);
                  return;
                }
                if (arrowSource) {
                  setArrowSource(null);
                  onAlvoEscolhido();
                  return;
                }
                setSelectedCards([]);
              }}
            />

            {/* ── Faixas ─────────────────────────────────────────────────── */}
            {resumoFaixas.map((r) => (
              <Group key={r.faixa.playerId} listening={false}>
                {/* Base opaca da faixa. Vem ANTES do playmat de propósito: com
                    ela por cima, o `rgba(30,41,59,0.30)` somava-se ao véu preto
                    de 40% que o próprio playmat já embute, e a arte chegava ao
                    jogador com ~58% de escurecimento — visível no editor de
                    cosméticos, invisível na mesa. */}
                <Rect
                  x={r.faixa.esquerda + 6}
                  y={r.faixa.topo + 3}
                  width={r.faixa.largura - 12}
                  height={r.faixa.altura - 6}
                  fill={r.faixa.emFoco ? COR_FAIXA_FOCO : COR_FAIXA}
                  cornerRadius={12}
                />
                {/* Playmat: o fundo da área de jogo daquele jogador. Já vem com
                    o overlay preto a 40% embutido (DOC-060 §2.2), para a arte
                    nunca competir com a carta. */}
                {/* O playmat do OPONENTE fica na célula dele. O MEU não é
                    desenhado aqui: ele virou o fundo fixo da tela inteira, atrás
                    do tabuleiro — ver `<Playmat>` no fim deste arquivo. Desenhar
                    nos dois lugares deixaria a minha célula com o playmat duas
                    vezes, uma delas fora de escala. */}
                {r.playmat && r.faixa.playerId !== myId && (
                  <Group
                    clipFunc={(ctx) => {
                      ctx.beginPath();
                      ctx.rect(
                        r.faixa.esquerda + 6,
                        r.faixa.topo + 3,
                        r.faixa.largura - 12,
                        r.faixa.altura - 6,
                      );
                      ctx.closePath();
                    }}
                  >
                    <KonvaImage
                      image={r.playmat}
                      x={r.faixa.esquerda + 6}
                      y={r.faixa.topo + 3}
                      width={r.faixa.largura - 12}
                      height={r.faixa.altura - 6}
                      listening={false}
                    />
                  </Group>
                )}
                {/* A borda de quem está fora de foco era
                    `rgba(255,255,255,0.05)`: invisível na prática. Com as
                    faixas encostadas umas nas outras, nada delimitava a mesa
                    de um jogador — era uma superfície contínua com cartas de
                    todo mundo. Agora cada uma é um painel com borda que se vê
                    e um respiro em volta (ESPACO_ENTRE_FAIXAS). */}
                {/* Só a MOLDURA. O preenchimento virou a base, acima.
                    Dourado vence o azul do foco: de quem é a VEZ é a informação
                    mais urgente da mesa, e ela precisa ser legível de relance,
                    sem ler nome nenhum. O foco da câmera é uma preferência de
                    quem olha; a vez é um fato da partida.

                    O HALO SAIU. Era `shadowBlur: 22` em dourado, sangrando ~22px
                    para dentro da mesa em volta da faixa inteira — "a luz ao
                    redor do usuário". Numa faixa em foco isso é um retângulo
                    brilhante atrás das cartas do próprio jogador, que compete
                    com o destaque de seleção e com o realce de carta. Uma borda
                    de 3.5px na cor certa diz a mesma coisa e não invade o
                    tabuleiro. */}
                <Rect
                  x={r.faixa.esquerda + 6}
                  y={r.faixa.topo + 3}
                  width={r.faixa.largura - 12}
                  height={r.faixa.altura - 6}
                  stroke={
                    r.faixa.playerId === activePlayerId
                      ? COR_VEZ
                      : r.faixa.emFoco
                        ? 'rgba(96,165,250,0.55)'
                        : 'rgba(148,163,184,0.28)'
                  }
                  strokeWidth={
                    r.faixa.playerId === activePlayerId ? 3.5 : r.faixa.emFoco ? 2.5 : 1.5
                  }
                  cornerRadius={12}
                />
                <Text
                  text={
                    r.player
                      ? `${r.faixa.playerId === activePlayerId ? '▶ ' : ''}${r.player.name}${
                          r.player.id === myId ? ' (você)' : ''
                        } · ${r.player.life} PV${r.player.isMonarch ? ' · monarca' : ''}`
                      : 'assento vazio'
                  }
                  x={r.faixa.rotulo.x + 8}
                  y={r.faixa.rotulo.y + 2}
                  fontSize={13}
                  fontStyle="bold"
                  /* O triângulo acompanha a borda dourada porque cor sozinha
                     não é sinal acessível: quem não distingue dourado de azul
                     ficaria sem saber de quem é a vez. */
                  fill={
                    r.faixa.playerId === activePlayerId
                      ? COR_VEZ
                      : r.faixa.emFoco
                        ? 'rgba(147,197,253,0.9)'
                        : 'rgba(255,255,255,0.4)'
                  }
                />
                <Mascote
                  petId={r.petId}
                  x={r.faixa.esquerda + r.faixa.largura - 30}
                  y={r.faixa.topo + 26}
                />
              </Group>
            ))}

            {/* ── Pilhas por faixa ───────────────────────────────────────── */}
            {resumoFaixas.map((r) => {
              // `escalaZonas` e nao `escala`: numa janela baixa o bloco de
              // zonas encolhe sozinho para o rotulo de cada pilha caber, e o
              // desenho tem de acompanhar a geometria. Ver `Faixa.escalaZonas`.
              const esc = r.faixa.escalaZonas;
              const meu = r.faixa.playerId === myId;
              return (
                <Group key={`pilhas-${r.faixa.playerId}`}>
                  <SlotComando centro={r.faixa.comando} quantidade={r.command} escala={esc} />
                  <Pilha
                    rotulo="GRIMÓRIO"
                    centro={r.faixa.grimorio}
                    quantidade={r.library}
                    cor="#2f3446"
                    /* Revelada vence o sleeve. `Pilha` só desenha `topo` quando
                       `verso` é falso, então os dois andam juntos: sem carta
                       revelada, volta a ser o verso do protetor. */
                    verso={!r.topoGrimorio}
                    topo={r.topoGrimorio}
                    versoImagem={r.verso}
                    escala={esc}
                    onClick={meu ? () => intents.draw(room, 1) : undefined}
                    onContextMenu={meu ? (x, y) => openContextMenu('library', x, y) : undefined}
                  />
                  <Pilha
                    rotulo="CEMITÉRIO"
                    centro={r.faixa.cemiterio}
                    quantidade={r.graveyard}
                    cor="#3a2630"
                    verso={false}
                    topo={r.topoCemiterio}
                    escala={esc}
                    onClick={() => abrirZona('GRAVEYARD', r.faixa.playerId)}
                    onContextMenu={
                      meu ? (x: number, y: number) => openContextMenu('zone', x, y) : undefined
                    }
                  />
                  <Pilha
                    rotulo="EXÍLIO"
                    centro={r.faixa.exilio}
                    quantidade={r.exile}
                    cor="#33294a"
                    verso={false}
                    topo={r.topoExilio}
                    escala={esc}
                    onClick={() => abrirZona('EXILE', r.faixa.playerId)}
                  />
                  {meu && r.sideboard > 0 && (
                    <Pilha
                      rotulo="RESERVA"
                      centro={r.faixa.reserva}
                      quantidade={r.sideboard}
                      cor="#2b3a33"
                      verso
                      versoImagem={r.verso}
                      escala={esc}
                      onClick={() => abrirZona('SIDEBOARD', r.faixa.playerId)}
                    />
                  )}
                </Group>
              );
            })}

            {/* ── Faixa de mão ───────────────────────────────────────────── */}
            <Group listening={false}>
              <Rect
                x={6}
                y={mesa.mao.topo + 3}
                width={mesa.largura - 12}
                height={mesa.mao.altura - 6}
                fill="rgba(15,23,42,0.55)"
                stroke="rgba(255,255,255,0.05)"
                cornerRadius={10}
                dash={[8, 6]}
              />
              <Text
                text="MÃO"
                x={18}
                y={mesa.mao.topo + 10}
                fontSize={11}
                fontStyle="bold"
                fill="rgba(255,255,255,0.18)"
                letterSpacing={2}
              />
            </Group>

            {/* ── Vínculos de anexo ──────────────────────────────────────── */}
            {itens
              .filter((i) => i.card.attachedTo)
              .map((i) => {
                const alvo = ancoras.get(i.card.attachedTo);
                if (!alvo) return null;
                return (
                  <Line
                    key={`anexo-${i.card.id}`}
                    points={[i.pos.x, i.pos.y, alvo.x, alvo.y]}
                    stroke="#22C55E"
                    strokeWidth={2}
                    dash={[6, 4]}
                    opacity={0.7}
                    listening={false}
                  />
                );
              })}

            {/* ── Cartas ─────────────────────────────────────────────────── */}
            {itens.map((item) => (
              <CardSprite
                key={item.card.id}
                item={item}
                meta={item.card.scryfallId ? (catalogo[item.card.scryfallId] ?? null) : null}
                room={room}
                isSelected={selectedCardIds.includes(item.card.id)}
                onContextMenu={handleContextMenu}
                onInspect={handleInspect}
                onAlvo={arrowSource ? handleAlvo : null}
                onSelecionar={handleSelecionar}
                onHover={handleHover}
              />
            ))}

            {/* ── Setas de alvo ──────────────────────────────────────────── */}
            {Object.values(arrows).map((seta) => {
              const de = ancoras.get(seta.fromId);
              const para = ancoras.get(seta.toId);
              if (!de || !para) return null;
              return (
                <Arrow
                  key={seta.id}
                  points={[de.x, de.y, para.x, para.y]}
                  stroke={seta.color}
                  fill={seta.color}
                  strokeWidth={4}
                  pointerLength={14}
                  pointerWidth={14}
                  opacity={0.85}
                  listening={false}
                  perfectDrawEnabled={false}
                />
              );
            })}

            {arrowSource && ancoras.get(arrowSource) && (
              <Group listening={false}>
                <Circle
                  x={ancoras.get(arrowSource)!.x}
                  y={ancoras.get(arrowSource)!.y}
                  radius={CARD_W * 0.62}
                  stroke={modoAnexar ? '#22C55E' : '#3B82F6'}
                  strokeWidth={3}
                  dash={[10, 8]}
                />
                <Text
                  text={
                    modoAnexar
                      ? 'escolha onde anexar (Esc cancela)'
                      : 'escolha o alvo (Esc cancela)'
                  }
                  x={ancoras.get(arrowSource)!.x - 160}
                  y={ancoras.get(arrowSource)!.y - CARD_W * 0.62 - 24}
                  width={320}
                  align="center"
                  fontSize={14}
                  fontStyle="bold"
                  fill={modoAnexar ? '#22C55E' : '#3B82F6'}
                />
              </Group>
            )}

            {/* ── Pings ──────────────────────────────────────────────────── */}
            {pings.map((p) => (
              <Group key={p.id} x={p.x} y={p.y} listening={false}>
                <Circle radius={26} stroke="#FBBF24" strokeWidth={3} opacity={0.9} />
                <Line points={[-12, 0, 12, 0]} stroke="#FBBF24" strokeWidth={3} />
                <Line points={[0, -12, 0, 12]} stroke="#FBBF24" strokeWidth={3} />
              </Group>
            ))}
          </Layer>
        </Stage>
      )}
    </div>
  );
}
