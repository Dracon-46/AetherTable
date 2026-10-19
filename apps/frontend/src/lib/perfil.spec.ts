/**
 * perfil.spec.ts — o apelido em branco não pode derrubar o salvamento.
 *
 * Perfil e Ajustes mandavam `displayName: ''` sempre que o campo opcional
 * estivesse vazio; o servidor exige um caractere quando o campo vem e recusava
 * o formulário inteiro — inclusive a troca de nome de usuário que a pessoa
 * tinha ido fazer.
 */

import { apelidoParaEnvio, usernameValido } from './perfil';

describe('apelidoParaEnvio', () => {
  it('campo em branco de quem nunca teve apelido NÃO vai no corpo', () => {
    expect(apelidoParaEnvio('', null)).toBeUndefined();
    expect(apelidoParaEnvio('', undefined)).toBeUndefined();
    // Espaço também é "em branco": `'   '` passava e o `trim` do servidor o
    // transformava no mesmo `''` recusado.
    expect(apelidoParaEnvio('   ', '')).toBeUndefined();
  });

  it('o JSON do PATCH sai sem a chave quando não há o que mudar', () => {
    const corpo = JSON.stringify({ username: 'ana', displayName: apelidoParaEnvio('', null) });
    expect(JSON.parse(corpo)).toEqual({ username: 'ana' });
  });

  it('apagar um apelido que existia é um pedido explícito de limpar: `null`', () => {
    expect(apelidoParaEnvio('', 'Ana, a Terrível')).toBeNull();
  });

  it('apelido preenchido vai aparado', () => {
    expect(apelidoParaEnvio('  Ana  ', null)).toBe('Ana');
    expect(apelidoParaEnvio('Ana', 'Antigo')).toBe('Ana');
  });
});

describe('usernameValido', () => {
  it('aceita o que o backend aceita', () => {
    expect(usernameValido('ana')).toBe(true);
    expect(usernameValido('Ana_B.silva-2')).toBe(true);
    expect(usernameValido('  ana  ')).toBe(true);
  });

  it('recusa caminho, espaço no meio e tamanho fora de 3 a 24', () => {
    expect(usernameValido('../admin')).toBe(false);
    expect(usernameValido('ana%2Fadmin')).toBe(false);
    expect(usernameValido('ana silva')).toBe(false);
    expect(usernameValido('ab')).toBe(false);
    expect(usernameValido('a'.repeat(25))).toBe(false);
  });
});
