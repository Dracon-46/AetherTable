/**
 * preferencias-de-interface.spec.ts — a aparência do site na conta.
 *
 * Visão, agrupamento e ordenação do grimório, tamanho das artes, densidade,
 * animações e os dois idiomas viviam só no `localStorage`: trocar de PC
 * zerava. O que estes casos fixam:
 *   - o padrão do contrato (shared-types) é o estado inicial do store;
 *   - o normalizador nunca falha e o DTO barra abuso;
 *   - aplicar toca SÓ o que a conta traz, e diz quando o navegador tem algo
 *     a subir;
 *   - a assinatura manda UM PATCH por rajada, e só pelo que vai para a conta
 *     (recolher o menu é do aparelho e não sobe).
 */

import {
  CHAVES_DE_PREFERENCIA_DE_INTERFACE,
  PREFERENCIAS_DE_INTERFACE_PADRAO,
  ehPreferenciaDeInterface,
  normalizarPreferenciasDeInterface,
} from '@aethertable/shared-types';
import { useAparencia } from './aparencia.store';
import { useAuthStore } from './auth.store';
import {
  aplicarPreferenciasDeInterface,
  ESPERA_MS,
  lerPreferenciasDeInterface,
  observarPreferenciasDeInterface,
} from './preferencias-da-conta';
import { api } from '../lib/fetcher';

jest.mock('../lib/fetcher', () => ({
  ...jest.requireActual('../lib/fetcher'),
  api: jest.fn(),
}));

const apiMock = api as jest.MockedFunction<typeof api>;
const inicial = useAparencia.getState();

beforeEach(() => {
  useAparencia.setState(inicial, true);
  useAuthStore.setState({ accessToken: 'token', user: { id: 'u1', username: 'ana' } });
  apiMock.mockReset();
  apiMock.mockResolvedValue({});
});

describe('o contrato', () => {
  it('o padrão do contrato é o mesmo estado inicial do store', () => {
    // Se divergirem, uma conta nova abriria o site de um jeito e a primeira
    // gravação o mudaria sem ninguém ter pedido.
    expect(lerPreferenciasDeInterface()).toEqual(PREFERENCIAS_DE_INTERFACE_PADRAO);
  });

  it('o que fica no aparelho não está no contrato', () => {
    expect(CHAVES_DE_PREFERENCIA_DE_INTERFACE).not.toContain('menuRecolhido');
    expect(CHAVES_DE_PREFERENCIA_DE_INTERFACE).not.toContain('painelDeBuscaRecolhido');
  });

  it('o normalizador nunca falha: valor fora da lista cai no padrão e o resto passa', () => {
    for (const lixo of [null, undefined, 'texto', 7, [1]]) {
      expect(normalizarPreferenciasDeInterface(lixo)).toEqual(PREFERENCIAS_DE_INTERFACE_PADRAO);
    }
    const r = normalizarPreferenciasDeInterface({
      visaoDeDeck: 'galeria',
      densidade: 'apertadissima',
      idiomaDasCartas: 'klingon',
      idiomaDaInterface: 'en',
      animacoesReduzidas: 'sim',
    });
    expect(r).toEqual({
      ...PREFERENCIAS_DE_INTERFACE_PADRAO,
      visaoDeDeck: 'galeria',
      idiomaDaInterface: 'en',
    });
  });

  it('ehPreferenciaDeInterface barra chave desconhecida, aninhamento e texto gigante', () => {
    expect(ehPreferenciaDeInterface({})).toBe(true);
    expect(ehPreferenciaDeInterface(PREFERENCIAS_DE_INTERFACE_PADRAO)).toBe(true);
    expect(ehPreferenciaDeInterface({ menuRecolhido: true })).toBe(false);
    expect(ehPreferenciaDeInterface({ densidade: { a: 1 } })).toBe(false);
    expect(ehPreferenciaDeInterface({ densidade: 'x'.repeat(33) })).toBe(false);
    expect(ehPreferenciaDeInterface([])).toBe(false);
  });
});

