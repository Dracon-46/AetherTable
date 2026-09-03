'use client';

/**
 * Lista de grimórios.
 *
 * ─── O QUE MUDOU ───────────────────────────────────────────────────────────
 *
 * A tela buscava com `useEffect` + `fetch` + `useState` e não guardava nada.
 * Sair para um deck e voltar refazia a lista inteira: uma tela vazia e um
 * pisca a cada "Voltar". Agora a leitura passa pelo cache do react-query
 * (`useListaDeDecks`) e a volta é instantânea, com revalidação ao fundo.
 *
 * Apagar também virou otimista: o cartão sai no clique e volta só se o
 * servidor recusar. Antes eram duas viagens em série (DELETE e depois a lista
 * inteira) com a interface parada entre elas.
 */

import { useState } from 'react';
import { Plus, Trash2, Library, Edit3, Loader2, AlertCircle, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  useApagarDeck,
  useCriarDeck,
  useListaDeDecks,
  type DeckResumo,
} from '../../../deckbuilder/useDecks';
import { mensagemDaApi } from '@/lib/fetcher';
import { ConfirmDialog, ToastHost } from '@/components/Toast';
import { FORMATOS_JOGAVEIS, acharFormato } from '@aethertable/shared-types';

/**
 * ─── OS FORMATOS SAEM DO CATÁLOGO, NÃO DO JSX ─────────────────────────────
 *
 * Esta lista era sete pares escritos à mão aqui. Existiam outras duas: oito
 * formatos na validação do backend e quatro (em MAIÚSCULAS) no seletor de criar
 * mesa. Três listas, três verdades sobre quais formatos o produto tem — e um
 * deck criado como "timeless" batia numa validação que não conhecia timeless.
 *
 * `FORMATOS_JOGAVEIS` filtra os PLANEJADOS: oferecer Booster Draft num seletor
 * quando o motor de draft não existe é prometer uma mesa que não monta.
 */
const POR_CATEGORIA = FORMATOS_JOGAVEIS.reduce<Record<string, typeof FORMATOS_JOGAVEIS>>(
  (acc, f) => {
    acc[f.categoria] = [...(acc[f.categoria] ?? []), f];
    return acc;
  },
  {},
);

const ROTULO_DE_CATEGORIA: Record<string, string> = {
  COMANDANTE: 'Comandante',
  CONSTRUIDO: 'Construído',
  CASUAL: 'Casual',
  LIMITADO: 'Limitado',
  VARIANTE: 'Variantes',
};

