'use client';

/**
 * DragaoAether.tsx — o dragão da porta de entrada.
 *
 * Substitui a cena antiga (um PNG de 748 KB com fogo em canvas por cima). Ele
 * segue a linguagem do Nicx, o mascote da Falkyria: vetor, vidro azul com borda
 * ciano, um núcleo de luz por dentro, e a expressão vinda SÓ dos olhos e do
 * núcleo. Nada de boca, dente, bochecha ou olho grande: é uma cabeça de frente,
 * de brasão, com olhar estreito e pupila em fenda.
 *
 * O âmbar dos olhos é o mesmo do ponto que assina a Falkyria.
 *
 * ─── HUMORES ───────────────────────────────────────────────────────────────
 *
 *   repouso         respira devagar, pisca de vez em quando
 *   atento          pupilas dilatam (alguém está preenchendo o formulário)
 *   olhos-fechados  a pessoa digita a senha com ela escondida (como o Nicx)
 *   invocando       o envio saiu: núcleo e narinas acendem enquanto a API acorda
 *   alerta          o envio falhou: olhos avermelham e a cabeça sacode uma vez
 *
 * As animações são CSS (`globals.css`, bloco do dragão) e só usam `transform`,
 * `opacity` e `filter`. `prefers-reduced-motion` é tratado lá e aqui: quem pediu
 * menos movimento não recebe o olhar que segue o ponteiro.
 */

import { useEffect, useId, useRef } from 'react';

export type HumorDoDragao = 'repouso' | 'atento' | 'olhos-fechados' | 'invocando' | 'alerta';

interface DragaoAetherProps {
  humor?: HumorDoDragao;
  className?: string;
}

/** Até onde a pupila anda dentro do olho, em unidades do `viewBox`. */
const CURSO_DO_OLHAR = 2.6;

const OLHOS = [
  { olho: 'M64 94 Q80 89 92 104 Q76 107 64 94 Z', pupila: 80 },
  { olho: 'M136 94 Q120 89 108 104 Q124 107 136 94 Z', pupila: 120 },
] as const;

