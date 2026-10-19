'use client';

import { useEffect } from 'react';

/**
 * O que aparece quando uma tela lança durante o render.
 *
 * Sem um limite de erro, o Next mostra a própria tela em branco com "Application
 * error: a client-side exception has occurred" — e a pessoa não tem o que
 * fazer além de recarregar, sem saber se vai acontecer de novo. Aqui ela tenta
 * de novo sem perder a sessão, ou volta ao início.
 */
export function TelaDeErro({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Em produção a mensagem chega genérica; o `digest` liga o relato ao log
    // do servidor.
    console.error('[erro de tela]', error.digest ?? '', error);
  }, [error]);

  return (
    <div className="bg-table-deep text-text flex min-h-dvh w-full flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold">Algo deu errado nesta tela.</h1>
      <p className="text-text-muted max-w-md text-sm">
        Tente de novo. Se continuar, volte ao início e entre outra vez.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="bg-primary hover:bg-primary-hover rounded-lg px-5 py-2 text-sm font-medium text-white transition-colors"
        >
          Tentar de novo
        </button>
        {/* `<a>` e não `<Link>`: com o app quebrado, recarregar do zero é o
            caminho mais seguro de volta. */}
        <a
          href="/"
          className="border-panel-border bg-panel hover:border-primary rounded-lg border px-5 py-2 text-sm transition-colors"
        >
          Voltar ao início
        </a>
      </div>
    </div>
  );
}
