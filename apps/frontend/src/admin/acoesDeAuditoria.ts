/**
 * acoesDeAuditoria.ts — rótulo e gravidade de cada `AdminAction` do log.
 *
 * ─── DUAS AÇÕES APARECIAM CRUAS E NÃO PODIAM SER FILTRADAS ─────────────────
 *
 * O dicionário morava dentro da página de auditoria e parou de acompanhar o
 * enum do Prisma: `USER_PASSWORD_RESET` e `USER_PURGE` são emitidas pelo
 * backend e caíam no fallback — a linha mostrava o código em inglês, com tom
 * neutro (uma exclusão DEFINITIVA de conta pintada como rotina) e sem entrada
 * no filtro, porque o seletor é gerado a partir daqui.
 *
 * Saiu da página para poder ser testado contra o `schema.prisma`: um valor
 * novo no enum sem rótulo aqui agora quebra o teste, em vez de virar uma
 * linha crua que ninguém percebe.
 */

export type TomDeAuditoria = 'perigo' | 'alerta' | 'neutro';

export const ACOES_DE_AUDITORIA: Record<string, { rotulo: string; tom: TomDeAuditoria }> = {
  USER_SUSPEND: { rotulo: 'Suspendeu conta', tom: 'alerta' },
  USER_UNSUSPEND: { rotulo: 'Removeu suspensão', tom: 'neutro' },
  USER_BAN: { rotulo: 'Baniu conta', tom: 'perigo' },
  USER_RESTORE: { rotulo: 'Restaurou conta', tom: 'neutro' },
  USER_ROLE_CHANGE: { rotulo: 'Alterou papel', tom: 'perigo' },
  USER_PASSWORD_RESET: { rotulo: 'Redefiniu senha', tom: 'alerta' },
  USER_PURGE: { rotulo: 'Excluiu conta definitivamente', tom: 'perigo' },
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
