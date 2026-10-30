'use client';

/**
 * Moldura.tsx — a casca das duas telas de senha.
 *
 * Hoje é uma camada fina sobre a `PortaFalkyria`, a mesma porta do login e do
 * cadastro: o mesmo fundo, o mesmo cartão, o mesmo dragão. O que fica aqui é o
 * que só as telas de senha têm — o cabeçalho com ícone e o "voltar para a
 * entrada" no pé.
 *
 * Quando ela nasceu, o login e o cadastro carregavam a `CenaDoDragao` (PNG e
 * fogo em canvas) e esta moldura não; agora as quatro telas são uma porta só.
 */

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { BOTAO_PRIMARIO, CAMPO, CabecalhoDoCartao, LINK, PortaFalkyria } from '../PortaFalkyria';

interface MolduraProps {
  icone: ReactNode;
  titulo: string;
  subtitulo: string;
  /** Sacode o painel quando há erro — o mesmo gesto do login. */
  tremer?: boolean;
  children: ReactNode;
}

export function Moldura({ icone, titulo, subtitulo, tremer = false, children }: MolduraProps) {
  return (
    <PortaFalkyria humor={tremer ? 'alerta' : 'repouso'} tremer={tremer}>
      <CabecalhoDoCartao icone={icone} titulo={titulo} subtitulo={subtitulo} />

      {children}

      <div className="border-line mt-6 border-t pt-5 text-center">
        <Link href="/" className={`${LINK} inline-flex items-center gap-1.5 text-sm`}>
          <ArrowLeft className="h-4 w-4" />
          Voltar para a entrada
        </Link>
      </div>
    </PortaFalkyria>
  );
}

/** A classe das caixas de texto, a mesma do login e do cadastro. */
export const ENTRADA = CAMPO;

/** O botão principal, o mesmo do login e do cadastro. */
export const BOTAO = BOTAO_PRIMARIO;
