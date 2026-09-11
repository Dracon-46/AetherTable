'use client';

/**
 * useAdmin.ts — leitura e escrita do backoffice (DOC-061).
 *
 * ─── O PAPEL NÃO VEM DO CACHE DE LOGIN ─────────────────────────────────────
 *
 * `useSouAdmin` pergunta ao servidor (`GET /admin/eu`) em vez de ler o `role`
 * que o `authStore` guardou no login. A diferença importa: o token vale sete
 * dias, então o `role` gravado no `localStorage` pode estar uma semana
 * desatualizado — e o caso que ele erra é justamente o que mais importa, uma
 * conta despromovida continuar vendo o painel.
 *
 * A resposta 403 não é tratada como falha: ela É a resposta. Quem não tem
 * acesso recebe `null` e a casca redireciona.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/fetcher';
import { useAuthStore } from '../store/auth.store';

export type Papel = 'USER' | 'MOD' | 'ADMIN';
export type StatusDeDenuncia = 'OPEN' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED';

export interface Sessao {
  id: string;
  username: string;
  papel: Papel;
}

export interface VisaoGeral {
  usuarios: {
    total: number;
    novosNaSemana: number;
    ativosEm24h: number;
    suspensos: number;
    banidos: number;
    admins: number;
    moderadores: number;
  };
  conteudo: { decks: number };
  partidas: { total: number; naSemana: number };
  moderacao: { denunciasAbertas: number };
  flags: Flag[];
}

export interface Flag {
  key: string;
  enabled: boolean;
  note: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface UsuarioAdmin {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: Papel;
  emailVerifiedAt: string | null;
  lastSeenAt: string | null;
  deletedAt: string | null;
  suspendedUntil: string | null;
  suspensionReason: string | null;
  createdAt: string;
  _count?: { decks: number; reportsGot: number };
}

export interface Pessoa {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface Denuncia {
  id: string;
  reason: string;
  status: StatusDeDenuncia;
  details: string | null;
  roomCode: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  reporter: Pessoa;
  reported: Pessoa;
  resolvedBy: { id: string; username: string } | null;
}

export interface LinhaDoSnapshot {
  em?: number;
  autor?: string;
  tipo?: string;
  texto: string;
}

export interface DenunciaDetalhada extends Denuncia {
  snapshot: LinhaDoSnapshot[];
  abertasContraEle: number;
  totalContraEle: number;
  outrasDenuncias: Array<{
    id: string;
    reason: string;
    status: StatusDeDenuncia;
    createdAt: string;
    roomCode: string | null;
    reporter: { id: string; username: string };
  }>;
}

export interface Auditoria {
  id: string;
  actorId: string | null;
  actorLabel: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

export interface Cosmetico {
  id: string;
  type: string;
  name: string;
  catalogoId: string | null;
  minTier: number;
  isActive: boolean;
  donos: number;
}

export interface CatalogoDeCosmetico {
  catalogoId: string;
  nome: string;
  tier: string;
  tipo: string | null;
}

interface Pagina<T> {
  itens: T[];
  proximoCursor: string | null;
}

const chaves = {
  eu: ['admin', 'eu'] as const,
  visaoGeral: ['admin', 'visao-geral'] as const,
  usuarios: (q: string, extra: string) => ['admin', 'usuarios', q, extra] as const,
  usuario: (id: string) => ['admin', 'usuario', id] as const,
  denuncias: (status: string) => ['admin', 'denuncias', status] as const,
  denuncia: (id: string) => ['admin', 'denuncia', id] as const,
  resumoDenuncias: ['admin', 'denuncias', 'resumo'] as const,
  cosmeticos: ['admin', 'cosmeticos'] as const,
  flags: ['admin', 'flags'] as const,
  auditoria: (filtro: string) => ['admin', 'auditoria', filtro] as const,
};

// ─── Sessão ──────────────────────────────────────────────────────────────────

export function useSouAdmin() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: chaves.eu,
    queryFn: async ({ signal }) => {
      try {
        return await api<Sessao>('/admin/eu', { signal });
      } catch (erro) {
        // 403 é uma resposta legítima: "você não é da casa". Deixar o erro
        // subir faria a tela mostrar "falha ao carregar" para um usuário
        // comum que simplesmente digitou /admin na barra de endereço.
        if (erro instanceof ApiError && erro.status === 403) return null;
        throw erro;
      }
    },
    enabled: Boolean(token),
    // Curto de propósito: uma despromoção precisa fechar o painel rápido.
    staleTime: 30_000,
    retry: false,
  });
}

export function useVisaoGeral() {
  return useQuery({
    queryKey: chaves.visaoGeral,
    queryFn: ({ signal }) => api<VisaoGeral>('/admin/visao-geral', { signal }),
    // O painel mostra contagens; 15 s evita uma requisição por clique de aba.
    staleTime: 15_000,
  });
}

// ─── Usuários ────────────────────────────────────────────────────────────────

export function useUsuarios(filtros: {
  q?: string;
  papel?: Papel | '';
  apenasSuspensos?: boolean;
  incluirApagados?: boolean;
}) {
  const params = new URLSearchParams();
  if (filtros.q) params.set('q', filtros.q);
  if (filtros.papel) params.set('papel', filtros.papel);
  if (filtros.apenasSuspensos) params.set('apenasSuspensos', 'true');
  if (filtros.incluirApagados) params.set('incluirApagados', 'true');
  const qs = params.toString();

  return useQuery({
    queryKey: chaves.usuarios(filtros.q ?? '', qs),
    queryFn: ({ signal }) =>
      api<Pagina<UsuarioAdmin>>(`/admin/usuarios${qs ? `?${qs}` : ''}`, { signal }),
  });
}

export function useUsuario(id: string | null) {
  return useQuery({
    queryKey: chaves.usuario(id ?? ''),
    queryFn: ({ signal }) => api<Record<string, unknown>>(`/admin/usuarios/${id}`, { signal }),
    enabled: Boolean(id),
  });
}

/**
 * Uma ação sobre um usuário.
 *
 * `invalidateQueries` sem chave específica derruba TODO o cache de admin, e é o
 * comportamento certo aqui: banir alguém muda a lista, a ficha, os contadores
 * da visão geral e o log de auditoria ao mesmo tempo. Enumerar as quatro chaves
 * seria uma lista para esquecer de atualizar na próxima ação.
 */
