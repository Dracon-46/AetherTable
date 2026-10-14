'use client';

/**
 * VitrineDeDecksIniciais.tsx — "comece com um deck pronto".
 *
 * Montar um deck de Commander do zero (cem cartas) é a barreira de entrada mais
 * alta do produto (DOC-094 II.9). A vitrine oferece os pré-montados oficiais:
 * um clique copia a lista para a conta e abre o deck — dali ele é da pessoa,
 * para jogar como está ou mexer à vontade.
 *
 * Aberta para quem ainda não tem deck nenhum; recolhida, com um botão, para
 * quem já tem — a lista de decks da pessoa continua sendo o assunto da página.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Gift, Loader2 } from 'lucide-react';
import { cardImageUrl } from '@/canvas/textureCache';
import { useDecksIniciais, useUsarDeckInicial } from './useDecksIniciais';

const COR_DO_PIP: Record<string, { fundo: string; texto: string }> = {
  W: { fundo: '#F8F3D6', texto: '#3B3524' },
  U: { fundo: '#0E68AB', texto: '#FFFFFF' },
  B: { fundo: '#2B2622', texto: '#E7E1D7' },
  R: { fundo: '#D3202A', texto: '#FFFFFF' },
  G: { fundo: '#00733E', texto: '#FFFFFF' },
};

export function VitrineDeDecksIniciais({ abertaDeInicio }: { abertaDeInicio: boolean }) {
  const router = useRouter();
  const { data: iniciais, isPending } = useDecksIniciais();
  const usar = useUsarDeckInicial();
  const [aberta, setAberta] = useState(abertaDeInicio);
  const [usando, setUsando] = useState<string | null>(null);

  const escolher = async (codigo: string) => {
    setUsando(codigo);
    try {
      const deck = await usar.mutateAsync(codigo);
      router.push(`/dashboard/decks/${deck.id}`);
    } catch {
      // A mensagem já saiu pelo `onError` do hook; a vitrine só destrava.
      setUsando(null);
    }
  };

  if (!isPending && (!iniciais || iniciais.length === 0)) return null;

  return (
    <section className="border-panel-border bg-panel mb-6 rounded-xl border p-4 shadow-lg sm:mb-10 sm:p-6">
      <button
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span>
          <span className="text-text flex items-center gap-2 text-base font-semibold sm:text-lg">
            <Gift className="text-primary h-5 w-5" />
            Comece com um deck pronto
          </span>
          <span className="text-text-muted mt-0.5 block text-sm">
            Decks de Commander oficiais. Um clique copia a lista para os seus decks.
          </span>
        </span>
        <ChevronDown
          className={`text-text-muted h-5 w-5 shrink-0 transition-transform ${aberta ? 'rotate-180' : ''}`}
        />
      </button>

      {aberta && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {isPending
            ? [0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-table-deep border-panel-border h-40 animate-pulse rounded-lg border"
                />
              ))
            : iniciais!.map((d) => (
                <article
                  key={d.codigo}
                  className="bg-table-deep border-panel-border hover:border-primary group flex flex-col overflow-hidden rounded-lg border transition-colors"
                >
                  <div className="relative h-24 overflow-hidden">
                    {d.comandantes[0] && (
                      <img
                        src={cardImageUrl(d.comandantes[0], 'art_crop')}
                        alt=""
                        className="h-full w-full object-cover opacity-85 transition-opacity group-hover:opacity-100"
                        loading="lazy"
                      />
                    )}
                    <div className="from-table-deep absolute inset-0 bg-gradient-to-t to-transparent" />
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-3 pt-1">
                    <h3 className="text-text truncate text-sm font-bold">{d.nome}</h3>
                    <p className="text-text-muted truncate text-xs">
                      {d.nomesDosComandantes.join(' & ')}
                    </p>
                    <p className="text-text-faint flex items-center gap-1.5 text-[11px]">
                      <span className="flex gap-0.5">
                        {d.cores.map((c) => (
                          <span
                            key={c}
                            className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black"
                            style={{
                              background: COR_DO_PIP[c]?.fundo,
                              color: COR_DO_PIP[c]?.texto,
                            }}
                          >
                            {c}
                          </span>
                        ))}
                      </span>
                      {d.colecao} · {d.lancamento.slice(0, 4)}
                    </p>
                    <button
                      onClick={() => void escolher(d.codigo)}
                      disabled={usando !== null}
                      className="bg-primary hover:bg-primary-hover mt-2 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold text-white transition-colors disabled:opacity-50"
                    >
                      {usando === d.codigo && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Usar este deck
                    </button>
                  </div>
                </article>
              ))}
        </div>
      )}
    </section>
  );
}
