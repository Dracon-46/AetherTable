/**
 * reacoes.ts — o que cada reação mostra.
 *
 * Um lugar só para o emoji e o rótulo: o balão na mesa, o menu do campo vazio,
 * a barra de ações e a ajuda de atalhos leem daqui. Com quatro listas, a
 * primeira reação nova apareceria em três delas e faltaria na quarta.
 */

import { REACOES, type Reacao } from '@aethertable/shared-types';

export const ROTULO_DA_REACAO: Readonly<Record<Reacao, { emoji: string; rotulo: string }>> = {
  POLEGAR: { emoji: '👍', rotulo: 'Boa!' },
  PENSANDO: { emoji: '🤔', rotulo: 'Pensando…' },
  UAU: { emoji: '😮', rotulo: 'Uau' },
  CHORO: { emoji: '😢', rotulo: 'Choro' },
  RISADA: { emoji: '😂', rotulo: 'Risada' },
  GG: { emoji: '🤝', rotulo: 'GG' },
};

export const LISTA_DE_REACOES: readonly { tipo: Reacao; emoji: string; rotulo: string }[] =
  REACOES.map((tipo) => ({ tipo, ...ROTULO_DA_REACAO[tipo] }));
