'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '../../../store/auth.store';
import { Plus, Trash2, Library, Edit3 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/lib/api';
import { ConfirmDialog, ToastHost, useToast } from '@/components/Toast';

export default function DecksPage() {
  const router = useRouter();
  const { accessToken, logout } = useAuthStore();
  const [decks, setDecks] = useState<any[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [newDeckFormat, setNewDeckFormat] = useState('commander');
  /** Substitui `window.confirm`: destruir um deck merece um diálogo do app. */
  const [deckParaDestruir, setDeckParaDestruir] = useState<string | null>(null);
  const avisar = useToast((s) => s.mostrar);

  useEffect(() => {
    fetchDecks();
  }, [accessToken]);

  async function fetchDecks() {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API_URL}/decks`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        setDecks(await res.json());
      } else if (res.status === 401) {
        logout();
        router.push('/');
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleCreateDeck(e: React.FormEvent) {
    e.preventDefault();
    if (!newDeckName.trim()) return;
    setIsCreating(true);
    try {
      const res = await fetch(`${API_URL}/decks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ name: newDeckName, formatId: newDeckFormat }),
      });
      if (res.ok) {
        const createdDeck = await res.json();
        setNewDeckName('');
        router.push(`/dashboard/decks/${createdDeck.id}`);
      } else if (res.status === 401) {
        logout();
        router.push('/');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDeleteDeck(id: string) {
    try {
      const res = await fetch(`${API_URL}/decks/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        await fetchDecks();
        avisar('Grimório destruído.', 'sucesso');
      } else {
        avisar('Não foi possível destruir o grimório.', 'erro');
      }
    } catch (err) {
      console.error(err);
      avisar('Falha de conexão ao destruir o grimório.', 'erro');
    } finally {
      setDeckParaDestruir(null);
    }
  }

  return (
    <>
      <div className="mx-auto max-w-6xl animate-[fadeIn_0.3s_ease-out]">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-text mb-2 flex items-center gap-3 text-3xl font-bold">
              <Library className="text-primary h-8 w-8" />
              Seu Grimório
            </h1>
            <p className="text-text-muted">Forje, organize e prepare seus decks para a batalha.</p>
          </div>
        </header>

        {/* Area de Criacao Rápida */}
        <section className="border-panel-border bg-panel mb-10 rounded-xl border p-4 shadow-lg sm:p-6">
          <h2 className="text-text mb-4 text-lg font-semibold">Forjar Novo Deck</h2>
          <form onSubmit={handleCreateDeck} className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={newDeckName}
              onChange={(e) => setNewDeckName(e.target.value)}
              disabled={isCreating}
              required
              placeholder="Ex: Mono Blue Control"
              className="border-panel-border bg-table-deep text-text focus:border-primary min-w-0 flex-1 rounded-md border px-4 py-2 transition-colors focus:outline-none"
            />
            <select
              value={newDeckFormat}
              onChange={(e) => setNewDeckFormat(e.target.value)}
              disabled={isCreating}
              className="bg-table-deep border-panel-border text-text focus:border-primary rounded-md border px-4 py-2 transition-colors focus:outline-none"
            >
              <option value="commander">Commander</option>
              <option value="standard">Standard</option>
              <option value="pauper">Pauper</option>
              <option value="modern">Modern</option>
              <option value="legacy">Legacy</option>
              <option value="vintage">Vintage</option>
              <option value="timeless">Timeless</option>
            </select>
            <button
              type="submit"
              disabled={isCreating}
              className="bg-primary hover:bg-primary-hover flex shrink-0 items-center justify-center gap-2 rounded-md px-6 py-2 font-medium text-white transition-all active:scale-95"
            >
              <Plus className="h-4 w-4" />
              {isCreating ? 'Forjando...' : 'Criar Deck'}
            </button>
          </form>
        </section>

        {/* Grid de Decks */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {decks.map((deck) => (
            <div
              key={deck.id}
              className="bg-panel border-panel-border hover:border-primary group flex flex-col rounded-xl border p-5 shadow-md transition-all"
            >
              <div className="mb-4 flex items-start justify-between">
                <h3 className="text-text truncate pr-4 text-xl font-bold">{deck.name}</h3>
                <span className="bg-table-deep text-text-muted rounded px-2 py-1 text-xs font-semibold">
                  {deck.cardCount} CARTAS
                </span>
              </div>

              <p className="text-text-muted mb-6 flex-1 text-sm">
                Atualizado em {new Date(deck.updatedAt).toLocaleDateString()}
              </p>

              <div className="mt-auto flex flex-wrap items-center gap-2">
                <button
                  onClick={() => router.push(`/dashboard/decks/${deck.id}?mode=view`)}
                  className="border-panel-border bg-table-deep text-text hover:bg-panel-border flex min-w-[7rem] flex-1 items-center justify-center gap-2 rounded border px-3 py-2 font-medium transition-colors hover:text-white"
                >
                  <Library className="h-4 w-4" />
                  Visualizar
                </button>
                <button
                  onClick={() => router.push(`/dashboard/decks/${deck.id}`)}
                  className="border-primary/30 bg-table-deep text-primary hover:bg-primary flex min-w-[7rem] flex-1 items-center justify-center gap-2 rounded border px-3 py-2 font-medium transition-colors hover:text-white"
                >
                  <Edit3 className="h-4 w-4" />
                  Editar
                </button>
                <button
                  onClick={() => setDeckParaDestruir(deck.id)}
                  className="bg-table-deep text-text-muted hover:bg-danger border-panel-border hover:border-danger rounded border p-2 transition-colors hover:text-white"
                  title="Destruir Deck"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}

          {decks.length === 0 && (
            <div className="border-panel-border col-span-full rounded-xl border border-dashed py-12 text-center">
              <Library className="text-text-muted mx-auto mb-3 h-12 w-12 opacity-50" />
              <p className="text-text-muted">
                Você ainda não possui nenhum deck. Forje um acima para começar.
              </p>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        aberto={deckParaDestruir !== null}
        titulo="Destruir este grimório?"
        descricao="O deck e todas as cartas dele somem. Não dá para desfazer."
        rotuloConfirmar="Destruir"
        perigo
        onConfirmar={() => deckParaDestruir && handleDeleteDeck(deckParaDestruir)}
        onCancelar={() => setDeckParaDestruir(null)}
      />
      <ToastHost />
    </>
  );
}
