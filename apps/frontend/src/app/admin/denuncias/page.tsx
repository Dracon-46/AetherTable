'use client';

/**
 * Central de moderação (DOC-061 §4).
 *
 * ─── A EVIDÊNCIA É O SNAPSHOT, E ELE NÃO É FATO ────────────────────────────
 *
 * O áudio não é gravado (decisão de produto: privacidade), então a única
 * evidência de uma denúncia de conduta verbal é o que o denunciante capturou do
 * log e do chat no momento do clique. Isso é texto que ELE controla.
 *
 * A tela mostra o snapshot como CITAÇÃO, com o aviso de que veio do
 * denunciante. Apresentá-lo como registro do sistema faria um moderador
 * apressado punir alguém com base em texto que a outra parte digitou.
 *
 * O que substitui a prova é o PADRÃO: "3 denúncias abertas contra esta conta"
 * aparece em destaque, porque o documento é explícito em que ofensa verbal
 * depende de denúncias múltiplas para gerar bloqueio.
 */

import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Flag,
  Loader2,
  MessageSquareQuote,
  ShieldAlert,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import {
  useAcaoDeDenuncia,
  useDenuncia,
  useDenuncias,
  useResumoDeDenuncias,
  type StatusDeDenuncia,
} from '../../../admin/useAdmin';
import { DialogoDeAcao, quando } from '../../../admin/Componentes';
import { mensagemDaApi } from '@/lib/fetcher';

const MOTIVO_LEGIVEL: Record<string, string> = {
  HARASSMENT: 'Assédio',
  CHEATING: 'Trapaça',
  SPAM: 'Spam',
  HATE_SPEECH: 'Discurso de ódio',
  OTHER: 'Outro',
};

const STATUS_LEGIVEL: Record<StatusDeDenuncia, { rotulo: string; classe: string }> = {
  OPEN: { rotulo: 'aberta', classe: 'bg-warning/15 text-warning border-warning/30' },
  REVIEWING: { rotulo: 'em análise', classe: 'bg-primary/15 text-primary border-primary/30' },
  RESOLVED: { rotulo: 'resolvida', classe: 'bg-success/15 text-success border-success/30' },
  DISMISSED: {
    rotulo: 'improcedente',
    classe: 'bg-table-deep text-text-muted border-panel-border',
  },
};

const FILTROS: Array<{ valor: StatusDeDenuncia | ''; rotulo: string }> = [
  { valor: 'OPEN', rotulo: 'Abertas' },
  { valor: 'REVIEWING', rotulo: 'Em análise' },
  { valor: 'RESOLVED', rotulo: 'Resolvidas' },
  { valor: 'DISMISSED', rotulo: 'Improcedentes' },
  { valor: '', rotulo: 'Todas' },
];

