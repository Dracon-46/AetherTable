'use client';

/**
 * Histórico — as partidas que a conta jogou.
 *
 * A RN12 dizia "sem histórico de partidas": a partida existia só enquanto a
 * sala estava aberta. Ela foi revista em 14/10/2026 — o que se guarda é o
 * RESUMO (quem jogou, com que deck e comandante, quem venceu, quanto durou),
 * nunca o replay. É o que basta para "com que deck eu mais ganho?" e para
 * reabrir o deck daquela partida.
 *
 * O nome de cada jogador vem da conta na hora da leitura: quem excluiu a conta
 * aparece como "Conta excluída".
 */

import { useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Crown,
  History,
  Loader2,
  Swords,
  Trophy,
  X,
} from 'lucide-react';
import { FORMATOS_JOGAVEIS, acharFormato } from '@aethertable/shared-types';
import { cardImageUrl } from '@/canvas/textureCache';
import { useCardCatalog, useHidratarCartas } from '@/cards/catalog';
import { ToastHost, useToast } from '@/components/Toast';
import { mensagemDaApi } from '@/lib/fetcher';
import {
  formatarDuracao,
  motivoLegivel,
  useEstatisticasDoHistorico,
  useHistorico,
  type FiltroDeResultado,
  type PartidaDoHistorico,
  type ResultadoDaPartida,
} from '../../../historico/useHistorico';
import { useT } from '../../../i18n/i18n';

const ABAS: readonly (readonly [FiltroDeResultado, string])[] = [
  ['todas', 'Todas'],
  ['vitorias', 'Vitórias'],
  ['derrotas', 'Derrotas'],
  ['sem-vencedor', 'Sem vencedor'],
];

const SELO: Record<ResultadoDaPartida, { rotulo: string; classe: string }> = {
  VITORIA: { rotulo: 'Vitória', classe: 'bg-success/15 text-success' },
  DERROTA: { rotulo: 'Derrota', classe: 'bg-danger/15 text-danger' },
  SEM_VENCEDOR: { rotulo: 'Sem vencedor', classe: 'bg-panel-hover text-text-muted' },
};

