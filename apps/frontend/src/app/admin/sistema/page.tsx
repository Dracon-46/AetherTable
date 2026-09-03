'use client';

/**
 * Ferramentas do sistema (DOC-061 §5).
 *
 * ─── OS INTERRUPTORES NÃO SÃO VARIÁVEIS DE AMBIENTE ────────────────────────
 *
 * O documento pede um "Kill Switch de Voz": um botão de emergência que desliga
 * o LiveKit para todo mundo se o faturamento do SFU disparar ou houver ataque.
 * Uma env var não serve — mudar env exige redeploy, e emergência de faturamento
 * não espera build. Eles vivem numa tabela, com histórico de quem mexeu.
 *
 * ─── E POR QUE O MONITOR DO COLYSEUS NÃO ESTÁ AQUI ─────────────────────────
 *
 * §5 pede também um iframe com a UI de `@colyseus/monitor`. Ele não está nesta
 * tela e não é esquecimento: o monitor não está montado no game-server, e um
 * iframe apontando para uma rota inexistente é pior que a ausência — parece
 * uma ferramenta quebrada. O que dá para fazer honestamente hoje é o link
 * direto, com o aviso de que depende de o monitor estar habilitado lá.
 */

import { useState } from 'react';
import {
  AlertCircle,
  Database,
  DoorClosed,
  ExternalLink,
  Info,
  Loader2,
  Mic,
  Power,
  Swords,
  UserPlus,
} from 'lucide-react';
import { useFlags, useLimparCacheDeCartas, useMudarFlag } from '../../../admin/useAdmin';
import { DialogoDeAcao, quando } from '../../../admin/Componentes';
import { mensagemDaApi } from '@/lib/fetcher';

const DESCRICAO: Record<
  string,
  { rotulo: string; Icone: typeof Mic; efeito: string; aoDesligar: string }
> = {
  VOICE_ENABLED: {
    rotulo: 'Voz (LiveKit)',
    Icone: Mic,
    efeito: 'Emissão de passes de voz para as mesas.',
    aoDesligar:
      'Nenhuma mesa nova recebe voz e o cliente monta a partida sem o LiveKit — sem tela de erro. Use se o faturamento do SFU disparar ou houver abuso.',
  },
  MATCHMAKING_ENABLED: {
    rotulo: 'Criação de mesas',
    Icone: Swords,
    efeito: 'Criar novas salas de jogo.',
    aoDesligar:
      'Ninguém abre mesa nova. As partidas EM ANDAMENTO seguem normalmente — o estado vive no game node, e isto só fecha a porta de entrada.',
  },
  REGISTRATION_ENABLED: {
    rotulo: 'Cadastro de contas',
    Icone: UserPlus,
    efeito: 'Registro de novos usuários.',
    aoDesligar:
      'O cadastro recusa com uma mensagem clara. Quem já tem conta continua entrando. Use contra criação automatizada de contas.',
  },
};

