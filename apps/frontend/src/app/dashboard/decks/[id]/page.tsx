'use client';

import { useState, useEffect, use } from 'react';
import { useAuthStore } from '../../../../store/auth.store';
import { ArrowLeft, Save, AlertCircle, LibraryBig, Trash2, Edit2, X, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/lib/api';

export default function DeckBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  const { accessToken } = useAuthStore();
  
  const [deck, setDeck] = useState<any>(null);
  const [rawText, setRawText] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  // Estados de edição de nome
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');

  useEffect(() => {
    fetchDeck();
  }, [id, accessToken]);

  async function fetchDeck() {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API_URL}/decks/${id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDeck(data);
        setEditNameValue(data.name);
      } else {
        router.push('/dashboard/decks');
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!rawText.trim()) return;
    setIsImporting(true);
    setImportResult(null);

    try {
      const res = await fetch(`${API_URL}/decks/${id}/import`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}` 
        },
        body: JSON.stringify({ decklist: rawText }),
      });
      const data = await res.json();
      
      if (res.ok) {
        setImportResult({ success: true, count: data.imported, notFound: data.notFound || [] });
        setRawText('');
        fetchDeck();
      } else {
        setImportResult({ success: false, error: data.message });
      }
    } catch {
      setImportResult({ success: false, error: 'Falha na conexão com servidor' });
    } finally {
      setIsImporting(false);
    }
  }

  async function handleRenameDeck() {
    if (!editNameValue.trim() || editNameValue === deck.name) {
      setIsEditingName(false);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/decks/${id}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}` 
        },
        body: JSON.stringify({ name: editNameValue }),
      });
      if (res.ok) {
        setDeck({ ...deck, name: editNameValue });
        setIsEditingName(false);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleRemoveCard(cardId: string) {
    if (!confirm('Remover esta carta do grimório?')) return;
    try {
      const res = await fetch(`${API_URL}/decks/${id}/cards/${cardId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        fetchDeck(); // Recarrega para atualizar a contagem total
      }
    } catch (err) {
      console.error(err);
    }
  }

  if (!deck) {
    return <div className="text-text-muted animate-pulse">Invocando grimório...</div>;
  }

  return (
    <div className="max-w-6xl mx-auto animate-[fadeIn_0.3s_ease-out]">
      <header className="mb-8">
        <button 
          onClick={() => router.push('/dashboard/decks')}
          className="flex items-center gap-2 text-sm text-text-muted hover:text-primary transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar aos Decks
        </button>
        
        <div className="flex items-center gap-3 mb-2">
          <LibraryBig className="w-8 h-8 text-primary flex-shrink-0" />
          {isEditingName ? (
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <input 
                type="text" 
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
                autoFocus
                className="flex-1 bg-table-deep border border-primary rounded px-3 py-1 text-2xl font-bold text-text focus:outline-none"
              />
              <button onClick={handleRenameDeck} className="p-2 bg-success text-white rounded hover:brightness-110">
                <Check className="w-4 h-4" />
              </button>
              <button onClick={() => { setIsEditingName(false); setEditNameValue(deck.name); }} className="p-2 bg-danger text-white rounded hover:brightness-110">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <h1 className="text-3xl font-bold text-text flex items-center gap-3 group">
              {deck.name}
              <button onClick={() => setIsEditingName(true)} className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-primary transition-all">
                <Edit2 className="w-5 h-5" />
              </button>
            </h1>
          )}
        </div>

        <div className="flex gap-4 text-sm text-text-muted">
          <span className="bg-panel px-2 py-1 rounded border border-panel-border">{deck.cardCount} Cartas Totais</span>
          <span className="bg-panel px-2 py-1 rounded border border-panel-border">Criado em {new Date(deck.createdAt).toLocaleDateString()}</span>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Painel Esquerdo: Importação em Massa */}
        <div className="lg:col-span-1">
          <div className="bg-panel border border-panel-border p-6 rounded-xl shadow-lg h-full flex flex-col">
            <h2 className="text-lg font-semibold text-text mb-4">Importação Rápida</h2>
            <p className="text-sm text-text-muted mb-4">
              Cole sua lista para substituir o deck atual ou iniciar do zero.
            </p>
            <form onSubmit={handleImport} className="flex flex-col flex-1">
              <textarea 
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                disabled={isImporting}
                placeholder="Exemplo:\n1 Sol Ring\n1x Mana Crypt\n4 Lightning Bolt"
                className="w-full flex-1 min-h-[300px] bg-table-deep border border-panel-border rounded-md p-4 text-text focus:outline-none focus:border-primary transition-colors resize-none mb-4 font-mono text-sm"
              />
              <button 
                type="submit" 
                disabled={isImporting || !rawText.trim()}
                className="w-full py-3 bg-primary text-white font-medium rounded-md hover:bg-primary-hover active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="w-5 h-5" />
                {isImporting ? 'Lendo Runas na Scryfall...' : 'Substituir por Importação'}
              </button>
            </form>

            {importResult && (
              <div className={`mt-4 p-4 rounded-md border text-sm ${importResult.success ? 'bg-success/10 border-success/30 text-success' : 'bg-danger/10 border-danger/30 text-danger'}`}>
                {importResult.success ? (
                  <>
                    <p className="font-semibold mb-1">✓ {importResult.count} cartas únicas importadas.</p>
                    {importResult.notFound?.length > 0 && (
                      <div className="mt-2 text-warning">
                        <p className="font-semibold">⚠️ Não encontradas:</p>
                        <ul className="list-disc pl-4 text-xs mt-1 max-h-24 overflow-y-auto">
                          {importResult.notFound.map((name: string, i: number) => (
                            <li key={i}>{name}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5" />
                    <span>{importResult.error}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Painel Direito: Cartas */}
        <div className="lg:col-span-2">
          <div className="bg-panel border border-panel-border p-6 rounded-xl shadow-lg h-full flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-text">Lista de Cartas</h2>
              <span className="text-sm font-medium text-text-muted">{deck.cards?.length || 0} Cartas Únicas</span>
            </div>

            {/* F05 - Validação Não Bloqueante */}
            <div className="mb-4 space-y-2">
              {deck.cardCount !== 100 && deck.cardCount > 0 && (
                <div className="flex items-center gap-2 p-3 bg-warning/10 border border-warning/30 text-warning rounded-md text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>Seu deck possui <strong>{deck.cardCount}</strong> cartas. O formato Commander exige exatas 100.</span>
                </div>
              )}
              {deck.cards?.some((c: any) => c.isBanned) && (
                <div className="flex items-center gap-2 p-3 bg-danger/10 border border-danger/30 text-danger rounded-md text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>Atenção: Este grimório contém cartas <strong>Banidas</strong> no formato Commander.</span>
                </div>
              )}
            </div>

            {deck.cards?.length > 0 ? (
              <div className="space-y-2 flex-1 overflow-y-auto pr-2 min-h-[400px]">
                {deck.cards.map((card: any) => (
                  <div key={card.id} className="flex items-center justify-between bg-table-deep border border-panel-border p-3 rounded-lg hover:border-primary transition-colors group">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <span className="text-primary font-bold w-6 text-right">{card.quantity}x</span>
                      <div className="flex flex-col truncate">
                        <span className={`font-semibold text-sm truncate flex items-center gap-2 ${card.isBanned ? 'text-danger line-through' : 'text-text'}`}>
                          {card.name || 'Resolvendo...'}
                          {card.isBanned && <span className="text-[10px] bg-danger text-white px-1.5 py-0.5 rounded uppercase">Banida</span>}
                        </span>
                        <span className="text-xs text-text-faint truncate">{card.typeLine}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-[10px] font-mono text-primary px-2 py-1 bg-primary/10 rounded">
                        [{card.set}]
                      </span>
                      <button 
                        onClick={() => handleRemoveCard(card.id)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 bg-danger/10 text-danger hover:bg-danger hover:text-white rounded transition-all"
                        title="Remover Carta"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-panel-border rounded-lg text-text-muted text-center p-6 min-h-[300px]">
                <LibraryBig className="w-10 h-10 mb-3 opacity-50" />
                <p>Nenhuma carta neste grimório.</p>
                <p className="text-xs mt-1">Cole sua lista de texto no painel à esquerda para importar as cartas.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
