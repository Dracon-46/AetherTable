import { useMemo } from 'react';
import { playmatCanvas } from '../cosmetics/render';

/**
 * O playmat do jogador local como imagem de fundo (`data:` URL).
 *
 * ─── A CODIFICAÇÃO É POR PLAYMAT, NÃO POR JOGADA ───────────────────────────
 *
 * O memo dependia do mapa `players` inteiro. Qualquer ponto de vida, marcador
 * ou carta comprada por qualquer jogador trocava esse mapa, e o canvas do
 * playmat era reconvertido em PNG — uma codificação de centenas de KB, várias
 * vezes por turno, para produzir a mesma string. O canvas já é cacheado por id
 * em `cosmetics/render.ts`; a conversão agora também é.
 */
export function usePlaymatDeFundo(playmatId: string): string | null {
  return useMemo(() => {
    const canvas = playmatCanvas(playmatId);
    return canvas ? canvas.toDataURL() : null;
  }, [playmatId]);
}
