'use client';

/**
 * Componentes.tsx — as peças que as quatro telas do painel compartilham.
 *
 * ─── O DIÁLOGO DE JUSTIFICATIVA É O CENTRO DISTO ───────────────────────────
 *
 * Toda ação punitiva do backoffice exige um motivo com pelo menos 8 caracteres
 * (ver `admin.dto.ts`), porque o log de auditoria sem o porquê responde "quem e
 * quando" e deixa de fora a única coisa que outro moderador precisa saber ao
 * revisar a decisão meses depois.
 *
 * Isso só funciona se pedir o motivo for MAIS FÁCIL que contorná-lo. Um
 * componente único garante que cada ação nova nasça com o campo — e o resumo
 * do que vai acontecer fica na frente do botão, porque "Banir" sozinho não
 * distingue suspender de apagar.
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, ShieldAlert, X } from 'lucide-react';
import { mensagemDaApi } from '@/lib/fetcher';

/** Cartão de número da visão geral. */
export function Metrica({
  rotulo,
  valor,
  detalhe,
  Icone,
  tom = 'neutro',
}: {
  rotulo: string;
  valor: number | string;
  detalhe?: string;
  Icone?: typeof AlertTriangle;
  tom?: 'neutro' | 'alerta' | 'perigo' | 'sucesso';
}) {
  const cor = {
    neutro: 'text-text',
    alerta: 'text-warning',
    perigo: 'text-danger',
    sucesso: 'text-success',
  }[tom];

  return (
    <div className="border-panel-border bg-panel rounded-xl border p-4">
      <div className="text-text-muted mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider">
        {Icone && <Icone className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{rotulo}</span>
      </div>
      <div className={`font-mono text-2xl font-bold ${cor}`}>{valor}</div>
      {detalhe && <div className="text-text-faint mt-0.5 text-xs">{detalhe}</div>}
    </div>
  );
}

/** Selo de papel. */
export function SeloDePapel({ papel }: { papel: string }) {
  const estilo =
    papel === 'ADMIN'
      ? 'bg-danger/15 text-danger border-danger/30'
      : papel === 'MOD'
        ? 'bg-primary/15 text-primary border-primary/30'
        : 'bg-table-deep text-text-muted border-panel-border';
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${estilo}`}>
      {papel}
    </span>
  );
}

/** Estado de uma conta: ativa, suspensa ou banida. */
export function SeloDeEstado({
  suspendedUntil,
  deletedAt,
}: {
  suspendedUntil: string | null;
  deletedAt: string | null;
}) {
  if (deletedAt) {
    return (
      <span className="bg-danger/15 text-danger border-danger/30 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase">
        banida
      </span>
    );
  }
  // A suspensão VENCIDA não é suspensão: comparar com agora é o que faz o
  // prazo expirar sozinho, sem cron. Sem esta checagem, uma conta suspensa há
  // um ano apareceria punida para sempre.
  if (suspendedUntil && new Date(suspendedUntil).getTime() > Date.now()) {
    return (
      <span
        className="bg-warning/15 text-warning border-warning/30 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase"
        title={`Até ${new Date(suspendedUntil).toLocaleString('pt-BR')}`}
      >
        suspensa
      </span>
    );
  }
  return (
    <span className="bg-success/15 text-success border-success/30 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase">
      ativa
    </span>
  );
}

export interface CampoExtra {
  nome: string;
  rotulo: string;
  tipo: 'numero' | 'texto' | 'selecao';
  valorInicial: string;
  opcoes?: Array<{ valor: string; rotulo: string }>;
  min?: number;
  max?: number;
  dica?: string;
}

/**
 * Diálogo de ação com justificativa obrigatória.
 *
 * `perigo` muda a cor do botão e nada mais: uma confirmação vermelha para
 * "remover suspensão" treinaria o moderador a ignorar a cor.
 */
export function DialogoDeAcao({
  aberto,
  titulo,
  descricao,
  rotuloConfirmar,
  perigo = false,
  extras = [],
  ocupado = false,
  erro,
  onConfirmar,
  onCancelar,
}: {
  aberto: boolean;
  titulo: string;
  descricao: string;
  rotuloConfirmar: string;
  perigo?: boolean;
  extras?: CampoExtra[];
  ocupado?: boolean;
  erro?: unknown;
  onConfirmar: (dados: { motivo: string; extras: Record<string, string> }) => void;
  onCancelar: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [valores, setValores] = useState<Record<string, string>>({});

  // Reabrir o diálogo com o motivo da ação ANTERIOR ainda digitado é o caminho
  // mais curto para um log de auditoria com justificativa errada.
  useEffect(() => {
    if (!aberto) return;
    setMotivo('');
    setValores(Object.fromEntries(extras.map((e) => [e.nome, e.valorInicial])));
    // `extras` é recriado a cada render pelo chamador; depender dele reiniciaria
    // os campos a cada tecla digitada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !ocupado) onCancelar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aberto, ocupado, onCancelar]);

  if (!aberto) return null;

  const motivoValido = motivo.trim().length >= 8;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !ocupado) onCancelar();
      }}
    >
      <div className="border-panel-border bg-panel custom-scrollbar max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border p-5 shadow-2xl">
        <div className="mb-1 flex items-start gap-2">
          {perigo ? (
            <ShieldAlert className="text-danger mt-0.5 h-5 w-5 shrink-0" />
          ) : (
            <AlertTriangle className="text-warning mt-0.5 h-5 w-5 shrink-0" />
          )}
          <h2 className="text-text min-w-0 flex-1 text-base font-bold">{titulo}</h2>
          <button
            onClick={onCancelar}
            disabled={ocupado}
            className="text-text-muted hover:text-text shrink-0 transition-colors"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-text-muted mb-4 text-sm">{descricao}</p>

        {extras.map((campo) => (
          <div key={campo.nome} className="mb-4">
            <label className="text-text-muted mb-1.5 block text-[11px] font-bold uppercase">
              {campo.rotulo}
            </label>
            {campo.tipo === 'selecao' ? (
              <select
                value={valores[campo.nome] ?? campo.valorInicial}
                onChange={(e) => setValores((v) => ({ ...v, [campo.nome]: e.target.value }))}
                className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
              >
                {campo.opcoes?.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.rotulo}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={campo.tipo === 'numero' ? 'number' : 'text'}
                min={campo.min}
                max={campo.max}
                value={valores[campo.nome] ?? campo.valorInicial}
                onChange={(e) => setValores((v) => ({ ...v, [campo.nome]: e.target.value }))}
                className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
              />
            )}
            {campo.dica && <p className="text-text-faint mt-1 text-xs">{campo.dica}</p>}
          </div>
        ))}

        <div className="mb-4">
          <label className="text-text-muted mb-1.5 block text-[11px] font-bold uppercase">
            Justificativa <span className="text-danger">*</span>
          </label>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            autoFocus
            rows={3}
            placeholder="Por que esta ação está sendo tomada?"
            className="bg-table-deep border-panel-border text-text focus:border-primary w-full resize-y rounded-md border px-3 py-2 text-sm focus:outline-none"
          />
          <p className="text-text-faint mt-1 text-xs">
            Fica no log de auditoria, junto com seu nome, a data e o IP. Mínimo de 8 caracteres.
          </p>
        </div>

        {Boolean(erro) && (
          <p className="border-danger/30 bg-danger/10 text-danger mb-4 rounded-md border p-3 text-sm">
            {mensagemDaApi(erro)}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancelar}
            disabled={ocupado}
            className="text-text-muted hover:text-text rounded-md px-4 py-2 text-sm font-medium transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirmar({ motivo: motivo.trim(), extras: valores })}
            disabled={ocupado || !motivoValido}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-bold text-white transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
              perigo ? 'bg-danger hover:bg-danger-hover' : 'bg-primary hover:bg-primary-hover'
            }`}
          >
            {ocupado && <Loader2 className="h-4 w-4 animate-spin" />}
            {rotuloConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Data curta e legível. Uma linha de log sem data é uma linha inútil. */
export function quando(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