const MES = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const DATA_E_HORA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** A partida em texto puro — para colar num grupo de conversa. */
function resumoEmTexto(p: PartidaDoHistorico, nomeDaCarta: (id: string | null) => string) {
  const cabecalho = [
    acharFormato(p.formato).nome,
    DATA_E_HORA.format(new Date(p.terminouEm)),
    `${p.jogadores} jogadores`,
    formatarDuracao(p.duracaoSegundos),
    p.rodadas ? `${p.rodadas} rodadas` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const linhas = p.participantes.map((j) => {
    const deck = [j.nomeDoDeck, nomeDaCarta(j.comandanteId)].filter(Boolean).join(' — ');
    const fim = j.venceu
      ? 'venceu'
      : (motivoLegivel(j.motivoDaEliminacao) ??
        (j.saiuAntes ? 'saiu antes do fim' : `vida ${j.vidaFinal ?? '?'}`));
    return `${j.venceu ? '🏆' : '•'} ${j.nome}${deck ? ` (${deck})` : ''}: ${fim}`;
  });
  return [`AetherTable — ${cabecalho}`, ...linhas].join('\n');
}

export default function HistoricoPage() {
  const t = useT();
  const [resultado, setResultado] = useState<FiltroDeResultado>('todas');
  const [formato, setFormato] = useState('');
  const [pagina, setPagina] = useState(1);
  const [aberta, setAberta] = useState<PartidaDoHistorico | null>(null);
  const catalogo = useCardCatalog((s) => s.cartas);
  const mostrar = useToast((s) => s.mostrar);

  const { data, isPending, isError, error, isFetching } = useHistorico({
    resultado,
    formato: formato || undefined,
    pagina,
  });
  const { data: numeros } = useEstatisticasDoHistorico();

  useHidratarCartas([
    ...(data?.partidas ?? []).flatMap((p) => p.participantes.map((j) => j.comandanteId)),
    numeros?.comandanteMaisJogado?.comandanteId,
  ]);

  const nomeDaCarta = (id: string | null) => (id ? (catalogo[id]?.name ?? '') : '');
  const paginas = data ? Math.max(1, Math.ceil(data.total / data.porPagina)) : 1;

  // Agrupa por mês, na ordem em que o servidor mandou (mais recentes primeiro).
  const meses: { mes: string; partidas: PartidaDoHistorico[] }[] = [];
  for (const p of data?.partidas ?? []) {
    const mes = MES.format(new Date(p.terminouEm));
    const ultimo = meses[meses.length - 1];
    if (ultimo?.mes === mes) ultimo.partidas.push(p);
    else meses.push({ mes, partidas: [p] });
  }

  const copiar = async (p: PartidaDoHistorico) => {
    try {
      await navigator.clipboard.writeText(resumoEmTexto(p, nomeDaCarta));
      mostrar('Resumo copiado.', 'sucesso');
    } catch {
      mostrar('Não deu para copiar: o navegador negou a área de transferência.', 'erro');
    }
  };

  return (
    <>
      <div className="mx-auto max-w-5xl animate-[fadeIn_0.3s_ease-out]">
        <header className="mb-6">
          <h1 className="text-text mb-2 flex items-center gap-3 text-2xl font-bold sm:text-3xl">
            <History className="text-primary h-7 w-7 sm:h-8 sm:w-8" />
            {t('Histórico')}
          </h1>
          <p className="text-text-muted text-sm sm:text-base">
            {t('As partidas que você jogou: quem estava na mesa, com que deck e quem venceu.')}
          </p>
        </header>

        {/* ── Números ─────────────────────────────────────────────────────── */}
        <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Resumo">
          <Numero
            Icone={Swords}
            rotulo="Partidas"
            valor={numeros ? String(numeros.partidas) : '—'}
          />
          <Numero
            Icone={Trophy}
            rotulo="Vitórias"
            valor={
              numeros ? `${numeros.vitorias} (${Math.round(numeros.taxaDeVitoria * 100)} %)` : '—'
            }
          />
          <Numero
            Icone={Clock}
            rotulo="Duração média"
            valor={numeros?.partidas ? formatarDuracao(numeros.duracaoMediaSegundos) : '—'}
          />
          <Numero
            Icone={Crown}
            rotulo="Comandante mais jogado"
            valor={
              numeros?.comandanteMaisJogado
                ? `${nomeDaCarta(numeros.comandanteMaisJogado.comandanteId) || '…'} (${numeros.comandanteMaisJogado.partidas})`
                : '—'
            }
          />
        </section>

        {/* ── Filtros ─────────────────────────────────────────────────────── */}
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div
            className="border-panel-border bg-panel flex flex-wrap rounded-lg border p-1"
            role="tablist"
            aria-label="Resultado"
          >
            {ABAS.map(([valor, rotulo]) => (
              <button
                key={valor}
                role="tab"
                aria-selected={resultado === valor}
                onClick={() => {
                  setResultado(valor);
                  setPagina(1);
                }}
                className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors sm:text-sm ${
                  resultado === valor ? 'bg-primary text-white' : 'text-text-muted hover:text-text'
                }`}
              >
                {rotulo}
              </button>
            ))}
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
          {isFetching && !isPending && <Loader2 className="text-primary h-4 w-4 animate-spin" />}
        </div>

        {/* ── Lista ───────────────────────────────────────────────────────── */}
        {isPending ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="bg-panel border-panel-border h-24 animate-pulse rounded-xl border"
              />
            ))}
          </div>
        ) : isError ? (
          <p className="text-danger text-sm">{mensagemDaApi(error)}</p>
        ) : meses.length === 0 ? (
          <div className="border-panel-border rounded-xl border border-dashed py-14 text-center">
            <History className="text-text-muted mx-auto mb-3 h-12 w-12 opacity-50" />
            <p className="text-text-muted px-4">
              {resultado === 'todas' && !formato
                ? 'Nenhuma partida ainda. Elas aparecem aqui quando a mesa termina.'
                : 'Nenhuma partida com esses filtros.'}
            </p>
          </div>
        ) : (
          meses.map(({ mes, partidas }) => (
            <section key={mes} className="mb-6">
              <h2 className="text-text-muted mb-2 text-xs font-semibold uppercase tracking-wider">
                {mes}
              </h2>
              <ul className="flex flex-col gap-3">
                {partidas.map((p) => {
                  const eu = p.participantes.find((j) => j.souEu);
                  const selo = SELO[p.resultado];
                  return (
                    <li key={p.id}>
                      <button
                        onClick={() => setAberta(p)}
                        className="bg-panel border-panel-border hover:border-primary group flex w-full items-stretch overflow-hidden rounded-xl border text-left shadow-md transition-all"
                      >
                        <div className="relative w-24 shrink-0 overflow-hidden sm:w-36">
                          {eu?.comandanteId ? (
                            <img
                              src={cardImageUrl(eu.comandanteId, 'art_crop')}
                              alt=""
                              className="h-full w-full object-cover opacity-85 transition-opacity group-hover:opacity-100"
                              loading="lazy"
                            />
                          ) : (
                            <div className="bg-table-deep h-full w-full" />
                          )}
                          <div className="to-panel absolute inset-0 bg-gradient-to-r from-transparent" />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-1 p-3 sm:p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-bold ${selo.classe}`}
                            >
                              {selo.rotulo}
                            </span>
                            <span className="text-text truncate text-sm font-semibold">
                              {eu?.nomeDoDeck || nomeDaCarta(eu?.comandanteId ?? null) || 'Partida'}
                            </span>
                          </div>
                          <p className="text-text-muted truncate text-xs">
                            contra{' '}
                            {p.participantes
                              .filter((j) => !j.souEu)
                              .map((j) => j.nome)
                              .join(', ') || 'ninguém'}
                          </p>
                          <p className="text-text-faint mt-auto flex flex-wrap gap-x-2 text-xs">
                            <span>{acharFormato(p.formato).nome}</span>
                            <span>· {DATA_E_HORA.format(new Date(p.terminouEm))}</span>
                            <span>· {formatarDuracao(p.duracaoSegundos)}</span>
                            {p.rodadas ? <span>· {p.rodadas} rodadas</span> : null}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
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

      {aberta && (
        <DetalheDaPartida
          partida={aberta}
          nomeDaCarta={nomeDaCarta}
          aoCopiar={() => copiar(aberta)}
          aoFechar={() => setAberta(null)}
        />
      )}
      <ToastHost />
    </>
  );
}

function Numero({ Icone, rotulo, valor }: { Icone: typeof Trophy; rotulo: string; valor: string }) {
  return (
    <div className="bg-panel border-panel-border flex items-center gap-3 rounded-xl border p-3 sm:p-4">
      <Icone className="text-primary h-5 w-5 shrink-0" />
      <div className="min-w-0">
        <p className="text-text-muted text-xs">{rotulo}</p>
        <p className="text-text truncate text-sm font-bold sm:text-base" title={valor}>
          {valor}
        </p>
      </div>
    </div>
  );
}

function DetalheDaPartida({
  partida: p,
  nomeDaCarta,
  aoCopiar,
  aoFechar,
}: {
  partida: PartidaDoHistorico;
  nomeDaCarta: (id: string | null) => string;
  aoCopiar: () => void;
  aoFechar: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex animate-[fadeIn_0.2s_ease-out] items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-da-partida"
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') aoFechar();
      }}
    >
      <div className="bg-panel border-panel-border custom-scrollbar max-h-[calc(100dvh-2rem)] w-full max-w-lg animate-[popIn_0.2s_ease-out] overflow-y-auto rounded-xl border p-5 shadow-2xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="titulo-da-partida" className="text-text text-lg font-bold">
              {acharFormato(p.formato).nome} · {SELO[p.resultado].rotulo}
            </h2>
            <p className="text-text-muted text-xs">
              {DATA_E_HORA.format(new Date(p.terminouEm))} · {formatarDuracao(p.duracaoSegundos)}
              {p.rodadas ? ` · ${p.rodadas} rodadas` : ''}
            </p>
          </div>
          <button
            onClick={aoFechar}
            autoFocus
            className="text-text-muted hover:text-text hover:bg-panel-hover rounded-md p-1.5"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <ul className="mb-5 flex flex-col gap-2">
          {p.participantes.map((j, i) => {
            const comandante = nomeDaCarta(j.comandanteId);
            const fim = j.venceu
              ? 'Venceu'
              : (motivoLegivel(j.motivoDaEliminacao) ?? (j.saiuAntes ? 'saiu antes do fim' : null));
            return (
              <li
                key={`${j.nome}-${i}`}
                className={`border-panel-border flex items-center gap-3 rounded-lg border p-2 ${
                  j.souEu ? 'bg-primary/10' : ''
                }`}
              >
                <div className="bg-table-deep h-12 w-16 shrink-0 overflow-hidden rounded">
                  {j.comandanteId && (
                    <img
                      src={cardImageUrl(j.comandanteId, 'art_crop')}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-text flex items-center gap-1.5 truncate text-sm font-semibold">
                    {j.venceu && <Trophy className="text-warning h-3.5 w-3.5 shrink-0" />}
                    {j.nome}
                    {j.souEu && <span className="text-text-muted font-normal">(você)</span>}
                    {j.comecou && (
                      <span className="text-text-faint text-xs font-normal">· começou</span>
                    )}
                  </p>
                  <p className="text-text-muted truncate text-xs">
                    {[j.nomeDoDeck, comandante].filter(Boolean).join(' — ') ||
                      'deck não registrado'}
                    {j.bracket ? ` · bracket ${j.bracket}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-text text-sm font-bold tabular-nums">{j.vidaFinal ?? '—'}</p>
                  {fim && <p className="text-text-faint text-[11px]">{fim}</p>}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap justify-end gap-2">
          <button
            onClick={aoCopiar}
            className="border-panel-border text-text hover:bg-panel-hover flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <Copy className="h-4 w-4" />
            Copiar resumo
          </button>
          {p.participantes.find((j) => j.souEu)?.deckId && (
            <Link
              href={`/dashboard/decks/${p.participantes.find((j) => j.souEu)!.deckId}`}
              className="bg-primary hover:bg-primary-hover flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-white"
            >
              Abrir o deck
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
