'use client';

import React, { useState, useEffect } from 'react';
import { Search, Plus, Loader2, X, Ghost } from 'lucide-react';
import { useUIStore } from '../store/game.store';
import { intents } from '../net/intents';
import type { Room } from 'colyseus.js';
import type { RoomState } from '../net/schema/RoomState';
import { API_URL } from '@/lib/api';
import { cardImageUrl } from '../canvas/textureCache';

interface TokenPickerProps {
  room: Room<RoomState>;
}

/**
 * Fichas predefinidas (DOC-036 item 79).
 *
 * Tesouro, Pista, Comida, Sangue e Mapa aparecem em praticamente toda partida
 * de Commander moderna. Obrigar o jogador a digitar "treasure" e esperar a
 * busca da Scryfall a cada tesouro gerado é atrito puro: são as fichas mais
 * criadas do formato.
 *
 * A busca usa a sintaxe da Scryfall e devolve a impressão mais recente.
 */
const PRESETS: Array<{ rotulo: string; query: string; emoji: string }> = [
  { rotulo: 'Tesouro', query: 't:token t:treasure', emoji: '💰' },
  { rotulo: 'Pista', query: 't:token t:clue', emoji: '🔍' },
  { rotulo: 'Comida', query: 't:token t:food', emoji: '🍗' },
  { rotulo: 'Sangue', query: 't:token t:blood', emoji: '🩸' },
  { rotulo: 'Mapa', query: 't:token t:map', emoji: '🗺️' },
  { rotulo: 'Pedra de Poder', query: 't:token t:powerstone', emoji: '💎' },
  { rotulo: 'Soldado 1/1', query: 't:token t:soldier pow=1 tou=1', emoji: '🗡️' },
  { rotulo: 'Zumbi 2/2', query: 't:token t:zombie pow=2 tou=2', emoji: '🧟' },
  { rotulo: 'Saproling 1/1', query: 't:token t:saproling', emoji: '🌱' },
  { rotulo: 'Dragão 5/5', query: 't:token t:dragon pow=5 tou=5', emoji: '🐉' },
];

