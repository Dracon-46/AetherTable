'use client';

/**
 * useHistorico.ts — leitura do histórico de partidas da conta.
 *
 * O histórico é gravado pelo game-server no fim de cada partida (resumo, não
 * replay — RN12, revista em 14/10/2026). Aqui só se lê: lista paginada com
 * filtros e os números do topo.
 */

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth.store';
import { api } from '../lib/fetcher';

export type ResultadoDaPartida = 'VITORIA' | 'DERROTA' | 'SEM_VENCEDOR';

export interface ParticipanteDoHistorico {
  nome: string;
  usuario: string | null;
  souEu: boolean;
  deckId: string | null;
  nomeDoDeck: string | null;
  comandanteId: string | null;
  bracket: number | null;
  vidaFinal: number | null;
  venceu: boolean;
  comecou: boolean;
  saiuAntes: boolean;
  motivoDaEliminacao: string | null;
}

export interface PartidaDoHistorico {
  id: string;
  terminouEm: string;
  duracaoSegundos: number;
  formato: string | null;
  rodadas: number | null;
  jogadores: number;
  resultado: ResultadoDaPartida;
  participantes: ParticipanteDoHistorico[];
}

export interface PaginaDoHistorico {
  total: number;
  pagina: number;
  porPagina: number;
  partidas: PartidaDoHistorico[];
}

export interface EstatisticasDoHistorico {
  partidas: number;
  vitorias: number;
  taxaDeVitoria: number;
  duracaoMediaSegundos: number;
  comandanteMaisJogado: { comandanteId: string; partidas: number } | null;
}

export type FiltroDeResultado = 'todas' | 'vitorias' | 'derrotas' | 'sem-vencedor';

export function useHistorico(filtros: {
  resultado: FiltroDeResultado;
  formato?: string;
  pagina: number;
}) {
  const token = useAuthStore((s) => s.accessToken);
  const qs = new URLSearchParams({
    resultado: filtros.resultado,
    pagina: String(filtros.pagina),
    ...(filtros.formato ? { formato: filtros.formato } : {}),
  });
  return useQuery({
    queryKey: ['historico', filtros],
    queryFn: ({ signal }) => api<PaginaDoHistorico>(`/matches/historico?${qs}`, { signal }),
    enabled: Boolean(token),
    placeholderData: keepPreviousData,
  });
}

export function useEstatisticasDoHistorico() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['historico', 'estatisticas'],
    queryFn: ({ signal }) =>
      api<EstatisticasDoHistorico>('/matches/historico/estatisticas', { signal }),
    enabled: Boolean(token),
  });
}

/** "25 min", "1 h 05 min". */
export function formatarDuracao(segundos: number): string {
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `${minutos} min`;
  return `${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, '0')} min`;
}

const MOTIVOS: Record<string, string> = {
  LIFE: 'vida zerada',
  POISON: 'veneno',
  COMMANDER: 'dano de comandante',
  DECKED: 'grimório vazio',
  CONCEDED: 'concedeu',
};

export function motivoLegivel(motivo: string | null): string | null {
  return motivo ? (MOTIVOS[motivo] ?? motivo.toLowerCase()) : null;
}
