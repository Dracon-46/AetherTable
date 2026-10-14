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
import { acharBorder, acharNameplate, acharTitle, type Nameplate } from '@aethertable/shared-types';
import { estiloCssDaPlaca } from '../cosmetics/render';

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

/**
 * O nome do jogador sobre a placa equipada.
 *
 * Sem placa (o padrão, ou cosméticos alheios desligados), devolve o nome cru
 * com as classes do chamador — o painel de vida fica idêntico ao que era. Com
 * placa, o nome ganha fundo, contorno e a cor de texto DA PLACA: a cor do tema
 * não serve aqui, porque o fundo da placa não muda com o tema claro.
 *
 * `placa` vence `nameplateId`: a prévia do backoffice desenha um item que
 * ainda não está registrado no catálogo, e resolvê-lo por id cairia no padrão.
 */
export function NomeComPlaca({
  nome,
  nameplateId,
  placa,
  className = '',
}: {
  nome: string;
  nameplateId?: string;
  placa?: Nameplate;
  className?: string;
}) {
  const estilo = estiloCssDaPlaca(placa ?? acharNameplate(nameplateId));
  if (!estilo) return <span className={className}>{nome}</span>;
  return (
    <span
      className={`inline-block max-w-full truncate rounded px-1.5 py-px align-middle leading-tight ${className}`}
      style={estilo}
    >
      {nome}
    </span>
  );
}
