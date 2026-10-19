'use client';

import { useEffect, useState } from 'react';
import { Circle, Group, Line } from 'react-konva';
import { acharPet } from '@aethertable/shared-types';
import { caminhoDoPet } from '../cosmetics/render';
import { useMovimentoReduzido } from './useMovimentoReduzido';

/**
 * Mascote da faixa. Discreto de propósito: fica no canto, é pequeno e se move
 * devagar. Um enfeite que disputa atenção com as cartas deixa de ser enfeite e
 * vira ruído — e a mesa já é densa.
 *
 * Respeita `prefers-reduced-motion`: quem pediu menos movimento vê a silhueta
 * parada, não uma silhueta pulsando.
 */
export function Mascote({ petId, x, y }: { petId: string; x: number; y: number }) {
  const pet = acharPet(petId);
  const pontos = caminhoDoPet(pet);
  const [t, setT] = useState(0);
  const reduzido = useMovimentoReduzido();
  /**
   * ─── O MASCOTE NUNCA SAÍA DO LUGAR ─────────────────────────────────────
   *
   * O efeito dependia de `pontos`, e `caminhoDoPet` devolve um array NOVO a
   * cada render. Cada quadro da animação re-renderizava, trocava o array,
   * reiniciava o efeito e zerava o relógio: o mascote ficava preso no
   * primeiro quadro. O que o efeito precisa saber é só SE há o que animar.
   */
  const animavel = pontos !== null;

  useEffect(() => {
    if (!animavel || reduzido) return;
    let raf = 0;
    const inicio = performance.now();
    const passo = (agora: number) => {
      setT((agora - inicio) / 1000);
      raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [animavel, reduzido]);

  if (!pontos) return null;

  const R = 17;
  const fase = Math.sin(t * 1.6);
  const dy = pet.animacao === 'flutuar' ? fase * 5 : 0;
  const escala = pet.animacao === 'pulsar' ? 1 + fase * 0.07 : 1;
  const giro = pet.animacao === 'balancar' ? fase * 7 : 0;

  return (
    <Group x={x} y={y + dy} rotation={giro} scaleX={escala} scaleY={escala} listening={false}>
      <Circle radius={R * 1.5} fill={pet.cor} opacity={0.1} />
      <Line
        points={pontos.flatMap(([px, py]) => [px * R, py * R])}
        closed
        fill={pet.cor}
        opacity={0.85}
        stroke="rgba(0,0,0,0.45)"
        strokeWidth={1.5}
      />
      {/* Olhos: é o que faz a silhueta virar bicho. */}
      <Circle x={-R * 0.28} y={-R * 0.12} radius={2.2} fill="#0b0f16" />
      <Circle x={R * 0.28} y={-R * 0.12} radius={2.2} fill="#0b0f16" />
    </Group>
  );
}
