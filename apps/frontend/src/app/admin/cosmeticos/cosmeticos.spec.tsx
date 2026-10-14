/**
 * Backoffice → Cosméticos — o segundo "nenhum" não podia ser registrado.
 *
 * O `value` de cada opção era só o `catalogoId`, que se repete entre tipos
 * ("nenhum" é título E mascote). As duas opções tinham o mesmo valor: escolher
 * a segunda selecionava a primeira, e o `find` devolvia a primeira também.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import CosmeticosPage from './page';

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);
jest.mock('./CriarCosmetico', () => ({ CriarCosmetico: () => null }));

const registrar = jest.fn();
const mutacao = (mutate = jest.fn()) => ({ mutate, isPending: false, isError: false, error: null });

jest.mock('../../../admin/useAdmin', () => ({
  useCosmeticos: () => ({
    isPending: false,
    isError: false,
    error: null,
    data: {
      registrados: [],
      catalogo: [
        { catalogoId: 'nenhum', nome: 'Sem título', tier: 'FREE', tipo: 'TITLE' },
        { catalogoId: 'nenhum', nome: 'Sem mascote', tier: 'FREE', tipo: 'PET' },
      ],
    },
  }),
  useRegistrarCosmetico: () => mutacao(registrar),
  useAtualizarCosmetico: () => mutacao(),
  useRemoverCosmetico: () => mutacao(),
}));

it('escolher o "nenhum" do mascote registra o do mascote, não o do título', () => {
  render(<CosmeticosPage />);
  const seletor = screen.getByRole('combobox');

  const valores = Array.from((seletor as HTMLSelectElement).options).map((o) => o.value);
  // Valores únicos: sem isso o navegador não distingue as duas opções.
  expect(new Set(valores).size).toBe(valores.length);

  const doMascote = Array.from((seletor as HTMLSelectElement).options).find((o) =>
    o.textContent?.includes('Sem mascote'),
  )!;
  fireEvent.change(seletor, { target: { value: doMascote.value } });
  fireEvent.click(screen.getByRole('button', { name: /Registrar/ }));

  expect(registrar).toHaveBeenCalledWith(
    { catalogoId: 'nenhum', tipo: 'PET', nome: 'Sem mascote', minTier: 0 },
    expect.anything(),
  );
});
