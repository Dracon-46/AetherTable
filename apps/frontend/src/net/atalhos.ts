'use client';

/**
 * atalhos.ts — teclado da mesa.
 *
 * Num sandbox sem motor de regras, a mão do jogador faz TUDO: virar, comprar,
 * desvirar, passar o turno. Fazer cada uma dessas coisas com dois cliques (abrir
 * menu, escolher item) é o que separa uma mesa fluida de uma mesa cansativa.
 *
 * ─── DE `switch (e.key)` PARA TABELA ───────────────────────────────────────
 *
 * A versão anterior tinha as teclas escritas dentro do `switch` e uma lista
 * `ATALHOS[]` ao lado, feita à mão, só para a ajuda mostrar. Duas listas e uma
 * verdade: trocar uma tecla no `switch` e esquecer a lista fazia a ajuda
 * mentir. E remapear era impossível por construção — a tecla era o `case`.
 *
 * Agora o `case` é a AÇÃO, não a tecla. Que tecla aciona qual ação sai de
 * `useAtalhos()` (preferência do jogador, com o padrão de
 * `@aethertable/shared-types`), e a ajuda e o editor leem a mesma fonte que
 * este listener. Uma ação nova é uma linha em `ACOES_DE_ATALHO` mais um `case`
 * aqui.
 *
 * ─── DUAS REGRAS QUE ESTE MÓDULO RESPEITA ──────────────────────────────────
 *
 * 1. Um atalho NUNCA dispara enquanto o jogador digita. Sem esse cuidado,
 *    escrever "desvirar tudo" no chat viraria uma dúzia de ações na mesa.
 *
 * 2. Tecla sem ação mapeada não é tocada — nem `preventDefault`. É o que
 *    mantém Ctrl+T, Ctrl+W, F5 e a busca do navegador funcionando: só
 *    interceptamos o que o jogador declarou que é atalho da mesa.
 */

import { useEffect } from 'react';
import type { Room } from 'colyseus.js';
import {
  ACOES_DE_ATALHO,
  TECLA_NAO_ATRIBUIDA,
  acaoDaTecla,
  normalizarTecla,
  type AcaoDeAtalho,
} from '@aethertable/shared-types';
import { useGameStore, useUIStore } from '../store/game.store';
import { useAtalhos } from '../store/atalhos.store';
import { PASSO_DO_FATOR } from '../canvas/layout';
import { intents } from './intents';
import type { RoomState } from './schema/RoomState';

/**
 * Gestos de MOUSE, que não passam pelo remapeamento.
 *
 * Ficam aqui, ao lado das teclas, porque para o jogador são a mesma coisa
 * ("como eu faço isso rápido") e porque a ajuda os mostra na mesma lista. Não
 * são remapeáveis: Alt+clique e Shift+clique estão presos ao gesto que o
 * tabuleiro implementa em `GameBoard`, e oferecer um editor para eles seria
 * oferecer um controle que não liga nada.
 */
export const GESTOS_DE_MOUSE: ReadonlyArray<{ gesto: string; descricao: string }> = [
  { gesto: 'Alt + clique', descricao: 'Inspecionar a carta / apontar um ping' },
  { gesto: 'Shift + clique', descricao: 'Somar à seleção' },
  { gesto: 'Duplo clique', descricao: 'Virar / desvirar a permanente' },
];

/**
 * Nomes de exibição das teclas nomeadas.
 *
 * `'escape'` na tela é `Esc`, e `'arrowup'` é `↑`. Sem esta tabela o editor
 * mostraria a string canônica crua, que é nome de código e não de tecla.
 */
const NOME_DA_TECLA: Readonly<Record<string, string>> = {
  escape: 'Esc',
  enter: 'Enter',
  ' ': 'Espaço',
  space: 'Espaço',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Del',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  home: 'Home',
  end: 'End',
};

/**
 * A string canônica, escrita como o jogador lê.
 *
 * `'ctrl+z'` vira `Ctrl + Z`; `'P'` vira `Shift + P`, porque a maiúscula É o
 * Shift na gramática canônica (ver `normalizarTecla`) — mostrar só "P" ao lado
 * de outro atalho "P" seria dois atalhos com o mesmo rótulo.
 */