describe('aplicar o que veio da conta', () => {
  it('aplica as chaves que a conta traz', () => {
    aplicarPreferenciasDeInterface({ visaoDeDeck: 'galeria', idiomaDaInterface: 'en' });
    expect(useAparencia.getState().visaoDeDeck).toBe('galeria');
    expect(useAparencia.getState().idiomaDaInterface).toBe('en');
  });

  it('chave ausente não apaga o navegador — e o navegador sobe', () => {
    // A conta foi gravada antes de existir `densidade` (ou é `{}` de fábrica).
    useAparencia.setState({ densidade: 'compacta' });
    expect(aplicarPreferenciasDeInterface({ visaoDeDeck: 'galeria' })).toBe(true);
    expect(useAparencia.getState().densidade).toBe('compacta');
    expect(aplicarPreferenciasDeInterface({})).toBe(true);
    expect(aplicarPreferenciasDeInterface(undefined)).toBe(true);
    expect(useAparencia.getState().densidade).toBe('compacta');
  });

  it('navegador todo no padrão não sobe nada', () => {
    // Se subisse, o padrão viraria escolha gravada e apagaria a de outra máquina.
    expect(aplicarPreferenciasDeInterface({})).toBe(false);
    expect(aplicarPreferenciasDeInterface(undefined)).toBe(false);
  });

  it('a conta com tudo não precisa ouvir o navegador', () => {
    useAparencia.setState({ densidade: 'compacta' });
    expect(aplicarPreferenciasDeInterface({ ...PREFERENCIAS_DE_INTERFACE_PADRAO })).toBe(false);
    // E a conta vence: a densidade volta à da conta.
    expect(useAparencia.getState().densidade).toBe('confortavel');
  });
});

describe('a assinatura com espera', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('uma rajada de mudanças vira UM PATCH, com o objeto completo', () => {
    const parar = observarPreferenciasDeInterface();
    useAparencia.getState().setVisaoDeDeck('galeria');
    useAparencia.getState().setDensidade('compacta');
    useAparencia.getState().setIdiomaDasCartas('en');
    expect(apiMock).not.toHaveBeenCalled();

    jest.advanceTimersByTime(ESPERA_MS);

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/users/me', {
      method: 'PATCH',
      body: {
        preferenciasDeInterface: {
          ...PREFERENCIAS_DE_INTERFACE_PADRAO,
          visaoDeDeck: 'galeria',
          densidade: 'compacta',
          idiomaDasCartas: 'en',
        },
      },
    });
    parar();
  });

  it('recolher o menu é do aparelho: não manda nada', () => {
    const parar = observarPreferenciasDeInterface();
    useAparencia.getState().alternarMenu();
    useAparencia.getState().alternarPainelDeBusca();
    jest.advanceTimersByTime(ESPERA_MS * 2);
    expect(apiMock).not.toHaveBeenCalled();
    parar();
  });

  it('enviarJa sobe o estado atual mesmo sem mudança', () => {
    useAparencia.setState({ tamanhoDeCarta: 'grande' });
    const parar = observarPreferenciasDeInterface({ enviarJa: true });
    jest.advanceTimersByTime(ESPERA_MS);
    expect(apiMock).toHaveBeenCalledTimes(1);
    parar();
  });

  it('parar com envio pendente manda na hora, em vez de perder a escolha', () => {
    const parar = observarPreferenciasDeInterface();
    useAparencia.getState().setOrdenacaoDeDeck('preco');
    parar();
    expect(apiMock).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(ESPERA_MS * 2);
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('sem sessão (logout), parar não manda nada', () => {
    const parar = observarPreferenciasDeInterface();
    useAparencia.getState().setOrdenacaoDeDeck('preco');
    useAuthStore.setState({ accessToken: null, user: null });
    parar();
    jest.advanceTimersByTime(ESPERA_MS * 2);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('falhar ao salvar não desfaz a escolha na tela', async () => {
    const aviso = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    apiMock.mockRejectedValue(new Error('sem rede'));
    const parar = observarPreferenciasDeInterface();
    useAparencia.getState().setVisaoDeDeck('compacta');
    jest.advanceTimersByTime(ESPERA_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(useAparencia.getState().visaoDeDeck).toBe('compacta');
    parar();
    aviso.mockRestore();
  });
});
