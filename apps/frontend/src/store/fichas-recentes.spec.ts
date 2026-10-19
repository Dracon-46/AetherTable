/**
 * fichas-recentes.spec.ts — o "Usadas recentemente" do seletor de fichas.
 *
 * A lista vivia só no `localStorage`; trocar de máquina esvaziava a fileira.
 * O que estes casos fixam:
 *   - lembrar põe no topo, sem repetir, no máximo oito, e guarda no cache local
 *     com a MESMA chave e o MESMO formato de antes;
 *   - a primeira hidratação MESCLA a lista da conta com a local (a da conta
 *     primeiro) e pede para subir quando a mescla difere da conta;
 *   - campo ausente na resposta (API antiga) não apaga a lista local;
 *   - criar fichas em sequência vira UM PATCH, com a lista inteira;
 *   - entrada que a mesa recusaria não é lembrada.
 */

import { MAX_FICHAS_RECENTES, normalizarFichasRecentes } from '@aethertable/shared-types';
import {
  aplicarFichasRecentesDaConta,
  lembrarFichaRecente,
  lerFichasRecentes,
  MAX_RECENTES,
  observarFichasRecentes,
  reiniciarFichasRecentes,
} from './fichas-recentes';
import { ESPERA_MS } from './preferencias-da-conta';
import { useAuthStore } from './auth.store';
import { api } from '../lib/fetcher';

jest.mock('../lib/fetcher', () => ({
  ...jest.requireActual('../lib/fetcher'),
  api: jest.fn(),
}));

const apiMock = api as jest.MockedFunction<typeof api>;
const CHAVE = 'aether-fichas-recentes';

const SOLDADO = {
  scryfallId: '0dd0f3e2-3e0a-4b41-9a10-2f83e4d3b3f6',
  name: 'Soldier',
  power: '1',
  toughness: '1',
};
const TESOURO = { scryfallId: '1a2b3c4d-1111-4222-8333-944455556666', name: 'Treasure' };
const ELEMENTAL = { name: 'Elemental', power: '4', toughness: '4' };

beforeEach(() => {
  window.localStorage.clear();
  reiniciarFichasRecentes();
  useAuthStore.setState({ accessToken: 'token', user: { id: 'u1', username: 'ana' } });
  apiMock.mockReset();
  apiMock.mockResolvedValue({});
});

describe('no navegador', () => {
  it('lê a lista que o seletor já guardava, no formato de antes', () => {
    window.localStorage.setItem(CHAVE, JSON.stringify([SOLDADO, ELEMENTAL]));
    expect(lerFichasRecentes()).toEqual([SOLDADO, ELEMENTAL]);
  });

  it('lembrar põe no topo, sem repetir, e guarda', () => {
    lembrarFichaRecente(SOLDADO);
    lembrarFichaRecente(TESOURO);
    const lista = lembrarFichaRecente({ ...SOLDADO });
    expect(lista).toEqual([SOLDADO, TESOURO]);
    expect(JSON.parse(window.localStorage.getItem(CHAVE)!)).toEqual([SOLDADO, TESOURO]);
  });

  it(`no máximo ${MAX_RECENTES}`, () => {
    for (let i = 0; i < MAX_RECENTES + 3; i++) lembrarFichaRecente({ name: `Ficha ${i}` });
    expect(lerFichasRecentes()).toHaveLength(MAX_RECENTES);
    expect(lerFichasRecentes()[0]!.name).toBe(`Ficha ${MAX_RECENTES + 2}`);
  });

  it('ficha que a mesa recusaria não é lembrada', () => {
    // Os mesmos limites do `CreateTokenIntent`: a conta recusaria a lista.
    expect(
      normalizarFichasRecentes([
        { ...SOLDADO, scryfallId: 'nao-e-uuid' },
        { name: 'Soldier', power: '12345' },
        { name: '' },
        { name: 'x'.repeat(121) },
        'Soldier',
        ELEMENTAL,
        { ...ELEMENTAL },
      ]),
    ).toEqual([ELEMENTAL]);
    expect(MAX_FICHAS_RECENTES).toBeGreaterThanOrEqual(MAX_RECENTES);
  });
});

describe('a hidratação', () => {
  it('mescla: a lista da conta primeiro, depois o que só este navegador tinha', () => {
    window.localStorage.setItem(CHAVE, JSON.stringify([ELEMENTAL, SOLDADO]));
    const subir = aplicarFichasRecentesDaConta([SOLDADO, TESOURO]);

    expect(lerFichasRecentes()).toEqual([SOLDADO, TESOURO, ELEMENTAL]);
    expect(JSON.parse(window.localStorage.getItem(CHAVE)!)).toEqual([SOLDADO, TESOURO, ELEMENTAL]);
    // O Elemental só existia aqui: a mescla precisa subir.
    expect(subir).toBe(true);
  });

  it('o local que a conta já tem não precisa subir', () => {
    window.localStorage.setItem(CHAVE, JSON.stringify([TESOURO]));
    expect(aplicarFichasRecentesDaConta([SOLDADO, TESOURO])).toBe(false);
    expect(lerFichasRecentes()).toEqual([SOLDADO, TESOURO]);
  });

  it('campo ausente (API antiga) não apaga o local — e o local sobe', () => {
    window.localStorage.setItem(CHAVE, JSON.stringify([ELEMENTAL]));
    expect(aplicarFichasRecentesDaConta(undefined)).toBe(true);
    expect(lerFichasRecentes()).toEqual([ELEMENTAL]);
  });

  it('nada dos dois lados: nada sobe', () => {
    expect(aplicarFichasRecentesDaConta([])).toBe(false);
  });
});

describe('o envio para a conta', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('criar fichas em sequência vira UM PATCH, com a lista inteira', () => {
    aplicarFichasRecentesDaConta([]);
    const parar = observarFichasRecentes();
    lembrarFichaRecente(SOLDADO);
    lembrarFichaRecente(TESOURO);
    lembrarFichaRecente(SOLDADO);
    expect(apiMock).not.toHaveBeenCalled();

    jest.advanceTimersByTime(ESPERA_MS);

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/users/me', {
      method: 'PATCH',
      body: { fichasRecentes: [SOLDADO, TESOURO] },
    });
    parar();
  });

  it('a mescla da primeira hidratação sobe sozinha', () => {
    window.localStorage.setItem(CHAVE, JSON.stringify([ELEMENTAL]));
    const subir = aplicarFichasRecentesDaConta([SOLDADO]);
    const parar = observarFichasRecentes({ enviarJa: subir });
    jest.advanceTimersByTime(ESPERA_MS);
    expect(apiMock).toHaveBeenCalledWith('/users/me', {
      method: 'PATCH',
      body: { fichasRecentes: [SOLDADO, ELEMENTAL] },
    });
    parar();
  });

  it('antes da hidratação, lembrar não manda nada (não há observador)', () => {
    lembrarFichaRecente(SOLDADO);
    jest.advanceTimersByTime(ESPERA_MS * 2);
    expect(apiMock).not.toHaveBeenCalled();
  });
});
