'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '../../../store/auth.store';
import { Plus, Trash2, Library, Edit3 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/lib/api';

export default function DecksPage() {
  const router = useRouter();
  const { accessToken } = useAuthStore();
  const [decks, setDecks] = useState<any[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');

  useEffect(() => {
    fetchDecks();
  }, [accessToken]);

  async function fetchDecks() {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API_URL}/decks`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) setDecks(await res.json());
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
          Authorization: `Bearer ${accessToken}` 
        },
        body: JSON.stringify({ name: newDeckName }),
      });
      if (res.ok) {
        setNewDeckName('');
        await fetchDecks();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDeleteDeck(id: string) {
    if(!confirm('Tem certeza que deseja DESTRUIR este grimório?')) return;
    try {
      const res = await fetch(`${API_URL}/decks/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) fetchDecks();
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="max-w-6xl mx-auto animate-[fadeIn_0.3s_ease-out]">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-text mb-2 flex items-center gap-3">
            <Library className="w-8 h-8 text-primary" />
            Seu Grimório
          </h1>
          <p className="text-text-muted">Forje, organize e prepare seus decks para a batalha.</p>
        </div>
      </header>

      {/* Area de Criacao Rápida */}
      <section className="mb-10 bg-panel border border-panel-border p-6 rounded-xl shadow-lg">
        <h2 className="text-lg font-semibold text-text mb-4">Forjar Novo Deck</h2>
        <form onSubmit={handleCreateDeck} className="flex gap-3">
          <input 
            type="text" 
            value={newDeckName}
            onChange={(e) => setNewDeckName(e.target.value)}
            disabled={isCreating}
            placeholder="Ex: Mono Blue Control"
            className="flex-1 bg-table-deep border border-panel-border rounded-md px-4 py-2 text-text focus:outline-none focus:border-primary transition-colors"
          />
          <button 
            type="submit" 
            disabled={isCreating}
            className="px-6 py-2 bg-primary text-white font-medium rounded-md hover:bg-primary-hover active:scale-95 transition-all flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {isCreating ? 'Forjando...' : 'Criar Deck'}
          </button>
        </form>
      </section>

      {/* Grid de Decks */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {decks.map(deck => (
          <div key={deck.id} className="bg-panel border border-panel-border rounded-xl p-5 hover:border-primary transition-all group flex flex-col shadow-md">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-xl font-bold text-text truncate pr-4">{deck.name}</h3>
              <span className="text-xs font-semibold bg-table-deep text-text-muted px-2 py-1 rounded">
                {deck.cardCount} CARTAS
              </span>
            </div>
            
            <p className="text-sm text-text-muted flex-1 mb-6">
              Atualizado em {new Date(deck.updatedAt).toLocaleDateString()}
            </p>

            <div className="flex items-center gap-2 mt-auto">
              <button 
                onClick={() => router.push(`/dashboard/decks/${deck.id}`)}
                className="flex-1 px-4 py-2 bg-table-deep text-primary hover:text-white hover:bg-primary border border-primary/30 rounded font-medium transition-colors flex justify-center items-center gap-2"
              >
                <Edit3 className="w-4 h-4" />
                Editar Lista
              </button>
              <button 
                onClick={() => handleDeleteDeck(deck.id)}
                className="p-2 bg-table-deep text-text-muted hover:text-white hover:bg-danger border border-panel-border hover:border-danger rounded transition-colors"
                title="Destruir Deck"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}

        {decks.length === 0 && (
          <div className="col-span-full py-12 text-center border border-dashed border-panel-border rounded-xl">
            <Library className="w-12 h-12 text-text-muted mx-auto mb-3 opacity-50" />
            <p className="text-text-muted">Você ainda não possui nenhum deck. Forje um acima para começar.</p>
          </div>
        )}
      </div>
    </div>
  );
}
