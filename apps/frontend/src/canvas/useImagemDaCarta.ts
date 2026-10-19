import { useEffect, useState } from 'react';
import { getTexture } from './textureCache';
import { sleeveCanvas } from '../cosmetics/render';

/**
 * O que desenhar numa carta da mesa: a arte, o sleeve ou `null`.
 *
 * `null` não é "nada": o `CardSprite` desenha o NOME da carta no lugar, que já
 * dá para jogar enquanto a arte não chega.
 *
 * ─── IMAGEM QUEBRADA NÃO VIRA VERSO ────────────────────────────────────────
 *
 * Uma arte que falhou (`complete` com largura zero) caía no sleeve. Numa carta
 * VIRADA PARA CIMA, isso diz à mesa inteira que ela está oculta: o jogador
 * via o verso de uma carta que todo mundo podia ver, sem saber qual era. O
 * sleeve é só para carta oculta; arte que falhou mostra o nome.
 */
export function useImagemDaCarta(
  scryfallId: string,
  frente: boolean,
  face: number,
  sleeveId: string,
): HTMLImageElement | HTMLCanvasElement | null {
  const [imgEl, setImgEl] = useState<HTMLImageElement | HTMLCanvasElement | null>(null);

  useEffect(() => {
    // Carta oculta mostra o SLEEVE, desenhado localmente. Nada de rede, e
    // nada de arte da WotC (DOC-060 §2.1).
    if (!frente || !scryfallId) {
      setImgEl(sleeveCanvas(sleeveId));
      return;
    }

    let active = true;
    const alvo = getTexture(scryfallId, 'normal', face === 1 ? 'back' : 'front');

    if (alvo.complete) {
      setImgEl(alvo.naturalWidth > 0 ? alvo : null);
      return;
    }

    setImgEl(null);
    const onLoad = () => {
      if (active && alvo.naturalWidth > 0) setImgEl(alvo);
    };
    alvo.addEventListener('load', onLoad);
    return () => {
      active = false;
      alvo.removeEventListener('load', onLoad);
    };
  }, [scryfallId, frente, face, sleeveId]);

  return imgEl;
}
