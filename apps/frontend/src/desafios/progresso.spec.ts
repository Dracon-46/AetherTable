/**
 * progresso.spec.ts — o progresso dos desafios na conta, sem tela.
 *
 * O que estes casos fixam:
 *   - o recorde que o navegador guardava no formato antigo sobe UMA vez pela
 *     importação, e a chave antiga some só depois de a conta confirmar;
 *   - se a importação falha, nada é apagado e o recorde local continua valendo;
 *   - a pergunta abandonada (`emJogo: true`) zera a sequência ao abrir;
 *   - os `PUT` de um desafio saem em fila, na ordem em que aconteceram;
 *   - a carga é uma por conta, por mais desafios que abram.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ProgressoDosDesafios } from '@aethertable/shared-types';
import {
  abrirDesafio,
  carregarProgresso,
  reiniciarProgressoDosDesafios,
  useProgressoDeDesafio,
  useProgressoDosDesafios,
} from './progresso';
import { api } from '../lib/fetcher';
import { useAuthStore } from '../store/auth.store';

jest.mock('../lib/fetcher', () => ({
  ...jest.requireActual('../lib/fetcher'),
  api: jest.fn(),
}));

const apiMock = api as jest.MockedFunction<typeof api>;
type Resposta = (caminho: string, opcoes?: { method?: string; body?: unknown }) => Promise<unknown>;
const responder = (r: Resposta) => apiMock.mockImplementation(r);

const caminhos = () => apiMock.mock.calls.map(([c, o]) => `${o?.method ?? 'GET'} ${c}`);

beforeEach(() => {
  window.localStorage.clear();
  reiniciarProgressoDosDesafios();
  useAuthStore.setState({ accessToken: 'token', user: { id: 'u1', username: 'ana' } });
  apiMock.mockReset();
});

describe('o recorde que o navegador guardava', () => {
  it('sobe pela importação, e a chave antiga some depois que a conta confirma', async () => {
    window.localStorage.setItem('aethertable:desafio:adivinhe', '9');
    window.localStorage.setItem('aethertable:desafio:mais-cara', '3');
    const daConta: ProgressoDosDesafios = {
      adivinhe: { recorde: 9, sequencia: 0, emJogo: false },
      'mais-cara': { recorde: 11, sequencia: 2, emJogo: false },
    };
    responder(async () => daConta);

    await carregarProgresso();

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/users/me/desafios/importar', {
      method: 'POST',
      body: { adivinhe: 9, 'mais-cara': 3 },
    });
    // A importação devolve o mapa inteiro: não precisa de um GET a mais.
    expect(useProgressoDosDesafios.getState().mapa).toEqual(daConta);
    expect(window.localStorage.getItem('aethertable:desafio:adivinhe')).toBeNull();
    expect(window.localStorage.getItem('aethertable:desafio:mais-cara')).toBeNull();
  });

  it('se a importação falha, nada é apagado e o recorde local continua aparecendo', async () => {
    window.localStorage.setItem('aethertable:desafio:escada', '14');
    responder(async (caminho) => {
      if (caminho.endsWith('/importar')) throw new Error('API antiga');
      return { escada: { recorde: 6, sequencia: 2, emJogo: false } };
    });

    await carregarProgresso();

    expect(caminhos()).toEqual(['POST /users/me/desafios/importar', 'GET /users/me/desafios']);
    // O maior dos dois, e a sequência da conta.
    expect(useProgressoDosDesafios.getState().mapa.escada).toEqual({
      recorde: 14,
      sequencia: 2,
      emJogo: false,
    });
    // Fica para a próxima carga tentar de novo.
    expect(window.localStorage.getItem('aethertable:desafio:escada')).toBe('14');
  });

  it('sem nada antigo, é só o GET', async () => {
    responder(async () => ({}));
    await carregarProgresso();
    expect(caminhos()).toEqual(['GET /users/me/desafios']);
  });

  it('chave antiga fora do formato ou zerada não sobe — e é limpa', async () => {
    window.localStorage.setItem('aethertable:desafio:Chave Ruim', '5');
    window.localStorage.setItem('aethertable:desafio:grade', '0');
    responder(async () => ({}));
    await carregarProgresso();
    expect(caminhos()).toEqual(['GET /users/me/desafios']);
    expect(window.localStorage.getItem('aethertable:desafio:Chave Ruim')).toBeNull();
    expect(window.localStorage.getItem('aethertable:desafio:grade')).toBeNull();
  });
});

describe('a carga', () => {
  it('é uma por conta, por mais desafios que abram', async () => {
    responder(async () => ({}));
    await Promise.all([abrirDesafio('adivinhe'), abrirDesafio('escada'), abrirDesafio('grade')]);
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('a conta é a fonte da verdade, e o que vier estranho é normalizado', async () => {
    responder(async () => ({
      escada: { recorde: 8, sequencia: 3, emJogo: false },
      'Fora Do Formato': { recorde: 99 },
      grade: { recorde: -4, sequencia: 'x', emJogo: 'sim' },
    }));
    await carregarProgresso();
    expect(useProgressoDosDesafios.getState().mapa).toEqual({
      escada: { recorde: 8, sequencia: 3, emJogo: false },
      grade: { recorde: 0, sequencia: 0, emJogo: false },
    });
  });

  it('sem conta alcançável, o desafio abre do zero, sem erro', async () => {
    responder(async () => {
      throw new Error('rede');
    });
    await expect(abrirDesafio('adivinhe')).resolves.toBeUndefined();
    expect(useProgressoDosDesafios.getState().mapa).toEqual({});
  });
});

describe('a pergunta abandonada', () => {
  it('emJogo: true na conta zera a sequência ao abrir, e a conta fica sabendo', async () => {
    responder(async (caminho, opcoes) =>
      opcoes?.method === 'PUT'
        ? opcoes.body
        : { adivinhe: { recorde: 10, sequencia: 6, emJogo: true } },
    );

    await abrirDesafio('adivinhe');

    expect(useProgressoDosDesafios.getState().mapa.adivinhe).toEqual({
      recorde: 10,
      sequencia: 0,
      emJogo: false,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(apiMock).toHaveBeenLastCalledWith('/users/me/desafios/adivinhe', {
      method: 'PUT',
      body: { sequencia: 0, emJogo: false },
    });
  });

  it('sem pergunta aberta, a sequência continua e nada é enviado', async () => {
    responder(async () => ({ adivinhe: { recorde: 10, sequencia: 6, emJogo: false } }));
    await abrirDesafio('adivinhe');
    expect(useProgressoDosDesafios.getState().mapa.adivinhe!.sequencia).toBe(6);
    expect(caminhos()).toEqual(['GET /users/me/desafios']);
  });
});

describe('a fila de PUT', () => {
  it('o segundo PUT só sai depois que o primeiro terminou — na ordem em que aconteceram', async () => {
    let soltarPrimeiro: () => void = () => undefined;
    const corpos: unknown[] = [];
    responder((_caminho, opcoes) => {
      if (opcoes?.method !== 'PUT') return Promise.resolve({});
      corpos.push(opcoes.body);
      // O primeiro ("sorteei") fica pendurado, como numa rede lenta.
      return corpos.length === 1
        ? new Promise((r) => (soltarPrimeiro = () => r({})))
        : Promise.resolve({});
    });

    const { result } = renderHook(() => useProgressoDeDesafio('escada'));
    await waitFor(() => expect(result.current.pronto).toBe(true));
    act(() => result.current.comecarPergunta());
    act(() => result.current.responder(1));

    await waitFor(() => expect(corpos).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    // O "respondi" não passou na frente do "sorteei".
    expect(corpos).toEqual([{ sequencia: 0, emJogo: true }]);
    // E a tela não esperou a rede.
    expect(result.current.sequencia).toBe(1);
    expect(result.current.recorde).toBe(1);

    soltarPrimeiro();
    await waitFor(() =>
      expect(corpos).toEqual([
        { sequencia: 0, emJogo: true },
        { sequencia: 1, emJogo: false },
      ]),
    );
  });

  it('o recorde local só sobe; o maior que vier da conta também vale', async () => {
    responder((_caminho, opcoes) =>
      Promise.resolve(
        opcoes?.method === 'PUT'
          ? { recorde: 20, sequencia: 0, emJogo: false }
          : { escada: { recorde: 5, sequencia: 5, emJogo: false } },
      ),
    );
    const { result } = renderHook(() => useProgressoDeDesafio('escada'));
    await waitFor(() => expect(result.current.pronto).toBe(true));
    act(() => result.current.responder(0));
    expect(result.current.recorde).toBe(5);
    // A conta tinha um recorde maior (feito em outra máquina).
    await waitFor(() => expect(result.current.recorde).toBe(20));
  });

  it('sem sessão, nada sobe para a conta', async () => {
    useAuthStore.setState({ accessToken: null, user: null });
    window.localStorage.setItem('aethertable:desafio:grade', '5');
    await carregarProgresso();
    expect(apiMock).not.toHaveBeenCalled();
    // E o recorde antigo continua aparecendo.
    expect(useProgressoDosDesafios.getState().mapa.grade!.recorde).toBe(5);
  });
});
