/**
 * credencial-de-voz.spec.ts — a credencial do LiveKit só sai com o passe de
 * voz do game-server, e só quando há servidor de voz configurado.
 *
 *  - O seat token ia em `X-Passe-De-Mesa`, e a API emite seat token para
 *    qualquer código de sala: dava para pedir voz numa mesa alheia.
 *  - Sem `NEXT_PUBLIC_LIVEKIT_URL`, a mesa conectava num domínio de terceiro
 *    e lhe entregava a credencial.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { escutarPasseDeVoz, useCredencialDeVoz } from './credencial-de-voz';

const BASE = {
  roomId: 'ABCD',
  accessToken: 'jwt',
  passeDeVoz: 'passe-do-game-server' as string | null,
  servidorDeVoz: 'wss://voz.exemplo.com',
};

const pedidos = () => (global.fetch as jest.Mock).mock.calls as [string, RequestInit][];

beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ token: 'credencial-livekit' }),
  })) as unknown as typeof fetch;
});

describe('escutarPasseDeVoz', () => {
  it('guarda o token da mensagem `passe-de-voz`', () => {
    const handlers: Record<string, (payload: unknown) => void> = {};
    const sala = {
      onMessage: (tipo: string, cb: (payload: unknown) => void) => {
        handlers[tipo] = cb;
        return () => {};
      },
    };
    const aoReceber = jest.fn();

    escutarPasseDeVoz(sala as never, aoReceber);
    handlers['passe-de-voz']!({ token: 'p1' });

    expect(aoReceber).toHaveBeenCalledWith('p1');
  });

  it('ignora um payload sem token', () => {
    const handlers: Record<string, (payload: unknown) => void> = {};
    const sala = {
      onMessage: (tipo: string, cb: (payload: unknown) => void) => {
        handlers[tipo] = cb;
        return () => {};
      },
    };
    const aoReceber = jest.fn();

    escutarPasseDeVoz(sala as never, aoReceber);
    handlers['passe-de-voz']!({ token: '' });

    expect(aoReceber).not.toHaveBeenCalled();
  });
});

describe('useCredencialDeVoz', () => {
  it('pede a credencial com o passe de voz, e não com o seat token', async () => {
    const { result } = renderHook(() => useCredencialDeVoz(BASE));

    await waitFor(() => expect(result.current).toBe('credencial-livekit'));
    const [url, init] = pedidos()[0]!;
    const headers = init.headers as Record<string, string>;
    expect(url).toContain('/matches/ABCD/voice-token');
    expect(headers['X-Passe-De-Voz']).toBe('passe-do-game-server');
    expect(headers).not.toHaveProperty('X-Passe-De-Mesa');
  });

  it('sem o passe ainda, espera em vez de pedir', async () => {
    const { result, rerender } = renderHook<string | null, typeof BASE>(useCredencialDeVoz, {
      initialProps: { ...BASE, passeDeVoz: null },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(pedidos()).toHaveLength(0);

    // O passe chega pela mensagem do game-server.
    rerender({ ...BASE });
    await waitFor(() => expect(result.current).toBe('credencial-livekit'));
    expect(pedidos()).toHaveLength(1);
  });

  it('sem servidor de voz configurado, não pede credencial nenhuma', async () => {
    const { result } = renderHook(() => useCredencialDeVoz({ ...BASE, servidorDeVoz: '' }));

    await new Promise((r) => setTimeout(r, 20));
    expect(pedidos()).toHaveLength(0);
    expect(result.current).toBeNull();
  });

  it('o código da sala vai codificado na URL', async () => {
    renderHook(() => useCredencialDeVoz({ ...BASE, roomId: 'AB/../x' }));

    await waitFor(() => expect(pedidos()).toHaveLength(1));
    expect(pedidos()[0]![0]).toContain('/matches/AB%2F..%2Fx/voice-token');
  });
});
