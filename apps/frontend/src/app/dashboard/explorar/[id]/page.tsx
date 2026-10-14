'use client';

/**
 * Um deck público, só para ler — e copiar, curtir ou exportar.
 *
 * Reaproveita as peças do editor (agrupamento, vistas, painel de legalidade e
 * exportar) com as ações de carta desligadas: quem vê o deck de outra pessoa
 * não mexe nele. Para jogar com ele, "Copiar para os meus decks" cria uma
 * cópia privada que é sua.
 */

import { use, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Copy, Heart, Loader2 } from 'lucide-react';
import { acharFormato } from '@aethertable/shared-types';
import { ToastHost } from '@/components/Toast';
import { mensagemDaApi } from '@/lib/fetcher';
import { agruparCartas, calcularBracket, precoTotal } from '../../../../deckbuilder/agrupar';
import { LinhaCompacta, type AcoesDeCarta } from '../../../../deckbuilder/VistasDoDeck';
import { PainelDeLegalidade } from '../../../../deckbuilder/PainelDeLegalidade';
import { MenuExportar } from '../../../../deckbuilder/AcoesDoDeck';
import { ComentariosDoDeck } from '../../../../deckbuilder/ComentariosDoDeck';
import { useCopiarPublico, useCurtir, useDeckPublico } from '../../../../deckbuilder/useExplorar';
import type { DeckCarta } from '../../../../deckbuilder/useDecks';

/** Nenhuma ação de carta: é o deck de outra pessoa. */
const SO_LEITURA: AcoesDeCarta = {
  onMudarQuantidade: null,
  onRemover: null,
  onAlternarComandante: null,
  onTrocarArte: null,
  onAlternarReserva: null,
};

const SEM_CARTAS: DeckCarta[] = [];

export default function DeckPublicoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: deck, isPending, isError, error } = useDeckPublico(id);
  const curtir = useCurtir();
  const copiar = useCopiarPublico();

  const cartas = deck?.cards ?? SEM_CARTAS;
  const grupos = useMemo(() => agruparCartas(cartas, 'tipo'), [cartas]);
  const bracket = useMemo(() => calcularBracket(cartas, deck?.formatId), [cartas, deck?.formatId]);

  if (isPending) {
    return (
      <div className="text-text-muted mx-auto flex max-w-7xl items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Abrindo o deck…
      </div>
    );
  }
  if (isError || !deck) {
    return (
      <div className="mx-auto max-w-7xl">
        <Link
          href="/dashboard/explorar"
          className="text-text-muted hover:text-primary mb-4 flex items-center gap-2 text-sm"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar ao Explorar
        </Link>
        <p className="text-danger text-sm">{mensagemDaApi(error)}</p>
      </div>
    );
  }

  return (
    <>
      <div className="mx-auto max-w-7xl animate-[fadeIn_0.3s_ease-out]">
        <Link
          href="/dashboard/explorar"
          className="text-text-muted hover:text-primary mb-4 flex items-center gap-2 text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar ao Explorar
        </Link>

        <header className="mb-5">
          <h1 className="text-text text-2xl font-bold sm:text-3xl">{deck.name}</h1>
          <p className="text-text-muted mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span>por {deck.dono}</span>
            <span>· {acharFormato(deck.formatId).nome}</span>
            <span>· {deck.cardCount} cartas</span>
            <span>· US$ {precoTotal(cartas)}</span>
            {bracket && (
              <span className={`font-bold ${bracket.color}`} title={bracket.dica}>
                · {bracket.label}
              </span>
            )}
          </p>
          {deck.description && (
            <p className="text-text-muted mt-3 max-w-3xl whitespace-pre-line text-sm leading-relaxed">
              {deck.description}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => curtir.mutate({ deckId: deck.id, curtir: !deck.curtido })}
              aria-pressed={deck.curtido}
              className="border-panel-border bg-panel text-text hover:border-danger flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors"
            >
              <Heart className={`h-4 w-4 ${deck.curtido ? 'fill-danger text-danger' : ''}`} />
              {deck.curtido ? 'Curtido' : 'Curtir'} · {deck.likeCount}
            </button>
            <button
              onClick={() => copiar.mutate(deck.id)}
              disabled={copiar.isPending}
              className="bg-primary hover:bg-primary-hover flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-bold text-white transition-colors disabled:opacity-60"
            >
              {copiar.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              Copiar para os meus decks
            </button>
            <MenuExportar cartas={cartas} nome={deck.name} />
          </div>
        </header>

        <PainelDeLegalidade cartas={cartas} formatId={deck.formatId} cardCount={deck.cardCount} />

        <div className="space-y-6">
          {grupos.map((grupo) => (
            <section key={grupo.nome}>
              <h2 className="text-text border-panel-border mb-3 flex items-center justify-between border-b pb-2 text-sm font-bold sm:text-base">
                <span>{grupo.nome}</span>
                <span className="text-text-muted bg-table-deep rounded px-2 py-0.5 text-xs font-medium">
                  {grupo.total}
                </span>
              </h2>
              <div className="columns-1 gap-4 sm:columns-2 xl:columns-3">
                {grupo.cartas.map((c) => (
                  <LinhaCompacta key={c.id} carta={c} acoes={SO_LEITURA} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <ComentariosDoDeck deckId={deck.id} />
      </div>
      <ToastHost />
    </>
  );
}
