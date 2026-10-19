'use client';

/**
 * IdiomaDasCartas.tsx — em que idioma você quer ver as cartas.
 *
 * É preferência da conta (`PreferenciasDeInterface`, com o navegador como
 * cache) e vale como PADRÃO: o editor oferece "pôr o
 * deck neste idioma" e o seletor de arte mostra as impressões nele. Nada muda
 * sozinho num deck — trocar a impressão é decisão de quem monta o deck, porque
 * muda o que os outros veem na mesa.
 */

import { Languages } from 'lucide-react';
import { IDIOMAS_DE_CARTA } from '@aethertable/shared-types';
import { useAparencia } from '../../../store/aparencia.store';
import { IDIOMAS_DA_INTERFACE, useT } from '../../../i18n/i18n';

export function IdiomaDasCartas() {
  const idioma = useAparencia((s) => s.idiomaDasCartas);
  const setIdioma = useAparencia((s) => s.setIdiomaDasCartas);
  const t = useT();

  return (
    <section className="bg-panel border-panel-border mb-8 rounded-xl border p-6 shadow-lg">
      <h2 className="text-text mb-1 flex items-center gap-2 text-lg font-bold">
        <Languages className="text-primary h-5 w-5" /> {t('Idioma das cartas')}
      </h2>
      <p className="text-text-muted mb-4 text-sm leading-relaxed">
        No editor de deck, "Pôr o deck em…" troca cada carta pela impressão mais recente neste
        idioma, e o seletor de arte mostra as impressões nele. Na mesa, todos veem a impressão que o
        deck guarda.
      </p>
      <select
        value={idioma}
        onChange={(e) => setIdioma(e.target.value)}
        aria-label="Idioma das cartas"
        className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-3 py-2 text-sm focus:outline-none sm:w-64"
      >
        {IDIOMAS_DE_CARTA.map((i) => (
          <option key={i.codigo} value={i.codigo}>
            {i.nome}
          </option>
        ))}
      </select>
    </section>
  );
}

/**
 * O idioma dos MENUS e das telas — outra coisa que o idioma das cartas. O que
 * ainda não tem tradução aparece em português (ver `i18n/i18n.ts`).
 */
export function IdiomaDaInterface() {
  const idioma = useAparencia((s) => s.idiomaDaInterface);
  const setIdioma = useAparencia((s) => s.setIdiomaDaInterface);
  const t = useT();

  return (
    <section className="bg-panel border-panel-border mb-8 rounded-xl border p-6 shadow-lg">
      <h2 className="text-text mb-1 flex items-center gap-2 text-lg font-bold">
        <Languages className="text-primary h-5 w-5" /> {t('Idioma da interface')}
      </h2>
      <p className="text-text-muted mb-4 text-sm leading-relaxed">
        {t('O idioma dos menus e das telas. O que ainda não foi traduzido aparece em português.')}
      </p>
      <select
        value={idioma}
        onChange={(e) => setIdioma(e.target.value as typeof idioma)}
        aria-label={t('Idioma da interface')}
        className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-3 py-2 text-sm focus:outline-none sm:w-64"
      >
        {IDIOMAS_DA_INTERFACE.map((i) => (
          <option key={i.codigo} value={i.codigo}>
            {i.nome}
          </option>
        ))}
      </select>
    </section>
  );
}
