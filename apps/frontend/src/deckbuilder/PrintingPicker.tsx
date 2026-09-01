'use client';

import React, { useState, useEffect } from 'react';
import { useToast } from '../components/Toast';
import { Loader2, X, AlertCircle } from 'lucide-react';
import { API_URL } from '@/lib/api';

interface PrintingPickerProps {
  card: any; // The current deckCard being edited
  deckId: string;
  accessToken: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function PrintingPicker({
  card,
  deckId,
  accessToken,
  onClose,
  onSuccess,
}: PrintingPickerProps) {
  const avisar = useToast((s) => s.mostrar);
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
        const res = await fetch(
          `https://api.scryfall.com/cards/search?order=released&q=oracleid%3A${oracleId}&unique=prints`,
        );
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
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ scryfallId }),
      });

      if (res.ok) {
        onSuccess();
      } else {
        avisar('Não foi possível trocar a impressão.', 'erro');
        setSavingId(null);
      }
    } catch (err) {
      console.error(err);
      avisar('Falha de conexão ao trocar a impressão.', 'erro');
      setSavingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="bg-panel border-panel-border flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border shadow-2xl">
        {/* Header */}
        <div className="border-panel-border bg-table-deep/50 flex items-center justify-between border-b p-4">
          <h2 className="text-text text-lg font-bold">Selecionar Impressão</h2>
          <button
            onClick={onClose}
            className="hover:bg-danger/20 hover:text-danger text-text-muted rounded p-1 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="custom-scrollbar bg-table-deep flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="text-primary flex h-48 flex-col items-center justify-center">
              <Loader2 className="mb-2 h-8 w-8 animate-spin" />
              <span className="text-sm">Buscando edições...</span>
            </div>
          ) : error ? (
            <div className="text-danger flex h-48 items-center justify-center gap-2">
              <AlertCircle className="h-6 w-6" />
              <span>{error}</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {printings.map((printing) => {
                const imageUri =
                  printing.image_uris?.normal || printing.card_faces?.[0]?.image_uris?.normal;
                const isCurrent = printing.id === card.scryfallId;

                return (
                  <div
                    key={printing.id}
                    onClick={() => handleSelect(printing.id)}
                    className={`relative cursor-pointer overflow-hidden rounded-lg border-2 transition-all ${isCurrent ? 'border-primary ring-primary/50 ring-2' : 'hover:border-text-muted border-transparent'} ${savingId === printing.id ? 'pointer-events-none opacity-50' : ''} `}
                  >
                    <div className="aspect-[63/88] bg-[#1a1a1a]">
                      {imageUri ? (
                        <img
                          src={imageUri}
                          alt={printing.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="text-text-muted flex h-full w-full items-center justify-center p-2 text-center text-xs">
                          Sem Imagem
                        </div>
                      )}
                    </div>

                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/80 p-1.5 text-[10px] backdrop-blur-sm">
                      <span
                        className="truncate pr-1 font-bold text-white"
                        title={printing.set_name}
                      >
                        {printing.set.toUpperCase()}
                      </span>
                      <span className="text-text-muted">#{printing.collector_number}</span>
                    </div>

                    {savingId === printing.id && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <Loader2 className="text-primary h-8 w-8 animate-spin" />
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
