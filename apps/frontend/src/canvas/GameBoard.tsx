'use client';

/**
 * GameBoard.tsx — Mesa de Jogo com React-Konva (DOC-040 §2).
 *
 * Arquitetura de layers (DOC-040 §2.2):
 *   - staticLayer: contornos de zona, rótulos, grade
 *   - cardsLayer: todas as cartas em repouso (20 Hz)
 *   - dragLayer: carta sendo arrastada (60 Hz)
 *   - fxLayer: pings, animações
 *
 * Performance crítica:
 *   - Sprites NÃO re-renderizam via React (§3.2) — atualizamos os nós Konva diretamente
 *   - Texturas compartilhadas por scryfallId (§4.2)
 *   - listening: false em nós não interativos
 *   - Throttle de 20/s em INTENT_MOVE_CARD
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Stage, Layer, Rect, Text, Group, Image as KonvaImage, Circle } from 'react-konva';
import type { Room } from 'colyseus.js';
import type Konva from 'konva';
import { useGameStore, type CardData } from '../store/game.store';
import { useUIStore } from '../store/game.store';
import { getTexture, getCardBack } from './textureCache';
import { intents } from '../net/intents';

interface GameBoardProps {
  room: Room<any>;
}

const CARD_W = 130;
const CARD_H = Math.round(CARD_W * 1.396);
const ZONE_COLORS = {
  BATTLEFIELD: 'rgba(59,130,246,0.05)',
  GRAVEYARD: 'rgba(239,68,68,0.05)',
  EXILE: 'rgba(168,85,247,0.05)',
  COMMAND: 'rgba(251,191,36,0.08)',
  HAND: 'rgba(34,197,94,0.05)',
  LIBRARY: 'rgba(100,116,139,0.08)',
};

// ─── CardSprite: carta individual renderizada com Konva ──────────────────────

interface CardSpriteProps {
  card: CardData;
  room: Room<any>;
  isSelected: boolean;
  onContextMenu: (cardId: string, x: number, y: number) => void;
  onInspect: (cardId: string) => void;
}

const CardSprite = React.memo(function CardSprite({ card, room, isSelected, onContextMenu, onInspect }: CardSpriteProps) {
  const myId = useGameStore((s) => s.mySessionId);
  const isMyCard = card.ownerId === myId;
  const isController = card.controllerId === myId;
  const isLocked = card.lockedBy && card.lockedBy !== myId;
  const isDraggingMe = card.lockedBy === myId;

  // Cartas em mão (HAND) e grimório (LIBRARY) não carregam imagem completa
  const showImage = card.zone !== 'LIBRARY';
  const showFront = showImage && (card.scryfallId && (card.zone !== 'HAND' || isMyCard) || card.zone === 'BATTLEFIELD' || card.zone === 'GRAVEYARD' || card.zone === 'EXILE' || card.zone === 'COMMAND');

  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!showFront) {
      setImgEl(getCardBack());
      return;
    }
    if (!card.scryfallId) return;
    const img = getTexture(card.scryfallId, 'small');
    if (img.complete) {
      setImgEl(img);
    } else {
      img.onload = () => setImgEl(img);
    }
  }, [card.scryfallId, showFront]);

  // Posição com predição otimista
  const [pos, setPos] = useState({ x: card.x, y: card.y });

  useEffect(() => {
    if (!isDraggingMe) {
      setPos({ x: card.x, y: card.y });
    }
  }, [card.x, card.y, isDraggingMe]);

  // React 19 exige argumento inicial em useRef — a sobrecarga sem argumento
  // deixou de existir.
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    if (!isController) { e.target.stopDrag(); return; }
    intents.grab(room, card.id);
  }, [room, card.id, isController]);

  const handleDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const newX = Math.round(node.x());
    const newY = Math.round(node.y());
    setPos({ x: newX, y: newY });
    intents.moveCard(room, card.id, newX, newY);
  }, [room, card.id]);

  const handleDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const finalX = Math.round(e.target.x());
    const finalY = Math.round(e.target.y());
    setPos({ x: finalX, y: finalY });

    if (card.zone !== 'BATTLEFIELD') {
      intents.changeZone(room, card.id, 'BATTLEFIELD', finalX, finalY);
    } else {
      intents.release(room, card.id, finalX, finalY);
    }
  }, [room, card.id, card.zone]);

  const handleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button === 2) return;
    // Duplo clique = tap/untap (DOC-040 §6)
    if (e.evt.detail === 2 && isController) {
      intents.tap(room, card.id, !card.isTapped);
    }
  }, [room, card.id, card.isTapped, isController]);

  const handleRightClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (pos) onContextMenu(card.id, pos.x, pos.y);
  }, [card.id, onContextMenu]);

  const handleMouseEnter = useCallback(() => {
    hoverTimeout.current = setTimeout(() => {
      onInspect(card.id);
    }, 400);
  }, [card.id, onInspect]);

  const handleMouseLeave = useCallback(() => {
    clearTimeout(hoverTimeout.current);
  }, []);

  const rotation = card.isTapped ? 90 : (card.rotation ?? 0);

  return (
    <Group
      x={pos.x}
      y={pos.y}
      draggable={isController && !isLocked}
      rotation={rotation}
      offsetX={CARD_W / 2}
      offsetY={CARD_H / 2}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onContextMenu={handleRightClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      opacity={card.phasedOut ? 0.4 : 1}
    >
      {/* Fundo fallback */}
      <Rect
        width={CARD_W}
        height={CARD_H}
        fill={card.faceDown ? '#2a2a3a' : '#1e1e2e'}
        cornerRadius={6}
        shadowColor="black"
        shadowBlur={isDraggingMe ? 20 : 6}
        shadowOpacity={isDraggingMe ? 0.8 : 0.4}
        shadowOffsetY={isDraggingMe ? 8 : 3}
        perfectDrawEnabled={false}
      />

      {/* Imagem da carta */}
      {imgEl && (
        <KonvaImage
          image={imgEl}
          width={CARD_W}
          height={CARD_H}
          cornerRadius={6}
          perfectDrawEnabled={false}
        />
      )}

      {/* Fallback de texto se não tiver imagem */}
      {!imgEl && card.zone !== 'LIBRARY' && (
        <Text
          text={card.scryfallId ? '...' : '?'}
          width={CARD_W}
          height={CARD_H}
          align="center"
          verticalAlign="middle"
          fill="#64748B"
          fontSize={12}
          listening={false}
        />
      )}

      {/* Overlay de travado por outro jogador */}
      {isLocked && (
        <Rect
          width={CARD_W}
          height={CARD_H}
          fill="rgba(239,68,68,0.25)"
          cornerRadius={6}
          listening={false}
        />
      )}

      {/* Overlay de selecionado */}
      {isSelected && (
        <Rect
          width={CARD_W}
          height={CARD_H}
          stroke="#3B82F6"
          strokeWidth={3}
          cornerRadius={6}
          fill="rgba(59,130,246,0.1)"
          listening={false}
        />
      )}

      {/* Badge de marcadores */}
      {Object.entries(card.counters).map(([name, value], idx) => (
        <Group key={name} x={4 + idx * 28} y={CARD_H - 22} listening={false}>
          <Circle radius={10} fill={name.includes('+1') ? '#22C55E' : name.includes('-1') ? '#EF4444' : '#3B82F6'} />
          <Text
            text={String(value)}
            fontSize={9}
            fill="white"
            width={20}
            height={20}
            offsetX={10}
            offsetY={10}
            align="center"
            verticalAlign="middle"
          />
        </Group>
      ))}

      {/* Indicador de face-down */}
      {card.faceDown && (
        <Text text="face ↓" fontSize={9} fill="#94A3B8" x={4} y={4} listening={false} />
      )}
    </Group>
  );
});

