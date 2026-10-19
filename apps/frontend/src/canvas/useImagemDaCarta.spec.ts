/**
 * useImagemDaCarta — o que cada carta da mesa desenha.
 *
 * O caso que motivou o arquivo: uma arte que FALHOU numa carta virada para
 * cima caía no sleeve, e a mesa inteira via o verso de uma carta pública.
 */

import { act, renderHook } from '@testing-library/react';
import { useImagemDaCarta } from './useImagemDaCarta';
import { getTexture } from './textureCache';

const SLEEVE = document.createElement('canvas');

jest.mock('../cosmetics/render', () => ({ sleeveCanvas: () => SLEEVE }));
jest.mock('./textureCache', () => ({ getTexture: jest.fn() }));

const getTextureMock = getTexture as jest.MockedFunction<typeof getTexture>;

/** Uma imagem no estado que se quiser, sem rede. */
function imagem(estado: { complete: boolean; naturalWidth: number }): HTMLImageElement {
  const img = new Image();
  Object.defineProperty(img, 'complete', { get: () => estado.complete });
  Object.defineProperty(img, 'naturalWidth', { get: () => estado.naturalWidth });
  return img;
}

beforeEach(() => {
  getTextureMock.mockReset();
});

describe('useImagemDaCarta', () => {
  it('carta oculta mostra o sleeve, sem pedir arte', () => {
    const { result } = renderHook(() => useImagemDaCarta('abc', false, 0, 'padrao'));

    expect(result.current).toBe(SLEEVE);
    expect(getTextureMock).not.toHaveBeenCalled();
  });

  it('carta virada para cima com a arte pronta mostra a arte', () => {
    const pronta = imagem({ complete: true, naturalWidth: 488 });
    getTextureMock.mockReturnValue(pronta);

    const { result } = renderHook(() => useImagemDaCarta('abc', true, 0, 'padrao'));

    expect(result.current).toBe(pronta);
  });

  it('arte QUEBRADA numa carta virada para cima mostra o nome, nunca o verso', () => {
    getTextureMock.mockReturnValue(imagem({ complete: true, naturalWidth: 0 }));

    const { result } = renderHook(() => useImagemDaCarta('abc', true, 0, 'padrao'));

    // `null` = o `CardSprite` desenha o nome da carta.
    expect(result.current).toBeNull();
  });

  it('enquanto a arte carrega, mostra o nome; quando chega, a arte', () => {
    const estado = { complete: false, naturalWidth: 0 };
    const carregando = imagem(estado);
    getTextureMock.mockReturnValue(carregando);

    const { result } = renderHook(() => useImagemDaCarta('abc', true, 0, 'padrao'));
    expect(result.current).toBeNull();

    estado.complete = true;
    estado.naturalWidth = 488;
    act(() => {
      carregando.dispatchEvent(new Event('load'));
    });
    expect(result.current).toBe(carregando);
  });

  it('o verso da dupla face pede a arte de trás', () => {
    getTextureMock.mockReturnValue(imagem({ complete: true, naturalWidth: 488 }));

    renderHook(() => useImagemDaCarta('abc', true, 1, 'padrao'));

    expect(getTextureMock).toHaveBeenLastCalledWith('abc', 'normal', 'back');
  });
});
