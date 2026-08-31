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
import { useCardCatalog, type CardMeta } from '../cards/catalog';
import { caminhoDoPet, playmatCanvas, sleeveCanvas } from '../cosmetics/render';
import { cosmeticosVisiveis, useCosmeticos } from '../cosmetics/store';
import { acharPet } from '@aethertable/shared-types';
import { intents } from '../net/intents';
import type { RoomState } from '../net/schema/RoomState';
import {
  CARD_W,
  CARD_H,
  montarMesa,
  posicaoNaMao,
  posicaoNoCampo,
  posicaoNoComando,
  paraCoordenadaRelativa,
  type Faixa,
  type Mesa,
  type Ponto,
} from './layout';

interface GameBoardProps {
  room: Room<RoomState>;
  modoAnexar: boolean;
  onAlvoEscolhido: () => void;
}

const COR_FAIXA_FOCO = 'rgba(59,130,246,0.055)';
const COR_FAIXA = 'rgba(30,41,59,0.30)';

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

      const rel = paraCoordenadaRelativa(minhaFaixa, x, y);
      if (card.zone !== 'BATTLEFIELD')
        intents.changeZone(room, card.id, 'BATTLEFIELD', rel.x, rel.y);
      else intents.release(room, card.id, rel.x, rel.y);
    },
    [room, card.id, card.zone, faixa],
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
  topo?: HTMLImageElement | null;
  escala: number;
  onClick?: () => void;
  onContextMenu?: (x: number, y: number) => void;
}) {
  const camadas = Math.min(3, Math.max(1, Math.ceil(quantidade / 12)));
  const w = CARD_W * escala;
  const h = CARD_H * escala;

  return (
    <Group
      x={centro.x}
      y={centro.y}
      offsetX={w / 2}
      offsetY={h / 2}
      onClick={onClick}
      onTap={onClick}
      onContextMenu={(e) => {
        e.evt.preventDefault();
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

  const openContextMenu = useUIStore((s) => s.openContextMenu);
  const setInspectedCard = useUIStore((s) => s.setInspectedCard);
  const setInspectedZone = useUIStore((s) => s.setInspectedZone);
  const setZoneOwner = useUIStore((s) => s.setZoneOwner);
  const selectedCardIds = useUIStore((s) => s.selectedCardIds);
  const boardView = useUIStore((s) => s.boardView);
  const zoomLevel = useUIStore((s) => s.zoomLevel);
  const setZoom = useUIStore((s) => s.setZoom);
  const cameraPosition = useUIStore((s) => s.cameraPosition);
  const setCamera = useUIStore((s) => s.setCamera);
  const arrowSource = useUIStore((s) => s.arrowSource);
  const setArrowSource = useUIStore((s) => s.setArrowSource);
  const toggleSelectedCard = useUIStore((s) => s.toggleSelectedCard);
  const setSelectedCards = useUIStore((s) => s.setSelectedCards);
  const setHoveredCard = useUIStore((s) => s.setHoveredCard);

  const pings = useTableStore((s) => s.pings);
  const expirarPings = useTableStore((s) => s.expirarPings);

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
  const mesa: Mesa = useMemo(() => {
    const oponentes = Object.values(players)
      .filter((p) => p.id !== myId)
      .sort((a, b) => a.seat - b.seat)
      .map((p) => p.id);

    const foco = (boardView === 'ME' || boardView === 'ALL' ? myId : boardView) || myId;

    // NO CELULAR, UMA FAIXA POR VEZ.
    //
    // Encaixar quatro faixas (≈1920x1300) numa tela de 390px deixa cada carta
    // com 15px de largura: tudo aparece e nada é jogável. A resposta certa não
    // é reduzir mais — é mostrar só a faixa em foco e trocar de faixa pelo
    // painel de Câmera. A vida e a contagem dos oponentes continuam visíveis na
    // faixa de vida no topo.
    if (estreito) {
      return montarMesa([foco], foco, { estreito: true });
    }

    // Ordem visual: oponentes de cima para baixo, eu sempre por último — é como
    // se vê uma mesa física da própria cadeira.
    const ordem = myId ? [...oponentes, myId] : oponentes;
    return montarMesa(ordem.length ? ordem : ['—'], foco);
  }, [players, myId, boardView, estreito]);

  const margens = estreito
    ? { esquerda: 8, direita: 8, topo: 212, base: 116 }
    : { esquerda: 196, direita: 300, topo: 56, base: 74 };

  const utilW = Math.max(120, dims.w - margens.esquerda - margens.direita);
  const utilH = Math.max(120, dims.h - margens.topo - margens.base);
  // Em tela estreita a mesa é ajustada pela LARGURA e o excedente vira rolagem
  // vertical (arrastar o fundo): reduzir mais para caber a altura toda deixaria
  // a carta com 23px.
  const escalaBase =
    dims.w && dims.h
      ? estreito
        ? utilW / mesa.largura
        : Math.min(utilW / mesa.largura, utilH / mesa.altura)
      : 0;
  const escala = escalaBase * zoomLevel;
  const offsetX = margens.esquerda + (utilW - mesa.largura * escala) / 2 + cameraPosition.x;
  const offsetY = margens.topo + (utilH - mesa.altura * escala) / 2 + cameraPosition.y;

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
      const escalaFaixa = faixa.emFoco ? 1 : 0.72;

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
    const topoDe = (zona: string, dono: string) => {
      const z = daZona(zona, dono);
      const ultima = z[z.length - 1];
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
        petId: cosmeticos.petId,
        library: p?.libraryCount ?? contar('LIBRARY', faixa.playerId),
        graveyard: contar('GRAVEYARD', faixa.playerId),
        exile: contar('EXILE', faixa.playerId),
        sideboard: contar('SIDEBOARD', faixa.playerId),
        topoCemiterio: topoDe('GRAVEYARD', faixa.playerId),
        topoExilio: topoDe('EXILE', faixa.playerId),
      };
    });

    return { itens: out, resumoFaixas: resumo };
  }, [cards, players, myId, mesa, cosmeticosDeOponentes]);

  const ancoras = useMemo(() => {
    const mapa = new Map<string, Ponto>();
    for (const item of itens) mapa.set(item.card.id, item.pos);
    for (const faixa of mesa.faixas) {
      mapa.set(faixa.playerId, { x: faixa.rotulo.x + 90, y: faixa.rotulo.y + 8 });
    }
    return mapa;
  }, [itens, mesa]);

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

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      setZoom(zoomLevel * (e.evt.deltaY > 0 ? 0.92 : 1.08));
    },
    [zoomLevel, setZoom],
  );

  const panRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setCamera(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardView]);

  /** Abre uma zona de pilha, lembrando de quem ela é. */
  const abrirZona = useCallback(
    (zona: 'GRAVEYARD' | 'EXILE' | 'LIBRARY' | 'SIDEBOARD', dono: string) => {
      setZoneOwner(dono);
      setInspectedZone(zona);
    },
    [setZoneOwner, setInspectedZone],
  );

  return (
    <div ref={containerRef} className="absolute inset-0">
      {dims.w > 0 && dims.h > 0 && (
        <Stage
          width={dims.w}
          height={dims.h}
          style={{ background: 'transparent', touchAction: 'none' }}
          onWheel={handleWheel}
          onContextMenu={(e) => e.evt.preventDefault()}
        >
          <Layer scale={{ x: escala, y: escala }} x={offsetX} y={offsetY}>
            {/* Fundo: pan, ping e menu da mesa */}
            <Rect
              width={mesa.largura}
              height={mesa.altura}
              fill="rgba(0,0,0,0.001)"
              onMouseDown={(e) => {
                panRef.current = { x: e.evt.clientX, y: e.evt.clientY };
              }}
              onMouseMove={(e) => {
                if (!panRef.current) return;
                const dx = e.evt.clientX - panRef.current.x;
                const dy = e.evt.clientY - panRef.current.y;
                panRef.current = { x: e.evt.clientX, y: e.evt.clientY };
                setCamera(cameraPosition.x + dx, cameraPosition.y + dy);
              }}
              onMouseUp={() => {
                panRef.current = null;
              }}
              onMouseLeave={() => {
                panRef.current = null;
              }}
              onTouchStart={(e) => {
                const t = e.evt.touches[0];
                if (t) panRef.current = { x: t.clientX, y: t.clientY };
              }}
              onTouchMove={(e) => {
                const t = e.evt.touches[0];
                if (!t || !panRef.current) return;
                e.evt.preventDefault();
                const dx = t.clientX - panRef.current.x;
                const dy = t.clientY - panRef.current.y;
                panRef.current = { x: t.clientX, y: t.clientY };
                setCamera(cameraPosition.x + dx, cameraPosition.y + dy);
              }}
              onTouchEnd={() => {
                panRef.current = null;
              }}
              onContextMenu={(e) => {
                e.evt.preventDefault();
                const p = e.target.getStage()?.getPointerPosition();
                if (p) openContextMenu('zone', p.x, p.y);
              }}
              onClick={(e) => {
                const evt = e.evt as MouseEvent;
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
                {/* Playmat: o fundo da área de jogo daquele jogador. Já vem com
                    o overlay preto a 40% embutido (DOC-060 §2.2), para a arte
                    nunca competir com a carta. */}
                {r.playmat && (
                  <Group
                    clipFunc={(ctx) => {
                      ctx.beginPath();
                      ctx.rect(6, r.faixa.topo + 3, mesa.largura - 12, r.faixa.altura - 6);
                      ctx.closePath();
                    }}
                  >
                    <KonvaImage
                      image={r.playmat}
                      x={6}
                      y={r.faixa.topo + 3}
                      width={mesa.largura - 12}
                      height={r.faixa.altura - 6}
                      listening={false}
                    />
                  </Group>
                )}
                <Rect
                  x={6}
                  y={r.faixa.topo + 3}
                  width={mesa.largura - 12}
                  height={r.faixa.altura - 6}
                  fill={r.faixa.emFoco ? COR_FAIXA_FOCO : COR_FAIXA}
                  stroke={r.faixa.emFoco ? 'rgba(59,130,246,0.35)' : 'rgba(255,255,255,0.05)'}
                  strokeWidth={r.faixa.emFoco ? 2 : 1}
                  cornerRadius={10}
                />
                <Text
                  text={
                    r.player
                      ? `${r.player.name}${r.player.id === myId ? ' (você)' : ''} · ${r.player.life} PV${
                          r.player.isMonarch ? ' · monarca' : ''
                        }`
                      : 'assento vazio'
                  }
                  x={r.faixa.rotulo.x + 8}
                  y={r.faixa.rotulo.y + 2}
                  fontSize={13}
                  fontStyle="bold"
                  fill={r.faixa.emFoco ? 'rgba(147,197,253,0.9)' : 'rgba(255,255,255,0.4)'}
                />
                <Mascote petId={r.petId} x={mesa.largura - 30} y={r.faixa.topo + 26} />
              </Group>
            ))}

            {/* ── Pilhas por faixa ───────────────────────────────────────── */}
            {resumoFaixas.map((r) => {
              const esc = r.faixa.emFoco ? 1 : 0.72;
              const meu = r.faixa.playerId === myId;
              return (
                <Group key={`pilhas-${r.faixa.playerId}`}>
                  <Pilha
                    rotulo="GRIMÓRIO"
                    centro={r.faixa.grimorio}
                    quantidade={r.library}
                    cor="#2f3446"
                    verso
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
