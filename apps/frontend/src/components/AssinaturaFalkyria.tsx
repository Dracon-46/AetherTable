'use client';

/**
 * AssinaturaFalkyria.tsx — o selo "Um produto Falkyria".
 *
 * O AetherTable é produto da Falkyria (ver `LICENSE`), e até aqui só o
 * repositório dizia isso: quem usava a plataforma não tinha como saber de quem
 * ela é. O selo vai nas telas que todo mundo vê — a entrada, o menu do painel e
 * a política de privacidade — e nunca na mesa, onde qualquer coisa a mais
 * compete com as cartas.
 *
 * ─── DUAS IMAGENS, E NÃO UM SVG COM `currentColor` ────────────────────────
 *
 * Dentro de `<img>` o SVG não herda a cor do texto. Cada tema tem a sua versão
 * da logo (ave branca no escuro, ave escura no claro), e o CSS de
 * `globals.css` mostra a certa a partir do `data-tema` — o mesmo atributo que
 * já troca os tokens, então não há flash na primeira pintura.
 */

import { useT } from '../i18n/i18n';

const SITE_DA_FALKYRIA = 'https://dracon-46.github.io/Portifolio/#falkyria';

interface AssinaturaFalkyriaProps {
  /** Só a logo, sem o texto — para a trilha recolhida do menu. */
  compacta?: boolean;
  className?: string;
}

export function AssinaturaFalkyria({ compacta = false, className = '' }: AssinaturaFalkyriaProps) {
  const t = useT();
  const rotulo = t('Um produto Falkyria');

  return (
    <a
      href={SITE_DA_FALKYRIA}
      target="_blank"
      rel="noopener noreferrer"
      title={compacta ? rotulo : undefined}
      aria-label={compacta ? rotulo : undefined}
      className={`text-text-faint hover:text-text-muted inline-flex items-center gap-1.5 text-xs transition-colors ${className}`}
    >
      <img src="/falkyria/falkyria-branca.svg" alt="" className="logo-falkyria-escuro h-4 w-4" />
      <img src="/falkyria/falkyria.svg" alt="" className="logo-falkyria-claro h-4 w-4" />
      {!compacta && <span>{rotulo}</span>}
    </a>
  );
}