export default function DenunciasPage() {
  const [filtro, setFiltro] = useState<StatusDeDenuncia | ''>('OPEN');
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [encerrando, setEncerrando] = useState<'RESOLVED' | 'DISMISSED' | null>(null);

  const { data, isPending, isError, error } = useDenuncias(filtro);
  const resumo = useResumoDeDenuncias();
  const detalhe = useDenuncia(selecionada);

  const assumir = useAcaoDeDenuncia((id) => `/admin/denuncias/${id}/assumir`);
  const resolver = useAcaoDeDenuncia<{ status: string; resolucao: string }>(
    (id) => `/admin/denuncias/${id}/resolver`,
  );

  const d = detalhe.data;

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <div className={selecionada ? 'lg:col-span-2' : 'lg:col-span-5'}>
        {/* Os contadores por status são navegação E informação: "0 abertas" é
            a resposta que o moderador procura ao abrir a tela. */}
        <div className="custom-scrollbar mb-4 flex gap-1 overflow-x-auto">
          {FILTROS.map((f) => {
            const n = f.valor ? resumo.data?.[f.valor] : undefined;
            return (
              <button
                key={f.valor || 'todas'}
                onClick={() => setFiltro(f.valor)}
                aria-pressed={filtro === f.valor}
                className={`flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  filtro === f.valor
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-panel-border bg-panel text-text-muted hover:text-text'
                }`}
              >
                {f.rotulo}
                {n !== undefined && (
                  <span className="bg-table-deep rounded px-1.5 font-mono text-[10px]">{n}</span>
                )}
              </button>
            );
          })}
        </div>

        {isPending ? (
          <div className="text-text-muted flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando fila…
          </div>
        ) : isError ? (
          <div className="border-danger/30 bg-danger/10 text-danger flex items-center gap-2 rounded-lg border p-3 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {mensagemDaApi(error)}
          </div>
        ) : data.itens.length === 0 ? (
          <div className="border-panel-border text-text-muted rounded-xl border border-dashed py-12 text-center">
            <CheckCircle2 className="text-success mx-auto mb-3 h-10 w-10" />
            <p className="text-sm">Nada nesta fila.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {data.itens.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => setSelecionada(item.id)}
                  className={`border-panel-border bg-panel hover:border-primary w-full rounded-xl border p-3 text-left transition-colors ${
                    selecionada === item.id ? 'border-primary bg-primary/5' : ''
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <Flag className="text-text-muted h-3.5 w-3.5 shrink-0" />
                    <span className="text-text min-w-0 flex-1 truncate text-sm font-bold">
                      {MOTIVO_LEGIVEL[item.reason] ?? item.reason}
                    </span>
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${STATUS_LEGIVEL[item.status].classe}`}
                    >
                      {STATUS_LEGIVEL[item.status].rotulo}
                    </span>
                  </div>
                  <p className="text-text-muted truncate text-xs">
                    <strong className="text-text">{item.reported.username}</strong> denunciado por{' '}
                    {item.reporter.username}
                    {item.roomCode ? ` · sala ${item.roomCode}` : ''}
                  </p>
                  <p className="text-text-faint mt-0.5 text-[11px]">{quando(item.createdAt)}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Detalhe ──────────────────────────────────────────────────────── */}
      {selecionada && (
        <aside className="lg:col-span-3">
          <div className="border-panel-border bg-panel rounded-xl border p-4">
            {detalhe.isPending ? (
              <div className="text-text-muted flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
              </div>
            ) : !d ? (
              <p className="text-text-muted text-sm">Denúncia não encontrada.</p>
            ) : (
              <>
                <div className="mb-3 flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-text text-base font-bold">
                      {MOTIVO_LEGIVEL[d.reason] ?? d.reason}
                    </h2>
                    <p className="text-text-muted text-xs">
                      <strong className="text-text">{d.reported.username}</strong> · denunciado por{' '}
                      {d.reporter.username} · {quando(d.createdAt)}
                      {d.roomCode ? ` · sala ${d.roomCode}` : ''}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${STATUS_LEGIVEL[d.status].classe}`}
                  >
                    {STATUS_LEGIVEL[d.status].rotulo}
                  </span>
                  <button
                    onClick={() => setSelecionada(null)}
                    className="text-text-muted hover:text-text shrink-0"
                    aria-label="Fechar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* ── O padrão ─────────────────────────────────────────────
                    Em destaque porque é a evidência que existe quando não há
                    gravação. Ver o cabeçalho deste arquivo. */}
                {d.totalContraEle > 1 && (
                  <div
                    className={`mb-3 flex items-center gap-2 rounded-lg border p-3 text-sm ${
                      d.abertasContraEle > 2
                        ? 'border-danger/40 bg-danger/10 text-danger'
                        : 'border-warning/40 bg-warning/10 text-warning'
                    }`}
                  >
                    <Users className="h-4 w-4 shrink-0" />
                    <span>
                      <strong>{d.totalContraEle}</strong> denúncias contra esta conta no total,{' '}
                      <strong>{d.abertasContraEle}</strong> ainda abertas.
                    </span>
                  </div>
                )}

                {d.details && (
                  <section className="mb-3">
                    <h3 className="text-text-muted mb-1 text-[11px] font-bold uppercase">
                      O que o denunciante escreveu
                    </h3>
                    <p className="bg-table-deep text-text whitespace-pre-wrap rounded-md p-3 text-sm">
                      {d.details}
                    </p>
                  </section>
                )}

                {/* ── Evidência ──────────────────────────────────────────── */}
                <section className="mb-4">
                  <h3 className="text-text-muted mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase">
                    <MessageSquareQuote className="h-3.5 w-3.5" />
                    Log capturado ({d.snapshot?.length ?? 0} linhas)
                  </h3>
                  {d.snapshot?.length ? (
                    <>
                      <div className="bg-table-deep custom-scrollbar max-h-64 overflow-y-auto rounded-md p-3">
                        {d.snapshot.map((linha, i) => (
                          <p
                            key={i}
                            className="text-text-muted font-mono text-[11px] leading-relaxed"
                          >
                            {linha.autor && <span className="text-primary">{linha.autor}: </span>}
                            {linha.texto}
                          </p>
                        ))}
                      </div>
                      <p className="text-text-faint mt-1.5 flex items-start gap-1.5 text-[11px]">
                        <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
                        Capturado pelo CLIENTE do denunciante, não pelo servidor. Trate como
                        citação, não como registro do sistema. Áudio não é gravado.
                      </p>
                    </>
                  ) : (
                    <p className="text-text-faint text-xs">
                      Sem log capturado — a denúncia foi feita fora de uma partida ou o cliente não
                      enviou evidência.
                    </p>
                  )}
                </section>

                {d.status === 'RESOLVED' || d.status === 'DISMISSED' ? (
                  <div className="border-panel-border bg-table-deep rounded-md border p-3 text-sm">
                    <p className="text-text-muted mb-1 text-[11px] font-bold uppercase">
                      Encerrada por {d.resolvedBy?.username ?? '—'} em {quando(d.resolvedAt)}
                    </p>
                    <p className="text-text">{d.resolution}</p>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {d.status === 'OPEN' && (
                      <button
                        onClick={() => assumir.mutate({ id: d.id })}
                        disabled={assumir.isPending}
                        className="border-panel-border bg-table-deep text-text hover:border-primary hover:text-primary flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        {assumir.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Marcar em análise
                      </button>
                    )}
                    <button
                      onClick={() => setEncerrando('RESOLVED')}
                      className="bg-success/15 text-success border-success/30 hover:bg-success/25 flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-bold transition-colors"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Procedente
                    </button>
                    <button
                      onClick={() => setEncerrando('DISMISSED')}
                      className="border-panel-border bg-table-deep text-text-muted hover:text-text flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors"
                    >
                      <XCircle className="h-3.5 w-3.5" /> Improcedente
                    </button>
                  </div>
                )}

                {/* A punição é um ato SEPARADO, e a tela diz onde ele fica:
                    juntar "resolver" e "suspender" num botão faria toda
                    denúncia procedente virar suspensão automática. */}
                {d.status !== 'RESOLVED' && d.status !== 'DISMISSED' && (
                  <p className="text-text-faint mt-3 text-xs">
                    Encerrar a denúncia não pune ninguém. A suspensão ou o banimento ficam na aba{' '}
                    <strong>Usuários</strong>, e são decisões separadas.
                  </p>
                )}

                {d.outrasDenuncias.length > 0 && (
                  <section className="border-panel-border mt-4 border-t pt-3">
                    <h3 className="text-text-muted mb-1.5 text-[11px] font-bold uppercase">
                      Outras denúncias contra {d.reported.username}
                    </h3>
                    <ul className="space-y-1">
                      {d.outrasDenuncias.map((o) => (
                        <li key={o.id}>
                          <button
                            onClick={() => setSelecionada(o.id)}
                            className="text-text-muted hover:text-primary flex w-full items-baseline justify-between gap-2 text-xs transition-colors"
                          >
                            <span className="truncate">
                              {MOTIVO_LEGIVEL[o.reason] ?? o.reason} — por {o.reporter.username}
                            </span>
                            <span className="text-text-faint shrink-0">
                              {STATUS_LEGIVEL[o.status]?.rotulo}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </div>
        </aside>
      )}

      {encerrando && d && (
        <DialogoDeAcao
          aberto
          titulo={
            encerrando === 'RESOLVED' ? 'Encerrar como procedente' : 'Encerrar como improcedente'
          }
          descricao={
            encerrando === 'RESOLVED'
              ? 'A denúncia é encerrada como válida. A punição, se houver, é aplicada separadamente na aba Usuários.'
              : 'A denúncia é encerrada como inválida. Nenhuma punição é aplicada.'
          }
          rotuloConfirmar="Encerrar"
          perigo={false}
          ocupado={resolver.isPending}
          erro={resolver.error}
          onConfirmar={({ motivo }) =>
            resolver.mutate(
              { id: d.id, corpo: { status: encerrando, resolucao: motivo } },
              { onSuccess: () => setEncerrando(null) },
            )
          }
          onCancelar={() => setEncerrando(null)}
        />
      )}
    </div>
  );
}
