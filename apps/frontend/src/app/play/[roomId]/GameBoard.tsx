import React, { useEffect, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Group, Text, Circle } from 'react-konva';
import type { Room } from 'colyseus.js';
import { useUIStore } from '../../../store/game.store';

interface GameBoardProps {
  room: Room<any>;
}

// Hook simples para carregar imagem
const useScryfallImage = (scryfallId: string) => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!scryfallId) return;
    const img = new window.Image();
    img.src = `https://api.scryfall.com/cards/${scryfallId}?format=image&version=normal`;
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      setImage(img);
    };
  }, [scryfallId]);

  return image;
};

const CARD_WIDTH = 140;
const CARD_HEIGHT = Math.round(CARD_WIDTH * 1.396); // Razão de aspecto do Magic

// Componente genérico para cartas e topo do deck
const CardVisual = ({ scryfallId, lockedBy, sessionId, isTapped, faceDown, counters, commanderTax, isCommandZone }: any) => {
  const image = useScryfallImage(scryfallId);

  // Extrair contadores se existirem
  const countersArray: {name: string, value: number}[] = [];
  if (counters) {
    counters.forEach((value: number, key: string) => {
      if (value !== 0) countersArray.push({ name: key, value });
    });
  }

  return (
    <>
      <Rect
        width={CARD_WIDTH}
        height={CARD_HEIGHT}
        fill="#1e1e1e"
        cornerRadius={8}
        stroke={lockedBy && lockedBy === sessionId ? '#22d3ee' : '#333'}
        strokeWidth={2}
        shadowColor="black"
        shadowBlur={10}
        shadowOpacity={0.6}
        shadowOffset={{ x: 2, y: 5 }}
      />
      {!faceDown && image && (
        <KonvaImage
          image={image}
          width={CARD_WIDTH}
          height={CARD_HEIGHT}
          cornerRadius={8}
        />
      )}
      {faceDown && (
        <Rect
          width={CARD_WIDTH}
          height={CARD_HEIGHT}
          fill="#3b2d1d" // Cor de verso genérica
          cornerRadius={8}
        />
      )}
      
      {/* Contadores / Marcadores */}
      {!faceDown && countersArray.map((c, i) => (
        <Group key={c.name} x={CARD_WIDTH - 20} y={20 + (i * 35)}>
          <Circle radius={14} fill="rgba(0,0,0,0.8)" stroke="#22d3ee" strokeWidth={2} />
          <Text text={`${c.value}`} fontSize={14} fontStyle="bold" fill="white" offsetX={4} offsetY={6} />
          {/* Rótulo do contador pequeno (ex: +1/+1 ou Veneno) */}
          <Text text={c.name.length > 5 ? c.name.substring(0,4) + '.' : c.name} fontSize={9} fill="white" offsetX={12} offsetY={-8} />
        </Group>
      ))}

      {/* Indicador de Taxa de Comandante */}
      {isCommandZone && (
        <Group x={CARD_WIDTH / 2} y={-15}>
          <Rect width={100} height={24} fill="rgba(0,0,0,0.8)" cornerRadius={12} offsetX={50} stroke="#a855f7" strokeWidth={1} />
          <Text text={`Taxa: ${commanderTax || 0}`} fill="#a855f7" fontSize={12} fontStyle="bold" offsetX={30} offsetY={-6} />
        </Group>
      )}

      {/* Feedback Visual caso esteja trancada por outro jogador */}
      {lockedBy && lockedBy !== sessionId && (
        <Rect
          width={CARD_WIDTH}
          height={CARD_HEIGHT}
          fill="rgba(255, 0, 0, 0.3)"
          cornerRadius={8}
        />
      )}
    </>
  );
};

