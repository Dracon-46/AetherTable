import { API_URL, GAME_HTTP_URL, WS_URL, authHeaders, httpDoWebSocket } from './api';

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

  it('httpDoWebSocket troca ws: por http: e wss: por https:', () => {
    expect(httpDoWebSocket('ws://localhost:2567')).toBe('http://localhost:2567');
    expect(httpDoWebSocket('wss://jogo.aethertable.gg')).toBe('https://jogo.aethertable.gg');
  });

  it('a troca é ancorada no início — um host chamado `ws` não é reescrito', () => {
    // Sem a âncora `^`, o `ws` do subdomínio seria a ocorrência substituída e a
    // lista de salas iria bater num endereço que não existe.
    expect(httpDoWebSocket('wss://ws.aethertable.gg/salas')).toBe(
      'https://ws.aethertable.gg/salas',
    );
  });

  it('GAME_HTTP_URL é o WS_URL em HTTP, mesmo host e mesma porta', () => {
    // Não é uma variável de ambiente própria de propósito: o game server serve
    // /health, /metrics e /salas no mesmo express em que o WebSocket vive.
    expect(GAME_HTTP_URL).toBe(httpDoWebSocket(WS_URL));
    expect(GAME_HTTP_URL).toMatch(/^https?:\/\//);
    expect(new URL(GAME_HTTP_URL).host).toBe(new URL(WS_URL).host);
  });
});
