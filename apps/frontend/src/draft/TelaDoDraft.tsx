'use client';

/**
 * TelaDoDraft.tsx — draft contra robôs (ou selado), do pacote ao deck salvo.
 *
 * Quatro passos, todos nesta tela e sem servidor no meio até o último:
 *
 *   1. ESCOLHER — a coleção e o modo (draft de 3 pacotes contra 7 robôs, ou
 *      selado com 6 pacotes abertos de uma vez);
 *   2. DRAFTAR — uma carta por pacote, 42 escolhas (ver `motor.ts`);
 *   3. MONTAR — 23 mágicas do que você pegou, mais os básicos (sugeridos pelas
 *      cores) até 40; o resto vira reserva;
 *   4. SALVAR — o deck nasce na conta (formato Booster Draft ou Sealed) pela
 *      importação de lista, com a impressão da coleção.
 *
 * Fechar a página no meio perde o draft: é uma partida de solitário de quinze
 * minutos, e guardar estado de draft no servidor não se paga.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Layers, Loader2, Package, Save, Sparkles } from 'lucide-react';
import { cardImageUrl } from '@/canvas/textureCache';
import { api, mensagemDaApi } from '../lib/fetcher';
import {
  CARTAS_POR_PACOTE,
  comecarDraft,
  coresDe,
  escolher,
  montarPacote,
  RODADAS,
  sugerirBasicos,
  type CartaDeDraft,
  type EstadoDoDraft,
} from './motor';
import { carregarColecao, COLECOES_DE_DRAFT, listaDoDeck, NOME_DO_BASICO } from './colecoes';

type Modo = 'draft' | 'selado';
const PACOTES_DO_SELADO = 6;
const TAMANHO_DO_DECK = 40;
const CORES = ['W', 'U', 'B', 'R', 'G'] as const;
const NOME_DA_COR: Record<string, string> = {
  W: 'Branco',
  U: 'Azul',
  B: 'Preto',
  R: 'Vermelho',
  G: 'Verde',
};

/**
 * Agrupa por cor (multicolor e incolor à parte), ordenado por custo. Devolve
 * ÍNDICES: a mesma carta pode vir em dois pacotes, e é o índice que distingue
 * uma cópia da outra.
 */
function porCor(cartas: readonly CartaDeDraft[]): Array<[string, number[]]> {
  const grupos = new Map<string, number[]>();
  cartas.forEach((c, i) => {
    const cs = coresDe(c);
    const chave = cs.length === 0 ? 'Incolor' : cs.length > 1 ? 'Multicolor' : NOME_DA_COR[cs[0]!]!;
    grupos.set(chave, [...(grupos.get(chave) ?? []), i]);
  });
  return [...grupos].map(([k, v]) => [
    k,
    v.sort((a, b) => (cartas[a]!.cmc ?? 0) - (cartas[b]!.cmc ?? 0)),
  ]);
}

