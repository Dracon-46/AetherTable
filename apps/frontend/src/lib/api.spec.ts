import { API_URL, WS_URL, authHeaders } from './api';

describe('lib/api', () => {
  it('expõe uma base de API absoluta e com o prefixo /api/v1', () => {
    expect(API_URL).toMatch(/^https?:\/\//);
    expect(API_URL).toContain('/api/v1');
  });

  it('não aponta para a faixa de portas reservada (3000–3020)', () => {
    // A API roda em 3333 e o frontend em 3030; nada do projeto pode cair na
    // faixa 3000–3020.
    const porta = Number(new URL(API_URL).port);
    expect(porta < 3000 || porta > 3020).toBe(true);
  });

  it('usa esquema de WebSocket', () => {
    expect(WS_URL).toMatch(/^wss?:\/\//);
  });

  it('monta o header Authorization quando há token', () => {
    expect(authHeaders('abc123')).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer abc123',
    });
  });

  it('omite o Authorization quando não há token', () => {
    const headers = authHeaders(null);
    expect(headers).toEqual({ 'Content-Type': 'application/json' });
    expect('Authorization' in headers).toBe(false);
  });
});