// Componente da Carta
const CardNode = ({ 
  card, 
  room,
  commanderTax,
  overrideX,
  overrideY,
  onContextMenu,
  onHover
}: { 
  card: any, 
  room: Room<any>,
  commanderTax?: number,
  overrideX?: number,
  overrideY?: number,
  onContextMenu: (e: any, target: any) => void,
  onHover: (id: string | null) => void
}) => {
  const [position, setPosition] = useState({ x: overrideX ?? card.x ?? 0, y: overrideY ?? card.y ?? 0 });

  useEffect(() => {
    setPosition({ x: overrideX ?? card.x ?? 0, y: overrideY ?? card.y ?? 0 });
  }, [card.x, card.y, overrideX, overrideY]);

  const handleDragStart = () => {
    room.send('INTENT_GRAB', { entityId: card.id });
  };

  const handleDragMove = (e: any) => {
    setPosition({ x: e.target.x(), y: e.target.y() });
    room.send('INTENT_MOVE_CARD', { 
      entityId: card.id, 
      x: Math.round(e.target.x()), 
      y: Math.round(e.target.y()) 
    });
  };

  const handleDragEnd = (e: any) => {
    const finalX = Math.round(e.target.x());
    const finalY = Math.round(e.target.y());
    setPosition({ x: finalX, y: finalY });

    if (card.zone !== 'BATTLEFIELD') {
      room.send('INTENT_CHANGE_ZONE', { 
        entityId: card.id, 
        targetZone: 'BATTLEFIELD',
        x: finalX,
        y: finalY
      });
    } else {
      room.send('INTENT_RELEASE', { 
        entityId: card.id, 
        x: finalX, 
        y: finalY 
      });
    }
  };

  const handleTap = (e: any) => {
    if (e.evt.button !== 0) return; 
    
    // Check for alt-click inspection
    if (e.evt.altKey) {
      useUIStore.getState().setInspectedCard(card.scryfallId);
      return;
    }

    room.send('INTENT_TAP', { 
      entityId: card.id, 
      isTapped: !card.isTapped 
    });
  };

  const handleMouseEnter = () => {
    onHover(card.id);
  };

  const handleMouseLeave = () => {
    onHover(null);
  };

  return (
    <Group
      x={position.x}
      y={position.y}
      draggable
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onClick={handleTap}
      onTap={handleTap}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onContextMenu={(e) => onContextMenu(e, { type: 'CARD', id: card.id, zone: card.zone, isTapped: card.isTapped, ownerId: card.ownerId })}
      rotation={(card.rotation || 0) + (card.isTapped ? 90 : 0)}
      offsetX={CARD_WIDTH / 2}
      offsetY={CARD_HEIGHT / 2}
    >
      <CardVisual 
        scryfallId={card.scryfallId} 
        lockedBy={card.lockedBy} 
        sessionId={room.sessionId}
        isTapped={card.isTapped}
        faceDown={card.faceDown}
        counters={card.counters}
        commanderTax={commanderTax}
        isCommandZone={card.zone === 'COMMAND'}
      />
    </Group>
  );
};