export default function SistemaPage() {
  const { data: flags, isPending, isError, error } = useFlags();
  const mudar = useMudarFlag();
  const limparCache = useLimparCacheDeCartas();

  const [alvo, setAlvo] = useState<{ key: string; ligar: boolean } | null>(null);
  const [confirmandoCache, setConfirmandoCache] = useState(false);

  return (
    <div className="space-y-6">
      {/* ── Interruptores ───────────────────────────────────────────────── */}
      <section>
        <h2 className="text-text-muted mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
          <Power className="h-3.5 w-3.5" /> Interruptores globais
        </h2>

        {isPending ? (
          <div className="text-text-muted flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : isError || !flags ? (
          <div className="border-danger/30 bg-danger/10 text-danger flex items-center gap-2 rounded-xl border p-4 text-sm">
            <AlertCircle className="h-5 w-5 shrink-0" />
            {mensagemDaApi(error)}
          </div>
        ) : (
          <div className="space-y-3">
            {flags.map((f) => {
              const d = DESCRICAO[f.key];
              const Icone = d?.Icone ?? Power;
              return (
                <div
                  key={f.key}
                  className={`rounded-xl border p-4 ${
                    f.enabled ? 'border-panel-border bg-panel' : 'border-danger/40 bg-danger/10'
                  }`}
                >
                  <div className="flex flex-wrap items-start gap-3">
                    <Icone
                      className={`mt-0.5 h-5 w-5 shrink-0 ${f.enabled ? 'text-success' : 'text-danger'}`}
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-text flex flex-wrap items-center gap-2 text-sm font-bold">
                        {d?.rotulo ?? f.key}
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                            f.enabled ? 'bg-success/15 text-success' : 'bg-danger/20 text-danger'
                          }`}
                        >
                          {f.enabled ? 'ligado' : 'desligado'}
                        </span>
                      </h3>
                      <p className="text-text-muted mt-0.5 text-xs">{d?.efeito}</p>
                      <p className="text-text-faint mt-1 text-xs leading-relaxed">
                        <strong>Desligado:</strong> {d?.aoDesligar}
                      </p>
                      {f.note && (
                        <p className="text-warning mt-1.5 text-xs">
                          Nota: {f.note}
                          {f.updatedBy && (
                            <span className="text-text-faint">
                              {' '}
                              — {f.updatedBy}, {quando(f.updatedAt)}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => setAlvo({ key: f.key, ligar: !f.enabled })}
                      className={`shrink-0 rounded-md px-3 py-2 text-xs font-bold text-white transition-all active:scale-95 ${
                        f.enabled
                          ? 'bg-danger hover:bg-danger-hover'
                          : 'bg-success hover:bg-success-hover'
                      }`}
                    >
                      {f.enabled ? 'Desligar' : 'Ligar'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Cache de cartas ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-text-muted mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
          <Database className="h-3.5 w-3.5" /> Cache da Scryfall
        </h2>
        <div className="border-panel-border bg-panel rounded-xl border p-4">
          <div className="flex flex-wrap items-start gap-3">
            <Database className="text-primary mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <h3 className="text-text text-sm font-bold">Esvaziar o cache de cartas</h3>
              <p className="text-text-muted mt-0.5 text-xs leading-relaxed">
                Metadados de carta ficam 12 horas em memória e no banco. Depois dos spoilers de uma
                coleção, as cartas novas chegam na primeira consulta — o que atrapalha é uma
                <strong> entrada antiga ainda válida</strong> por TTL, como uma errata. Esvaziar
                força a releitura.
              </p>
              <p className="text-text-faint mt-1.5 text-xs">
                O custo é uma rajada de consultas à Scryfall enquanto o cache reaquece. A fila de
                100 ms do cliente único continua valendo, então não há risco de bloqueio — só
                lentidão momentânea nas primeiras mesas.
              </p>
              {limparCache.isSuccess && (
                <p className="text-success mt-2 text-xs">
                  {limparCache.data.emMemoria} entradas em memória e {limparCache.data.noBanco} no
                  banco foram removidas.
                </p>
              )}
              {limparCache.isError && (
                <p className="text-danger mt-2 text-xs">{mensagemDaApi(limparCache.error)}</p>
              )}
            </div>
            <button
              onClick={() => setConfirmandoCache(true)}
              disabled={limparCache.isPending}
              className="border-panel-border bg-table-deep text-text hover:border-primary hover:text-primary flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50"
            >
              {limparCache.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Esvaziar
            </button>
          </div>
        </div>
      </section>

      {/* ── Salas ───────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-text-muted mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
          <DoorClosed className="h-3.5 w-3.5" /> Salas em andamento
        </h2>
        <div className="border-panel-border bg-panel rounded-xl border p-4">
          <div className="flex items-start gap-3">
            <Info className="text-text-muted mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0 flex-1 text-xs leading-relaxed">
              <p className="text-text mb-1 text-sm font-bold">
                O monitor do Colyseus não está embutido aqui.
              </p>
              <p className="text-text-muted">
                DOC-061 §5 pede um iframe com a UI de{' '}
                <code className="text-text">@colyseus/monitor</code> para ver e encerrar salas
                fantasmas. Ele <strong>não está montado</strong> no game-server, e um iframe
                apontando para uma rota inexistente pareceria uma ferramenta quebrada em vez de uma
                ferramenta ausente.
              </p>
              <p className="text-text-faint mt-1.5">
                Para habilitar: monte o `monitor()` do Colyseus no game-server atrás de autenticação
                e aponte para <code>/colyseus</code>. Enquanto isso, o link abaixo só funciona se
                você já tiver feito isso.
              </p>
              <a
                href={`${process.env.NEXT_PUBLIC_WS_URL?.replace(/^ws/, 'http') ?? ''}/colyseus`}
                target="_blank"
                rel="noreferrer"
                className="text-primary mt-2 inline-flex items-center gap-1.5 hover:underline"
              >
                Abrir monitor do Colyseus <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {alvo && (
        <DialogoDeAcao
          aberto
          titulo={`${alvo.ligar ? 'Ligar' : 'Desligar'} ${DESCRICAO[alvo.key]?.rotulo ?? alvo.key}`}
          descricao={
            alvo.ligar
              ? 'O recurso volta a funcionar para todos os jogadores imediatamente.'
              : (DESCRICAO[alvo.key]?.aoDesligar ??
                'O recurso é desligado para todos os jogadores imediatamente.')
          }
          rotuloConfirmar={alvo.ligar ? 'Ligar' : 'Desligar'}
          perigo={!alvo.ligar}
          ocupado={mudar.isPending}
          erro={mudar.error}
          onConfirmar={({ motivo }) =>
            mudar.mutate(
              { key: alvo.key, ligado: alvo.ligar, nota: motivo },
              { onSuccess: () => setAlvo(null) },
            )
          }
          onCancelar={() => setAlvo(null)}
        />
      )}

      {confirmandoCache && (
        <DialogoDeAcao
          aberto
          titulo="Esvaziar o cache de cartas"
          descricao="Todas as entradas em memória e no banco são apagadas. As cartas voltam a ser buscadas na Scryfall conforme aparecem nas mesas."
          rotuloConfirmar="Esvaziar"
          ocupado={limparCache.isPending}
          erro={limparCache.error}
          onConfirmar={() =>
            limparCache.mutate(undefined, { onSuccess: () => setConfirmandoCache(false) })
          }
          onCancelar={() => setConfirmandoCache(false)}
        />
      )}
    </div>
  );
}
