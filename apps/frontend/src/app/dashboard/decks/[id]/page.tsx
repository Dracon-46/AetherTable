'use client';

/**
 * DeckBuilderPage — ver e editar um grimório.
 *
 * ─── 1. VISUALIZAR E EDITAR ERAM DUAS TELAS ────────────────────────────────
 *
 * O modo de leitura era o parâmetro de URL `?mode=view`, e não havia como sair
 * dele: a única saída era o botão "Voltar aos Decks", achar o mesmo cartão na
 * lista e clicar em "Editar" — três cliques e duas navegações para chegar à
 * MESMA tela com os controles ligados. E a segunda navegação recarregava o
 * deck inteiro do servidor, que era a parte caríssima.
 *
 * Agora é um interruptor. O modo é estado local; a URL é atualizada por
 * `replace` só para o link continuar compartilhável. Nenhuma navegação,
 * nenhuma requisição: os controles aparecem no mesmo quadro do clique.
 *
 * ─── 2. TODA AÇÃO RECARREGAVA O DECK ───────────────────────────────────────
 *
 * `+1`, `−1`, remover e promover a comandante terminavam em `await
 * fetchDeck()` — o `GET /decks/:id` inteiro, que hidratava as 100 cartas na
 * Scryfall sem cache. Um clique custava mais de um segundo com a tela parada.
 * As mutações agora são otimistas (ver `useDecks.ts`) e o servidor responde do
 * cache (ver `decks.service.ts`).
 *
 * ─── 3. TRÊS VISTAS E TRÊS AGRUPAMENTOS ────────────────────────────────────
 *
 * Eram duas vistas (lista e galeria) e um agrupamento (tipo), e o agrupamento
 * valia só na galeria. Ver `VistasDoDeck.tsx` e `agrupar.ts` para o porquê de
 * cada corte. A escolha é lembrada entre sessões.
 */

import { useCallback, useEffect, useMemo, useState, use } from 'react';
import {
  ArrowLeft,
  Save,
  AlertCircle,
  LibraryBig,
  Edit2,
  X,
  Check,
  LayoutGrid,
  List,
  Rows3,
  Search as SearchIcon,
  Crown,
  Activity,
  Eye,
  Pencil,
  Loader2,
  DollarSign,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ConfirmDialog, ToastHost, useToast } from '../../../../components/Toast';
import { CardSearch } from '../../../../deckbuilder/CardSearch';
import { PrintingPicker } from '../../../../deckbuilder/PrintingPicker';
import {
  COLUNAS_DA_GALERIA,
  useAparencia,
  type AgrupamentoDeDeck,
  type TamanhoDeCarta,
  type VisaoDeDeck,
} from '../../../../store/aparencia.store';
import {
  chavesDeDeck,
  useAdicionarCarta,
  useAlternarComandante,
  useDeck,
  useImportarLista,
  useMudarQuantidade,
  useRemoverCarta,
  useRenomearDeck,
  type DeckCarta,
} from '../../../../deckbuilder/useDecks';
import {
  agruparCartas,
  calcularBracket,
  ordenarParaExibir,
  precoTotal,
} from '../../../../deckbuilder/agrupar';
import {
  ArteDeCarta,
  LinhaCompacta,
  LinhaDeCarta,
  type AcoesDeCarta,
} from '../../../../deckbuilder/VistasDoDeck';
import { PainelDeLegalidade } from '../../../../deckbuilder/PainelDeLegalidade';
import { mensagemDaApi } from '@/lib/fetcher';
import { useQueryClient } from '@tanstack/react-query';

const VISTAS: Array<{ valor: VisaoDeDeck; rotulo: string; Icone: typeof List; dica: string }> = [
  {
    valor: 'lista',
    rotulo: 'Lista',
    Icone: List,
    dica: 'Uma linha por carta, com os controles sempre visíveis',
  },
  {
    valor: 'compacta',
    rotulo: 'Compacta',
    Icone: Rows3,
    dica: 'A lista inteira numa tela — controles no hover',
  },
  {
    valor: 'galeria',
    rotulo: 'Galeria',
    Icone: LayoutGrid,
    dica: 'As artes, para conferir o deck de relance',
  },
];