export default function GameBoard({ room }: GameBoardProps) {
  const [cards, setCards] = useState<any[]>([]);
  const [libraryCards, setLibraryCards] = useState<any[]>([]);
  const [graveyardCards, setGraveyardCards] = useState<any[]>([]);
  const [playersMap, setPlayersMap] = useState<Record<string, any>>({});
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, target: any } | null>(null);
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);

  const { boardView } = useUIStore();

  // Zonas ancoradas
  const LIBRARY_POS = { x: window.innerWidth - 200, y: window.innerHeight - 250 };
  const GRAVEYARD_POS = { x: window.innerWidth - 360, y: window.innerHeight - 250 };

  useEffect(() => {
    const updateCards = () => {
      const cardsArray: any[] = [];
      const handArray: any[] = [];
      const commandArray: any[] = [];
      const libArray: any[] = [];
      const graveArray: any[] = [];

      room.state.cards.forEach((card: any) => {
        if (card.zone === 'BATTLEFIELD') {
          let shouldShow = true;
          if (boardView === 'ME') shouldShow = card.controllerId === room.sessionId;
          else if (boardView === 'OPPONENTS') shouldShow = card.controllerId !== room.sessionId;
          else if (boardView !== 'ALL') shouldShow = card.controllerId === boardView;
          
          if (shouldShow) cardsArray.push(card);
        } else {
          // Definição de dono das zonas ancoradas baseado na câmera
          let targetOwner = room.sessionId;
          if (boardView !== 'ALL' && boardView !== 'ME' && boardView !== 'OPPONENTS') {
            targetOwner = boardView;
          }

          if (card.ownerId === targetOwner) {
            if (targetOwner !== room.sessionId) return;

            if (card.zone === 'HAND') handArray.push(card);
            else if (card.zone === 'COMMAND') commandArray.push(card);
            else if (card.zone === 'LIBRARY') libArray.push(card);
            else if (card.zone === 'GRAVEYARD') graveArray.push(card);
          }
        }
      });

      // NÃO mutamos c.x e c.y (ReadOnly pelo Colyseus Proxy). O offset visual
      // será calculado em tempo de renderização na render-tree.
      setCards([...cardsArray, ...handArray, ...commandArray]);
      setLibraryCards(libArray);
      setGraveyardCards(graveArray);
    };

    updateCards();
    
    // Atualizar mapa de jogadores para puxar status como commanderTax
    const updatePlayers = () => {
      const pMap: Record<string, any> = {};
      room.state.players.forEach((p: any) => {
        pMap[p.id] = p;
      });
      setPlayersMap(pMap);
    };
    updatePlayers();

    room.state.cards.onAdd((card: any) => {
      card.onChange(() => updateCards());
      updateCards();
    });
    room.state.cards.onRemove(() => updateCards());
    
    room.state.cards.forEach((card: any) => {
      card.onChange(() => updateCards());
    });
    
    room.state.players.onAdd((player: any) => {
      player.onChange(() => updatePlayers());
      updatePlayers();
    });

  }, [room, boardView]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignorar atalhos se o usuário estiver digitando em um input/textarea
      const tag = document.activeElement?.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      const key = e.key.toLowerCase();
      
      // Global shortcuts
      if (key === 'd') {
        room.send('INTENT_DRAW', { amount: 1 });
      } else if (key === 's') {
        room.send('INTENT_SHUFFLE', { zone: 'LIBRARY' });
      } else if (key === 'escape') {
        useUIStore.getState().setInspectedCard(null);
      }

      // Hover-based shortcuts
      if (hoveredCardId) {
        const card = cards.find(c => c.id === hoveredCardId);
        if (!card) return;

        if (key === 'f') {
          room.send('INTENT_UPDATE_PROPERTY', { entityId: card.id, property: 'faceDown', value: !card.faceDown });
        } else if (key === 't' && e.ctrlKey) {
          e.preventDefault();
          const newRot = (card.rotation || 0) === 180 ? 0 : 180;
          room.send('INTENT_UPDATE_PROPERTY', { entityId: card.id, property: 'rotation', value: newRot });
        } else if (key === 'c' && e.ctrlKey) {
          e.preventDefault();
          room.send('INTENT_COPY_CARD', { entityId: card.id });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [room, hoveredCardId, cards]);

  const handleContextMenu = (e: any, target: any) => {
    e.evt.preventDefault();
    setContextMenu({
      x: e.evt.clientX,
      y: e.evt.clientY,
      target
    });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  const handleAddCounter = (entityId: string) => {
    const name = window.prompt("Nome do Marcador (ex: +1/+1, -1/-1, Veneno):", "+1/+1");
    if (!name) return;
    const amountStr = window.prompt("Quantidade de Marcadores a adicionar/remover (ex: 1, -1):", "1");
    if (!amountStr) return;
    const amount = parseInt(amountStr, 10);
    if (!isNaN(amount)) {
      room.send('INTENT_ADD_COUNTER', { entityId, name, amount });
    }
    closeContextMenu();
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-table-deep" onClick={closeContextMenu} onContextMenu={(e) => e.preventDefault()}>
      <Stage 
        width={window.innerWidth} 
        height={window.innerHeight} 
        draggable
        className="cursor-grab active:cursor-grabbing"
      >
        <Layer>
          {/* Deck / Library Zone */}
          {libraryCards.length > 0 && (
            <Group 
              x={LIBRARY_POS.x} 
              y={LIBRARY_POS.y}
              onContextMenu={(e) => handleContextMenu(e, { type: 'ZONE', zone: 'LIBRARY' })}
              onClick={(e) => {
                if (e.evt.button === 0) room.send('INTENT_DRAW', { amount: 1 });
              }}
            >
              {libraryCards.length > 1 && (
                <Rect width={CARD_WIDTH} height={CARD_HEIGHT} fill="#2c2216" cornerRadius={8} x={4} y={-4} />
              )}
              {libraryCards.length > 5 && (
                <Rect width={CARD_WIDTH} height={CARD_HEIGHT} fill="#1e160f" cornerRadius={8} x={8} y={-8} />
              )}
              <CardVisual faceDown={true} />
              <Text text={`${libraryCards.length}`} fill="white" fontSize={24} x={CARD_WIDTH/2 - 12} y={CARD_HEIGHT/2 - 12} />
            </Group>
          )}

          {/* Graveyard Zone */}
          {graveyardCards.length > 0 && (
            <Group 
              x={GRAVEYARD_POS.x} 
              y={GRAVEYARD_POS.y}
              onContextMenu={(e) => handleContextMenu(e, { type: 'ZONE', zone: 'GRAVEYARD' })}
              onClick={(e) => {
                if (e.evt.button === 0) useUIStore.getState().setInspectedZone('GRAVEYARD');
              }}
            >
              <CardVisual 
                scryfallId={graveyardCards[graveyardCards.length - 1].scryfallId} 
                faceDown={false} 
              />
              <Rect width={30} height={30} fill="rgba(0,0,0,0.7)" cornerRadius={15} x={CARD_WIDTH - 15} y={-15} />
              <Text text={`${graveyardCards.length}`} fill="white" fontSize={14} x={CARD_WIDTH - 6} y={-6} />
            </Group>
          )}

          {cards.map((card: any) => {
            let overrideX = undefined;
            let overrideY = undefined;
            
            if (card.zone === 'HAND' && card.x === 0 && card.y === 0) {
              const handCards = cards.filter(c => c.zone === 'HAND');
              const idx = handCards.findIndex(hc => hc.id === card.id);
              if (idx !== -1) {
                overrideX = window.innerWidth / 2 - (handCards.length * 150) / 2 + idx * 150 + CARD_WIDTH/2;
                overrideY = window.innerHeight - 200 + CARD_HEIGHT/2;
              }
            } else if (card.zone === 'COMMAND' && card.x === 0 && card.y === 0) {
              const cmdCards = cards.filter(c => c.zone === 'COMMAND');
              const idx = cmdCards.findIndex(cc => cc.id === card.id);
              if (idx !== -1) {
                overrideX = 200 + idx * 150 + CARD_WIDTH/2;
                overrideY = 200 + CARD_HEIGHT/2;
              }
            }

            return (
              <CardNode 
                key={card.id} 
                card={card} 
                room={room} 
                overrideX={overrideX}
                overrideY={overrideY}
                commanderTax={playersMap[card.ownerId]?.commanderTax}
                onContextMenu={handleContextMenu} 
                onHover={setHoveredCardId} 
              />
            );
          })}
        </Layer>
      </Stage>

      {/* HTML Overlay for Context Menu */}
      {contextMenu && (
        <div 
          className="absolute z-50 bg-panel border border-panel-border rounded shadow-xl py-1 min-w-[160px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.target.type === 'ZONE' && contextMenu.target.zone === 'LIBRARY' && (
            <>
              <button 
                className="w-full text-left px-4 py-2 text-sm text-text hover:bg-primary-subtle"
                onClick={() => { room.send('INTENT_DRAW', { amount: 1 }); closeContextMenu(); }}
              >
                Comprar 1 Carta (D)
              </button>
              <button 
                className="w-full text-left px-4 py-2 text-sm text-text hover:bg-primary-subtle"
                onClick={() => { room.send('INTENT_SHUFFLE', { zone: 'LIBRARY' }); closeContextMenu(); }}
              >
                Embaralhar (S)
              </button>
              <button 
                className="w-full text-left px-4 py-2 text-sm text-text hover:bg-primary-subtle font-bold"
                onClick={() => { useUIStore.getState().setInspectedZone('LIBRARY'); closeContextMenu(); }}
              >
                Procurar (Tutor)...
              </button>
            </>
          )}
          {contextMenu.target.type === 'CARD' && contextMenu.target.zone === 'COMMAND' && contextMenu.target.ownerId === room.sessionId && (
            <>
              <button 
                className="w-full text-left px-4 py-2 text-sm text-text hover:bg-primary-subtle"
                onClick={() => {
                  room.send('INTENT_CHANGE_ZONE', { entityId: contextMenu.target.id, targetZone: 'BATTLEFIELD', x: window.innerWidth/2, y: window.innerHeight/2 });
                  closeContextMenu();
                }}
              >
                Jogar no Campo
              </button>
              <div className="px-4 py-2 flex items-center justify-between gap-4 border-t border-panel-border mt-1">
                <span className="text-sm font-bold text-primary">Taxa Comandante</span>
                <div className="flex items-center gap-1">
                  <button onClick={(e) => { e.stopPropagation(); room.send('INTENT_ADD_PLAYER_COUNTER', { name: 'commanderTax', amount: -2 }); }} className="text-danger px-2 bg-danger/10 hover:bg-danger/20 rounded">-2</button>
                  <button onClick={(e) => { e.stopPropagation(); room.send('INTENT_ADD_PLAYER_COUNTER', { name: 'commanderTax', amount: 2 }); }} className="text-success px-2 bg-success/10 hover:bg-success/20 rounded">+2</button>
                </div>
              </div>
            </>
          )}
          {contextMenu.target.type === 'CARD' && contextMenu.target.zone === 'BATTLEFIELD' && (
            <>
              <button 
                className="w-full text-left px-4 py-2 text-sm text-text hover:bg-primary-subtle"
                onClick={() => { room.send('INTENT_TAP', { entityId: contextMenu.target.id, isTapped: !contextMenu.target.isTapped }); closeContextMenu(); }}
              >
                Virar / Desvirar
              </button>
              <button 
                className="w-full text-left px-4 py-2 text-sm text-text hover:bg-primary-subtle"
                onClick={() => { room.send('INTENT_UPDATE_PROPERTY', { entityId: contextMenu.target.id, property: 'faceDown', value: !contextMenu.target.faceDown }); closeContextMenu(); }}
              >
                Virar face para baixo (F)
              </button>
              <button 
                className="w-full text-left px-4 py-2 text-sm text-text hover:bg-primary-subtle"
                onClick={() => { room.send('INTENT_CHANGE_ZONE', { entityId: contextMenu.target.id, targetZone: 'GRAVEYARD' }); closeContextMenu(); }}
              >
                Enviar p/ Cemitério
              </button>
              <button 
                className="w-full text-left px-4 py-2 text-sm text-text hover:bg-primary-subtle"
                onClick={(e) => { e.stopPropagation(); handleAddCounter(contextMenu.target.id); }}
              >
                Adicionar Marcador...
              </button>
              <button 
                className="w-full text-left px-4 py-2 text-sm text-danger hover:bg-danger/20"
                onClick={() => { room.send('INTENT_CLEAR_COUNTERS', { entityId: contextMenu.target.id }); closeContextMenu(); }}
              >
                Limpar Marcadores
              </button>
            </>
          )}
          {contextMenu.target.type === 'CARD' && contextMenu.target.zone === 'HAND' && (
            <>
              <button 
                className="w-full text-left px-4 py-2 text-sm text-text hover:bg-primary-subtle"
                onClick={() => {
                  room.send('INTENT_CHANGE_ZONE', { entityId: contextMenu.target.id, targetZone: 'BATTLEFIELD', x: window.innerWidth/2, y: window.innerHeight/2 });
                  closeContextMenu();
                }}
              >
                Jogar no Campo
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
