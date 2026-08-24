import React, { useEffect, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Group } from 'react-konva';
import type { Room } from 'colyseus.js';

interface GameBoardProps {
  room: Room<any>;
}

// Hook simples para carregar imagem
const useScryfallImage = (scryfallId: string) => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!scryfallId) return;
    const img = new window.Image();
    // Proxy ou URL direta do Scryfall
    img.src = `https://api.scryfall.com/cards/${scryfallId}?format=image&version=normal`;
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      setImage(img);
    };
  }, [scryfallId]);

  return image;
};

// Componente da Carta
const CardNode = ({ 
  card, 
  room 
}: { 
  card: any, 
  room: Room<any> 
}) => {
  const image = useScryfallImage(card.scryfallId);
  
  // Estado local para drag otimista
  const [position, setPosition] = useState({ x: card.x || 0, y: card.y || 0 });

  // Sincroniza do servidor para o local (apenas se não estiver arrastando)
  useEffect(() => {
    setPosition({ x: card.x, y: card.y });
  }, [card.x, card.y]);

  const handleDragStart = () => {
    // Tenta pegar o lock (embora o colyseus já faça isso, mandamos a intenção)
    room.send('INTENT_GRAB', { entityId: card.id });
  };

  const handleDragMove = (e: any) => {
    // Predição Otimista visual
    setPosition({
      x: e.target.x(),
      y: e.target.y()
    });
    
    // Podemos omitir mandar MOVE freneticamente no MVP para poupar rede,
    // e enviar apenas no Release, ou mandar o MOVE para ver tempo real (sujeito a lag se n otimizado)
    // Para MVP de demonstração da sincronização em tempo real:
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
      // Jogar a carta na mesa
      room.send('INTENT_CHANGE_ZONE', { 
        entityId: card.id, 
        targetZone: 'BATTLEFIELD',
        x: finalX,
        y: finalY
      });
    } else {
      // Apenas mover no campo
      room.send('INTENT_RELEASE', { 
        entityId: card.id, 
        x: finalX, 
        y: finalY 
      });
    }
  };

  const handleTap = (e: any) => {
    // Cancela se for o final de um clique duplo ou drag
    if (e.evt.button !== 0) return; // Só clique esquerdo
    
    room.send('INTENT_TAP', { 
      entityId: card.id, 
      isTapped: !card.isTapped 
    });
  };

  // Tamanho padrão de carta no AetherTable
  const CARD_WIDTH = 140;
  const CARD_HEIGHT = Math.round(CARD_WIDTH * 1.396); // Razão de aspecto do Magic

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
      rotation={card.isTapped ? 90 : 0}
      // O offset centraliza a rotação (para rotacionar a partir do centro)
      offsetX={CARD_WIDTH / 2}
      offsetY={CARD_HEIGHT / 2}
    >
      {/* Fallback de fundo antes da imagem carregar */}
      <Rect
        width={CARD_WIDTH}
        height={CARD_HEIGHT}
        fill="#1e1e1e"
        cornerRadius={8}
        stroke={card.lockedBy === room.sessionId ? '#22d3ee' : '#333'}
        strokeWidth={2}
        shadowColor="black"
        shadowBlur={10}
        shadowOpacity={0.6}
        shadowOffset={{ x: 2, y: 5 }}
      />
      {image && (
        <KonvaImage
          image={image}
          width={CARD_WIDTH}
          height={CARD_HEIGHT}
          cornerRadius={8}
        />
      )}
      
      {/* Feedback Visual caso esteja trancada por outro jogador */}
      {card.lockedBy && card.lockedBy !== room.sessionId && (
        <Rect
          width={CARD_WIDTH}
          height={CARD_HEIGHT}
          fill="rgba(255, 0, 0, 0.3)"
          cornerRadius={8}
        />
      )}
    </Group>
  );
};

export default function GameBoard({ room }: GameBoardProps) {
  // Estado local das cartas (Map convertido pra array pro React renderizar)
  const [cards, setCards] = useState<any[]>([]);

  useEffect(() => {
    // Ouvinte de mudanças no State do Colyseus
    // room.state.cards é um MapSchema
    
    const updateCards = () => {
      const cardsArray: any[] = [];
      const handArray: any[] = [];
      const commandArray: any[] = [];

      room.state.cards.forEach((card: any) => {
        if (card.zone === 'BATTLEFIELD') {
          cardsArray.push(card);
        } else if (card.zone === 'HAND' && card.ownerId === room.sessionId) {
          handArray.push(card);
        } else if (card.zone === 'COMMAND' && card.ownerId === room.sessionId) {
          commandArray.push(card);
        }
      });

      // Posiciona as cartas da Mão e do Comandante visualmente para facilitar o Drag para o Battlefield
      handArray.forEach((c, idx) => {
        // Se não tiver posição X/Y (ainda na mão), força visualmente embaixo
        if (c.x === 0 && c.y === 0) {
          c.x = window.innerWidth / 2 - (handArray.length * 150) / 2 + idx * 150;
          c.y = window.innerHeight - 200; 
        }
      });

      commandArray.forEach((c, idx) => {
        if (c.x === 0 && c.y === 0) {
          c.x = 200 + idx * 150;
          c.y = 200; 
        }
      });

      setCards([...cardsArray, ...handArray, ...commandArray]);
    };

    // Inicial
    updateCards();

    // Colyseus: trigger quando qualquer item for adicionado ou removido no Map
    room.state.cards.onAdd = () => updateCards();
    room.state.cards.onRemove = () => updateCards();
    
    // E precisamos monitorar mudanças DENTRO de cada carta
    room.state.cards.forEach((card: any) => {
      card.onChange = () => {
        updateCards(); // Força re-render (poderia ser otimizado pra não dar re-render na lista inteira)
      };
    });

    room.state.cards.onAdd = (card: any) => {
      card.onChange = () => updateCards();
      updateCards();
    };

    return () => {
      // Limpeza de eventos não é estritamente necessária pro Colyseus neste hook, pois a room morre.
    };
  }, [room]);

  return (
    <Stage 
      width={window.innerWidth} 
      height={window.innerHeight} 
      draggable // O tabuleiro inteiro ser arrastável
      className="cursor-grab active:cursor-grabbing"
    >
      <Layer>
        {cards.map(card => (
          <CardNode key={card.id} card={card} room={room} />
        ))}
      </Layer>
    </Stage>
  );
}
