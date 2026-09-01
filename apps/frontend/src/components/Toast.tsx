'use client';

/**
 * Toast.tsx — aviso não bloqueante.
 *
 * O deckbuilder usava `window.alert` para toda falha e `window.confirm` para
 * toda remoção. Diálogo nativo tem três problemas concretos aqui:
 *
 *   1. TRAVA A ABA inteira — nenhuma outra requisição do app avança enquanto
 *      ele está aberto;
 *   2. é bloqueado por padrão dentro de iframe, onde a ação simplesmente não
 *      acontece e nenhum erro aparece;
 *   3. não tem estilo, então o aviso mais frequente do app é a única coisa que
 *      não parece o app.
 */

import React from 'react';
import { AlertCircle, Check, X } from 'lucide-react';
import { create } from 'zustand';

export type TipoToast = 'sucesso' | 'erro' | 'info';

interface ToastItem {
  id: number;
  tipo: TipoToast;
  texto: string;
}

interface ToastState {
  itens: ToastItem[];
  mostrar: (texto: string, tipo?: TipoToast) => void;
  remover: (id: number) => void;
}

let seq = 0;

export const useToast = create<ToastState>((set, get) => ({
  itens: [],
  mostrar: (texto, tipo = 'info') => {
    const id = ++seq;
    set({ itens: [...get().itens, { id, tipo, texto }] });
    // Some sozinho: um aviso de falha de rede não merece um clique para sumir.
    setTimeout(() => get().remover(id), 5000);
  },
  remover: (id) => set({ itens: get().itens.filter((i) => i.id !== id) }),
}));

const ESTILO: Record<TipoToast, string> = {
  sucesso: 'border-success/40 bg-success/10 text-success',
  erro: 'border-danger/40 bg-danger/10 text-danger',
  info: 'border-panel-border bg-panel text-text',
};

export function ToastHost() {
  const itens = useToast((s) => s.itens);
  const remover = useToast((s) => s.remover);

  if (itens.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {itens.map((i) => (
        <div
          key={i.id}
          className={`painel-entra pointer-events-auto flex items-start gap-2 rounded-lg border p-3 shadow-2xl backdrop-blur ${ESTILO[i.tipo]}`}
        >
          {i.tipo === 'sucesso' ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <p className="min-w-0 flex-1 text-sm">{i.texto}</p>
          <button
            onClick={() => remover(i.id)}
            className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
            aria-label="Fechar aviso"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Diálogo de confirmação — o substituto de `window.confirm`. */
export function ConfirmDialog({
  aberto,
  titulo,
  descricao,
  rotuloConfirmar = 'Confirmar',
  perigo = false,
  onConfirmar,
  onCancelar,
}: {
  aberto: boolean;
  titulo: string;
  descricao?: string;
  rotuloConfirmar?: string;
  perigo?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  React.useEffect(() => {
    if (!aberto) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancelar();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [aberto, onCancelar]);

  if (!aberto) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancelar();
      }}
    >
      <div className="modal-entra border-panel-border bg-panel w-full max-w-sm rounded-xl border p-5 shadow-2xl">
        <h2 className="text-text text-base font-bold">{titulo}</h2>
        {descricao && <p className="text-text-muted mt-1 text-sm">{descricao}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancelar}
            className="text-text-muted hover:text-text rounded-md px-4 py-2 text-sm font-medium transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            autoFocus
            className={`rounded-md px-4 py-2 text-sm font-bold text-white transition-all active:scale-95 ${
              perigo ? 'bg-danger hover:bg-danger-hover' : 'bg-primary hover:bg-primary-hover'
            }`}
          >
            {rotuloConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
