'use client';

/**
 * aparencia.store.ts — como o jogador quer VER o aplicativo.
 *
 * Preferência puramente local: nada aqui trafega para o servidor nem para os
 * outros jogadores. Fica separada do `uiStore` da mesa de propósito — este
 * store vale nas telas de fora da partida (taverna, grimórios, perfil), e a
 * mesa tem o próprio, com estado efêmero que não faz sentido aqui.
 *
 * ─── POR QUE MINIMIZAR NÃO É "ESCONDER" ────────────────────────────────────
 *
 * O menu lateral tinha dois estados: fora da tela (celular) ou 256 px fixos
 * (desktop). Em tela de 1366 px — a mais comum num notebook — isso é 19 % da
 * largura gasta com quatro links, o tempo todo, inclusive dentro do
 * deckbuilder, que é a tela que mais precisa de espaço horizontal.
 *
 * Minimizado é um TERCEIRO estado, e a diferença importa: o menu continua na
 * tela, com os ícones e o destaque da rota atual, ocupando 64 px. Some com a
 * navegação para ganhar espaço é o que o modo celular já faz; aqui o objetivo é
 * ganhar espaço SEM perder a navegação.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { armazenamentoSeguro } from './storage';

/** Como a lista de cartas do grimório é desenhada. */
export type VisaoDeDeck = 'lista' | 'galeria' | 'compacta';

/** Por qual critério as cartas são agrupadas. */
export type AgrupamentoDeDeck = 'tipo' | 'cor' | 'cmc' | 'nenhum';

/** Tamanho das artes na galeria. Vira número de colunas na grade. */
export type TamanhoDeCarta = 'pequeno' | 'medio' | 'grande';

/** Densidade da interface fora da mesa. */
export type Densidade = 'confortavel' | 'compacta';

interface AparenciaState {
  /** Menu lateral em modo trilha de ícones (só desktop). */
  menuRecolhido: boolean;
  visaoDeDeck: VisaoDeDeck;
  agrupamentoDeDeck: AgrupamentoDeDeck;
  tamanhoDeCarta: TamanhoDeCarta;
  densidade: Densidade;
  /** Preferir menos movimento, independente do sistema operacional. */
  animacoesReduzidas: boolean;

  alternarMenu: () => void;
  setMenuRecolhido: (v: boolean) => void;
  setVisaoDeDeck: (v: VisaoDeDeck) => void;
  setAgrupamentoDeDeck: (v: AgrupamentoDeDeck) => void;
  setTamanhoDeCarta: (v: TamanhoDeCarta) => void;
  setDensidade: (v: Densidade) => void;
  setAnimacoesReduzidas: (v: boolean) => void;
}

export const useAparencia = create<AparenciaState>()(
  persist(
    (set) => ({
      menuRecolhido: false,
      visaoDeDeck: 'lista',
      agrupamentoDeDeck: 'tipo',
      tamanhoDeCarta: 'medio',
      densidade: 'confortavel',
      animacoesReduzidas: false,

      alternarMenu: () => set((s) => ({ menuRecolhido: !s.menuRecolhido })),
      setMenuRecolhido: (menuRecolhido) => set({ menuRecolhido }),
      setVisaoDeDeck: (visaoDeDeck) => set({ visaoDeDeck }),
      setAgrupamentoDeDeck: (agrupamentoDeDeck) => set({ agrupamentoDeDeck }),
      setTamanhoDeCarta: (tamanhoDeCarta) => set({ tamanhoDeCarta }),
      setDensidade: (densidade) => set({ densidade }),
      setAnimacoesReduzidas: (animacoesReduzidas) => set({ animacoesReduzidas }),
    }),
    {
      name: 'aether-aparencia',
      storage: armazenamentoSeguro,
    },
  ),
);

/** Colunas da grade da galeria, por tamanho escolhido. Classes fixas para o
 *  Tailwind poder extraí-las — interpolação de string aqui produz CSS vazio. */
export const COLUNAS_DA_GALERIA: Record<TamanhoDeCarta, string> = {
  pequeno: 'grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10',
  medio: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
  grande: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
};
