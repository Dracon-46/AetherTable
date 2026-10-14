'use client';

/**
 * useNotificacoes.ts — os avisos do sino e o que já foi visto.
 *
 * Os avisos vêm do servidor (`GET /notificacoes`, derivados de curtidas e
 * denúncias). O "já vi" é deste navegador: a data da última vez que o sino foi
 * aberto e a última versão de Novidades lida. É conveniência de interface — se
 * o armazenamento falhar (aba anônima, dados limpos), o pior que acontece é o
 * sino acender de novo.
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { useAuthStore } from '../store/auth.store';
import { api } from '../lib/fetcher';
import { NOVIDADE_MAIS_RECENTE } from '../novidades/novidades';

export type Notificacao =
  | { tipo: 'CURTIDAS'; em: string; deckId: string; nomeDoDeck: string; quantas: number }
  | { tipo: 'COMENTARIOS'; em: string; deckId: string; nomeDoDeck: string; quantos: number }
  | {
      tipo: 'DENUNCIA_ANALISADA';
      em: string;
      denunciaId: string;
      desfecho: 'RESOLVED' | 'DISMISSED';
    };

const CHAVE_VISTO_EM = 'aethertable:sino-visto-em';
const CHAVE_VERSAO_VISTA = 'aethertable:novidade-vista';

function ler(chave: string): string | null {
  try {
    return window.localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravar(chave: string, valor: string): void {
  try {
    window.localStorage.setItem(chave, valor);
  } catch {
    /* sem armazenamento, o sino só volta a acender */
  }
}

export function useNotificacoes() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['notificacoes'],
    queryFn: ({ signal }) => api<Notificacao[]>('/notificacoes', { signal }),
    enabled: Boolean(token),
    staleTime: 60_000,
    // Curtida não é urgente: de cinco em cinco minutos basta.
    refetchInterval: 5 * 60_000,
  });
}

/**
 * O "já vi", num store: há mais de um sino montado (cabeçalho do celular, menu
 * aberto, menu recolhido), e abrir um precisa apagar o número dos outros.
 */
interface EstadoDoSino {
  vistoEm: string | null;
  versaoVista: string | null;
  carregado: boolean;
  carregar: () => void;
  marcar: (maisRecente?: string) => void;
}

export const useSinoStore = create<EstadoDoSino>((set, get) => ({
  vistoEm: null,
  versaoVista: null,
  carregado: false,
  carregar: () => {
    if (get().carregado) return;
    set({ vistoEm: ler(CHAVE_VISTO_EM), versaoVista: ler(CHAVE_VERSAO_VISTA), carregado: true });
  },
  marcar: (maisRecente) => {
    // O mais tarde entre o relógio daqui e o aviso mais novo: com o relógio do
    // aparelho atrasado em relação ao servidor, o aviso que acabou de chegar
    // continuaria "novo" depois de o sino ser aberto.
    const relogio = new Date().toISOString();
    const agora = maisRecente && maisRecente > relogio ? maisRecente : relogio;
    gravar(CHAVE_VISTO_EM, agora);
    gravar(CHAVE_VERSAO_VISTA, NOVIDADE_MAIS_RECENTE.versao);
    set({ vistoEm: agora, versaoVista: NOVIDADE_MAIS_RECENTE.versao });
  },
}));

/** O que está por ler, e como marcar tudo como lido. */
export function useNaoLidas(notificacoes: Notificacao[] | undefined) {
  const { vistoEm, versaoVista, carregado, carregar, marcar } = useSinoStore();

  // Lido no efeito, não no render: no servidor não há `localStorage`, e o
  // primeiro render do cliente precisa bater com o do servidor.
  useEffect(carregar, [carregar]);

  const avisosNovos = carregado
    ? (notificacoes ?? []).filter((n) => !vistoEm || n.em > vistoEm).length
    : 0;
  const novidadeNova = carregado && versaoVista !== NOVIDADE_MAIS_RECENTE.versao;

  return {
    total: avisosNovos + (novidadeNova ? 1 : 0),
    novidadeNova,
    /** A data de corte ANTES de marcar — para destacar o que era novo ao abrir. */
    vistoEm,
    marcarComoLido: () =>
      marcar(
        (notificacoes ?? []).reduce<string | undefined>(
          (m, n) => (!m || n.em > m ? n.em : m),
          undefined,
        ),
      ),
  };
}
