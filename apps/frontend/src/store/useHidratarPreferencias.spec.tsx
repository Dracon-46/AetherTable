/**
 * useHidratarPreferencias — as preferências da conta sob StrictMode.
 *
 * A limpeza do efeito zerava o `ativo` da única requisição em voo, e a guarda
 * `jaBuscou` impedia a segunda montagem de pedir de novo: em desenvolvimento,
 * tema, cosméticos, atalhos e o tier de apoiador nunca eram aplicados.
 *
 * E a mesma guarda impedia o token NOVO da troca de senha de hidratar: o
 * observador das preferências de mesa ficava desligado e nada mais chegava à
 * conta.
 *
 * Depois, a aparência do site e as fichas recentes entraram na mesma
 * hidratação: o que a conta tem é aplicado, o que falta nela não apaga o
 * navegador (e sobe), e uma conta sem linha de preferências também liga os
 * observadores.
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { useHidratarPreferencias } from './useHidratarPreferencias';
import { useAuthStore } from './auth.store';
import { useCosmeticos } from '../cosmetics/store';
import { api } from '../lib/fetcher';
import {
  observarPreferenciasDaMesa,
  observarPreferenciasDeInterface,
} from './preferencias-da-conta';
import {
  observarFichasRecentes,
  lerFichasRecentes,
  reiniciarFichasRecentes,
} from './fichas-recentes';
import { useAparencia } from './aparencia.store';
import { useUIStore } from './game.store';

jest.mock('../lib/fetcher', () => ({
  ...jest.requireActual('../lib/fetcher'),
  api: jest.fn(),
}));
jest.mock('./preferencias-da-conta', () => ({
  ...jest.requireActual('./preferencias-da-conta'),
  observarPreferenciasDaMesa: jest.fn(),
  observarPreferenciasDeInterface: jest.fn(),
}));
jest.mock('./fichas-recentes', () => ({
  ...jest.requireActual('./fichas-recentes'),
  observarFichasRecentes: jest.fn(),
}));
// O catálogo autoral é outra busca (react-query); não participa da guarda.
jest.mock('../cosmetics/useCatalogo', () => ({ useCatalogoDeCosmeticos: () => 0 }));

const apiMock = api as jest.MockedFunction<typeof api>;
const observarMock = observarPreferenciasDaMesa as jest.MockedFunction<
  typeof observarPreferenciasDaMesa
>;
const pararDeObservar = jest.fn();
const observarAparenciaMock = observarPreferenciasDeInterface as jest.MockedFunction<
  typeof observarPreferenciasDeInterface
>;
const observarFichasMock = observarFichasRecentes as jest.MockedFunction<
  typeof observarFichasRecentes
>;
const aparenciaInicial = useAparencia.getState();
const mesaInicial = useUIStore.getState();

function Casca() {
  useHidratarPreferencias();
  return null;
}

beforeEach(() => {
  apiMock.mockReset();
  pararDeObservar.mockReset();
  observarMock.mockReset();
  observarMock.mockReturnValue(pararDeObservar);
  observarAparenciaMock.mockReset();
  observarAparenciaMock.mockReturnValue(jest.fn());
  observarFichasMock.mockReset();
  observarFichasMock.mockReturnValue(jest.fn());
  useAuthStore.setState({ accessToken: 'token', user: { id: 'u1', username: 'ana' } });
  useCosmeticos.setState({ tier: 'FREE' });
  useAparencia.setState(aparenciaInicial, true);
  useUIStore.setState(mesaInicial, true);
  window.localStorage.removeItem('aether-fichas-recentes');
  reiniciarFichasRecentes();
});

describe('useHidratarPreferencias', () => {
  it('sob StrictMode, o tier da conta é aplicado', async () => {
    apiMock.mockResolvedValue({ supporterTier: 'APOIADOR', preference: null });

    const { unmount } = render(
      <React.StrictMode>
        <Casca />
      </React.StrictMode>,
    );

    await waitFor(() => expect(useCosmeticos.getState().tier).toBe('APOIADOR'));
    unmount();
  });

  it('sob StrictMode, a remontagem aproveita o pedido em voo: UMA requisição', async () => {
    apiMock.mockResolvedValue({ supporterTier: 'APOIADOR', preference: {} });

    const { unmount } = render(
      <React.StrictMode>
        <Casca />
      </React.StrictMode>,
    );

    await waitFor(() => expect(useCosmeticos.getState().tier).toBe('APOIADOR'));
    expect(apiMock).toHaveBeenCalledTimes(1);
    // Aplicada uma vez: um observador só, não um por montagem.
    expect(observarMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('trocar a senha (token novo) hidrata de novo e religa o observador', async () => {
    apiMock.mockResolvedValue({ supporterTier: 'FREE', preference: {} });
    const { unmount } = render(<Casca />);
    await waitFor(() => expect(observarMock).toHaveBeenCalledTimes(1));

    apiMock.mockResolvedValue({ supporterTier: 'APOIADOR', preference: {} });
    act(() => {
      useAuthStore.getState().setAccessToken('token-depois-da-troca-de-senha');
    });

    await waitFor(() => expect(useCosmeticos.getState().tier).toBe('APOIADOR'));
    expect(apiMock).toHaveBeenCalledTimes(2);
    // O observador do token antigo foi desligado, e um novo, ligado.
    expect(pararDeObservar).toHaveBeenCalledTimes(1);
    expect(observarMock).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('fora do StrictMode continua sendo UMA requisição por montagem', async () => {
    apiMock.mockResolvedValue({ supporterTier: 'APOIADOR', preference: null });

    const { rerender, unmount } = render(<Casca />);
    await waitFor(() => expect(useCosmeticos.getState().tier).toBe('APOIADOR'));
    rerender(<Casca />);

    expect(apiMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('a placa de nome salva na conta é hidratada junto com os outros cosméticos', async () => {
    // Sem esta linha no hook, a placa ficaria presa ao `localStorage`: trocar
    // de máquina devolvia o jogador ao nome sem placa — o mesmo relato que
    // trouxe os outros cosméticos para a conta.
    apiMock.mockResolvedValue({
      supporterTier: 'APOIADOR',
      preference: { borderId: 'chama', nameplateId: 'ouro-real' },
    });

    const { unmount } = render(<Casca />);
    await waitFor(() => expect(useCosmeticos.getState().nameplateId).toBe('ouro-real'));
    expect(useCosmeticos.getState().borderId).toBe('chama');
    unmount();
  });

  it('a resposta que chega depois da desmontagem não é aplicada', async () => {
    let responder: (v: unknown) => void = () => {};
    apiMock.mockReturnValue(new Promise((r) => (responder = r)));

    const { unmount } = render(<Casca />);
    unmount();
    responder({ supporterTier: 'APOIADOR', preference: null });
    await Promise.resolve();

    expect(useCosmeticos.getState().tier).toBe('FREE');
  });

  it('a aparência e as preferências de mesa novas da conta são aplicadas', async () => {
    apiMock.mockResolvedValue({
      supporterTier: 'FREE',
      preference: {
        preferenciasDeInterface: { visaoDeDeck: 'galeria', idiomaDaInterface: 'en' },
        preferenciasDeMesa: { logDividido: true, efeitosSonoros: true },
      },
    });

    const { unmount } = render(<Casca />);
    await waitFor(() => expect(useAparencia.getState().visaoDeDeck).toBe('galeria'));
    expect(useAparencia.getState().idiomaDaInterface).toBe('en');
    expect(useUIStore.getState().logDividido).toBe(true);
    expect(useUIStore.getState().efeitosSonoros).toBe(true);
    // A conta tinha o que tinha; o navegador estava no padrão: nada a subir.
    expect(observarAparenciaMock).toHaveBeenCalledWith({ enviarJa: false });
    unmount();
  });

  it('campo ausente (API antiga) não apaga a aparência local — e ela sobe', async () => {
    useAparencia.setState({ densidade: 'compacta', tamanhoDeCarta: 'grande' });
    apiMock.mockResolvedValue({ supporterTier: 'FREE', preference: { keybindings: {} } });

    const { unmount } = render(<Casca />);
    await waitFor(() => expect(observarAparenciaMock).toHaveBeenCalledTimes(1));
    expect(useAparencia.getState().densidade).toBe('compacta');
    expect(useAparencia.getState().tamanhoDeCarta).toBe('grande');
    expect(observarAparenciaMock).toHaveBeenCalledWith({ enviarJa: true });
    unmount();
  });

  it('as fichas recentes da conta são mescladas com as deste navegador', async () => {
    const SOLDADO = { scryfallId: '0dd0f3e2-3e0a-4b41-9a10-2f83e4d3b3f6', name: 'Soldier' };
    const ELEMENTAL = { name: 'Elemental', power: '4', toughness: '4' };
    window.localStorage.setItem('aether-fichas-recentes', JSON.stringify([ELEMENTAL]));
    apiMock.mockResolvedValue({ supporterTier: 'FREE', preference: { fichasRecentes: [SOLDADO] } });

    const { unmount } = render(<Casca />);
    await waitFor(() => expect(observarFichasMock).toHaveBeenCalledTimes(1));
    expect(lerFichasRecentes()).toEqual([SOLDADO, ELEMENTAL]);
    // O Elemental só existia aqui: a lista mesclada sobe.
    expect(observarFichasMock).toHaveBeenCalledWith({ enviarJa: true });
    unmount();
  });

  it('conta sem linha de preferências também liga os observadores', async () => {
    // Antes, `preference: null` encerrava a hidratação ali: numa conta nova,
    // nada do que a pessoa ajustasse chegava à conta.
    useUIStore.setState({ previaAoLado: true });
    apiMock.mockResolvedValue({ supporterTier: 'FREE', preference: null });

    const { unmount } = render(<Casca />);
    await waitFor(() => expect(observarMock).toHaveBeenCalledTimes(1));
    expect(observarAparenciaMock).toHaveBeenCalledTimes(1);
    expect(observarFichasMock).toHaveBeenCalledTimes(1);
    // E a escolha local que a conta não tem sobe.
    expect(observarMock).toHaveBeenCalledWith({ enviarJa: true });
    expect(useUIStore.getState().previaAoLado).toBe(true);
    unmount();
  });
});
