/**
 * ttl.spec.ts — a conversão que decide se alguém consegue entrar.
 *
 * O caso que motivou estes testes é o `'900'`: `JWT_ACCESS_TTL=900` está no
 * `render.yaml`, e variável de ambiente sempre chega como TEXTO. Passada crua
 * para o `jsonwebtoken`, essa string cai no parser de duração, não é
 * reconhecida, e a assinatura lança "Invalid expiresIn option" — dentro de uma
 * factory assíncrona no boot, que é o lugar mais silencioso possível para uma
 * exceção.
 */

import { TTL_PADRAO_SEGUNDOS, ttlEmSegundos } from './ttl.js';

describe('ttlEmSegundos', () => {
  it('aceita segundos em texto — o formato que está no render.yaml', () => {
    expect(ttlEmSegundos('900')).toBe(900);
  });

  it('aceita formato de duração', () => {
    expect(ttlEmSegundos('12h')).toBe(43_200);
    expect(ttlEmSegundos('45m')).toBe(2_700);
    expect(ttlEmSegundos('7d')).toBe(604_800);
    expect(ttlEmSegundos('30s')).toBe(30);
  });

  it('tolera espaço e maiúscula', () => {
    expect(ttlEmSegundos(' 12 H ')).toBe(43_200);
  });

  it('cai no padrão quando a variável não existe ou está vazia', () => {
    expect(ttlEmSegundos(undefined)).toBe(TTL_PADRAO_SEGUNDOS);
    expect(ttlEmSegundos('')).toBe(TTL_PADRAO_SEGUNDOS);
    expect(ttlEmSegundos('   ')).toBe(TTL_PADRAO_SEGUNDOS);
  });

  it('cai no padrão em formato que não entende, em vez de devolver NaN', () => {
    // `NaN` viraria um token sem expiração definida e um `expiresIn: null` no
    // corpo da resposta — falha silenciosa nos dois lados.
    expect(ttlEmSegundos('uma semana')).toBe(TTL_PADRAO_SEGUNDOS);
    expect(ttlEmSegundos('12 horas')).toBe(TTL_PADRAO_SEGUNDOS);
    expect(Number.isNaN(ttlEmSegundos('abc'))).toBe(false);
  });

  it('recusa zero e negativo — token nasceria expirado', () => {
    // O sintoma seria cruel: o login responde 200 com um token, e toda
    // requisição seguinte devolve 401.
    expect(ttlEmSegundos('0')).toBe(TTL_PADRAO_SEGUNDOS);
    expect(ttlEmSegundos('-100')).toBe(TTL_PADRAO_SEGUNDOS);
    expect(ttlEmSegundos('0h')).toBe(TTL_PADRAO_SEGUNDOS);
  });

  it('o padrão é de doze horas', () => {
    expect(TTL_PADRAO_SEGUNDOS).toBe(43_200);
  });
});
