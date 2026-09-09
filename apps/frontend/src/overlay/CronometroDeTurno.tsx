'use client';

/**
 * CronometroDeTurno.tsx — quanto tempo o turno atual está durando.
 *
 * ─── ELE CONTA E AVISA. NUNCA AGE. ─────────────────────────────────────────
 *
 * Não existe motor de regras (RN01). Um cronômetro que passasse o turno
 * sozinho seria a PRIMEIRA regra que o servidor impõe — e abriria a porta para
 * "então por que ele não desvira minhas permanentes também", que é exatamente
 * a ladeira que RN01 existe para não descer.
 *
 * Ao passar do limite ele muda de cor, e para aí. Quem passa o turno é o
 * jogador; o que este componente faz é tirar a discussão de "faz quanto tempo
 * que é a sua vez?" do campo da percepção.
 *
 * ─── POR QUE O CLIENTE CALCULA, EM VEZ DE RECEBER O TEMPO ──────────────────
 *
 * O servidor publica um único número — `turnoIniciadoEm`, o epoch em que o
 * turno começou — e cada cliente deriva o resto. A alternativa seria o servidor
 * transmitir o tempo decorrido a cada segundo: um `broadcast` por segundo, por
 * sala, para todo mundo, numa mesa que passa minutos parada enquanto alguém
 * pensa. Seria tráfego constante para uma informação que o cliente já consegue
 * produzir sozinho a partir de um timestamp.
 *
 * O custo é que o relógio local do jogador entra na conta. Para medir "faz uns
 * três minutos", isso é irrelevante; e é a única precisão que este componente
 * promete.
 */

import React from 'react';
import { Timer } from 'lucide-react';
import { useGameStore } from '../store/game.store';

/** `m:ss`, ou `h:mm:ss` quando alguém realmente demorou. */
function formatar(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(seg).padStart(2, '0')}`;
  return `${m}:${String(seg).padStart(2, '0')}`;
}

export function CronometroDeTurno() {
  const phase = useGameStore((s) => s.phase);
  const limite = useGameStore((s) => s.config.cronometroDeTurno);
  const inicio = useGameStore((s) => s.config.turnoIniciadoEm);

  const [agora, setAgora] = React.useState(() => Date.now());

  const rodando = phase === 'PLAYING' && limite > 0 && inicio > 0;

  React.useEffect(() => {
    if (!rodando) return;
    // Um tique por segundo, e só enquanto há cronômetro ligado: um intervalo
    // sempre ativo redesenharia a barra da mesa 60 vezes por minuto em toda
    // partida, inclusive nas que não pediram cronômetro nenhum.
    const id = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [rodando]);

  // Ressincroniza no exato momento em que o turno vira, sem esperar o próximo
  // tique: sem isto o cronômetro exibia até um segundo do turno anterior.
  React.useEffect(() => {
    if (rodando) setAgora(Date.now());
  }, [inicio, rodando]);

  if (!rodando) return null;

  const decorrido = Math.max(0, (agora - inicio) / 1000);
  const estourou = decorrido >= limite;

  return (
    <div
      className={`pointer-events-auto flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium shadow-lg backdrop-blur transition-colors ${
        estourou
          ? 'border-warning/60 bg-warning/15 text-warning'
          : 'border-panel-border bg-panel/90 text-text-muted'
      }`}
      // O `title` carrega a promessa inteira do componente: quem passar o mouse
      // por cima de um número vermelho precisa descobrir que nada vai acontecer.
      title={
        estourou
          ? `O turno passou do combinado (${formatar(limite)}). O cronômetro só avisa — quem passa o turno é o jogador.`
          : `Tempo deste turno. O combinado é ${formatar(limite)}.`
      }
      aria-label={`Tempo do turno atual: ${formatar(decorrido)}`}
    >
      <Timer className="h-3.5 w-3.5 shrink-0" />
      <span className="font-mono tabular-nums">{formatar(decorrido)}</span>
      <span className="text-text-faint hidden font-mono sm:inline">/ {formatar(limite)}</span>
    </div>
  );
}
