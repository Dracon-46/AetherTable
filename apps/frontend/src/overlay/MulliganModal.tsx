'use client';

/**
 * MulliganModal.tsx — decisão de mão inicial (London Mulligan).
 *
 * CORREÇÃO CRÍTICA DA AUDITORIA
 *
 * O modal aparecia sempre que `hasKeptHand === false` e havia qualquer carta na
 * mão. Como `hasKeptHand` NÃO era persistido (o `partialize` do store só
 * guardava `showZoneOutlines` e `boardView`), qualquer F5 no meio da partida
 * ressuscitava um overlay `fixed inset-0 z-[100]` por cima da mesa inteira —
 * e como ele não tinha botão de fechar, a partida ficava inacessível. Era a
 * origem principal do "tem coisas que ficam por cima e não deixam agir".
 *
 * Agora a decisão é registrada por SALA em `sessionStorage`, o modal só aparece
 * na abertura da partida (antes de qualquer carta ir para a mesa) e sempre tem
 * saída.
 */

import React from 'react';
import type { Room } from 'colyseus.js';
import { useGameStore } from '../store/game.store';
import { Check, Repeat, X } from 'lucide-react';
import { intents } from '../net/intents';
import { cardImageUrl } from '../canvas/textureCache';
import type { RoomState } from '../net/schema/RoomState';

interface MulliganModalProps {
  room: Room<RoomState>;
}

function chaveDecisao(roomId: string) {
  return `aether:kept-hand:${roomId}`;
}

