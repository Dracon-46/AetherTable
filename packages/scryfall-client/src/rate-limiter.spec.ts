import { __resetRateLimiter, throttled } from './rate-limiter';

describe('fila serializada da Scryfall', () => {
  beforeEach(() => __resetRateLimiter());

  it('espaca chamadas concorrentes em >= 100 ms e nunca as dispara em paralelo', async () => {
    const starts: number[] = [];
    let emVoo = 0;
    let maxEmVoo = 0;

    const task = async () => {
      emVoo += 1;
      maxEmVoo = Math.max(maxEmVoo, emVoo);
      starts.push(Date.now());
      await new Promise((r) => setTimeout(r, 10));
      emVoo -= 1;
    };

    // Tres chamadas disparadas ao mesmo tempo: e o caso que a implementacao
    // de referencia de DOC-035 §3 deixaria passar em paralelo.
    await Promise.all([throttled(task), throttled(task), throttled(task)]);

    expect(maxEmVoo).toBe(1);
    expect(starts).toHaveLength(3);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(95);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(95);
  });

  it('uma rejeicao nao trava a fila', async () => {
    await expect(throttled(() => Promise.reject(new Error('falhou')))).rejects.toThrow('falhou');
    await expect(throttled(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});