const AGRUPAMENTOS: Array<{ valor: AgrupamentoDeDeck; rotulo: string }> = [
  { valor: 'tipo', rotulo: 'Agrupar por tipo' },
  { valor: 'cor', rotulo: 'Agrupar por cor' },
  { valor: 'cmc', rotulo: 'Agrupar por custo' },
  { valor: 'nenhum', rotulo: 'Sem agrupamento' },
];

/**
 * Lista vazia ESTÁVEL.
 *
 * `deck?.cards ?? []` cria um array novo a cada render enquanto o deck não
 * chegou, e todo `useMemo` que dependesse dele recalculava sempre — a
 * memoização existiria no código e não no comportamento.
 */
const SEM_CARTAS: DeckCarta[] = [];

const TAMANHOS: Array<{ valor: TamanhoDeCarta; rotulo: string }> = [
  { valor: 'pequeno', rotulo: 'P' },
  { valor: 'medio', rotulo: 'M' },
  { valor: 'grande', rotulo: 'G' },
];

export default function DeckBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  const searchParams = useSearchParams();
  const avisar = useToast((s) => s.mostrar);

  const { data: deck, isPending, isError } = useDeck(id);
  const qc = useQueryClient();

  /**
   * MODO DE LEITURA: ESTADO, NÃO ROTA.
   *
   * A URL semeia o valor inicial e depois só acompanha. `mode=view` continua
   * sendo aceito porque links antigos e favoritos existem — trocar o nome do
   * parâmetro sem recuo transformaria cada um deles num deck aberto em edição
   * sem o usuário pedir.
   */
  const [somenteLeitura, setSomenteLeitura] = useState(
    () => searchParams.get('modo') === 'ver' || searchParams.get('mode') === 'view',
  );

  const alternarModo = useCallback(() => {
    setSomenteLeitura((antes) => {
      const agora = !antes;
      // `replace` e não `push`: alternar dez vezes não deve criar dez entradas
      // no histórico, senão o botão Voltar do navegador para de sair da tela.
      // `scroll: false` mantém a posição da lista — trocar de modo no meio de
      // cem cartas e voltar ao topo é perder o lugar.
      router.replace(agora ? `/dashboard/decks/${id}?modo=ver` : `/dashboard/decks/${id}`, {
        scroll: false,
      });
      return agora;
    });
  }, [id, router]);

  // ── Preferências de exibição ─────────────────────────────────────────────
  const visao = useAparencia((s) => s.visaoDeDeck);
  const setVisao = useAparencia((s) => s.setVisaoDeDeck);
  const agrupamento = useAparencia((s) => s.agrupamentoDeDeck);
  const setAgrupamento = useAparencia((s) => s.setAgrupamentoDeDeck);
  const tamanho = useAparencia((s) => s.tamanhoDeCarta);
  const setTamanho = useAparencia((s) => s.setTamanhoDeCarta);

  // ── Estado local da tela ─────────────────────────────────────────────────
  const [textoDaLista, setTextoDaLista] = useState('');
  const [abaEsquerda, setAbaEsquerda] = useState<'busca' | 'importacao'>('busca');
  const [editandoNome, setEditandoNome] = useState(false);
  const [nomeEditado, setNomeEditado] = useState('');
  const [cartaParaArte, setCartaParaArte] = useState<DeckCarta | null>(null);
  const [cartaParaRemover, setCartaParaRemover] = useState<string | null>(null);

  // ── Mutações ─────────────────────────────────────────────────────────────
  const mudarQuantidade = useMudarQuantidade(id);
  const removerCarta = useRemoverCarta(id);
  const alternarComandante = useAlternarComandante(id);
  const adicionarCarta = useAdicionarCarta(id);
  const renomear = useRenomearDeck(id);
  const importar = useImportarLista(id);

  // Um deck que não existe (ou não é meu) devolve 404: volta para a lista em
  // vez de deixar a tela num erro sem saída.
  useEffect(() => {
    if (isError) router.replace('/dashboard/decks');
  }, [isError, router]);

  // ── Derivações memoizadas ────────────────────────────────────────────────
  const cartas = deck?.cards ?? SEM_CARTAS;
  const grupos = useMemo(() => agruparCartas(cartas, agrupamento), [cartas, agrupamento]);
  const ordenadas = useMemo(() => ordenarParaExibir(cartas), [cartas]);
  const bracket = useMemo(() => calcularBracket(cartas), [cartas]);
  const preco = useMemo(() => precoTotal(cartas), [cartas]);

  /**
   * Handlers estáveis: são o que faz o `React.memo` das linhas valer algo.
   * Recriados a cada render, cada linha veria uma prop nova e re-renderizaria
   * junto — a memoização existiria e não pouparia nada.
   */
  const acoes: AcoesDeCarta = useMemo(
    () =>
      somenteLeitura
        ? {
            onMudarQuantidade: null,
            onRemover: null,
            onAlternarComandante: null,
            onTrocarArte: null,
          }
        : {
            onMudarQuantidade: (cardId, delta) => mudarQuantidade.mutate({ cardId, delta }),
            onRemover: (cardId) => setCartaParaRemover(cardId),
            onAlternarComandante: (cardId, boardType) =>
              alternarComandante.mutate({ cardId, boardType }),
            onTrocarArte: (carta) => setCartaParaArte(carta),
          },
    [somenteLeitura, mudarQuantidade, alternarComandante],
  );

  const aoAdicionarCarta = useCallback(
    async (scryfallId: string, quantity: number) => {
      await adicionarCarta.mutateAsync({ scryfallId, quantity });
    },
    [adicionarCarta],
  );

  async function salvarNome() {
    const novo = nomeEditado.trim();
    if (!novo || novo === deck?.name) {
      setEditandoNome(false);
      return;
    }
    setEditandoNome(false);
    renomear.mutate(novo);
  }

  async function enviarImportacao(e: React.FormEvent) {
    e.preventDefault();
    if (!textoDaLista.trim()) return;
    try {
      const r = await importar.mutateAsync(textoDaLista);
      setTextoDaLista('');
      avisar(
        r.notFound?.length
          ? `${r.imported} cartas importadas. ${r.notFound.length} não encontradas.`
          : `${r.imported} cartas importadas.`,
        r.notFound?.length ? 'info' : 'sucesso',
      );
    } catch (erro) {
      avisar(mensagemDaApi(erro), 'erro');
    }
  }

  if (isPending || !deck) {
    return (
      <div className="mx-auto max-w-7xl">
        <div className="text-text-muted mb-6 flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Invocando grimório…
        </div>
        <div className="bg-panel border-panel-border h-64 animate-pulse rounded-xl border" />
      </div>
    );
  }

  const chip = 'bg-panel border-panel-border rounded border px-2 py-1';

  return (
    <>
      <div className="mx-auto max-w-7xl animate-[fadeIn_0.3s_ease-out]">
        {/* ── Cabeçalho ──────────────────────────────────────────────────── */}
        <header className="mb-6">
          <button
            onClick={() => router.push('/dashboard/decks')}
            className="text-text-muted hover:text-primary mb-4 flex items-center gap-2 text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar aos Decks
          </button>

          <div className="mb-3 flex flex-wrap items-center gap-3">
            <LibraryBig className="text-primary h-7 w-7 shrink-0 sm:h-8 sm:w-8" />
            {editandoNome ? (
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md">
                <input
                  type="text"
                  value={nomeEditado}
                  onChange={(e) => setNomeEditado(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void salvarNome();
                    if (e.key === 'Escape') setEditandoNome(false);
                  }}
                  autoFocus
                  className="bg-table-deep border-primary text-text min-w-0 flex-1 rounded border px-3 py-1 text-xl font-bold focus:outline-none sm:text-2xl"
                />
                <button
                  onClick={() => void salvarNome()}
                  className="bg-success shrink-0 rounded p-2 text-white hover:brightness-110"
                  aria-label="Salvar nome"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setEditandoNome(false)}
                  className="bg-danger shrink-0 rounded p-2 text-white hover:brightness-110"
                  aria-label="Cancelar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <h1 className="text-text group flex min-w-0 items-center gap-2 text-2xl font-bold sm:text-3xl">
                <span className="min-w-0 break-words">{deck.name}</span>
                {!somenteLeitura && (
                  <button
                    onClick={() => {
                      setNomeEditado(deck.name);
                      setEditandoNome(true);
                    }}
                    className="text-text-muted hover:text-primary shrink-0 p-1 transition-all sm:opacity-0 sm:group-hover:opacity-100"
                    aria-label="Renomear grimório"
                  >
                    <Edit2 className="h-5 w-5" />
                  </button>
                )}
              </h1>
            )}

            {/* ── O interruptor Visualizar ⇄ Editar ──────────────────────
                Fica no cabeçalho, ao lado do nome, porque é onde o usuário
                está olhando quando percebe que quer mexer no deck. Enterrá-lo
                no rodapé faria o caminho voltar a ser "Voltar → Editar". */}
            <div className="border-panel-border bg-panel ml-auto flex shrink-0 overflow-hidden rounded-lg border p-1">
              <button
                onClick={() => somenteLeitura || alternarModo()}
                aria-pressed={somenteLeitura}
                className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                  somenteLeitura
                    ? 'bg-primary text-white shadow'
                    : 'text-text-muted hover:text-text hover:bg-table-deep'
                }`}
                title="Só olhar — nenhum controle de edição na tela"
              >
                <Eye className="h-3.5 w-3.5" /> Visualizar
              </button>
              <button
                onClick={() => somenteLeitura && alternarModo()}
                aria-pressed={!somenteLeitura}
                className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                  !somenteLeitura
                    ? 'bg-primary text-white shadow'
                    : 'text-text-muted hover:text-text hover:bg-table-deep'
                }`}
                title="Buscar, importar, ajustar quantidades e trocar artes"
              >
                <Pencil className="h-3.5 w-3.5" /> Editar
              </button>
            </div>
          </div>

          <div className="text-text-muted flex flex-wrap gap-2 text-xs sm:gap-3 sm:text-sm">
            <span className={chip}>{deck.cardCount} Cartas</span>
            <span className={`${chip} flex items-center gap-1`}>
              <DollarSign className="h-3.5 w-3.5" />
              {preco} USD
            </span>
            <span className={chip}>
              Formato: <span className="text-text font-bold uppercase">{deck.formatId}</span>
            </span>
            <span className={`${chip} flex items-center gap-1.5 font-bold ${bracket.color}`}>
              <Activity className="h-3.5 w-3.5" /> {bracket.label}
            </span>
            <span className={`${chip} hidden sm:inline`}>
              Criado em {new Date(deck.createdAt).toLocaleDateString()}
            </span>
          </div>
        </header>

        {/* ── Barra de exibição ──────────────────────────────────────────── */}
        <div className="mb-5 flex flex-wrap items-center gap-2 sm:gap-3">
          <div
            className="bg-panel border-panel-border flex gap-1 rounded-md border p-1"
            role="group"
            aria-label="Modo de visualização"
          >
            {VISTAS.map((v) => (
              <button
                key={v.valor}
                onClick={() => setVisao(v.valor)}
                aria-pressed={visao === v.valor}
                title={v.dica}
                className={`flex items-center gap-2 rounded-sm px-2.5 py-2 text-xs font-medium transition-colors sm:px-4 sm:text-sm ${
                  visao === v.valor
                    ? 'bg-primary text-white shadow'
                    : 'text-text-muted hover:text-text hover:bg-table-deep'
                }`}
              >
                <v.Icone className="h-4 w-4 shrink-0" />
                {/* O rótulo some em tela estreita: três ícones cabem, três
                    ícones com texto quebram a linha e empurram o resto. */}
                <span className="hidden sm:inline">{v.rotulo}</span>
              </button>
            ))}
          </div>

          {/* Agrupamento vale nas TRÊS vistas agora. Antes era exclusivo da
              galeria, o que deixava a vista de lista — a de edição — sem
              nenhuma forma de separar terrenos de mágicas. */}
          <select
            value={agrupamento}
            onChange={(e) => setAgrupamento(e.target.value as AgrupamentoDeDeck)}
            className="bg-panel border-panel-border text-text focus:border-primary rounded-md border px-3 py-2 text-xs focus:outline-none sm:text-sm"
            aria-label="Critério de agrupamento"
          >
            {AGRUPAMENTOS.map((a) => (
              <option key={a.valor} value={a.valor}>
                {a.rotulo}
              </option>
            ))}
          </select>

          {visao === 'galeria' && (
            <div
              className="bg-panel border-panel-border flex items-center gap-1 rounded-md border p-1"
              role="group"
              aria-label="Tamanho das artes"
            >
              <span className="text-text-muted px-1.5 text-[10px] font-bold uppercase">Arte</span>
              {TAMANHOS.map((t) => (
                <button
                  key={t.valor}
                  onClick={() => setTamanho(t.valor)}
                  aria-pressed={tamanho === t.valor}
                  className={`h-7 w-7 rounded text-xs font-bold transition-colors ${
                    tamanho === t.valor
                      ? 'bg-primary text-white'
                      : 'text-text-muted hover:text-text hover:bg-table-deep'
                  }`}
                  title={`Artes ${t.valor === 'pequeno' ? 'pequenas' : t.valor === 'medio' ? 'médias' : 'grandes'}`}
                >
                  {t.rotulo}
                </button>
              ))}
            </div>
          )}

          <span className="text-text-faint ml-auto text-xs">
            {cartas.length} cartas únicas
            {/* Um indicador de escrita em voo, e não um spinner bloqueante: a
                tela já mostra o valor novo, isto só diz que ele está subindo. */}
            {(mudarQuantidade.isPending ||
              removerCarta.isPending ||
              alternarComandante.isPending ||
              adicionarCarta.isPending) && (
              <Loader2 className="ml-2 inline h-3 w-3 animate-spin align-[-1px]" />
            )}
          </span>
        </div>

        {/* ── Legalidade ─────────────────────────────────────────────────────
            Aqui viviam dois `if` escritos à mão: um avisava "o formato
            Commander exige exatas 100" SEM consultar formato nenhum — e por
            isso aparecia em deck de Modern, onde a regra é mínimo 60 — e o
            outro procurava `isBanned`. Eram as duas únicas regras de Magic que
            a tela conhecia. Ver `PainelDeLegalidade`. */}
        <PainelDeLegalidade cartas={cartas} formatId={deck.formatId} cardCount={deck.cardCount} />

        {/* ── Corpo: painel de entrada + lista ───────────────────────────── */}
        <div
          className={`grid gap-5 lg:gap-8 ${somenteLeitura ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-3'}`}
        >
          {!somenteLeitura && (
            <aside className="lg:col-span-1">
              <div className="bg-panel border-panel-border flex h-full flex-col rounded-xl border p-4 shadow-lg sm:p-6">
                <div className="border-panel-border mb-5 flex gap-2 border-b pb-2">
                  <button
                    onClick={() => setAbaEsquerda('busca')}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-t-md py-2 text-sm font-medium transition-colors ${
                      abaEsquerda === 'busca'
                        ? 'text-primary border-primary border-b-2'
                        : 'text-text-muted hover:text-text'
                    }`}
                  >
                    <SearchIcon className="h-4 w-4" /> Buscar Cartas
                  </button>
                  <button
                    onClick={() => setAbaEsquerda('importacao')}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-t-md py-2 text-sm font-medium transition-colors ${
                      abaEsquerda === 'importacao'
                        ? 'text-primary border-primary border-b-2'
                        : 'text-text-muted hover:text-text'
                    }`}
                  >
                    <Save className="h-4 w-4" /> Importação
                  </button>
                </div>

                {abaEsquerda === 'busca' ? (
                  <div className="flex min-h-[24rem] flex-1 flex-col overflow-hidden">
                    <CardSearch onAddCard={aoAdicionarCarta} />
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col">
                    <p className="text-text-muted mb-4 text-sm">
                      Cole sua lista para <strong>substituir</strong> o deck atual.
                    </p>
                    <form onSubmit={enviarImportacao} className="flex flex-1 flex-col">
                      <textarea
                        value={textoDaLista}
                        onChange={(e) => setTextoDaLista(e.target.value)}
                        disabled={importar.isPending}
                        placeholder={'1 Sol Ring\n1x Mana Crypt\n4 Lightning Bolt'}
                        className="bg-table-deep border-panel-border text-text focus:border-primary mb-4 min-h-[16rem] w-full flex-1 resize-y rounded-md border p-4 font-mono text-sm transition-colors focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={importar.isPending || !textoDaLista.trim()}
                        className="bg-primary hover:bg-primary-hover flex w-full items-center justify-center gap-2 rounded-md py-3 font-medium text-white transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {importar.isPending ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Save className="h-5 w-5" />
                        )}
                        {importar.isPending
                          ? 'Lendo Runas na Scryfall...'
                          : 'Substituir por Importação'}
                      </button>
                    </form>

                    {importar.isError && (
                      <div className="bg-danger/10 border-danger/30 text-danger mt-4 flex items-center gap-2 rounded-md border p-4 text-sm">
                        <AlertCircle className="h-5 w-5 shrink-0" />
                        <span>{mensagemDaApi(importar.error)}</span>
                      </div>
                    )}
                    {importar.isSuccess && importar.data.notFound?.length ? (
                      <div className="bg-warning/10 border-warning/30 text-warning mt-4 rounded-md border p-4 text-sm">
                        <p className="font-semibold">⚠️ Não encontradas:</p>
                        <ul className="custom-scrollbar mt-1 max-h-24 list-disc overflow-y-auto pl-4 text-xs">
                          {importar.data.notFound.map((nome, i) => (
                            <li key={`${nome}-${i}`}>{nome}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </aside>
          )}

          <section className={somenteLeitura ? '' : 'min-w-0 lg:col-span-2'}>
            <div className="bg-panel border-panel-border flex h-full min-h-[24rem] flex-col rounded-xl border p-4 shadow-lg sm:p-6">
              {cartas.length === 0 ? (
                <div className="border-panel-border text-text-muted flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center">
                  <LibraryBig className="mb-3 h-10 w-10 opacity-50" />
                  <p>Nenhuma carta neste grimório.</p>
                  {!somenteLeitura && (
                    <p className="mt-1 text-xs">
                      Use a busca ou cole uma lista no painel ao lado para começar.
                    </p>
                  )}
                </div>
              ) : (
                <div className="custom-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
                  {grupos.map((grupo) => (
                    <div key={grupo.nome}>
                      <h3 className="bg-panel text-text border-panel-border sticky top-0 z-10 mb-3 flex items-center justify-between gap-2 border-b pb-2 text-sm font-bold sm:text-base">
                        <span className="flex min-w-0 items-center gap-2">
                          {grupo.nome === 'Comandante' && (
                            <Crown className="text-primary h-4 w-4 shrink-0" />
                          )}
                          <span className="truncate">{grupo.nome}</span>
                        </span>
                        <span className="text-text-muted bg-table-deep shrink-0 rounded px-2 py-0.5 text-xs font-medium">
                          {grupo.total}
                        </span>
                      </h3>

                      {visao === 'galeria' ? (
                        <div className={`grid gap-3 sm:gap-4 ${COLUNAS_DA_GALERIA[tamanho]}`}>
                          {grupo.cartas.map((c) => (
                            <ArteDeCarta key={c.id} carta={c} acoes={acoes} />
                          ))}
                        </div>
                      ) : visao === 'compacta' ? (
                        // Colunas: é o que faz cem cartas caberem numa tela.
                        <div className="columns-1 gap-4 sm:columns-2 xl:columns-3">
                          {grupo.cartas.map((c) => (
                            <LinhaCompacta key={c.id} carta={c} acoes={acoes} />
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {grupo.cartas.map((c) => (
                            <LinhaDeCarta key={c.id} carta={c} acoes={acoes} />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Agrupamento desligado com a vista de lista: os grupos já
                      vêm num só, então isto nunca duplica nada — está aqui só
                      para o caso de `grupos` vir vazio com cartas presentes. */}
                  {grupos.length === 0 && ordenadas.length > 0 && (
                    <div className="space-y-2">
                      {ordenadas.map((c) => (
                        <LinhaDeCarta key={c.id} carta={c} acoes={acoes} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>

        {cartaParaArte && (
          <PrintingPicker
            card={cartaParaArte}
            deckId={deck.id}
            onClose={() => setCartaParaArte(null)}
            onSuccess={() => {
              // O `PrintingPicker` grava direto na API (troca a impressão da
              // carta). Sem invalidar, a arte na tela continuaria a antiga —
              // antes disto a tela chamava `fetchDeck()` aqui.
              void qc.invalidateQueries({ queryKey: chavesDeDeck.um(id) });
              setCartaParaArte(null);
            }}
          />
        )}
      </div>

      <ConfirmDialog
        aberto={cartaParaRemover !== null}
        titulo="Remover carta do grimório?"
        descricao="A carta sai da lista. Você pode adicioná-la de novo pela busca."
        rotuloConfirmar="Remover"
        perigo
        onConfirmar={() => {
          if (cartaParaRemover) removerCarta.mutate(cartaParaRemover);
          setCartaParaRemover(null);
        }}
        onCancelar={() => setCartaParaRemover(null)}
      />
      <ToastHost />
    </>
  );
}
