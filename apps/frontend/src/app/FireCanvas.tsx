'use client';

/**
 * FireCanvas.tsx — o dragão da tela de login, vivo.
 *
 * ─── O QUE HAVIA ANTES ─────────────────────────────────────────────────────
 *
 * O fogo nascia de `canvas.width / 2` — o centro geométrico da JANELA. Mas o
 * dragão não está no centro: ele ocupa o quadrante superior esquerdo da arte, e
 * a bocarra acesa fica em torno de 47% x / 43% y da imagem. O resultado é que as
 * chamas brotavam do vazio, um palmo abaixo do painel de login.
 *
 * Pior: o fundo usa `bg-cover bg-center`. A arte é quadrada (1024x1024), então
 * numa janela larga ela é recortada em cima e embaixo, e numa estreita, dos
 * lados. A boca não fica parada na tela — ela ANDA conforme o formato da
 * janela. Qualquer coordenada fixa acerta em uma resolução e erra em todas as
 * outras. Por isso `pontoNaArte` refaz aqui a mesma conta que o `cover` faz no
 * CSS.
 *
 * ─── AS TRÊS FASES ─────────────────────────────────────────────────────────
 *
 *   repouso    brasas subindo devagar, a boca com brilho baixo
 *   carga      o dragão INSPIRA: as brasas invertem e são sugadas para a
 *              bocarra, que acende progressivamente
 *   sopro      o jato sai da boca na direção em que ela aponta
 *
 * A carga existe para dar peso ao clique. Fogo que aparece do nada é um efeito;
 * fogo precedido de inspiração é uma criatura decidindo cuspir.
 */

import { useEffect, useRef } from 'react';

export type FaseDoDragao = 'repouso' | 'carga' | 'sopro';

/**
 * Onde fica a bocarra, em coordenadas NORMALIZADAS da arte (0..1).
 * Medido sobre `public/dragon_bg.png`: a frente da boca aberta.
 */
const BOCA = { u: 0.5, v: 0.43 };

/** A arte é quadrada; o `cover` precisa da proporção real. */
const ARTE = { largura: 1024, altura: 1024 };

/**
 * Para onde o dragão cospe. Ele encara a direita e um pouco para baixo — o
 * jato tem de acompanhar, senão o fogo atravessa a própria cabeça.
 */
const ANGULO_BASE = 0.18; // radianos, para a direita e levemente abaixo
const ABERTURA = 0.42; // dispersão do cone

interface Particula {
  x: number;
  y: number;
  vx: number;
  vy: number;
  raio: number;
  vida: number;
  duracao: number;
  cor: string;
  /** Brasa sugada na inspiração: caminha para a boca em vez de para fora. */
  sugada?: boolean;
}

const PALETA_FOGO = ['#ff3c00', '#ff7a00', '#ffb300', '#ffe9a3'];
const PALETA_BRASA = ['#ff6a00', '#ff9d2f', '#ffcf6b'];

const aleatorio = (min: number, max: number) => min + Math.random() * (max - min);
const escolher = <T,>(lista: readonly T[]): T =>
  lista[Math.floor(Math.random() * lista.length)] as T;

/**
 * Converte um ponto normalizado da arte na posição em pixels dentro do
 * container, replicando `background-size: cover` + `background-position: center`.
 */
function pontoNaArte(largura: number, altura: number, u: number, v: number) {
  const escala = Math.max(largura / ARTE.largura, altura / ARTE.altura);
  const desenhoL = ARTE.largura * escala;
  const desenhoA = ARTE.altura * escala;
  return {
    x: (largura - desenhoL) / 2 + u * desenhoL,
    y: (altura - desenhoA) / 2 + v * desenhoA,
    escala,
  };
}

