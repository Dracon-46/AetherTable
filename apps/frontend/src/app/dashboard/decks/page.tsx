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
 *
 * ─── O CARTÃO PASSOU A DIZER DE QUE DECK SE TRATA ──────────────────────────
 *
 * Nome, formato e data eram tudo — com dez decks de Commander, a única forma
 * de achar "o dos dinossauros" era lembrar o nome que se deu a ele. Agora o
 * cartão traz a arte do comandante, as cores e a estrela de favorito, e a
 * busca acha pelo comandante também. Favoritar, renomear e clonar ficam no
 * próprio cartão; as colunas existiam no banco e não tinham caminho de
 * escrita (DOC-094 II.3).
 */

import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Library,
  Edit3,
  Loader2,
  AlertCircle,
  Search,
  Star,
  MoreVertical,
  Copy,
  PenLine,
  Globe,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  useApagarDeck,
  useAtualizarDeck,
  useClonarDeck,
  useCriarDeck,
  useListaDeDecks,
  type DeckResumo,
} from '../../../deckbuilder/useDecks';
import { mensagemDaApi } from '@/lib/fetcher';
import { ConfirmDialog, ToastHost } from '@/components/Toast';
import { FORMATOS_JOGAVEIS, acharFormato } from '@aethertable/shared-types';
import { cardImageUrl } from '@/canvas/textureCache';
import { useCardCatalog, useHidratarCartas } from '@/cards/catalog';
import { VitrineDeDecksIniciais } from '../../../deckbuilder/VitrineDeDecksIniciais';

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

/** As cores do símbolo de mana, para as bolinhas de identidade. */
const COR_DO_PIP: Record<string, { fundo: string; texto: string }> = {
  W: { fundo: '#F8F3D6', texto: '#3B3524' },
  U: { fundo: '#0E68AB', texto: '#FFFFFF' },
  B: { fundo: '#2B2622', texto: '#E7E1D7' },
  R: { fundo: '#D3202A', texto: '#FFFFFF' },
  G: { fundo: '#00733E', texto: '#FFFFFF' },
};

function PipsDeCor({ cores }: { cores?: string[] }) {
  if (!cores?.length) return null;
  return (
    <span className="flex gap-0.5" aria-label={`Cores: ${cores.join(', ')}`}>
      {cores.map((c) => (
        <span
          key={c}
          className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black shadow"
          style={{ background: COR_DO_PIP[c]?.fundo, color: COR_DO_PIP[c]?.texto }}
        >
          {c}
        </span>
      ))}
    </span>
  );
}

