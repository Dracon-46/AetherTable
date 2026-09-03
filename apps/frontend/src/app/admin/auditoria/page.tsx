'use client';

/**
 * Log de auditoria (DOC-061 §6).
 *
 * ─── O QUE ESTA TELA GARANTE ───────────────────────────────────────────────
 *
 * O checklist do documento pede que TODO endpoint administrativo gere um rastro
 * inalterável ("Admin X deletou usuário Y em [data]"). Antes disto, o módulo
 * não tinha endpoint nenhum e a tabela não existia — promover alguém a ADMIN ou
 * apagar uma conta era uma escrita sem testemunha.
 *
 * A tela é LEGÍVEL POR MODERADOR de propósito. Um log que só o administrador vê
 * não segura o administrador; moderadores lerem as ações uns dos outros — e as
 * do admin — é o que transforma o registro em prestação de contas em vez de
 * arquivo morto.
 *
 * Não há botão de apagar nem de editar, e a API não expõe nenhum: um log que o
 * próprio autor pode limpar responde à pergunta errada.
 */

import { useState } from 'react';
import { AlertCircle, ClipboardList, Loader2, ShieldAlert } from 'lucide-react';
import { useAuditoria } from '../../../admin/useAdmin';
import { quando } from '../../../admin/Componentes';
import { mensagemDaApi } from '@/lib/fetcher';

/** Rótulo em português e cor por gravidade da ação. */
const ACOES: Record<string, { rotulo: string; tom: 'perigo' | 'alerta' | 'neutro' }> = {
  USER_SUSPEND: { rotulo: 'Suspendeu conta', tom: 'alerta' },
  USER_UNSUSPEND: { rotulo: 'Removeu suspensão', tom: 'neutro' },
  USER_BAN: { rotulo: 'Baniu conta', tom: 'perigo' },
  USER_RESTORE: { rotulo: 'Restaurou conta', tom: 'neutro' },
  USER_ROLE_CHANGE: { rotulo: 'Alterou papel', tom: 'perigo' },
  INVENTORY_GRANT: { rotulo: 'Concedeu cosmético', tom: 'neutro' },
  INVENTORY_REVOKE: { rotulo: 'Retirou cosmético', tom: 'alerta' },
  COSMETIC_CREATE: { rotulo: 'Registrou cosmético', tom: 'neutro' },
  COSMETIC_UPDATE: { rotulo: 'Alterou cosmético', tom: 'neutro' },
  COSMETIC_DELETE: { rotulo: 'Desregistrou cosmético', tom: 'alerta' },
  REPORT_CLAIM: { rotulo: 'Assumiu denúncia', tom: 'neutro' },
  REPORT_RESOLVE: { rotulo: 'Denúncia procedente', tom: 'alerta' },
  REPORT_DISMISS: { rotulo: 'Denúncia improcedente', tom: 'neutro' },
  FLAG_CHANGE: { rotulo: 'Mexeu num interruptor', tom: 'perigo' },
  CARD_CACHE_PURGE: { rotulo: 'Esvaziou o cache de cartas', tom: 'neutro' },
};

const CLASSE_POR_TOM = {
  perigo: 'border-danger/30 bg-danger/5',
  alerta: 'border-warning/30 bg-warning/5',
  neutro: 'border-panel-border bg-panel',
};

export default function AuditoriaPage() {
  const [action, setAction] = useState('');
  const { data, isPending, isError, error } = useAuditoria({ action });

  return (
    <div className="space-y-4">
      <div className="border-panel-border bg-panel flex items-start gap-3 rounded-xl border p-4">
        <ShieldAlert className="text-primary mt-0.5 h-5 w-5 shrink-0" />
        <p className="text-text-muted min-w-0 text-xs leading-relaxed">
          Registro <strong className="text-text">inalterável</strong> de toda ação administrativa.
          Não existe rota de edição nem de remoção — nem para administradores. O nome de quem agiu e
          do alvo são congelados no momento da ação, então o histórico continua legível mesmo depois
          de a conta ser renomeada ou expurgada.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="bg-panel border-panel-border text-text focus:border-primary rounded-md border px-3 py-2 text-sm focus:outline-none"
          aria-label="Filtrar por tipo de ação"
        >
          <option value="">Todas as ações</option>
          {Object.entries(ACOES).map(([valor, { rotulo }]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </select>
      </div>

      {isPending ? (
        <div className="text-text-muted flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Lendo o histórico…
        </div>
      ) : isError || !data ? (
        <div className="border-danger/30 bg-danger/10 text-danger flex items-center gap-2 rounded-xl border p-4 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0" />
          {mensagemDaApi(error)}
        </div>
      ) : data.itens.length === 0 ? (
        <div className="border-panel-border text-text-muted rounded-xl border border-dashed py-12 text-center">
          <ClipboardList className="mx-auto mb-3 h-10 w-10 opacity-50" />
          <p className="text-sm">
            {action ? 'Nenhuma ação deste tipo registrada.' : 'Nenhuma ação registrada ainda.'}
          </p>
        </div>
      ) : (
        <ol className="space-y-2">
          {data.itens.map((linha) => {
            const meta = ACOES[linha.action] ?? { rotulo: linha.action, tom: 'neutro' as const };
            return (
              <li key={linha.id} className={`rounded-xl border p-3 ${CLASSE_POR_TOM[meta.tom]}`}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-text text-sm font-bold">{meta.rotulo}</span>
                  {linha.targetLabel && (
                    <span className="text-text-muted min-w-0 truncate text-sm">
                      → {linha.targetLabel}
                    </span>
                  )}
                  <span className="text-text-faint ml-auto shrink-0 text-[11px]">
                    {quando(linha.createdAt)}
                  </span>
                </div>

                <div className="text-text-muted mt-1 text-xs">
                  por <strong className="text-text">{linha.actorLabel}</strong>
                  {linha.ip && <span className="text-text-faint font-mono"> · {linha.ip}</span>}
                </div>

                {linha.reason && (
                  <p className="text-text mt-1.5 text-xs italic">&ldquo;{linha.reason}&rdquo;</p>
                )}

                {/* `metadata` guarda o detalhe estruturado — de/para de papel,
                    dias de suspensão, qual cosmético. Mostrar cru é feio e é o
                    certo: qualquer formatação bonita esconderia campos que
                    ações futuras vão adicionar sem que ninguém atualize aqui. */}
                {Object.keys(linha.metadata ?? {}).length > 0 && (
                  <dl className="text-text-faint mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px]">
                    {Object.entries(linha.metadata).map(([chave, valor]) => (
                      <span key={chave}>
                        <dt className="inline">{chave}:</dt>{' '}
                        <dd className="text-text-muted inline">
                          {typeof valor === 'object' ? JSON.stringify(valor) : String(valor)}
                        </dd>
                      </span>
                    ))}
                  </dl>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {data?.proximoCursor && (
        <p className="text-text-faint text-center text-xs">
          Há mais registros. Filtre por tipo de ação para estreitar o resultado.
        </p>
      )}
    </div>
  );
}
