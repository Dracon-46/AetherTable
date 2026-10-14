'use client';

/**
 * useDecksIniciais.ts — a vitrine de decks prontos e o "usar este deck".
 *
 * A vitrine é estática no servidor (listas geradas do MTGJSON), então o cache
 * não expira na sessão. Usar um deck inicial COPIA a lista para a conta — e
 * o servidor reencontra a cópia se a pessoa escolher o mesmo deck de novo.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth.store';
import { api, mensagemDaApi } from '../lib/fetcher';
import { useToast } from '../components/Toast';
import { chavesDeDeck, type DeckResumo } from './useDecks';

export interface DeckInicial {
  codigo: string;
  nome: string;
  colecao: string;
  lancamento: string;
  comandantes: string[];
  nomesDosComandantes: string[];
  cores: string[];
  totalDeCartas: number;
}

export function useDecksIniciais() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['decks-iniciais'],
    queryFn: ({ signal }) => api<DeckInicial[]>('/decks-iniciais', { signal }),
    enabled: Boolean(token),
    staleTime: Infinity,
  });
}

export function useUsarDeckInicial() {
  const qc = useQueryClient();
  const avisar = useToast((s) => s.mostrar);
  return useMutation({
    mutationFn: (codigo: string) =>
      api<DeckResumo>(`/decks-iniciais/${encodeURIComponent(codigo)}/usar`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chavesDeDeck.lista() }),
    onError: (erro) => avisar(mensagemDaApi(erro), 'erro'),
  });
}
