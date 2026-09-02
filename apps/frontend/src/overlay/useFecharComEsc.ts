'use client';

import { useEffect } from 'react';

/**
 * useFecharComEsc — Escape fecha o painel aberto.
 *
 * ─── POR QUE ISTO VIROU UM HOOK ────────────────────────────────────────────
 *
 * Metade dos painéis da mesa tratava Escape e a outra metade não. O
 * `CardInspector`, o `ZoneInspector`, o `CardEditor` e o menu de contexto
 * fechavam; o modal de jogadores, o gerador de fichas e o scry, não.
 *
 * Numa mesa em tempo real isso é pior do que parece. Escape é reflexo: o
 * jogador aperta sem olhar, o painel não fecha, e ele conclui que a tela
 * travou — enquanto os oponentes continuam jogando atrás do overlay. Foi
 * exatamente a família de reclamação que o `MulliganModal` já tinha recebido
 * ("tem coisas que ficam por cima e não deixam agir").
 *
 * `capture: true` porque alguns painéis vivem dentro de contêineres que também
 * escutam teclado; sem a captura, quem consome o evento primeiro decide, e a
 * ordem depende de onde o foco está.
 */
export function useFecharComEsc(ativo: boolean, fechar: () => void): void {
  useEffect(() => {
    if (!ativo) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      fechar();
    };
    window.addEventListener('keydown', aoTeclar, true);
    return () => window.removeEventListener('keydown', aoTeclar, true);
  }, [ativo, fechar]);
}
