'use client';

/**
 * Moldura.tsx — a casca das duas telas de senha.
 *
 * ─── POR QUE UM COMPONENTE, E POR QUE ELE PARA AQUI ────────────────────────
 *
 * `app/page.tsx` (login) e `app/register/page.tsx` repetem este painel inteiro
 * — o mesmo `min-h-dvh`, o mesmo vidro, o mesmo `animate-[shake]` no erro. Um
 * terceiro e um quarto lugar com a mesma cópia seriam o momento em que uma
 * correção de layout passa a valer em duas telas e não nas outras duas.
 *
 * Ela NÃO foi aplicada retroativamente ao login e ao cadastro, e isso é uma
 * escolha: aquelas duas telas carregam a `CenaDoDragao` com o estado de sopro
 * ligado ao envio do formulário, e refatorá-las junto misturaria "criar a
 * recuperação de senha" com "mexer na porta de entrada do produto" no mesmo
 * diff. Fica registrado como o próximo passo óbvio de quem for mexer nelas.
 *
 * `min-h-dvh` e não `min-h-screen` pelo mesmo motivo do login: `100vh` no
 * celular é a altura da janela SEM a barra do navegador, então a tela "cabe" no
 * CSS e sobra conteúdo embaixo da barra na vida real.
 */

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

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
    <div className="relative flex min-h-dvh w-full items-center justify-center overflow-y-auto overflow-x-hidden px-3 py-4">
      <div
        className={`bg-panel/80 border-panel-border relative z-10 my-auto w-full max-w-md rounded-lg border p-5 shadow-2xl backdrop-blur-md transition-transform duration-300 sm:p-7 ${
          tremer ? 'animate-[shake_0.2s_ease-in-out]' : ''
        }`}
      >
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="bg-table-deep border-panel-border mb-3 rounded-full border p-2.5 shadow-inner">
            {icone}
          </div>
          <h1 className="text-text text-xl font-bold sm:text-2xl">{titulo}</h1>
          <p className="text-text-muted mt-1 text-sm">{subtitulo}</p>
        </div>

        {children}

        <div className="border-panel-border mt-5 border-t pt-4 text-center">
          <Link
            href="/"
            className="text-text-muted hover:text-primary inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para a entrada
          </Link>
        </div>
      </div>
    </div>
  );
}

/** A classe das caixas de texto, igual à do login e à de `TrocarSenha`. */
export const ENTRADA =
  'bg-table-deep border-panel-border text-text focus:border-primary focus:ring-primary w-full rounded-md border px-4 py-2.5 transition-colors focus:outline-none focus:ring-1 disabled:opacity-50';
