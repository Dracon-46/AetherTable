'use client';

/**
 * Explorar — decks públicos de outras contas.
 *
 * `Deck.isPublic` existia com índice e nenhuma tela o lia: marcar um deck como
 * público não mudava nada para ninguém (DOC-094 II.8). Aqui eles aparecem,
 * com o comandante, as cores, o dono e as curtidas — e "Curtidos" guarda os
 * que a pessoa marcou para voltar depois.
 *
 * A busca por NOME vai ao servidor (é um filtro do banco); a busca por
 * COMANDANTE é feita na página carregada, porque o banco guarda só o id da
 * impressão e o nome vem do catálogo do cliente.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Compass, Heart, Loader2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { FORMATOS_JOGAVEIS, acharFormato } from '@aethertable/shared-types';
import { cardImageUrl } from '@/canvas/textureCache';
import { useCardCatalog, useHidratarCartas } from '@/cards/catalog';
import { ToastHost } from '@/components/Toast';
import { mensagemDaApi } from '@/lib/fetcher';
import { useCurtir, useListaPublica, type DeckPublico } from '../../../deckbuilder/useExplorar';
import { useT } from '../../../i18n/i18n';

const COR_DO_PIP: Record<string, { fundo: string; texto: string }> = {
  W: { fundo: '#F8F3D6', texto: '#3B3524' },
  U: { fundo: '#0E68AB', texto: '#FFFFFF' },
  B: { fundo: '#2B2622', texto: '#E7E1D7' },
  R: { fundo: '#D3202A', texto: '#FFFFFF' },
  G: { fundo: '#00733E', texto: '#FFFFFF' },
};

export default function ExplorarPage() {
  const [aba, setAba] = useState<'todos' | 'curtidos'>('todos');
  const [ordem, setOrdem] = useState<'curtidos' | 'recentes'>('curtidos');
  const [formato, setFormato] = useState('');
  const [digitado, setDigitado] = useState('');
  const [busca, setBusca] = useState('');
  const [comandante, setComandante] = useState('');
  const [pagina, setPagina] = useState(1);
  const catalogo = useCardCatalog((s) => s.cartas);
  const curtir = useCurtir();
  const t = useT();

  // A busca por nome vai ao servidor: espera a pessoa parar de digitar.
  useEffect(() => {
    const t = setTimeout(() => {
      setBusca(digitado.trim());
      setPagina(1);
    }, 400);
    return () => clearTimeout(t);
  }, [digitado]);

  const { data, isPending, isError, error, isFetching } = useListaPublica({
    busca: busca || undefined,
    formato: formato || undefined,
    ordem,
    curtidos: aba === 'curtidos',
    pagina,
  });

  useHidratarCartas((data?.decks ?? []).flatMap((d) => [d.commanderId, d.partnerId]));

  const nomeDoComandante = (d: DeckPublico) =>
    [d.commanderId, d.partnerId]
      .map((id) => (id ? catalogo[id]?.name : undefined))
      .filter(Boolean)
      .join(' & ');

  const termo = comandante.trim().toLowerCase();
  const decks = (data?.decks ?? []).filter(
    (d) => !termo || nomeDoComandante(d).toLowerCase().includes(termo),
  );
  const paginas = data ? Math.max(1, Math.ceil(data.total / data.porPagina)) : 1;

  return (
    <>
      <div className="mx-auto max-w-7xl animate-[fadeIn_0.3s_ease-out]">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-text mb-2 flex items-center gap-3 text-2xl font-bold sm:text-3xl">
              <Compass className="text-primary h-7 w-7 sm:h-8 sm:w-8" />
              {t('Explorar')}
            </h1>
            <p className="text-text-muted text-sm sm:text-base">
              {t(
                'Decks que outros jogadores deixaram públicos. Curta para guardar, copie para jogar.',
              )}
            </p>
          </div>
          <div
            className="border-panel-border bg-panel flex rounded-lg border p-1"
            role="tablist"
            aria-label="Quais decks"
          >
            {(
              [
                ['todos', 'Todos os decks'],
                ['curtidos', 'Curtidos'],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                role="tab"
                aria-selected={aba === valor}
                onClick={() => {
                  setAba(valor);
                  setPagina(1);
                }}
                className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors sm:text-sm ${
                  aba === valor ? 'bg-primary text-white' : 'text-text-muted hover:text-text'
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>
        </header>

        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="text-text-muted pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <input
              type="search"
              value={digitado}
              onChange={(e) => setDigitado(e.target.value)}
              placeholder="Nome do deck…"
              aria-label="Buscar pelo nome do deck"
              className="border-panel-border bg-panel text-text focus:border-primary w-full rounded-md border py-2 pl-9 pr-3 text-sm focus:outline-none"
            />
          </div>
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="text-text-muted pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <input
              type="search"
              value={comandante}
              onChange={(e) => setComandante(e.target.value)}
              placeholder="Comandante (nesta página)…"
              aria-label="Filtrar pelo comandante"
              className="border-panel-border bg-panel text-text focus:border-primary w-full rounded-md border py-2 pl-9 pr-3 text-sm focus:outline-none"
            />
          </div>
          <select
            value={formato}
            onChange={(e) => {
              setFormato(e.target.value);
              setPagina(1);
            }}
            aria-label="Formato"
            className="border-panel-border bg-panel text-text focus:border-primary rounded-md border px-3 py-2 text-sm focus:outline-none"
          >
            <option value="">Qualquer formato</option>
            {FORMATOS_JOGAVEIS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
          <select
            value={ordem}
            onChange={(e) => {
              setOrdem(e.target.value as 'curtidos' | 'recentes');
              setPagina(1);
            }}
            aria-label="Ordem"
            className="border-panel-border bg-panel text-text focus:border-primary rounded-md border px-3 py-2 text-sm focus:outline-none"
          >
            <option value="curtidos">Mais curtidos</option>
            <option value="recentes">Mais recentes</option>
          </select>
          {isFetching && !isPending && <Loader2 className="text-primary h-4 w-4 animate-spin" />}
        </div>

        {isPending ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-panel border-panel-border h-56 animate-pulse rounded-xl border"
              />
            ))}
          </div>
        ) : isError ? (
          <p className="text-danger text-sm">{mensagemDaApi(error)}</p>
        ) : decks.length === 0 ? (
          <div className="border-panel-border rounded-xl border border-dashed py-14 text-center">
            <Compass className="text-text-muted mx-auto mb-3 h-12 w-12 opacity-50" />
            <p className="text-text-muted px-4">
              {aba === 'curtidos'
                ? 'Você ainda não curtiu nenhum deck.'
                : 'Nenhum deck público com esses filtros. Que tal deixar um dos seus público?'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {decks.map((d) => {
              const cmd = nomeDoComandante(d);
              return (
                <article
                  key={d.id}
                  className="bg-panel border-panel-border hover:border-primary group relative flex flex-col overflow-hidden rounded-xl border shadow-md transition-all"
                >
                  <Link href={`/dashboard/explorar/${d.id}`} className="flex flex-1 flex-col">
                    <div className="relative h-28 shrink-0 overflow-hidden">
                      {d.commanderId ? (
                        <img
                          src={cardImageUrl(d.commanderId, 'art_crop')}
                          alt=""
                          className="h-full w-full object-cover opacity-85 transition-opacity group-hover:opacity-100"
                          loading="lazy"
                        />
                      ) : (
                        <div className="bg-table-deep h-full w-full" />
                      )}
                      <div className="from-panel absolute inset-0 bg-gradient-to-t to-transparent" />
                    </div>
                    <div className="flex flex-1 flex-col gap-1 p-4 pt-1">
                      <h2 className="text-text truncate text-base font-bold">{d.name}</h2>
                      {cmd && <p className="text-text-muted truncate text-xs">{cmd}</p>}
                      <p className="text-text-faint mt-auto flex flex-wrap items-center gap-2 text-xs">
                        <span>{acharFormato(d.formatId).nome}</span>
                        <span className="flex gap-0.5">
                          {d.colorIdentity.map((c) => (
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
                        <span>· por {d.dono}</span>
                      </p>
                    </div>
                  </Link>
                  <button
                    onClick={() => curtir.mutate({ deckId: d.id, curtir: !d.curtido })}
                    aria-pressed={d.curtido}
                    aria-label={d.curtido ? 'Descurtir' : 'Curtir'}
                    className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-xs font-bold text-white backdrop-blur transition-colors hover:bg-black/75"
                  >
                    <Heart
                      className={`h-3.5 w-3.5 ${d.curtido ? 'fill-danger text-danger' : ''}`}
                    />
                    {d.likeCount}
                  </button>
                </article>
              );
            })}
          </div>
        )}

        {paginas > 1 && (
          <nav className="mt-8 flex items-center justify-center gap-2" aria-label="Páginas">
            <button
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={pagina === 1}
              className="border-panel-border bg-panel text-text rounded-md border p-2 disabled:opacity-40"
              aria-label="Página anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-text-muted text-sm">
              {pagina} de {paginas}
            </span>
            <button
              onClick={() => setPagina((p) => Math.min(paginas, p + 1))}
              disabled={pagina >= paginas}
              className="border-panel-border bg-panel text-text rounded-md border p-2 disabled:opacity-40"
              aria-label="Próxima página"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </nav>
        )}
      </div>
      <ToastHost />
    </>
  );
}