export function TelaDoDraft() {
  const router = useRouter();
  const [codigo, setCodigo] = useState<string>(COLECOES_DE_DRAFT[0].codigo);
  const [modo, setModo] = useState<Modo>('draft');
  const [colecao, setColecao] = useState<CartaDeDraft[] | null>(null);
  const [estado, setEstado] = useState<EstadoDoDraft | null>(null);
  /** O que você tem para montar: as escolhas do draft, ou os pacotes do selado. */
  const [poolSelado, setPoolSelado] = useState<CartaDeDraft[] | null>(null);
  /** Índices (no pool) das cartas que estão no DECK; o resto é reserva. */
  const [noDeck, setNoDeck] = useState<Set<number>>(new Set());
  const [basicos, setBasicos] = useState<Record<string, number>>({});
  const [nome, setNome] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const pool = useMemo(
    () => poolSelado ?? (estado?.terminou ? estado.escolhidas[0]! : null),
    [poolSelado, estado],
  );
  const fase: 'escolher' | 'draftar' | 'montar' = pool ? 'montar' : estado ? 'draftar' : 'escolher';

  const comecar = async () => {
    setCarregando(true);
    setErro(null);
    try {
      const cartas = await carregarColecao(codigo);
      if (cartas.length < 60)
        throw new Error('A coleção veio incompleta da Scryfall. Tente outra.');
      setColecao(cartas);
      const nomeDaColecao = COLECOES_DE_DRAFT.find((c) => c.codigo === codigo)?.nome ?? codigo;
      setNome(`${modo === 'draft' ? 'Draft' : 'Selado'} de ${nomeDaColecao}`.slice(0, 80));
      if (modo === 'selado') {
        const abertas = Array.from({ length: PACOTES_DO_SELADO }, () =>
          montarPacote(cartas, Math.random),
        ).flat();
        setPoolSelado(abertas);
        prepararMontagem(abertas);
      } else {
        setEstado(comecarDraft(cartas, Math.random));
      }
    } catch (e) {
      setErro(mensagemDaApi(e));
    } finally {
      setCarregando(false);
    }
  };

  /** Ponto de partida da montagem: as 23 "melhores" das duas cores principais. */
  const prepararMontagem = (cartas: readonly CartaDeDraft[]) => {
    const conta = new Map<string, number>();
    for (const c of cartas) for (const cor of coresDe(c)) conta.set(cor, (conta.get(cor) ?? 0) + 1);
    const principais = [...conta]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([c]) => c);
    const peso: Record<string, number> = { mythic: 4, rare: 3, uncommon: 2, common: 1 };
    const candidatas = cartas
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !/\bLand\b/.test(c.type_line ?? '') || coresDe(c).length > 0)
      .filter(({ c }) => coresDe(c).every((x) => principais.includes(x)))
      .sort((a, b) => (peso[b.c.rarity] ?? 0) - (peso[a.c.rarity] ?? 0));
    const escolhidas = new Set(candidatas.slice(0, 23).map(({ i }) => i));
    setNoDeck(escolhidas);
    setBasicos(
      sugerirBasicos(
        [...escolhidas].map((i) => cartas[i]!),
        TAMANHO_DO_DECK - escolhidas.size,
      ),
    );
  };

  const pegar = (indice: number) => {
    if (!estado || !colecao) return;
    const novo = escolher(estado, indice, colecao, Math.random);
    setEstado(novo);
    if (novo.terminou) prepararMontagem(novo.escolhidas[0]!);
  };

  const alternar = (i: number) =>
    setNoDeck((antes) => {
      const novo = new Set(antes);
      if (novo.has(i)) novo.delete(i);
      else novo.add(i);
      return novo;
    });

  const totalBasicos = Object.values(basicos).reduce((a, b) => a + b, 0);
  const totalDoDeck = noDeck.size + totalBasicos;

  const salvar = async () => {
    if (!pool) return;
    setSalvando(true);
    setErro(null);
    try {
      const deck = pool.filter((_, i) => noDeck.has(i));
      const reserva = pool.filter((_, i) => !noDeck.has(i));
      const criado = await api<{ id: string }>('/decks', {
        method: 'POST',
        body: {
          name: nome.trim() || 'Draft',
          formatId: modo === 'draft' ? 'booster_draft' : 'sealed',
        },
      });
      await api(`/decks/${criado.id}/import`, {
        method: 'POST',
        body: { decklist: listaDoDeck(deck, reserva, basicos, codigo) },
      });
      router.push(`/dashboard/decks/${criado.id}`);
    } catch (e) {
      setErro(mensagemDaApi(e));
      setSalvando(false);
    }
  };

  // ─── 1. Escolher ─────────────────────────────────────────────────────────
  if (fase === 'escolher') {
    return (
      <div className="bg-panel border-panel-border max-w-xl space-y-5 rounded-xl border p-5 sm:p-6">
        <div>
          <label className="text-text-muted mb-1.5 block text-xs font-medium">Coleção</label>
          <select
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            aria-label="Coleção"
            className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
          >
            {COLECOES_DE_DRAFT.map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(
            [
              ['draft', 'Draft contra robôs', 'Três pacotes passando em roda com sete robôs.', Bot],
              [
                'selado',
                'Selado',
                'Seis pacotes abertos de uma vez; monte com o que vier.',
                Package,
              ],
            ] as const
          ).map(([id, rotulo, texto, Icone]) => (
            <button
              key={id}
              onClick={() => setModo(id)}
              aria-pressed={modo === id}
              className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left ${
                modo === id ? 'border-primary bg-primary/10' : 'border-panel-border'
              }`}
            >
              <Icone className="text-primary h-5 w-5" />
              <span className="text-text text-sm font-semibold">{rotulo}</span>
              <span className="text-text-faint text-xs">{texto}</span>
            </button>
          ))}
        </div>
        {erro && <p className="text-danger text-sm">{erro}</p>}
        <button
          onClick={() => void comecar()}
          disabled={carregando}
          className="bg-primary hover:bg-primary-hover flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {carregando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {carregando ? 'Abrindo os pacotes…' : 'Começar'}
        </button>
      </div>
    );
  }

  // ─── 2. Draftar ──────────────────────────────────────────────────────────
  if (fase === 'draftar' && estado) {
    const pacote = estado.pacotes[0]!;
    const minhas = estado.escolhidas[0]!;
    return (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <section>
          <p className="text-text mb-3 text-sm font-semibold">
            Pacote {estado.rodada + 1} de {RODADAS} · escolha {estado.escolha + 1} de{' '}
            {CARTAS_POR_PACOTE}
            <span className="text-text-faint ml-2 font-normal">
              (passando para a {estado.rodada === 1 ? 'direita' : 'esquerda'})
            </span>
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5">
            {pacote.map((c, i) => (
              <button
                key={`${c.id}-${i}`}
                onClick={() => pegar(i)}
                aria-label={`Pegar ${c.name}`}
                className="hover:ring-primary group rounded-lg transition-transform hover:-translate-y-1 hover:ring-2"
              >
                <img
                  src={cardImageUrl(c.id, 'normal')}
                  alt={c.name}
                  className="aspect-[5/7] w-full rounded-lg bg-black/20 object-cover"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        </section>
        <aside className="bg-panel border-panel-border h-fit rounded-xl border p-3">
          <p className="text-text mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <Layers className="text-primary h-4 w-4" /> Suas escolhas ({minhas.length})
          </p>
          {porCor(minhas).map(([cor, indices]) => (
            <div key={cor} className="mb-2">
              <p className="text-text-faint text-[11px] font-semibold uppercase">
                {cor} ({indices.length})
              </p>
              <ul className="text-text-muted text-xs">
                {indices.map((i) => (
                  <li key={i} className="truncate">
                    {minhas[i]!.name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>
      </div>
    );
  }

  // ─── 3. Montar ───────────────────────────────────────────────────────────
  const cartas = pool!;
  const indicesPorCor = porCor(cartas);
  return (
    <div className="space-y-5">
      <div className="bg-panel border-panel-border flex flex-wrap items-end gap-4 rounded-xl border p-4">
        <div className="min-w-0 flex-1">
          <label className="text-text-muted mb-1 block text-xs font-medium">Nome do deck</label>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={80}
            aria-label="Nome do deck"
            className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {CORES.map((cor) => (
            <label key={cor} className="text-text-muted flex flex-col text-[11px]">
              {NOME_DO_BASICO[cor]}
              <input
                type="number"
                min={0}
                max={30}
                value={basicos[cor] ?? 0}
                onChange={(e) =>
                  setBasicos((b) => ({
                    ...b,
                    [cor]: Math.max(0, Math.min(30, Number(e.target.value) || 0)),
                  }))
                }
                className="bg-table-deep border-panel-border text-text w-14 rounded border px-2 py-1 text-sm"
              />
            </label>
          ))}
          <button
            onClick={() =>
              setBasicos(
                sugerirBasicos(
                  [...noDeck].map((i) => cartas[i]!),
                  Math.max(0, TAMANHO_DO_DECK - noDeck.size),
                ),
              )
            }
            className="border-panel-border text-text-muted hover:text-text rounded-md border px-3 py-1.5 text-xs"
          >
            Sugerir básicos
          </button>
        </div>
        <div className="text-right">
          <p
            className={`text-sm font-bold ${totalDoDeck >= TAMANHO_DO_DECK ? 'text-success' : 'text-warning'}`}
          >
            {totalDoDeck} / {TAMANHO_DO_DECK}
          </p>
          <p className="text-text-faint text-[11px]">
            {noDeck.size} mágicas + {totalBasicos} básicos
          </p>
        </div>
        <button
          onClick={() => void salvar()}
          disabled={salvando || totalDoDeck < TAMANHO_DO_DECK}
          title={
            totalDoDeck < TAMANHO_DO_DECK ? 'O deck precisa de pelo menos 40 cartas' : undefined
          }
          className="bg-primary hover:bg-primary-hover flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar deck
        </button>
      </div>
      {erro && <p className="text-danger text-sm">{erro}</p>}
      <p className="text-text-muted text-xs">
        Clique numa carta para pô-la no deck ou tirá-la (vai para a reserva).
      </p>
      {indicesPorCor.map(([cor, indices]) => (
        <section key={cor}>
          <h3 className="text-text-muted mb-2 text-xs font-semibold uppercase tracking-wider">
            {cor}
          </h3>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
            {indices.map((i) => {
              const c = cartas[i]!;
              const dentro = noDeck.has(i);
              return (
                <button
                  key={i}
                  onClick={() => alternar(i)}
                  aria-pressed={dentro}
                  aria-label={`${dentro ? 'Tirar' : 'Pôr'} ${c.name}`}
                  className={`rounded-lg transition-opacity ${dentro ? 'ring-primary ring-2' : 'opacity-45 hover:opacity-80'}`}
                >
                  <img
                    src={cardImageUrl(c.id, 'normal')}
                    alt={c.name}
                    className="aspect-[5/7] w-full rounded-lg bg-black/20 object-cover"
                    loading="lazy"
                  />
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
