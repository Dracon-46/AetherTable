'use client';

import React, { useState, useEffect } from 'react';
import { Loader2, X, AlertCircle } from 'lucide-react';
import { API_URL } from '@/lib/api';

interface PrintingPickerProps {
  card: any; // The current deckCard being edited
  deckId: string;
  accessToken: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function PrintingPicker({ card, deckId, accessToken, onClose, onSuccess }: PrintingPickerProps) {
  const [printings, setPrintings] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPrintings() {
      // First, we need the oracle_id to find all printings. 
      // If we don't have it directly, we fetch the card details from scryfall first.
      try {
        let oracleId = card.oracleId;
        
        if (!oracleId) {
          const cardRes = await fetch(`https://api.scryfall.com/cards/${card.scryfallId}`);
          if (cardRes.ok) {
            const cardData = await cardRes.json();
            oracleId = cardData.oracle_id;
          }
        }

        if (!oracleId) {
          throw new Error('Não foi possível determinar o Oracle ID da carta.');
        }

        // Fetch all printings
        const res = await fetch(`https://api.scryfall.com/cards/search?order=released&q=oracleid%3A${oracleId}&unique=prints`);
        if (res.ok) {
          const data = await res.json();
          setPrintings(data.data || []);
        } else {
          throw new Error('Falha ao buscar impressões na Scryfall.');
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    }

    fetchPrintings();
  }, [card]);

  async function handleSelect(scryfallId: string) {
    if (scryfallId === card.scryfallId) return; // Same printing
    
    setSavingId(scryfallId);
    try {
      const res = await fetch(`${API_URL}/decks/${deckId}/cards/${card.id}/printing`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}` 
        },
        body: JSON.stringify({ scryfallId }),
      });

      if (res.ok) {
        onSuccess();
      } else {
        alert('Falha ao atualizar impressão.');
        setSavingId(null);
      }
    } catch (err) {
      console.error(err);
      alert('Falha na conexão ao tentar atualizar impressão.');
      setSavingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-panel border border-panel-border rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-panel-border bg-table-deep/50">
          <h2 className="font-bold text-text text-lg">Selecionar Impressão</h2>
          <button 
            onClick={onClose}
            className="p-1 hover:bg-danger/20 hover:text-danger rounded transition-colors text-text-muted"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-table-deep">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-48 text-primary">
              <Loader2 className="w-8 h-8 animate-spin mb-2" />
              <span className="text-sm">Buscando edições...</span>
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 justify-center h-48 text-danger">
              <AlertCircle className="w-6 h-6" />
              <span>{error}</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {printings.map((printing) => {
                const imageUri = printing.image_uris?.normal || printing.card_faces?.[0]?.image_uris?.normal;
                const isCurrent = printing.id === card.scryfallId;
                
                return (
                  <div 
                    key={printing.id} 
                    onClick={() => handleSelect(printing.id)}
                    className={`relative rounded-lg overflow-hidden cursor-pointer transition-all border-2 
                      ${isCurrent ? 'border-primary ring-2 ring-primary/50' : 'border-transparent hover:border-text-muted'}
                      ${savingId === printing.id ? 'opacity-50 pointer-events-none' : ''}
                    `}
                  >
                    <div className="aspect-[63/88] bg-[#1a1a1a]">
                      {imageUri ? (
                        <img src={imageUri} alt={printing.name} className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-text-muted p-2 text-center">
                          Sem Imagem
                        </div>
                      )}
                    </div>

                    <div className="absolute bottom-0 inset-x-0 bg-black/80 backdrop-blur-sm p-1.5 flex justify-between items-center text-[10px]">
                      <span className="text-white font-bold truncate pr-1" title={printing.set_name}>
                        {printing.set.toUpperCase()}
                      </span>
                      <span className="text-text-muted">#{printing.collector_number}</span>
                    </div>

                    {savingId === printing.id && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-primary animate-spin" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