export default function DecksPage() {
  const router = useRouter();
  const { data: decks, isPending, isError, error } = useListaDeDecks();
  const criar = useCriarDeck();
  const apagar = useApagarDeck();

  const [novoNome, setNovoNome] = useState('');
  const [novoFormato, setNovoFormato] = useState('commander');
  /** Substitui `window.confirm`: destruir um deck merece um diálogo do app. */
  const [deckParaDestruir, setDeckParaDestruir] = useState<string | null>(null);
  /** Filtro local — não vai ao servidor, a lista inteira já está em memória. */
  const [busca, setBusca] = useState('');

  async function criarDeck(e: React.FormEvent) {
    e.preventDefault();
    if (!novoNome.trim()) return;
    const criado = await criar.mutateAsync({ name: novoNome.trim(), formatId: novoFormato });
    setNovoNome('');
    router.push(`/dashboard/decks/${criado.id}`);
  }

  const termo = busca.trim().toLowerCase();
  const visiveis: DeckResumo[] = (decks ?? []).filter(
    (d) => !termo || d.name.toLowerCase().includes(termo) || d.formatId.includes(termo),
  );

  return (
    <>
      <div className="mx-auto max-w-7xl animate-[fadeIn_0.3s_ease-out]">
        <header className="mb-6 sm:mb-8">
          <h1 className="text-text mb-2 flex items-center gap-3 text-2xl font-bold sm:text-3xl">
            <Library className="text-primary h-7 w-7 shrink-0 sm:h-8 sm:w-8" />
            Seu Grimório
          </h1>
          <p className="text-text-muted text-sm sm:text-base">
            Forje, organize e prepare seus decks para a batalha — {FORMATOS_JOGAVEIS.length}{' '}
            formatos disponíveis.
          </p>
        </header>

        {/* ── Criação rápida ──────────────────────────────────────────────── */}
        <section className="border-panel-border bg-panel mb-6 rounded-xl border p-4 shadow-lg sm:mb-10 sm:p-6">
          <h2 className="text-text mb-4 text-base font-semibold sm:text-lg">Forjar Novo Deck</h2>
          <form onSubmit={criarDeck} className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              disabled={criar.isPending}
              required
              placeholder="Ex: Mono Blue Control"
              className="border-panel-border bg-table-deep text-text focus:border-primary min-w-0 flex-1 rounded-md border px-4 py-2 transition-colors focus:outline-none"
            />
            <select
              value={novoFormato}
              onChange={(e) => setNovoFormato(e.target.value)}
              disabled={criar.isPending}
              // `sm:max-w-56`: sem teto, um `<option>` como "Commander Two-Headed
              // Giant" esticava o seletor e comia a largura do campo de nome.
              className="bg-table-deep border-panel-border text-text focus:border-primary rounded-md border px-4 py-2 transition-colors focus:outline-none sm:max-w-56"
              aria-label="Formato do deck"
            >
              {/* Agrupado por categoria: com 25 formatos, uma lista plana obriga
                  a ler tudo para achar "Pauper EDH". */}
              {Object.entries(POR_CATEGORIA).map(([categoria, lista]) => (
                <optgroup key={categoria} label={ROTULO_DE_CATEGORIA[categoria] ?? categoria}>
                  {lista.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                      {f.status === 'BETA' ? ' (beta)' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="submit"
              disabled={criar.isPending || !novoNome.trim()}
              className="bg-primary hover:bg-primary-hover flex shrink-0 items-center justify-center gap-2 rounded-md px-6 py-2 font-medium text-white transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {criar.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {criar.isPending ? 'Forjando...' : 'Criar Deck'}
            </button>
          </form>
          {criar.isError && (
            <p className="text-danger mt-3 flex items-center gap-2 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {mensagemDaApi(criar.error)}
            </p>
          )}
        </section>

        {/* Filtro: aparece só quando há grimórios o bastante para procurar
            entre eles. Um campo de busca sobre três itens é decoração. */}
        {(decks?.length ?? 0) > 5 && (
          <div className="relative mb-6 max-w-sm">
            <Search className="text-text-muted pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Filtrar por nome ou formato…"
              className="border-panel-border bg-panel text-text focus:border-primary w-full rounded-md border py-2 pl-9 pr-3 text-sm focus:outline-none"
            />
          </div>
        )}

        {/* ── Grade ───────────────────────────────────────────────────────── */}
        {isPending ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
            {/* Esqueleto com a MESMA altura do cartão real: um spinner
                centralizado empurrava o conteúdo quando a lista chegava. */}
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="bg-panel border-panel-border h-44 animate-pulse rounded-xl border"
              />
            ))}
          </div>
        ) : isError ? (
          <div className="border-danger/30 bg-danger/10 text-danger flex items-center gap-3 rounded-xl border p-4">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="text-sm">{mensagemDaApi(error)}</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
            {visiveis.map((deck) => (
              <article
                key={deck.id}
                className="bg-panel border-panel-border hover:border-primary group flex flex-col rounded-xl border p-4 shadow-md transition-all sm:p-5"
              >
                <div className="mb-4 flex items-start justify-between gap-2">
                  <h3 className="text-text min-w-0 truncate text-lg font-bold sm:text-xl">
                    {deck.name}
                  </h3>
                  <span className="bg-table-deep text-text-muted shrink-0 rounded px-2 py-1 text-xs font-semibold">
                    {deck.cardCount} CARTAS
                  </span>
                </div>

                <p className="text-text-muted mb-5 flex-1 text-sm">
                  {/* O NOME do formato, não o id. "historic_brawl" na tela é um
                      identificador vazando para o usuário. */}
                  <span className="text-text-faint">{acharFormato(deck.formatId).nome}</span>
                  {' · atualizado em '}
                  {new Date(deck.updatedAt).toLocaleDateString()}
                </p>

                <div className="mt-auto flex items-center gap-2">
                  {/*
                    `<Link>` e não `router.push`: o Link pré-carrega o código da
                    rota quando o cartão entra na viewport, então o clique não
                    espera download nenhum. Com `router.push` num botão, a
                    navegação só COMEÇA a buscar o chunk da rota no clique — e
                    era isso que fazia abrir um grimório parecer travado por um
                    instante antes de qualquer dado chegar.

                    As duas apontam para a MESMA rota, então um prefetch serve
                    às duas — e agora o modo é um interruptor lá dentro, não
                    uma tela separada.
                  */}
                  <Link
                    href={`/dashboard/decks/${deck.id}?modo=ver`}
                    className="border-panel-border bg-table-deep text-text hover:bg-panel-border flex min-w-0 flex-1 items-center justify-center gap-2 rounded border px-3 py-2 text-sm font-medium transition-colors hover:text-white"
                  >
                    <Library className="h-4 w-4 shrink-0" />
                    <span className="truncate">Visualizar</span>
                  </Link>
                  <Link
                    href={`/dashboard/decks/${deck.id}`}
                    className="border-primary/30 bg-table-deep text-primary hover:bg-primary flex min-w-0 flex-1 items-center justify-center gap-2 rounded border px-3 py-2 text-sm font-medium transition-colors hover:text-white"
                  >
                    <Edit3 className="h-4 w-4 shrink-0" />
                    <span className="truncate">Editar</span>
                  </Link>
                  <button
                    onClick={() => setDeckParaDestruir(deck.id)}
                    className="bg-table-deep text-text-muted hover:bg-danger border-panel-border hover:border-danger shrink-0 rounded border p-2 transition-colors hover:text-white"
                    title="Destruir Deck"
                    aria-label={`Destruir ${deck.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </article>
            ))}

            {visiveis.length === 0 && (
              <div className="border-panel-border col-span-full rounded-xl border border-dashed py-12 text-center">
                <Library className="text-text-muted mx-auto mb-3 h-12 w-12 opacity-50" />
                <p className="text-text-muted px-4">
                  {termo
                    ? `Nenhum grimório casa com “${busca.trim()}”.`
                    : 'Você ainda não possui nenhum deck. Forje um acima para começar.'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        aberto={deckParaDestruir !== null}
        titulo="Destruir este grimório?"
        descricao="O deck e todas as cartas dele somem. Não dá para desfazer."
        rotuloConfirmar="Destruir"
        perigo
        onConfirmar={() => {
          if (deckParaDestruir) apagar.mutate(deckParaDestruir);
          setDeckParaDestruir(null);
        }}
        onCancelar={() => setDeckParaDestruir(null)}
      />
      <ToastHost />
    </>
  );
}
