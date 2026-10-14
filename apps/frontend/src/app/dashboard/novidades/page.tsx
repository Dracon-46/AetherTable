'use client';

/**
 * Novidades — o que mudou em cada versão, em linguagem de quem joga.
 *
 * O conteúdo mora em `novidades/novidades.ts`, no próprio cliente: muda junto
 * com o código que ele descreve, no mesmo commit, e não depende de rede.
 */

import { Megaphone } from 'lucide-react';
import { NOVIDADES } from '../../../novidades/novidades';
import { useT } from '../../../i18n/i18n';

const DATA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export default function NovidadesPage() {
  const t = useT();
  return (
    <div className="mx-auto max-w-3xl animate-[fadeIn_0.3s_ease-out]">
      <header className="mb-8">
        <h1 className="text-text mb-2 flex items-center gap-3 text-2xl font-bold sm:text-3xl">
          <Megaphone className="text-primary h-7 w-7 sm:h-8 sm:w-8" />
          {t('Novidades')}
        </h1>
        <p className="text-text-muted text-sm sm:text-base">{t('O que mudou em cada versão.')}</p>
      </header>

      <ol className="border-panel-border relative space-y-8 border-l pl-6">
        {NOVIDADES.map((n, i) => (
          <li key={n.versao} className="relative">
            <span
              className={`absolute -left-[1.94rem] top-1.5 h-3 w-3 rounded-full border-2 ${
                i === 0 ? 'bg-primary border-primary' : 'bg-panel border-panel-border'
              }`}
              aria-hidden
            />
            <p className="text-text-faint text-xs">
              <span className="text-primary font-mono font-bold">v{n.versao}</span> ·{' '}
              {DATA.format(new Date(`${n.data}T00:00:00Z`))}
            </p>
            <h2 className="text-text mb-2 mt-0.5 text-lg font-bold">{n.titulo}</h2>
            <ul className="text-text-muted list-disc space-y-1 pl-5 text-sm">
              {n.itens.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
