/**
 * fetcher.ts — uma porta só para a API Core.
 *
 * ─── O QUE ESTAVA ACONTECENDO ──────────────────────────────────────────────
 *
 * Cada tela montava a própria chamada à mão: `fetch(...)`, `headers`
 * escritos de novo, `res.ok` checado de forma diferente em cada arquivo, e
 * `console.error(err)` como tratamento de erro. Três consequências:
 *
 *  1. NENHUM CACHE. Voltar da tela de um deck para a lista refazia a lista
 *     inteira, mesmo que ela tivesse sido carregada dois segundos antes. Da
 *     cadeira do usuário, "Voltar" é uma tela em branco que recarrega.
 *  2. 429 INVISÍVEL. O throttler responde 429 e o código só olhava `res.ok`
 *     para o caminho de sucesso — a tela ficava parada, sem erro nenhum.
 *  3. Um 401 tratado em alguns lugares e ignorado em outros: a sessão expirada
 *     aparecia como "os decks sumiram".
 *
 * Aqui a resposta é um erro TIPADO, e quem chama decide. O `logout` em 401 é
 * feito uma vez, neste módulo.
 */

import { API_URL } from './api';
import { useAuthStore } from '../store/auth.store';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Quantos segundos esperar, quando o servidor diz (429). */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Erro de limite de requisições — merece uma mensagem diferente na tela. */
  get eLimite(): boolean {
    return this.status === 429;
  }
}

/** Mensagem em português para o usuário, a partir do status. */
export function mensagemDaApi(erro: unknown): string {
  if (erro instanceof ApiError) {
    if (erro.status === 429) {
      return 'Muitas ações em sequência. Aguarde um instante e tente de novo.';
    }
    if (erro.status === 401) return 'Sua sessão expirou. Entre de novo.';
    if (erro.status === 403) return 'Você não tem permissão para isso.';
    if (erro.status === 404) return 'Não encontrado.';
    if (erro.status >= 500) return 'O servidor teve um problema. Tente de novo.';
    return erro.message;
  }
  return 'Falha de conexão com o servidor.';
}

interface OpcoesApi {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Aborta a chamada — o `signal` que o react-query passa nas queries. */
  signal?: AbortSignal;
  /** Rota pública (busca de carta, imagem): não manda `Authorization`. */
  publica?: boolean;
}

/**
 * Chamada autenticada à API. Devolve o JSON já desserializado.
 *
 * `204 No Content` devolve `undefined` em vez de estourar no `res.json()` —
 * várias rotas de deleção respondem assim.
 */
export async function api<T = unknown>(caminho: string, opcoes: OpcoesApi = {}): Promise<T> {
  const { method = 'GET', body, signal, publica = false } = opcoes;
  const token = useAuthStore.getState().accessToken;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!publica && token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${caminho}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (erro) {
    // `AbortError` não é falha de rede: é o react-query cancelando uma query
    // que não interessa mais. Repassar como ApiError faria a tela mostrar
    // "sem conexão" ao trocar de rota rápido.
    if (erro instanceof DOMException && erro.name === 'AbortError') throw erro;
    throw new ApiError('Falha de conexão com o servidor.', 0);
  }

  if (res.status === 401) {
    // Uma vez, aqui. Espalhado pelas telas, metade delas esquecia.
    useAuthStore.getState().logout();
    throw new ApiError('Sessão expirada.', 401);
  }

  if (!res.ok) {
    const retryAfter = Number(res.headers.get('retry-after')) || undefined;
    let mensagem = `A API respondeu ${res.status}.`;
    try {
      const corpo = (await res.json()) as { message?: string | string[] };
      if (corpo?.message) {
        mensagem = Array.isArray(corpo.message) ? corpo.message.join(' ') : corpo.message;
      }
    } catch {
      /* corpo vazio ou não-JSON: a mensagem por status já serve */
    }
    throw new ApiError(mensagem, res.status, retryAfter);
  }

  if (res.status === 204) return undefined as T;

  const texto = await res.text();
  return (texto ? JSON.parse(texto) : undefined) as T;
}
