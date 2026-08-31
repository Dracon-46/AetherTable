'use client';

/**
 * Avatar.tsx — avatar do jogador com a borda cosmética.
 *
 * DOC-060 §2.3: o avatar aparece no lobby, no perfil e no painel de vida. É o
 * único cosmético com upload permitido — uma bolha pequena, importável do
 * OAuth. Quando não há imagem, as iniciais bastam: uma silhueta genérica não
 * ajuda ninguém a identificar de quem é o painel numa mesa de quatro.
 */

import React from 'react';
import { acharBorder, acharTitle } from '@aethertable/shared-types';

interface AvatarProps {
  nome: string;
  avatarUrl?: string;
  /** ID do catálogo de bordas. */
  borderId?: string;
  tamanho?: 'sm' | 'md' | 'lg';
  className?: string;
}

const TAMANHOS = {
  sm: 'h-7 w-7 text-[10px]',
  md: 'h-10 w-10 text-xs',
  lg: 'h-16 w-16 text-base',
} as const;

export function Avatar({ nome, avatarUrl, borderId, tamanho = 'md', className = '' }: AvatarProps) {
  const borda = acharBorder(borderId);
  const iniciais = nome.trim().slice(0, 2).toUpperCase() || '??';

  return (
    <div
      className={`bg-primary/20 text-primary relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold ${TAMANHOS[tamanho]} ${borda.classe} ${className}`}
      title={nome}
    >
      {avatarUrl ? (
        /* Avatar externo (Google/Discord) numa bolha de 64px: `next/image`
           aqui só acrescentaria um proxy de otimização para uma imagem que já
           vem dimensionada. */
        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden="true">{iniciais}</span>
      )}
    </div>
  );
}

/** Badge de título de chat (DOC-060 §2.5). */
export function TituloDeChat({ titleId }: { titleId?: string }) {
  const titulo = acharTitleSeguro(titleId);
  if (!titulo) return null;
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
      style={{ color: titulo.cor, backgroundColor: `${titulo.cor}22` }}
    >
      {titulo.badge}
    </span>
  );
}

function acharTitleSeguro(titleId?: string) {
  if (!titleId) return null;
  // O item "nenhum" existe no catálogo com badge vazio: não renderiza nada.
  const t = acharTitle(titleId);
  return t.badge ? t : null;
}
