'use client';

/**
 * aparencia.store.ts — como o jogador quer VER o aplicativo.
 *
 * Nada aqui trafega para os outros jogadores. Fica separada do `uiStore` da
 * mesa de propósito — este store vale nas telas de fora da partida (taverna,
 * grimórios, perfil), e a mesa tem o próprio, com estado efêmero que não faz
 * sentido aqui.
 *
 * ─── O QUE SEGUE A CONTA E O QUE FICA NESTE APARELHO ───────────────────────
 *
 * Era tudo só `localStorage`, e trocar de PC zerava. Agora as escolhas de
 * GOSTO (visão, agrupamento e ordenação do grimório, tamanho das artes,
 * densidade, animações, os dois idiomas) seguem a conta, pelo contrato
 * `PreferenciasDeInterface` do shared-types — ver `preferencias-da-conta.ts`
 * e `useHidratarPreferencias`. O `localStorage` continua sendo o cache que faz
 * a tela abrir sem esperar rede.
 *
 * `menuRecolhido` e `painelDeBuscaRecolhido` ficam SÓ aqui, de propósito: são
 * do aparelho, não da pessoa. O menu recolhido que ajuda no notebook atrapalha
 * no monitor largo, e o painel de busca é recolhido no celular por falta de
 * espaço.
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
import type {
  AgrupamentoDeDeck,
  CodigoDoIdiomaDaInterface,
  Densidade,
  OrdenacaoDeDeck,
  TamanhoDeCarta,
  VisaoDeDeck,
} from '@aethertable/shared-types';
import { armazenamentoSeguro } from './storage';

/**
 * Os tipos moram no shared-types desde que a aparência foi para a conta: a API
 * valida contra as MESMAS listas que este store aceita. Reexportados aqui para
 * as telas continuarem importando de onde sempre importaram.
 */
export type { AgrupamentoDeDeck, Densidade, OrdenacaoDeDeck, TamanhoDeCarta, VisaoDeDeck };

interface AparenciaState {
  /** Menu lateral em modo trilha de ícones (só desktop). */
  menuRecolhido: boolean;
  visaoDeDeck: VisaoDeDeck;
  agrupamentoDeDeck: AgrupamentoDeDeck;
  ordenacaoDeDeck: OrdenacaoDeDeck;
  tamanhoDeCarta: TamanhoDeCarta;
  densidade: Densidade;
  /** Preferir menos movimento, independente do sistema operacional. */
  animacoesReduzidas: boolean;
  /** Painel de busca/importação do deckbuilder minimizado. */
  painelDeBuscaRecolhido: boolean;
  /**
   * Idioma preferido das CARTAS (código da Scryfall: "pt", "en"…), não da
   * interface. É o padrão de "pôr o deck num idioma" no editor e o idioma que
   * o seletor de arte mostra além do inglês.
   */
  idiomaDasCartas: string;
  /** Idioma da INTERFACE. Ver `i18n/i18n.ts`. */
  idiomaDaInterface: CodigoDoIdiomaDaInterface;

  alternarMenu: () => void;
  setMenuRecolhido: (v: boolean) => void;
  setVisaoDeDeck: (v: VisaoDeDeck) => void;
  setAgrupamentoDeDeck: (v: AgrupamentoDeDeck) => void;
  setOrdenacaoDeDeck: (v: OrdenacaoDeDeck) => void;
  setTamanhoDeCarta: (v: TamanhoDeCarta) => void;
  setDensidade: (v: Densidade) => void;
  setAnimacoesReduzidas: (v: boolean) => void;
  alternarPainelDeBusca: () => void;
  setIdiomaDasCartas: (v: string) => void;
  setIdiomaDaInterface: (v: CodigoDoIdiomaDaInterface) => void;
}

export const useAparencia = create<AparenciaState>()(
  persist(
    (set) => ({
      menuRecolhido: false,
      visaoDeDeck: 'lista',
      agrupamentoDeDeck: 'tipo',
      ordenacaoDeDeck: 'nome',
      tamanhoDeCarta: 'medio',
      densidade: 'confortavel',
      animacoesReduzidas: false,
      painelDeBuscaRecolhido: false,
      idiomaDasCartas: 'pt',
      idiomaDaInterface: 'pt-BR',

      alternarMenu: () => set((s) => ({ menuRecolhido: !s.menuRecolhido })),
      setMenuRecolhido: (menuRecolhido) => set({ menuRecolhido }),
      setVisaoDeDeck: (visaoDeDeck) => set({ visaoDeDeck }),
      setAgrupamentoDeDeck: (agrupamentoDeDeck) => set({ agrupamentoDeDeck }),
      setOrdenacaoDeDeck: (ordenacaoDeDeck) => set({ ordenacaoDeDeck }),
      setTamanhoDeCarta: (tamanhoDeCarta) => set({ tamanhoDeCarta }),
      setDensidade: (densidade) => set({ densidade }),
      setAnimacoesReduzidas: (animacoesReduzidas) => set({ animacoesReduzidas }),
      alternarPainelDeBusca: () =>
        set((s) => ({ painelDeBuscaRecolhido: !s.painelDeBuscaRecolhido })),
      setIdiomaDasCartas: (idiomaDasCartas) => set({ idiomaDasCartas }),
      setIdiomaDaInterface: (idiomaDaInterface) => set({ idiomaDaInterface }),
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
