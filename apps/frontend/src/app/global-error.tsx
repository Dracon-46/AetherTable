'use client';

import './globals.css';
import { inter } from './fonte';
import { TelaDeErro } from './TelaDeErro';

/**
 * Erro no próprio layout raiz: esta tela o SUBSTITUI, então traz o `<html>`,
 * o `<body>`, o CSS e a fonte por conta própria.
 */
export default function ErroGlobal({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="bg-table-deep text-text min-h-dvh w-full antialiased">
        <TelaDeErro error={error} reset={reset} />
      </body>
    </html>
  );
}
