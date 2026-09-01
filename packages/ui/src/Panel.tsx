import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

/**
 * `title` aqui é o cabeçalho do painel (um ReactNode), não o atributo `title`
 * do HTML (que é string e vira tooltip). Por isso o nativo é omitido — manter
 * os dois com o mesmo nome é um conflito de tipos.
 */
export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  children?: ReactNode;
}

/**
 * Painel de UI de DOM. 80 % de opacidade + backdrop-blur, borda de 1 px,
 * raio de 8 px, padding de 12 px (DOC-041 §2.1 e §2.3).
 */
export function Panel({ title, children, className, ...props }: PanelProps) {
  return (
    <div
      className={cn(
        'bg-panel/80 border-panel-border rounded-lg border p-3 backdrop-blur',
        'shadow-elevation-1',
        className,
      )}
      {...props}
    >
      {title ? <h2 className="text-text mb-2 text-[15px] font-semibold">{title}</h2> : null}
      {children}
    </div>
  );
}

/**
 * Numero que muda (vida, contadores). `tabular-nums` e OBRIGATORIO: sem isso o
 * texto salta na horizontal a cada mudanca de digito (DOC-041 §2.2).
 */
export function LiveNumber({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn('font-bold tabular-nums', className)} aria-live="polite">
      {value}
    </span>
  );
}
