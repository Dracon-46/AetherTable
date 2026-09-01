'use client';

import { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
}

export function FireCanvas({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Redimensiona o canvas para o tamanho da janela
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const createParticle = (): Particle => {
      // O fogo sai aproximadamente do centro da tela (onde o dragão estaria)
      const x = canvas.width / 2 + (Math.random() * 100 - 50);
      const y = canvas.height / 2 + 100 + Math.random() * 50;

      return {
        x,
        y,
        // O fogo explode para frente e para os lados
        vx: (Math.random() - 0.5) * 25,
        vy: (Math.random() - 1) * 20 - 10,
        size: Math.random() * 40 + 20,
        life: 0,
        maxLife: Math.random() * 40 + 30,
        // Paleta de fogo quente
        color: ['#ff4400', '#ff8800', '#ffcc00', '#ffffff'][
          Math.floor(Math.random() * 4)
        ] as string,
      };
    };

    const draw = () => {
      // Limpa a tela frame a frame
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Efeito de mesclagem para fazer as chamas brilharem intensamente umas sobre as outras
      ctx.globalCompositeOperation = 'screen';

      if (active) {
        // Gera novas partículas ferozmente se o fogo estiver ativo
        for (let i = 0; i < 15; i++) {
          particlesRef.current.push(createParticle());
        }
      }

      for (let i = 0; i < particlesRef.current.length; i++) {
        const p = particlesRef.current[i];
        if (!p) continue;

        // Desenha a partícula
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);

        // Gradiente radial para simular fogo e fumaça
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        const opacity = Math.max(0, 1 - p.life / p.maxLife);

        gradient.addColorStop(
          0,
          `${p.color}${Math.floor(opacity * 255)
            .toString(16)
            .padStart(2, '0')}`,
        );
        gradient.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.fillStyle = gradient;
        ctx.fill();

        // Movimento
        p.x += p.vx;
        p.y += p.vy;

        // O fogo sobe e espalha
        p.size *= 1.05; // Expande
        p.life++;
      }

      // Remove partículas mortas
      particlesRef.current = particlesRef.current.filter((p) => p.life < p.maxLife);

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-0 h-full w-full mix-blend-screen"
    />
  );
}
