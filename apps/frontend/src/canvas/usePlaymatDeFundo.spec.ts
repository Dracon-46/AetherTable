/**
 * usePlaymatDeFundo — o playmat vira PNG uma vez por playmat.
 *
 * O memo dependia do mapa de jogadores inteiro: cada ponto de vida de
 * qualquer jogador reconvertia o canvas em PNG, várias vezes por turno.
 */

import { renderHook } from '@testing-library/react';
import { usePlaymatDeFundo } from './usePlaymatDeFundo';
import { playmatCanvas } from '../cosmetics/render';

jest.mock('../cosmetics/render', () => ({ playmatCanvas: jest.fn() }));

const playmatCanvasMock = playmatCanvas as jest.MockedFunction<typeof playmatCanvas>;
const toDataURL = jest.fn((): string => 'data:image/png;base64,xyz');

beforeEach(() => {
  toDataURL.mockClear();
  playmatCanvasMock.mockReturnValue({ toDataURL } as unknown as HTMLCanvasElement);
});

describe('usePlaymatDeFundo', () => {
  it('re-renderizar com o mesmo playmat não recodifica a imagem', () => {
    const { result, rerender } = renderHook(({ id }) => usePlaymatDeFundo(id), {
      initialProps: { id: 'floresta' },
    });

    // O que acontece a cada mudança de vida na mesa: o tabuleiro re-renderiza.
    rerender({ id: 'floresta' });
    rerender({ id: 'floresta' });

    expect(result.current).toBe('data:image/png;base64,xyz');
    expect(toDataURL).toHaveBeenCalledTimes(1);
  });

  it('trocar de playmat recodifica', () => {
    const { rerender } = renderHook(({ id }) => usePlaymatDeFundo(id), {
      initialProps: { id: 'floresta' },
    });
    rerender({ id: 'vulcao' });

    expect(toDataURL).toHaveBeenCalledTimes(2);
    expect(playmatCanvasMock).toHaveBeenLastCalledWith('vulcao');
  });

  it('sem canvas (fora do navegador), não há fundo', () => {
    playmatCanvasMock.mockReturnValue(null);
    const { result } = renderHook(() => usePlaymatDeFundo('floresta'));
    expect(result.current).toBeNull();
  });
});
