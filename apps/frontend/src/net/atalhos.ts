'use client';

/**
 * atalhos.ts — teclado da mesa.
 *
 * Num sandbox sem motor de regras, a mão do jogador faz TUDO: virar, comprar,
 * desvirar, passar o turno. Fazer cada uma dessas coisas com dois cliques (abrir
 * menu, escolher item) é o que separa uma mesa fluida de uma mesa cansativa.
 * Nenhuma tecla estava mapeada.
 *
 * REGRA que este módulo respeita: um atalho NUNCA dispara enquanto o jogador
 * digita. Sem esse cuidado, escrever "desvirar tudo" no chat viraria uma dúzia
 * de ações na mesa.
 */

import { useEffect } from 'react';
import type { Room } from 'colyseus.js';
import { useGameStore, useUIStore } from '../store/game.store';
import { intents } from './intents';
import type { RoomState } from './schema/RoomState';

export interface Atalho {
  tecla: string;
  descricao: string;
  /** Exige Ctrl/Cmd. */
  comModificador?: boolean;
}

/** Tabela publicada na ajuda da mesa. Fonte única. */
export const ATALHOS: Atalho[] = [
  { tecla: 'D', descricao: 'Comprar uma carta' },
  { tecla: 'U', descricao: 'Desvirar todas as suas permanentes' },
  { tecla: 'T', descricao: 'Virar / desvirar a seleção' },
  { tecla: 'E', descricao: 'Marcadores, P/T e dano da carta selecionada' },
  { tecla: 'F', descricao: 'Virar a seleção para baixo / para cima' },
  { tecla: 'X', descricao: 'Transformar (dupla face)' },
  { tecla: 'S', descricao: 'Embaralhar o grimório' },
  { tecla: 'P', descricao: 'Passar o turno' },
  { tecla: 'G', descricao: 'Mandar a seleção para o cemitério' },
  { tecla: 'Z', descricao: 'Desfazer a última ação', comModificador: true },
  { tecla: 'Esc', descricao: 'Limpar a seleção / fechar painel' },
  { tecla: 'Alt + clique', descricao: 'Inspecionar a carta / apontar um ping' },
  { tecla: 'Shift + clique', descricao: 'Somar à seleção' },
];

/** O foco está num campo de texto? Então o teclado é do campo, não da mesa. */
function digitando(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

export function useAtalhosDaMesa(room: Room<RoomState> | null, ativo: boolean): void {
  useEffect(() => {
    if (!room || !ativo) return;

    const onKey = (e: KeyboardEvent) => {
      if (digitando(e.target)) return;

      const ui = useUIStore.getState();
      const jogo = useGameStore.getState();
      const selecao = ui.selectedCardIds.filter((id) => jogo.cards[id]);
      const primeira = selecao[0] ? jogo.cards[selecao[0]] : undefined;

      // Ctrl/Cmd + Z — desfazer.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        intents.undo(room);
        return;
      }
      // Qualquer outro modificador é atalho do navegador: não sequestrar.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case 'd':
          e.preventDefault();
          intents.draw(room, 1);
          break;

        case 'u':
          e.preventDefault();
          intents.untapAll(room);
          break;

        case 's':
          e.preventDefault();
          intents.shuffle(room, 'LIBRARY');
          break;

        case 'p':
          e.preventDefault();
          intents.passTurn(room);
          break;

        case 't':
          if (selecao.length === 0) return;
          e.preventDefault();
          // Uma mensagem para a seleção inteira: N mensagens seguidas
          // estourariam o limite de 30 intenções/s.
          intents.batchUpdate(room, selecao, 'isTapped', !primeira?.isTapped);
          break;

        case 'f':
          if (selecao.length === 0) return;
          e.preventDefault();
          intents.batchUpdate(room, selecao, 'faceDown', !primeira?.faceDown);
          break;

        case 'x':
          if (!primeira) return;
          e.preventDefault();
          intents.transform(room, primeira.id);
          break;

        case 'g':
          if (selecao.length === 0) return;
          e.preventDefault();
          selecao.forEach((id) => intents.changeZone(room, id, 'GRAVEYARD'));
          ui.clearSelection();
          break;

        case 'e':
          if (!primeira) return;
          e.preventDefault();
          ui.setEditingCard(primeira.id);
          break;

        case 'escape':
          // O Esc de cada painel é tratado no próprio painel; aqui ele só
          // limpa a seleção quando não há nada aberto.
          if (ui.editingCardId || ui.inspectedZone || ui.inspectedCardId || ui.arrowSource) return;
          ui.clearSelection();
          break;

        default:
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [room, ativo]);
}