export function TokenPicker({ room }: TokenPickerProps) {
  const isActive = useUIStore((s) => s.activeModals.tokens);
  const toggleModal = useUIStore((s) => s.toggleModal);
  const cameraPos = useUIStore((s) => s.cameraPosition);
  const zoomLevel = useUIStore((s) => s.zoomLevel);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [presetEmCurso, setPresetEmCurso] = useState<string | null>(null);

  // Busca inicial genérica de tokens comuns
  useEffect(() => {
    if (isActive && results.length === 0 && query === '') {
      performSearch('t:token');
    }
  }, [isActive]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (query.trim().length >= 2) {
        performSearch(`t:token ${query}`);
      } else if (query.trim() === '') {
        performSearch('t:token');
      }
    }, 500);

    return () => clearTimeout(handler);
  }, [query]);

  const performSearch = async (q: string) => {
    setIsSearching(true);
    try {
      // Espelho do backend: `api.scryfall.com` pode estar bloqueado na rede.
      const res = await fetch(
        `${API_URL}/cards/search?q=${encodeURIComponent(q)}&order=cmc&dir=asc`,
      );
      if (res.ok) {
        const data = await res.json();
        setResults(data.data?.slice(0, 30) || []);
      } else {
        setResults([]);
      }
    } catch (e) {
      console.error(e);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  /** Busca a impressão mais recente do preset e cria a ficha direto. */
  const criarPreset = async (query: string) => {
    setPresetEmCurso(query);
    try {
      const res = await fetch(
        `${API_URL}/cards/search?q=${encodeURIComponent(query)}&order=released&dir=desc`,
      );
      if (!res.ok) throw new Error(`API de cartas respondeu ${res.status}`);
      const data = await res.json();
      const carta = data.data?.[0];
      if (carta) handleCreate(carta);
    } catch (e) {
      // Falha de rede não pode travar o painel: o jogador ainda pode buscar
      // manualmente, e o log do console diz o que aconteceu.
      console.error('[tokens] Falha ao buscar ficha predefinida:', e);
    } finally {
      setPresetEmCurso(null);
    }
  };

  const handleCreate = (card: any) => {
    setCreatingId(card.id);

    // Centro da MESA LÓGICA (1920x1080), não da janela: usar pixels de tela
    // fazia o token nascer fora do campo em qualquer resolução diferente.
    const centerX = 1920 / 2 - cameraPos.x / zoomLevel;
    const centerY = 1080 / 2 - cameraPos.y / zoomLevel;

    intents.createToken(room, {
      scryfallId: card.id,
      name: card.name,
      power: card.power,
      toughness: card.toughness,
      amount: 1,
      x: centerX,
      y: centerY,
    });

    setTimeout(() => {
      setCreatingId(null);
      toggleModal('tokens');
    }, 300);
  };

  if (!isActive) return null;

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) toggleModal('tokens');
      }}
    >
      <div className="border-panel-border bg-panel/95 flex max-h-[85dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border shadow-2xl backdrop-blur">
        <div className="border-panel-border bg-table-deep/50 flex items-center justify-between border-b p-4">
          <h3 className="text-text flex items-center gap-2 font-bold">
            <Ghost className="text-primary h-5 w-5" />
            Gerador de Tokens
          </h3>
          <button
            onClick={() => toggleModal('tokens')}
            className="hover:bg-danger/20 hover:text-danger text-text-muted rounded p-1 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Atalhos: um clique cria a ficha, sem passar pela busca. */}
        <div className="border-panel-border border-b px-4 pt-3">
          <span className="text-text-muted mb-2 block text-[10px] font-bold uppercase tracking-wider">
            Fichas frequentes
          </span>
          <div className="flex flex-wrap gap-1.5 pb-3">
            {PRESETS.map((p) => (
              <button
                key={p.rotulo}
                onClick={() => criarPreset(p.query)}
                disabled={presetEmCurso === p.query}
                className="border-panel-border bg-table-deep text-text hover:border-primary hover:text-primary flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors disabled:opacity-50"
              >
                <span aria-hidden="true">{p.emoji}</span>
                {p.rotulo}
                {presetEmCurso === p.query && <Loader2 className="h-3 w-3 animate-spin" />}
              </button>
            ))}
          </div>
        </div>

        <div className="border-panel-border border-b p-4">
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
              <Search className="text-text-muted h-4 w-4" />
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar token por nome ou tipo (ex: 'Zombie', 't:goblin')..."
              className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border py-2 pl-10 pr-4 text-sm transition-colors focus:outline-none"
              autoFocus
            />
            {isSearching && (
              <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                <Loader2 className="text-primary h-4 w-4 animate-spin" />
              </div>
            )}
          </div>
        </div>

        <div className="custom-scrollbar flex-1 overflow-y-auto p-4">
          {results.length === 0 && !isSearching ? (
            <div className="text-text-muted flex flex-col items-center py-8 text-center">
              <Ghost className="mb-2 h-10 w-10 opacity-20" />
              Nenhum token encontrado.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {results.map((card) => {
                // Do nosso proxy, não do `image_uris` da resposta.
                const imageUri = card.id ? cardImageUrl(card.id, 'normal') : null;
                return (
                  <div
                    key={card.id}
                    className="group relative cursor-pointer"
                    onClick={() => handleCreate(card)}
                  >
                    <div className="group-hover:border-primary bg-table-deep flex aspect-[63/88] flex-col items-center justify-center overflow-hidden rounded-lg border-2 border-transparent transition-colors">
                      {imageUri ? (
                        <img
                          src={imageUri}
                          alt={card.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="p-2 text-center">
                          <span className="text-xs font-bold">{card.name}</span>
                          <span className="text-text-muted block text-[10px]">
                            {card.type_line}
                          </span>
                        </div>
                      )}

                      <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                        {creatingId === card.id ? (
                          <Loader2 className="h-8 w-8 animate-spin text-white" />
                        ) : (
                          <div className="flex flex-col items-center text-white">
                            <Plus className="mb-1 h-8 w-8" />
                            <span className="bg-primary rounded px-2 py-1 text-xs font-bold">
                              Criar Token
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
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