export function MulliganModal({ room }: MulliganModalProps) {
  const cards = useGameStore((s) => s.cards);
  const players = useGameStore((s) => s.players);
  const myId = useGameStore((s) => s.mySessionId);
  const roomId = useGameStore((s) => s.roomId);

  const [decidiu, setDecidiu] = React.useState(true);
  const [isSelectingBottom, setIsSelectingBottom] = React.useState(false);
  const [selectedCards, setSelectedCards] = React.useState<string[]>([]);

  const eu = myId ? players[myId] : undefined;
  const keptHandNoServidor = eu?.keptHand;

  /**
   * Lê a decisão já tomada nesta sala — mas o SERVIDOR manda.
   *
   * O `sessionStorage` é indexado por `roomId`, e o `roomId` NÃO muda entre uma
   * partida e a seguinte: `INTENT_RESET_MATCH` devolve a mesa para a sala de
   * espera reabrindo a janela (zera `keptHand` e `mulliganCount`), mas a chave
   * `aether:kept-hand:<roomId>` continuava marcada de antes. Na segunda partida
   * da mesma sala o modal nunca mais abria — da cadeira do jogador, "o mulligan
   * parou de funcionar", sem erro nenhum no console.
   *
   * Por isso o reforço local é DESCARTADO assim que o servidor diz que a janela
   * está aberta. Ele continua cobrindo o caso para o qual existe — o F5 no meio
   * da decisão, antes de o estado chegar — e deixa de sobreviver a ela.
   */
  React.useEffect(() => {
    if (!roomId) return;
    if (keptHandNoServidor === false) {
      try {
        sessionStorage.removeItem(chaveDecisao(roomId));
      } catch {
        /* sessionStorage indisponível — o estado em memória já basta */
      }
      setDecidiu(false);
      return;
    }
    try {
      setDecidiu(sessionStorage.getItem(chaveDecisao(roomId)) === '1');
    } catch {
      setDecidiu(false);
    }
  }, [roomId, keptHandNoServidor]);

  const registrarDecisao = React.useCallback(() => {
    try {
      if (roomId) sessionStorage.setItem(chaveDecisao(roomId), '1');
    } catch {
      /* sessionStorage indisponível — segue só com o estado em memória */
    }
    // Conta ao servidor. É o que faz o botão de mulligan sumir da barra de
    // ações e o que fecha a janela para valer: sem isso, "manter mão" era um
    // combinado só entre o modal e o `sessionStorage` desta aba.
    intents.keepHand(room);
    setDecidiu(true);
  }, [roomId, room]);

  const mulliganCount = eu?.mulliganCount ?? 0;
  /**
   * A decisão agora vive no SERVIDOR (`Player.keptHand`).
   *
   * O `sessionStorage` continua como reforço para o F5 no mesmo dispositivo,
   * mas ele nunca poderia ser a fonte da verdade: é o servidor que fecha a
   * janela de mulligan (`MULLIGAN_CLOSED`), e antes disto o cliente podia achar
   * que a janela ainda estava aberta — mostrando um botão que só produzia erro.
   * Basta um dos dois dizer "já decidiu" para o modal sair da frente.
   */
  const jaDecidiuNoServidor = eu?.keptHand === true;

  const handCards = Object.values(cards).filter((c) => c.ownerId === myId && c.zone === 'HAND');

  // Se já há carta em jogo, a partida começou: nunca reabrir por cima da mesa.
  const partidaEmAndamento = Object.values(cards).some(
    (c) => c.ownerId === myId && (c.zone === 'BATTLEFIELD' || c.zone === 'GRAVEYARD'),
  );

  if (decidiu || jaDecidiuNoServidor || partidaEmAndamento || handCards.length === 0) return null;

  const handleKeep = () => {
    if (mulliganCount > 0) {
      setIsSelectingBottom(true);
    } else {
      registrarDecisao();
    }
  };

  const handleMulligan = () => {
    setSelectedCards([]);
    intents.mulligan(room);
  };

  const toggleCardSelection = (cardId: string) => {
    setSelectedCards((atual) => {
      if (atual.includes(cardId)) return atual.filter((id) => id !== cardId);
      if (atual.length >= mulliganCount) return atual;
      return [...atual, cardId];
    });
  };

  const handleConfirmBottom = () => {
    selectedCards.forEach((id) => {
      intents.changeZone(room, id, 'LIBRARY', undefined, undefined, 0); // index 0 = fundo
    });
    registrarDecisao();
  };

  return (
    <div className="z-60 pointer-events-auto fixed inset-0 flex flex-col items-center justify-center overflow-y-auto bg-black/90 p-4 backdrop-blur-sm">
      {/* Saída sempre disponível: sem isto, um estado inesperado travava a mesa. */}
      <button
        onClick={registrarDecisao}
        className="border-panel-border bg-panel/80 text-text-muted absolute right-4 top-4 rounded-lg border p-2 transition-colors hover:text-white"
        title="Fechar e ir para a mesa"
        aria-label="Fechar"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="mb-6 text-center">
        <h1 className="mb-2 text-3xl font-bold text-white drop-shadow-lg sm:text-5xl">
          {isSelectingBottom ? 'London Mulligan' : 'Sua Mão Inicial'}
        </h1>
        <p className="text-text-muted text-sm sm:text-xl">
          {isSelectingBottom
            ? `Selecione ${mulliganCount} carta(s) para devolver ao fundo do grimório.`
            : 'Você pode manter estas cartas ou realizar um Mulligan.'}
        </p>
      </div>

      {/* `flex-wrap` + largura por breakpoint: com 7 cartas de 192px fixos a
          linha estourava a tela em qualquer notebook. */}
      {/* ─── AS SETE CARTAS EM UMA FILEIRA ─────────────────────────────────
          Era `max-w-6xl` (1152px) com `flex-wrap`, e a carta parava de crescer
          em `lg:w-40` (160px). Sete cartas de 160 mais os vãos dão 1192px: a
          SÉTIMA quebrava para uma segunda linha, sozinha, no meio de uma tela
          vazia — e num monitor grande as cartas continuavam com 160px enquanto
          sobrava metade da largura.

          `clamp` deixa a carta crescer com a viewport até 208px e encolher até
          88px, e o teto de largura sai do caminho. O `flex-wrap` fica como
          recuo para telas muito estreitas, onde uma fileira de sete é
          impossível de qualquer forma. */}
      <div className="mb-8 flex w-full flex-wrap justify-center gap-3 px-2">
        {handCards.map((c) => {
          const isSelected = selectedCards.includes(c.id);
          return (
            <button
              type="button"
              key={c.id}
              className={`group relative shrink-0 transition-transform ${
                isSelectingBottom ? 'cursor-pointer' : 'cursor-default'
              } ${isSelected ? '-translate-y-4 scale-105' : ''}`}
              onClick={() => isSelectingBottom && toggleCardSelection(c.id)}
            >
              {c.scryfallId ? (
                <img
                  src={cardImageUrl(c.scryfallId, 'normal')}
                  className={`aspect-[63/88] w-[clamp(88px,11.5vw,208px)] rounded-xl border object-cover shadow-[0_0_20px_rgba(0,0,0,0.8)] transition-all duration-300 ${
                    isSelected
                      ? 'border-primary shadow-primary/50'
                      : 'border-panel-border group-hover:-translate-y-2'
                  }`}
                  alt="Carta da mão inicial"
                />
              ) : (
                <div className="border-panel-border bg-panel text-text-faint flex aspect-[63/88] w-[clamp(88px,11.5vw,208px)] items-center justify-center rounded-xl border p-2 text-center text-[10px]">
                  carta sem imagem
                </div>
              )}

              {isSelected && (
                <div className="border-primary bg-primary/20 pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl border-4">
                  <Check className="text-primary h-12 w-12 drop-shadow-md" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap justify-center gap-4">
        {isSelectingBottom ? (
          <button
            onClick={handleConfirmBottom}
            disabled={selectedCards.length !== mulliganCount}
            className="bg-primary hover:bg-primary-hover flex items-center gap-3 rounded-xl px-6 py-3 text-base font-bold text-white shadow-[0_0_30px_rgba(59,130,246,0.3)] transition-all active:scale-95 disabled:opacity-50 sm:text-xl"
          >
            <Check className="h-6 w-6" />
            Confirmar ({selectedCards.length}/{mulliganCount})
          </button>
        ) : (
          <>
            <button
              onClick={handleKeep}
              className="bg-success hover:bg-success-hover flex items-center gap-3 rounded-xl px-6 py-3 text-base font-bold text-white shadow-[0_0_30px_rgba(34,197,94,0.3)] transition-all active:scale-95 sm:text-xl"
            >
              <Check className="h-6 w-6" />
              Manter mão
            </button>
            <button
              onClick={handleMulligan}
              className="bg-danger hover:bg-danger-hover flex items-center gap-3 rounded-xl px-6 py-3 text-base font-bold text-white shadow-[0_0_30px_rgba(239,68,68,0.3)] transition-all active:scale-95 sm:text-xl"
            >
              <Repeat className="h-6 w-6" />
              Mulligan {mulliganCount > 0 ? `(${mulliganCount})` : ''}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
