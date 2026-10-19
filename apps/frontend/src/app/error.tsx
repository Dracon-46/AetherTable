'use client';

import { TelaDeErro } from './TelaDeErro';

export default function Erro({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <TelaDeErro error={error} reset={reset} />;
}