export default function DecksPage() {
  const router = useRouter();
  const { data: decks, isPending, isError, error } = useListaDeDecks();
  const criar = useCriarDeck();
  const apagar = useApagarDeck();
  const atualizar = useAtualizarDeck();
  const clonar = useClonarDeck();
  const catalogo = useCardCatalog((s) => s.cartas);

  const [novoNome, setNovoNome] = useState('');
  const [novoFormato, setNovoFormato] = useState('commander');
  /** Substitui `window.confirm`: destruir um deck merece um diálogo do app. */
  const [deckParaDestruir, setDeckParaDestruir] = useState<string | null>(null);
  /** Filtros locais — não vão ao servidor, a lista inteira já está em memória. */
  const [busca, setBusca] = useState('');
  const [buscaComandante, setBuscaComandante] = useState('');
  const [formatoFiltro, setFormatoFiltro] = useState('');
  const [soFavoritos, setSoFavoritos] = useState(false);
  const [menuDe, setMenuDe] = useState<string | null>(null);
  const [renomeando, setRenomeando] = useState<{ id: string; nome: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // O nome do comandante vem do catálogo: o deck guarda só o id da impressão.
  useHidratarCartas((decks ?? []).flatMap((d) => [d.commanderId, d.partnerId]));

  useEffect(() => {
    if (!menuDe) return;
    const fora = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuDe(null);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [menuDe]);

  async function criarDeck(e: React.FormEvent) {
    e.preventDefault();
    if (!novoNome.trim()) return;
    let criado: DeckResumo;
    try {
      criado = await criar.mutateAsync({ name: novoNome.trim(), formatId: novoFormato });
    } catch {
      // Sem o `catch`, a recusa (nome inválido, 429, rede) virava rejeição não
      // tratada no `onSubmit`. A mensagem já aparece pelo `criar.isError`
      // abaixo do formulário, e o nome digitado fica para a pessoa corrigir.
      return;
    }
    setNovoNome('');
    router.push(`/dashboard/decks/${criado.id}`);
  }

  const nomeDoComandante = (d: DeckResumo) =>
    [d.commanderId, d.partnerId]
      .map((id) => (id ? catalogo[id]?.name : undefined))
      .filter(Boolean)
      .join(' & ');

  const termo = busca.trim().toLowerCase();
  const termoComandante = buscaComandante.trim().toLowerCase();
  const formatosUsados = [...new Set((decks ?? []).map((d) => d.formatId))];
  const visiveis: DeckResumo[] = (decks ?? [])
    .filter((d) => !termo || d.name.toLowerCase().includes(termo))
    .filter((d) => !termoComandante || nomeDoComandante(d).toLowerCase().includes(termoComandante))
    .filter((d) => !formatoFiltro || d.formatId === formatoFiltro)
    .filter((d) => !soFavoritos || d.isFavorite)
    // Favoritos primeiro; dentro de cada grupo, a ordem do servidor (o mais
    // recente no topo). `sort` é estável, então a segunda ordem se mantém.
    .sort((a, b) => Number(Boolean(b.isFavorite)) - Number(Boolean(a.isFavorite)));

  const filtrando = Boolean(termo || termoComandante || formatoFiltro || soFavoritos);

  const salvarNome = () => {
    if (!renomeando) return;
    const nome = renomeando.nome.trim();
    if (nome && nome !== decks?.find((d) => d.id === renomeando.id)?.name) {
      atualizar.mutate({ deckId: renomeando.id, dados: { name: nome.slice(0, 80) } });
    }
    setRenomeando(null);
  };

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

        {/* Aberta para quem ainda não tem deck: é o caminho mais curto até
            a primeira partida. Quem já tem decks a vê recolhida. */}
        {!isPending && <VitrineDeDecksIniciais abertaDeInicio={(decks?.length ?? 0) === 0} />}

        {/* Filtros: aparecem com dois grimórios ou mais. Um filtro sobre um
            deck só é decoração. */}
        {(decks?.length ?? 0) > 1 && (
          <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search className="text-text-muted pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Nome do deck…"
                aria-label="Filtrar pelo nome do deck"
                className="border-panel-border bg-panel text-text focus:border-primary w-full rounded-md border py-2 pl-9 pr-3 text-sm focus:outline-none"
              />
            </div>
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search className="text-text-muted pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
              <input
                type="search"
                value={buscaComandante}
                onChange={(e) => setBuscaComandante(e.target.value)}
                placeholder="Comandante…"
                aria-label="Filtrar pelo comandante"
                className="border-panel-border bg-panel text-text focus:border-primary w-full rounded-md border py-2 pl-9 pr-3 text-sm focus:outline-none"
              />
            </div>
            {formatosUsados.length > 1 && (
              <select
                value={formatoFiltro}
                onChange={(e) => setFormatoFiltro(e.target.value)}
                aria-label="Filtrar por formato"
                className="border-panel-border bg-panel text-text focus:border-primary rounded-md border px-3 py-2 text-sm focus:outline-none"
              >
                <option value="">Qualquer formato</option>
                {formatosUsados.map((f) => (
                  <option key={f} value={f}>
                    {acharFormato(f).nome}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => setSoFavoritos((v) => !v)}
              aria-pressed={soFavoritos}
              className={`flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors ${
                soFavoritos
                  ? 'border-warning/60 bg-warning/10 text-warning'
                  : 'border-panel-border bg-panel text-text-muted hover:text-text'
              }`}
            >
              <Star className={`h-4 w-4 ${soFavoritos ? 'fill-current' : ''}`} />
              Favoritos
            </button>
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
                className="bg-panel border-panel-border h-52 animate-pulse rounded-xl border"
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
            {visiveis.map((deck) => {
              const comandante = nomeDoComandante(deck);
              return (
                <article
                  key={deck.id}
                  className="bg-panel border-panel-border hover:border-primary group relative flex flex-col overflow-hidden rounded-xl border shadow-md transition-all"
                >
                  {/* A arte do comandante dá rosto ao deck. Sem comandante
                      (Modern, Pauper), sobra o fundo do painel. */}
                  <div className="relative h-24 shrink-0 overflow-hidden">
                    {deck.commanderId ? (
                      <img
                        src={cardImageUrl(deck.commanderId, 'art_crop')}
                        alt=""
                        className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100"
                        loading="lazy"
                      />
                    ) : (
                      <div className="bg-table-deep h-full w-full" />
                    )}
                    <div className="from-panel absolute inset-0 bg-gradient-to-t to-transparent" />
                    <button
                      onClick={() =>
                        atualizar.mutate({
                          deckId: deck.id,
                          dados: { isFavorite: !deck.isFavorite },
                        })
                      }
                      aria-pressed={Boolean(deck.isFavorite)}
                      aria-label={deck.isFavorite ? 'Tirar dos favoritos' : 'Favoritar'}
                      title={deck.isFavorite ? 'Tirar dos favoritos' : 'Favoritar'}
                      className="absolute left-2 top-2 rounded-full bg-black/50 p-1.5 backdrop-blur transition-colors hover:bg-black/70"
                    >
                      <Star
                        className={`h-4 w-4 ${deck.isFavorite ? 'fill-warning text-warning' : 'text-white'}`}
                      />
                    </button>
                    <div
                      className="absolute right-2 top-2"
                      ref={menuDe === deck.id ? menuRef : undefined}
                    >
                      <button
                        onClick={() => setMenuDe(menuDe === deck.id ? null : deck.id)}
                        aria-label={`Mais ações de ${deck.name}`}
                        aria-expanded={menuDe === deck.id}
                        className="rounded-full bg-black/50 p-1.5 text-white backdrop-blur transition-colors hover:bg-black/70"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                      {menuDe === deck.id && (
                        <div
                          role="menu"
                          className="border-panel-border bg-panel absolute right-0 top-full z-10 mt-1 w-44 overflow-hidden rounded-lg border py-1 shadow-xl"
                        >
                          <button
                            role="menuitem"
                            onClick={() => {
                              setRenomeando({ id: deck.id, nome: deck.name });
                              setMenuDe(null);
                            }}
                            className="text-text hover:bg-panel-hover flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                          >
                            <PenLine className="h-4 w-4" /> Renomear
                          </button>
                          <button
                            role="menuitem"
                            onClick={() => {
                              clonar.mutate(deck.id);
                              setMenuDe(null);
                            }}
                            className="text-text hover:bg-panel-hover flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                          >
                            <Copy className="h-4 w-4" /> Clonar
                          </button>
                          <button
                            role="menuitem"
                            onClick={() => {
                              setDeckParaDestruir(deck.id);
                              setMenuDe(null);
                            }}
                            className="text-danger hover:bg-danger/10 flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                          >
                            <Trash2 className="h-4 w-4" /> Excluir
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col p-4 pt-1 sm:px-5">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      {renomeando?.id === deck.id ? (
                        <input
                          autoFocus
                          value={renomeando.nome}
                          maxLength={80}
                          onChange={(e) => setRenomeando({ id: deck.id, nome: e.target.value })}
                          onBlur={salvarNome}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') salvarNome();
                            if (e.key === 'Escape') setRenomeando(null);
                          }}
                          aria-label="Novo nome do deck"
                          className="border-primary bg-table-deep text-text min-w-0 flex-1 rounded border px-2 py-1 text-lg font-bold focus:outline-none"
                        />
                      ) : (
                        <h3 className="text-text min-w-0 truncate text-lg font-bold sm:text-xl">
                          {deck.name}
                        </h3>
                      )}
                      <span className="bg-table-deep text-text-muted shrink-0 rounded px-2 py-1 text-xs font-semibold">
                        {deck.cardCount} CARTAS
                      </span>
                    </div>
                    {comandante && (
                      <p className="text-text-muted mb-1 truncate text-xs" title={comandante}>
                        {comandante}
                      </p>
                    )}

                    <p className="text-text-muted mb-4 flex flex-1 flex-wrap items-center gap-2 text-sm">
                      {/* O NOME do formato, não o id. "historic_brawl" na tela é um
                          identificador vazando para o usuário. */}
                      <span className="text-text-faint">{acharFormato(deck.formatId).nome}</span>
                      <PipsDeCor cores={deck.colorIdentity} />
                      {deck.isPublic && (
                        <span
                          className="text-primary flex items-center gap-1 text-[11px]"
                          title="Aparece no Explorar"
                        >
                          <Globe className="h-3 w-3" /> público
                        </span>
                      )}
                      <span className="text-text-faint text-xs">
                        · {new Date(deck.updatedAt).toLocaleDateString()}
                      </span>
                    </p>

                    <div className="mt-auto flex items-center gap-2">
                      {/*
                        `<Link>` e não `router.push`: o Link pré-carrega o código da
                        rota quando o cartão entra na viewport, então o clique não
                        espera download nenhum.
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
                    </div>
                  </div>
                </article>
              );
            })}

            {visiveis.length === 0 && (
              <div className="border-panel-border col-span-full rounded-xl border border-dashed py-12 text-center">
                <Library className="text-text-muted mx-auto mb-3 h-12 w-12 opacity-50" />
                <p className="text-text-muted px-4">
                  {filtrando
                    ? 'Nenhum grimório passa por esses filtros.'
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
