/**
 * esquecer-conta.spec.ts — a conta seguinte não herda o visual da anterior.
 *
 * Cosméticos e atalhos moram no localStorage do NAVEGADOR. Num computador
 * compartilhado, quem entrava depois herdava sleeve, título e teclas de quem
 * saiu — e aparecia para a mesa com o visual de outra pessoa.
 */

import { COSMETICOS_PADRAO, ATALHOS_PADRAO } from '@aethertable/shared-types';
import { useCosmeticos } from './store';
import { useAtalhos } from '../store/atalhos.store';

describe('trocar de conta no mesmo navegador', () => {
  it('os cosméticos voltam ao padrão e o navegador esquece os da conta anterior', () => {
    useCosmeticos.setState({ sleeveId: 'sleeve-de-outra-conta' } as never);
    window.localStorage.setItem('qualquer', 'x');

    useCosmeticos.getState().esquecerConta();

    expect(useCosmeticos.getState().sleeveId).toBe(COSMETICOS_PADRAO.sleeveId);
    expect(useCosmeticos.getState().tier).toBe('FREE');
  });

  it('os atalhos voltam às teclas de fábrica', () => {
    useAtalhos.setState({ atalhos: { ...ATALHOS_PADRAO, COMPRAR: 'z' } });

    useAtalhos.getState().esquecerConta();

    expect(useAtalhos.getState().atalhos).toEqual(ATALHOS_PADRAO);
  });
});
