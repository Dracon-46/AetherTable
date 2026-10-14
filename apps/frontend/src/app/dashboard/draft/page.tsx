'use client';

/**
 * Draft — contra robôs, ou selado. O deck de 40 vai para a conta e de lá para
 * a mesa (formatos Booster Draft e Sealed). Ver `draft/TelaDoDraft.tsx`.
 */

import { Package } from 'lucide-react';
import { TelaDoDraft } from '../../../draft/TelaDoDraft';
import { useT } from '../../../i18n/i18n';

export default function DraftPage() {
  const t = useT();
  return (
    <div className="mx-auto max-w-7xl animate-[fadeIn_0.3s_ease-out]">
      <header className="mb-6">
        <h1 className="text-text mb-2 flex items-center gap-3 text-2xl font-bold sm:text-3xl">
          <Package className="text-primary h-7 w-7 sm:h-8 sm:w-8" />
          {t('Draft')}
        </h1>
        <p className="text-text-muted text-sm sm:text-base">
          {t(
            'Abra pacotes de uma coleção, escolha carta a carta contra sete robôs (ou monte um selado) e leve o deck de 40 para a mesa.',
          )}
        </p>
      </header>
      <TelaDoDraft />
    </div>
  );
}