export function FireCanvas({ fase }: { fase: FaseDoDragao }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particulasRef = useRef<Particula[]>([]);
  const quadroRef = useRef<number | null>(null);
  /** Fase lida dentro do loop sem recriá-lo: recriar zeraria as partículas. */
  const faseRef = useRef<FaseDoDragao>(fase);
  /** Quanto a boca está acesa, 0..1. Sobe na carga, cai sozinho no resto. */
  const cargaRef = useRef(0);

  useEffect(() => {
    faseRef.current = fase;
  }, [fase]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Quem pediu menos movimento recebe a cena parada, não uma cena piscando.
    const reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let largura = 0;
    let altura = 0;

    const redimensionar = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      largura = canvas.clientWidth;
      altura = canvas.clientHeight;
      canvas.width = Math.round(largura * dpr);
      canvas.height = Math.round(altura * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    redimensionar();
    window.addEventListener('resize', redimensionar);

    const brasa = (): Particula => ({
      // As brasas de repouso sobem do chão da caverna, não da boca.
      x: aleatorio(0, largura),
      y: altura + aleatorio(0, 40),
      vx: aleatorio(-0.25, 0.25),
      vy: aleatorio(-1.4, -0.5),
      raio: aleatorio(1, 2.6),
      vida: 0,
      duracao: aleatorio(140, 260),
      cor: escolher(PALETA_BRASA),
    });

    /** Mota de inspiração: nasce longe e é puxada para a bocarra. */
    const mota = (boca: { x: number; y: number }): Particula => {
      const angulo = aleatorio(0, Math.PI * 2);
      const distancia = aleatorio(120, 340);
      return {
        x: boca.x + Math.cos(angulo) * distancia,
        y: boca.y + Math.sin(angulo) * distancia,
        vx: 0,
        vy: 0,
        raio: aleatorio(1, 2.2),
        vida: 0,
        duracao: aleatorio(30, 60),
        cor: escolher(PALETA_BRASA),
        sugada: true,
      };
    };

    const chama = (boca: { x: number; y: number }, escala: number): Particula => {
      const angulo = ANGULO_BASE + aleatorio(-ABERTURA, ABERTURA) / 2;
      const forca = aleatorio(7, 17) * escala;
      return {
        x: boca.x + aleatorio(-6, 6),
        y: boca.y + aleatorio(-6, 6),
        vx: Math.cos(angulo) * forca,
        vy: Math.sin(angulo) * forca - aleatorio(0, 2),
        raio: aleatorio(10, 26) * escala,
        vida: 0,
        duracao: aleatorio(26, 46),
        cor: escolher(PALETA_FOGO),
      };
    };

    const desenharParticula = (p: Particula) => {
      const opacidade = Math.max(0, 1 - p.vida / p.duracao);
      if (opacidade <= 0) return;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.max(0.1, p.raio));
      const hex = Math.round(opacidade * 255)
        .toString(16)
        .padStart(2, '0');
      g.addColorStop(0, `${p.cor}${hex}`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.raio, 0, Math.PI * 2);
      ctx.fill();
    };

    /** O halo da bocarra. É ele que faz a criatura parecer estar carregando. */
    const desenharBrilhoDaBoca = (boca: { x: number; y: number }, escala: number) => {
      const carga = cargaRef.current;
      if (carga <= 0.01) return;
      const raio = (60 + carga * 190) * escala;
      const g = ctx.createRadialGradient(boca.x, boca.y, 0, boca.x, boca.y, raio);
      g.addColorStop(0, `rgba(255, 190, 90, ${0.5 * carga})`);
      g.addColorStop(0.35, `rgba(255, 110, 20, ${0.32 * carga})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(boca.x, boca.y, raio, 0, Math.PI * 2);
      ctx.fill();
    };

    const desenhar = () => {
      const boca = pontoNaArte(largura, altura, BOCA.u, BOCA.v);
      const atual = faseRef.current;

      ctx.clearRect(0, 0, largura, altura);
      ctx.globalCompositeOperation = 'screen';

      // A carga sobe rápido e desce devagar: encher é uma decisão, esvaziar é
      // inércia. Descer no mesmo ritmo faria o brilho piscar a cada passada
      // acidental do mouse.
      const alvo = atual === 'repouso' ? 0.12 : atual === 'carga' ? 1 : 0.75;
      const passo = cargaRef.current < alvo ? 0.055 : 0.02;
      cargaRef.current +=
        Math.sign(alvo - cargaRef.current) * Math.min(passo, Math.abs(alvo - cargaRef.current));

      desenharBrilhoDaBoca(boca, boca.escala);

      const lista = particulasRef.current;

      if (!reduzido) {
        if (atual === 'repouso' && lista.length < 90 && Math.random() < 0.35) {
          lista.push(brasa());
        }
        if (atual === 'carga' && lista.length < 260) {
          for (let i = 0; i < 3; i += 1) lista.push(mota(boca));
        }
        if (atual === 'sopro' && lista.length < 420) {
          for (let i = 0; i < 14; i += 1) lista.push(chama(boca, boca.escala));
        }
      }

      for (const p of lista) {
        if (p.sugada) {
          // Puxão para a boca, acelerando conforme chega — sugar é o inverso
          // visual de explodir, e é o que vende a inspiração.
          const dx = boca.x - p.x;
          const dy = boca.y - p.y;
          const dist = Math.hypot(dx, dy) || 1;
          const puxao = 0.9 + (1 - Math.min(1, dist / 340)) * 2.6;
          p.vx += (dx / dist) * puxao;
          p.vy += (dy / dist) * puxao;
          p.vx *= 0.86;
          p.vy *= 0.86;
          if (dist < 14) p.vida = p.duracao; // chegou: some dentro da bocarra
        } else {
          p.vy -= 0.12; // o calor sobe
          p.vx *= 0.985;
          p.vy *= 0.985;
          p.raio *= 1.03;
        }

        p.x += p.vx;
        p.y += p.vy;
        p.vida += 1;
        desenharParticula(p);
      }

      particulasRef.current = lista.filter((p) => p.vida < p.duracao && p.y > -80);

      quadroRef.current = requestAnimationFrame(desenhar);
    };

    desenhar();

    return () => {
      window.removeEventListener('resize', redimensionar);
      if (quadroRef.current) cancelAnimationFrame(quadroRef.current);
      particulasRef.current = [];
    };
    // Sem dependências: o loop lê a fase pelo ref. Recriá-lo a cada mudança de
    // fase apagaria as partículas em voo e cortaria o fogo pela metade.
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
    />
  );
}