// ─── Contorno de zonas ────────────────────────────────────────────────────────

function ZoneOutline({ label, x, y, width, height, color }: {
  label: string; x: number; y: number; width: number; height: number; color: string;
}) {
  return (
    <Group x={x} y={y} listening={false}>
      <Rect
        width={width}
        height={height}
        fill={color}
        stroke="rgba(255,255,255,0.04)"
        strokeWidth={1}
        cornerRadius={8}
        dash={[8, 6]}
      />
      <Text
        text={label}
        x={12}
        y={12}
        fontSize={11}
        fill="rgba(255,255,255,0.15)"
        fontStyle="bold"
        letterSpacing={2}
      />
    </Group>
  );
}

// ─── GameBoard principal ──────────────────────────────────────────────────────

export default function GameBoard({ room }: GameBoardProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const cards = useGameStore((s) => s.cards);
  const myId = useGameStore((s) => s.mySessionId);
  const { openContextMenu, setInspectedCard, selectedCardIds } = useUIStore();
  const [dims, setDims] = useState({ w: window.innerWidth, h: window.innerHeight });

  // Atualiza dimensões ao redimensionar
  useEffect(() => {
    const onResize = () => setDims({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Separa cartas por zona para renderização
  const cardList = Object.values(cards);
  const battlefield = cardList.filter(c => c.zone === 'BATTLEFIELD');
  const myHand = cardList.filter(c => c.zone === 'HAND' && c.ownerId === myId);
  const myCommand = cardList.filter(c => c.zone === 'COMMAND' && c.ownerId === myId);
  const myGraveyard = cardList.filter(c => c.zone === 'GRAVEYARD' && c.ownerId === myId);

  // Posiciona mão visualmente na base da tela
  const handStartX = dims.w / 2 - (myHand.length * (CARD_W + 10)) / 2;
  myHand.forEach((c, idx) => {
    if (c.x === 0 && c.y === 0) {
      c.x = handStartX + idx * (CARD_W + 10) + CARD_W / 2;
      c.y = dims.h - CARD_H / 2 - 20;
    }
  });

  // Posiciona Comandante
  myCommand.forEach((c, idx) => {
    if (c.x === 0 && c.y === 0) {
      c.x = 80 + idx * (CARD_W + 10);
      c.y = dims.h / 2;
    }
  });

  // Cemitério no canto
  myGraveyard.slice(-1).forEach(c => {
    if (c.x === 0 && c.y === 0) {
      c.x = dims.w - CARD_W - 20;
      c.y = dims.h - CARD_H - 20;
    }
  });

  const handleContextMenu = useCallback((cardId: string, x: number, y: number) => {
    openContextMenu(cardId, x, y);
  }, [openContextMenu]);

  const handleInspect = useCallback((cardId: string) => {
    setInspectedCard(cardId);
  }, [setInspectedCard]);

  const allVisible = [...battlefield, ...myHand, ...myCommand, ...myGraveyard];

  return (
    <Stage
      ref={stageRef}
      width={dims.w}
      height={dims.h}
      style={{ background: 'transparent' }}
    >
      {/* Layer 0: Contornos de zona (raramente redesenhado) */}
      <Layer listening={false}>
        <ZoneOutline
          label="BATTLEFIELD"
          x={180}
          y={40}
          width={dims.w - 360}
          height={dims.h - 200}
          color={ZONE_COLORS.BATTLEFIELD}
        />
        <ZoneOutline
          label="MÃO"
          x={180}
          y={dims.h - 180}
          width={dims.w - 360}
          height={160}
          color={ZONE_COLORS.HAND}
        />
        <ZoneOutline
          label="COMANDO"
          x={10}
          y={dims.h / 2 - 120}
          width={160}
          height={220}
          color={ZONE_COLORS.COMMAND}
        />
        <ZoneOutline
          label="CEMITÉRIO"
          x={dims.w - 170}
          y={dims.h - 280}
          width={160}
          height={220}
          color={ZONE_COLORS.GRAVEYARD}
        />
      </Layer>

      {/* Layer 1: Cartas (atualizado a 20 Hz pelos patches do Colyseus) */}
      <Layer>
        {allVisible.map(card => (
          <CardSprite
            key={card.id}
            card={card}
            room={room}
            isSelected={selectedCardIds.includes(card.id)}
            onContextMenu={handleContextMenu}
            onInspect={handleInspect}
          />
        ))}
      </Layer>
    </Stage>
  );
}
