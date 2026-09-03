'use client';

/**
 * CardSearch — busca de cartas do deckbuilder.
 *
 * ─── O QUE MUDOU ───────────────────────────────────────────────────────────
 *
 *  1. NENHUM RESULTADO ERA GUARDADO. Cada `performSearch` era um `fetch` cru
 *     jogado em `useState`. Apagar uma letra e digitar de novo — o gesto mais
 *     comum de quem está procurando uma carta — repetia a mesma requisição do
 *     zero. O servidor já cacheava a busca por 10 minutos (`CardsService`), e
 *     o cliente jogava esse ganho fora pedindo de novo. Com react-query, uma
 *     consulta já feita volta do cache sem tocar na rede.
 *
 *  2. A LISTA PISCAVA VAZIA a cada tecla: `setResults([])` no caminho de erro e
 *     um estado de "buscando" que apagava o que estava na tela. `placeholderData`
 *     mantém o resultado anterior visível enquanto o novo chega — a lista
 *     ATUALIZA em vez de sumir e voltar.
 *
 *  3. O DEBOUNCE ERA DE 500 ms E O MÍNIMO ERA 3 LETRAS. Meio segundo depois da
 *     última tecla é tempo suficiente para o usuário concluir que nada
 *     aconteceu. A API aceita 2 caracteres; o mínimo de 3 recusava buscas
 *     válidas ("Ox", "Sol" já passava mas "Ur" não).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Loader2, AlertCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api, mensagemDaApi } from '@/lib/fetcher';
import { cardImageUrl } from '../canvas/textureCache';

interface CardSearchProps {
  onAddCard: (scryfallId: string, quantity: number) => Promise<void>;
}

interface CartaDaBusca {
  id: string;
  name: string;
  type_line?: string;
  set: string;
}

/** Mínimo aceito pela API. Ver `CardsController.search`. */
const MIN_LETRAS = 2;
const DEBOUNCE_MS = 300;
const MAX_RESULTADOS = 20;

export function CardSearch({ onAddCard }: CardSearchProps) {
  const [texto, setTexto] = useState('');
  const [termo, setTermo] = useState('');
  const [adicionando, setAdicionando] = useState<string | null>(null);
  const [quantidades, setQuantidades] = useState<Record<string, number>>({});

  // O debounce só decide QUANDO o termo muda; o cache decide se isso vira
  // requisição. Um termo já buscado responde do cache, sem rede.
  useEffect(() => {
    const t = setTimeout(() => setTermo(texto.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [texto]);

  const habilitada = termo.length >= MIN_LETRAS;

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ['cards', 'search', termo],
    queryFn: ({ signal }) =>
      // Espelho do backend, não `api.scryfall.com`: numa rede que filtra o
      // domínio da Scryfall, a busca do navegador nem chega a sair.
      api<{ data?: CartaDaBusca[] }>(`/cards/search?q=${encodeURIComponent(termo)}&unique=prints`, {
        signal,
        publica: true,
      }),
    enabled: habilitada,
    // Impressão de carta não muda: uma hora é conservador.
    staleTime: 60 * 60_000,
    // Mantém a lista anterior na tela enquanto a nova chega.
    placeholderData: (anterior) => anterior,
  });

  const resultados = useMemo(() => (data?.data ?? []).slice(0, MAX_RESULTADOS), [data]);

  const adicionar = async (scryfallId: string) => {
    setAdicionando(scryfallId);
    try {
      await onAddCard(scryfallId, quantidades[scryfallId] || 1);
    } finally {
      setAdicionando(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="relative mb-4">
        <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
          <Search className="text-text-muted h-4 w-4" />
        </div>
        <input
          type="text"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar carta (ex: 'Sol Ring', 't:goblin')..."
          className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border py-2 pl-10 pr-9 text-sm transition-colors focus:outline-none"
        />
        {isFetching && habilitada && (
          <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
            <Loader2 className="text-primary h-4 w-4 animate-spin" />
          </div>
        )}
      </div>

      <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto">
        {!habilitada && (
          <p className="text-text-muted mt-8 text-center text-sm">
            Digite pelo menos {MIN_LETRAS} letras para buscar na Scryfall.
          </p>
        )}

        {habilitada && isError && (
          <div className="border-danger/30 bg-danger/10 text-danger flex items-start gap-2 rounded-md border p-3 text-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{mensagemDaApi(error)}</span>
          </div>
        )}

        {habilitada && !isError && resultados.length === 0 && !isFetching && (
          <p className="text-text-muted mt-8 text-center text-sm">Nenhuma carta encontrada.</p>
        )}

        {resultados.map((carta) => (
          <div
            key={carta.id}
            className="bg-table-deep border-panel-border hover:border-primary group flex items-center gap-3 rounded-lg border p-2 transition-colors"
          >
            {/* A URL vem do nosso proxy, não do `image_uris` da resposta:
                aquele campo aponta para `cards.scryfall.io`, que é justamente
                o domínio que o navegador pode não alcançar. */}
            <img
              src={cardImageUrl(carta.id, 'small')}
              alt={carta.name}
              // Dimensão explícita: sem ela, cada imagem que chegava empurrava
              // a lista para baixo e o item sob o cursor trocava de lugar.
              className="aspect-[5/7] w-12 shrink-0 rounded bg-black/20 object-cover shadow"
              loading="lazy"
              decoding="async"
            />

            <div className="min-w-0 flex-1">
              <p className="text-text truncate text-sm font-semibold" title={carta.name}>
                {carta.name}
              </p>
              <p className="text-text-faint truncate text-xs">{carta.type_line}</p>
              <p className="text-primary mt-0.5 text-[10px]">[{carta.set?.toUpperCase()}]</p>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1">
              <input
                type="number"
                min={1}
                max={99}
                value={quantidades[carta.id] || 1}
                onChange={(e) =>
                  setQuantidades((antes) => ({
                    ...antes,
                    // `Math.min` no teto: o campo aceitava qualquer número
                    // digitado e o servidor recusava depois, com a carta já
                    // "adicionada" na tela.
                    [carta.id]: Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1)),
                  }))
                }
                aria-label={`Quantidade de ${carta.name}`}
                className="bg-panel border-panel-border text-text focus:border-primary w-12 rounded border py-1 text-center text-xs focus:outline-none"
              />
              <button
                onClick={() => void adicionar(carta.id)}
                disabled={adicionando === carta.id}
                className="bg-primary/10 text-primary hover:bg-primary flex w-full items-center justify-center rounded p-1.5 transition-colors hover:text-white disabled:opacity-50"
                title="Adicionar ao Deck"
                aria-label={`Adicionar ${carta.name} ao deck`}
              >
                {adicionando === carta.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
