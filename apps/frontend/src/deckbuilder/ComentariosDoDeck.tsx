'use client';

/**
 * ComentariosDoDeck.tsx — a conversa embaixo de um deck público.
 *
 * Aparece no Explorar (o deck de outra pessoa) e no editor do próprio deck
 * quando ele é público — é ali que o dono lê o que disseram e apaga o que não
 * quer na casa dele. Ver `comentarios.service.ts` no backend para as regras.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquare, Send, Trash2 } from 'lucide-react';
import { api, mensagemDaApi } from '../lib/fetcher';
import { useToast } from '../components/Toast';

export interface Comentario {
  id: string;
  texto: string;
  em: string;
  autor: { usuario: string; nome: string };
  meu: boolean;
  podeApagar: boolean;
}

const MAX = 500;
const QUANDO = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function ComentariosDoDeck({ deckId }: { deckId: string }) {
  const qc = useQueryClient();
  const avisar = useToast((s) => s.mostrar);
  const chave = ['comentarios', deckId];
  const [texto, setTexto] = useState('');

  const { data, isPending, isError, error } = useQuery({
    queryKey: chave,
    queryFn: ({ signal }) => api<Comentario[]>(`/explorar/decks/${deckId}/comentarios`, { signal }),
  });

  const comentar = useMutation({
    mutationFn: (t: string) =>
      api(`/explorar/decks/${deckId}/comentarios`, { method: 'POST', body: { texto: t } }),
    onSuccess: () => {
      setTexto('');
      void qc.invalidateQueries({ queryKey: chave });
    },
    onError: (e) => avisar(mensagemDaApi(e), 'erro'),
  });

  const apagar = useMutation({
    mutationFn: (id: string) =>
      api(`/explorar/decks/${deckId}/comentarios/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chave }),
    onError: (e) => avisar(mensagemDaApi(e), 'erro'),
  });

  return (
    <section className="bg-panel border-panel-border mt-6 rounded-xl border p-4 sm:p-5">
      <h2 className="text-text mb-3 flex items-center gap-2 font-bold">
        <MessageSquare className="text-primary h-5 w-5" /> Comentários
        {data && data.length > 0 && (
          <span className="text-text-faint text-sm font-normal">({data.length})</span>
        )}
      </h2>

      {isPending ? (
        <p className="text-text-muted flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </p>
      ) : isError ? (
        <p className="text-danger text-sm">{mensagemDaApi(error)}</p>
      ) : data.length === 0 ? (
        <p className="text-text-muted text-sm">Ninguém comentou ainda.</p>
      ) : (
        <ul className="mb-4 space-y-3">
          {data.map((c) => (
            <li key={c.id} className="group flex gap-3">
              <div className="bg-primary/20 text-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                {c.autor.nome.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-text-faint text-xs">
                  <span className={`font-semibold ${c.meu ? 'text-primary' : 'text-text'}`}>
                    {c.autor.nome}
                  </span>{' '}
                  · {QUANDO.format(new Date(c.em))}
                </p>
                <p className="text-text whitespace-pre-line break-words text-sm">{c.texto}</p>
              </div>
              {c.podeApagar && (
                <button
                  onClick={() => apagar.mutate(c.id)}
                  disabled={apagar.isPending}
                  className="text-text-faint hover:text-danger shrink-0 self-start p-1 transition-opacity sm:opacity-0 sm:focus:opacity-100 sm:group-hover:opacity-100"
                  aria-label={`Apagar o comentário de ${c.autor.nome}`}
                  title="Apagar"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const t = texto.trim();
          if (t && !comentar.isPending) comentar.mutate(t);
        }}
      >
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value.slice(0, MAX))}
          rows={2}
          maxLength={MAX}
          placeholder="Comente o deck…"
          aria-label="Seu comentário"
          className="bg-table-deep border-panel-border text-text focus:border-primary min-w-0 flex-1 resize-y rounded-md border px-3 py-2 text-sm focus:outline-none"
        />
        <button
          type="submit"
          disabled={!texto.trim() || comentar.isPending}
          className="bg-primary hover:bg-primary-hover flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {comentar.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Enviar
        </button>
      </form>
      <p className="text-text-faint mt-1 text-right text-[11px]">
        {texto.length}/{MAX}
      </p>
    </section>
  );
}
