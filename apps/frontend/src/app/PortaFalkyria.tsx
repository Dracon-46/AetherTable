'use client';

/**
 * PortaFalkyria.tsx — a casca das telas de entrada: login, cadastro e as duas
 * de senha.
 *
 * Usa o sistema visual dos outros produtos da Falkyria (site e painel do Nicx):
 * neutros quentes, azul de destaque, ponto âmbar de assinatura, Geist no texto,
 * serifa no título, cartão de vidro com borda acesa pelo ponteiro, e um fundo de
 * brilho, quadriculado e grão. Os tokens estão em `globals.css`, bloco "Sistema
 * Falkyria".
 *
 * O desenho segue o `LoginView` do painel do Nicx: palco à esquerda (título e
 * mascote), formulário à direita. No celular o palco vira uma faixa de uma
 * linha acima do cartão; o formulário é o que precisa caber sem rolar.
 *
 * Antes havia duas cascas: o login e o cadastro com a `CenaDoDragao` (PNG e
 * fogo em canvas), e a `Moldura` das telas de senha, que não tinha a cena.
 * Agora as quatro telas são a mesma porta.
 *
 * `min-h-dvh` e não `min-h-screen`: `100vh` no celular é a altura da janela SEM
 * a barra do navegador, então a tela "cabe" no CSS e sobra conteúdo embaixo da
 * barra na vida real.
 */

import type { PointerEvent, ReactNode } from 'react';
import { DragaoAether, type HumorDoDragao } from '../components/DragaoAether';
import { geist, instrumentSerif } from './fonte-falkyria';
import { useT } from '../i18n/i18n';

interface PortaFalkyriaProps {
  /** A frase do palco, ao lado do título. Some no celular. */
  chamada?: string;
  humor?: HumorDoDragao;
  /** Sacode o cartão quando há erro. */
  tremer?: boolean;
  children: ReactNode;
}

/** A luz da borda do cartão segue o ponteiro (ver `.cartao-falkyria`). */
function seguirLuz(e: PointerEvent<HTMLDivElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
}

export function PortaFalkyria({
  chamada,
  humor = 'repouso',
  tremer = false,
  children,
}: PortaFalkyriaProps) {
  const t = useT();

  return (
    <div
      className={`${geist.className} text-ink relative isolate min-h-dvh w-full overflow-x-hidden`}
    >
      <div aria-hidden="true" className="fundo-falkyria" />

      <main className="mx-auto grid min-h-dvh w-full max-w-6xl content-center items-center gap-5 px-4 py-5 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12 lg:py-12">
        <section className="flex items-center gap-3 lg:flex-col lg:items-start lg:gap-0">
          <p className="rotulo-falkyria mb-4 hidden items-center gap-2 lg:flex">
            <span className="ponto-falkyria" />
            {t('Mesa virtual de card games')}
          </p>
          <h1
            className={`${instrumentSerif.className} text-ink text-[2.4rem] leading-[0.92] tracking-[-0.02em] lg:text-[clamp(3.6rem,7vw,6.25rem)]`}
          >
            Aether<em className="text-accent">Table</em>
          </h1>
          {chamada && (
            <p className="text-muted mt-5 hidden max-w-md text-[15px] leading-relaxed lg:block">
              {chamada}
            </p>
          )}
          <div className="relative order-first aspect-square w-16 shrink-0 lg:order-none lg:mt-6 lg:w-full lg:max-w-[380px]">
            <div
              aria-hidden="true"
              className="absolute inset-[14%] rounded-full blur-3xl"
              style={{ background: 'radial-gradient(circle, var(--glow-a), transparent 70%)' }}
            />
            <DragaoAether humor={humor} className="relative h-full w-full" />
          </div>
        </section>

        <section className="w-full max-w-md justify-self-center lg:justify-self-end">
          <div
            onPointerMove={seguirLuz}
            className={`cartao-falkyria p-5 sm:p-8 ${tremer ? 'animate-[shake_0.2s_ease-in-out]' : ''}`}
          >
            {children}
          </div>
        </section>
      </main>
    </div>
  );
}

interface CabecalhoDoCartaoProps {
  icone: ReactNode;
  titulo: string;
  subtitulo: string;
}

/** O topo do cartão: ícone num círculo de destaque, título e uma linha. */
export function CabecalhoDoCartao({ icone, titulo, subtitulo }: CabecalhoDoCartaoProps) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <span className="bg-accent-soft text-accent grid size-10 shrink-0 place-items-center rounded-full">
        {icone}
      </span>
      <div>
        <h2 className="text-ink text-lg font-semibold tracking-tight">{titulo}</h2>
        <p className="text-subtle text-xs">{subtitulo}</p>
      </div>
    </div>
  );
}

/*
 * As classes de controle das telas de entrada, iguais às do painel do Nicx.
 * Ficam aqui, e não em componentes, porque cada tela já tem os próprios
 * `<input>` com estado, `disabled` e `aria-*`: trocar a classe é o que muda.
 */

export const ROTULO = 'text-muted text-xs font-medium';

export const CAMPO =
  'border-line-strong bg-canvas/60 text-ink placeholder:text-subtle focus:border-accent h-12 w-full rounded-xl border px-4 text-[15px] outline-none transition-[border-color,box-shadow] duration-200 focus:shadow-[0_0_0_4px_var(--accent-soft)] disabled:opacity-50';

export const BOTAO_PRIMARIO =
  'group bg-ink text-canvas inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-5 text-[15px] font-medium tracking-[-0.01em] shadow-[0_1px_0_0_rgb(255_255_255/0.18)_inset,0_10px_24px_-12px_rgb(0_0_0/0.55)] transition-[background-color,transform] duration-200 hover:bg-[color-mix(in_oklab,var(--ink)_86%,var(--canvas))] active:scale-[0.98] disabled:cursor-default disabled:opacity-60';

export const BOTAO_SECUNDARIO =
  'bg-surface text-ink border-line-strong hover:bg-surface-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border px-5 text-[15px] font-medium shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors';

export const AVISO_ERRO =
  'bg-danger-soft text-danger flex items-start gap-3 rounded-xl px-4 py-3 text-[13px] leading-relaxed';

export const AVISO_ALERTA =
  'bg-amber-soft text-amber-ink flex items-start gap-3 rounded-xl px-4 py-3 text-[13px] leading-relaxed';

export const LINK = 'text-accent hover:text-accent-hover transition-colors';