export function formatarTecla(tecla: string): string {
  if (!tecla) return 'sem tecla';

  const partes = tecla.split('+');
  // Uma tecla que é literalmente '+' virou ['', ''] no split: o último pedaço
  // vazio significa que o próprio separador é a tecla.
  const base = partes.pop() || '+';
  const modificadores = partes
    .filter(Boolean)
    .map((m) => (m === 'ctrl' ? 'Ctrl' : m === 'alt' ? 'Alt' : 'Shift'));

  let visivel = NOME_DA_TECLA[base.toLowerCase()] ?? base;
  if (visivel === base && base.length === 1) {
    // Letra maiúscula na canônica quer dizer Shift; qualquer outro caractere
    // de um dígito só aparece como está ('=', '-', '4').
    if (base >= 'A' && base <= 'Z') modificadores.push('Shift');
    visivel = base.toUpperCase();
  }

  return [...modificadores, visivel].join(' + ');
}

/** O foco está num campo de texto? Então o teclado é do campo, não da mesa. */
function digitando(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/** Ações que não fazem nada sem carta selecionada. */
const EXIGE_SELECAO: ReadonlySet<AcaoDeAtalho> = new Set(
  ACOES_DE_ATALHO.filter((a) => a.grupo === 'SELECAO' && a.id !== 'LIMPAR_SELECAO').map(
    (a) => a.id,
  ),
);

export function useAtalhosDaMesa(room: Room<RoomState> | null, ativo: boolean): void {
  const atalhos = useAtalhos((s) => s.atalhos);

  useEffect(() => {
    if (!room || !ativo) return;

    const onKey = (e: KeyboardEvent) => {
      if (digitando(e.target)) return;

      const acao = acaoDaTecla(atalhos, normalizarTecla(e));
      if (!acao) return;

      const ui = useUIStore.getState();
      const jogo = useGameStore.getState();
      const selecao = ui.selectedCardIds.filter((id) => jogo.cards[id]);
      const primeira = selecao[0] ? jogo.cards[selecao[0]] : undefined;

      // Uma ação de seleção sem seleção NÃO consome a tecla: deixá-la passar
      // preserva o comportamento nativo (um 'f' que não move carta nenhuma não
      // deve engolir o 'f' de um atalho do navegador).
      if (EXIGE_SELECAO.has(acao) && selecao.length === 0) return;

      switch (acao) {
        case 'COMPRAR':
          e.preventDefault();
          intents.draw(room, 1);
          break;

        case 'DESVIRAR_TUDO':
          e.preventDefault();
          intents.untapAll(room);
          break;

        case 'EMBARALHAR':
          e.preventDefault();
          intents.shuffle(room, 'LIBRARY');
          break;

        case 'PASSAR_TURNO':
          e.preventDefault();
          intents.passTurn(room);
          break;

        case 'DESFAZER':
          e.preventDefault();
          intents.undo(room);
          break;

        case 'VIRAR_SELECAO':
          e.preventDefault();
          // Uma mensagem para a seleção inteira: N mensagens seguidas
          // estourariam o limite de 30 intenções/s.
          intents.batchUpdate(room, selecao, 'isTapped', !primeira?.isTapped);
          break;

        case 'VIRAR_PARA_BAIXO':
          e.preventDefault();
          intents.batchUpdate(room, selecao, 'faceDown', !primeira?.faceDown);
          break;

        case 'TRANSFORMAR':
          if (!primeira) return;
          e.preventDefault();
          intents.transform(room, primeira.id);
          break;

        case 'PARA_CEMITERIO':
          e.preventDefault();
          selecao.forEach((id) => intents.changeZone(room, id, 'GRAVEYARD'));
          ui.clearSelection();
          break;

        case 'EDITAR_CARTA':
          if (!primeira) return;
          e.preventDefault();
          ui.setEditingCard(primeira.id);
          break;

        case 'LIMPAR_SELECAO':
          // O Esc de cada painel é tratado no próprio painel; aqui ele só
          // limpa a seleção quando não há nada aberto.
          if (ui.editingCardId || ui.inspectedZone || ui.inspectedCardId || ui.arrowSource) return;
          ui.clearSelection();
          break;

        /**
         * As duas únicas ações que não emitem intenção nenhuma: mexem numa
         * preferência de quem olha, não no estado compartilhado da mesa.
         */
        case 'AUMENTAR_CARTA':
          e.preventDefault();
          ui.ajustarFatorCarta(PASSO_DO_FATOR);
          break;

        case 'REDUZIR_CARTA':
          e.preventDefault();
          ui.ajustarFatorCarta(-PASSO_DO_FATOR);
          break;

        default:
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [room, ativo, atalhos]);
}

export { TECLA_NAO_ATRIBUIDA };