export function DragaoAether({ humor = 'repouso', className = '' }: DragaoAetherProps) {
  const ref = useRef<SVGSVGElement>(null);
  const uid = `dg${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const id = (parte: string) => `${uid}-${parte}`;

  // O olhar acompanha o ponteiro. Escreve variáveis CSS direto no SVG, sem
  // estado do React: um `setState` por `pointermove` renderizaria a página
  // inteira de login dezenas de vezes por segundo.
  useEffect(() => {
    const svg = ref.current;
    // `?.`: o jsdom dos testes (e navegador velho) não tem `matchMedia`.
    if (!svg || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let quadro = 0;
    const olhar = (e: PointerEvent) => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => {
        const r = svg.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height * 0.5);
        const dist = Math.hypot(dx, dy) || 1;
        const forca = Math.min(1, dist / 420);
        svg.style.setProperty(
          '--olhar-x',
          `${((dx / dist) * forca * CURSO_DO_OLHAR).toFixed(2)}px`,
        );
        svg.style.setProperty(
          '--olhar-y',
          `${((dy / dist) * forca * CURSO_DO_OLHAR * 0.6).toFixed(2)}px`,
        );
      });
    };
    window.addEventListener('pointermove', olhar, { passive: true });
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener('pointermove', olhar);
    };
  }, []);

  return (
    <svg
      ref={ref}
      viewBox="0 0 200 200"
      className={`dragao-aether ${className}`}
      data-humor={humor}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={id('corpo')} cx="0.44" cy="0.3" r="0.8" fx="0.4" fy="0.22">
          <stop offset="0" stopColor="#3b78c4" />
          <stop offset="0.42" stopColor="#17498a" />
          <stop offset="0.82" stopColor="#0b2752" />
          <stop offset="1" stopColor="#061430" />
        </radialGradient>
        <linearGradient id={id('chifre')} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#123f7a" />
          <stop offset="1" stopColor="#46e3f5" stopOpacity="0.85" />
        </linearGradient>
        <radialGradient id={id('borda')} cx="0.5" cy="0.42" r="0.62">
          <stop offset="0.7" stopColor="#46e3f5" stopOpacity="0" />
          <stop offset="1" stopColor="#46e3f5" stopOpacity="0.28" />
        </radialGradient>
        <radialGradient id={id('brilho')}>
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.26" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('iris')} cx="0.5" cy="0.45" r="0.6">
          <stop offset="0" stopColor="#ffe3a3" />
          <stop offset="0.45" stopColor="#f5b733" />
          <stop offset="1" stopColor="#a86c00" />
        </radialGradient>
        <radialGradient id={id('nucleo')}>
          <stop offset="0" stopColor="#e9fcff" />
          <stop offset="0.35" stopColor="#46e3f5" stopOpacity="0.9" />
          <stop offset="1" stopColor="#1c5cab" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('brasa')}>
          <stop offset="0" stopColor="#ffe3a3" />
          <stop offset="0.5" stopColor="#eda100" stopOpacity="0.6" />
          <stop offset="1" stopColor="#eda100" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('chao')}>
          <stop offset="0" stopColor="#46e3f5" stopOpacity="0.4" />
          <stop offset="1" stopColor="#46e3f5" stopOpacity="0" />
        </radialGradient>
        <clipPath id={id('recorte')}>
          <path d={CABECA} />
        </clipPath>
      </defs>

      <ellipse cx="100" cy="190" rx="52" ry="6" fill={`url(#${id('chao')})`} />

      <g className="dragao-cabeca">
        {/* Chifres curvos varridos para fora e, abaixo deles, as barbatanas
            da nuca: atrás da cabeça, dão a silhueta de réptil. */}
        <g fill={`url(#${id('chifre')})`}>
          <path d="M72 62 C64 48 52 34 32 22 C50 26 68 38 88 54 Z" />
          <path d="M128 62 C136 48 148 34 168 22 C150 26 132 38 112 54 Z" />
          <path d="M64 64 C54 58 44 56 30 56 C44 50 56 50 68 56 Z" fillOpacity="0.7" />
          <path d="M136 64 C146 58 156 56 170 56 C156 50 144 50 132 56 Z" fillOpacity="0.7" />
        </g>

        <path d={CABECA} fill={`url(#${id('corpo')})`} />
        <g clipPath={`url(#${id('recorte')})`}>
          <path d={CABECA} fill={`url(#${id('borda')})`} />
          <ellipse cx="84" cy="66" rx="22" ry="9" fill={`url(#${id('brilho')})`} />
        </g>
        <path d={CABECA} fill="none" stroke="#46e3f5" strokeOpacity="0.38" strokeWidth="1.1" />

        {/* Estrutura: crista da testa, arcadas e o dorso do focinho. */}
        <g fill="none" stroke="#46e3f5" strokeLinecap="round">
          <path d="M100 56 V60 M100 82 V96" strokeOpacity="0.3" strokeWidth="1" />
          <path
            d="M58 85 Q76 81 95 95 M142 85 Q124 81 105 95"
            strokeOpacity="0.5"
            strokeWidth="1.4"
          />
          <path
            d="M85 108 Q90 136 94 156 M115 108 Q110 136 106 156"
            strokeOpacity="0.2"
            strokeWidth="1"
          />
        </g>

        {/* O núcleo, como o do Nicx: é ele que "acende" quando o login sai. */}
        <circle className="dragao-aura" cx="100" cy="71" r="16" fill={`url(#${id('nucleo')})`} />
        <path
          className="dragao-nucleo"
          d="M100 62 L106 71 L100 81 L94 71 Z"
          fill="#e9fcff"
          fillOpacity="0.92"
        />

        {OLHOS.map(({ olho, pupila }, i) => (
          <g key={i} className="dragao-olho">
            <path d={olho} fill={`url(#${id('iris')})`} />
            <path className="dragao-olho-alerta" d={olho} fill="#ff5a47" />
            <g className="dragao-olhar">
              <ellipse
                className="dragao-pupila"
                cx={pupila}
                cy="98.5"
                rx="1.5"
                ry="4.6"
                fill="#1a0f00"
              />
            </g>
          </g>
        ))}

        {/* Narinas em fenda, abertas para fora, e as brasas que só aparecem
            invocando. Arco virado para cima lia como sorriso. */}
        <g fill="#040c1f" fillOpacity="0.85">
          <path d="M90 157 Q93 160 95 166 Q91 163 90 157 Z" />
          <path d="M110 157 Q107 160 105 166 Q109 163 110 157 Z" />
        </g>
        <g className="dragao-brasas">
          <circle cx="92" cy="162" r="6" fill={`url(#${id('brasa')})`} />
          <circle cx="108" cy="162" r="6" fill={`url(#${id('brasa')})`} />
        </g>
      </g>
    </svg>
  );
}

/** A silhueta: cabeça de frente, simétrica, com esporão na testa e franja na face. */
const CABECA =
  'M100 50 C88 50 74 53 66 59 L46 72 L58 82 C52 94 44 104 36 112 L60 117 C66 136 74 154 82 166 Q90 177 100 177 Q110 177 118 166 C126 154 134 136 140 117 L164 112 C156 104 148 94 142 82 L154 72 L134 59 C126 53 112 50 100 50 Z';