export function useAcaoDeUsuario<Corpo, Resposta = unknown>(
  rota: (id: string) => string,
  method: 'POST' | 'PATCH' | 'DELETE' = 'POST',
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, corpo }: { id: string; corpo: Corpo }) =>
      api<Resposta>(rota(id), { method, body: corpo }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
  });
}

// ─── Denúncias ───────────────────────────────────────────────────────────────

export function useDenuncias(status: StatusDeDenuncia | '') {
  return useQuery({
    queryKey: chaves.denuncias(status),
    queryFn: ({ signal }) =>
      api<Pagina<Denuncia>>(`/admin/denuncias${status ? `?status=${status}` : ''}`, { signal }),
  });
}

export function useResumoDeDenuncias() {
  return useQuery({
    queryKey: chaves.resumoDenuncias,
    queryFn: ({ signal }) =>
      api<Record<StatusDeDenuncia, number>>('/admin/denuncias/resumo', { signal }),
    staleTime: 15_000,
  });
}

export function useDenuncia(id: string | null) {
  return useQuery({
    queryKey: chaves.denuncia(id ?? ''),
    queryFn: ({ signal }) => api<DenunciaDetalhada>(`/admin/denuncias/${id}`, { signal }),
    enabled: Boolean(id),
  });
}

export function useAcaoDeDenuncia<Corpo>(rota: (id: string) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, corpo }: { id: string; corpo?: Corpo }) =>
      api(rota(id), { method: 'POST', body: corpo ?? {} }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
  });
}

// ─── Cosméticos ──────────────────────────────────────────────────────────────

export function useCosmeticos() {
  return useQuery({
    queryKey: chaves.cosmeticos,
    queryFn: ({ signal }) =>
      api<{ catalogo: CatalogoDeCosmetico[]; registrados: Cosmetico[] }>('/admin/cosmeticos', {
        signal,
      }),
  });
}

export function useRegistrarCosmetico() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: { catalogoId: string; tipo: string; nome: string; minTier: number }) =>
      api('/admin/cosmeticos', { method: 'POST', body: corpo }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chaves.cosmeticos }),
  });
}

export function useAtualizarCosmetico() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      corpo,
    }: {
      id: string;
      corpo: { nome?: string; minTier?: number; ativo?: boolean };
    }) => api(`/admin/cosmeticos/${id}`, { method: 'PATCH', body: corpo }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chaves.cosmeticos }),
  });
}

export function useRemoverCosmetico() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/admin/cosmeticos/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chaves.cosmeticos }),
  });
}

// ─── Sistema ─────────────────────────────────────────────────────────────────

export function useFlags() {
  return useQuery({
    queryKey: chaves.flags,
    queryFn: ({ signal }) => api<Flag[]>('/admin/flags', { signal }),
  });
}

export function useMudarFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, ligado, nota }: { key: string; ligado: boolean; nota?: string }) =>
      api(`/admin/flags/${key}`, { method: 'PATCH', body: { ligado, nota } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin'] }),
  });
}

export function useLimparCacheDeCartas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ emMemoria: number; noBanco: number }>('/admin/cache-de-cartas/limpar', {
        method: 'POST',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin'] }),
  });
}

// ─── Auditoria ───────────────────────────────────────────────────────────────

export function useAuditoria(filtros: { action?: string; targetId?: string }) {
  const params = new URLSearchParams();
  if (filtros.action) params.set('action', filtros.action);
  if (filtros.targetId) params.set('targetId', filtros.targetId);
  const qs = params.toString();

  return useQuery({
    queryKey: chaves.auditoria(qs),
    queryFn: ({ signal }) =>
      api<Pagina<Auditoria>>(`/admin/auditoria${qs ? `?${qs}` : ''}`, { signal }),
  });
}
