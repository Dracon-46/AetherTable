/**
 * erros.spec.ts — o que uma mensagem de erro precisa entregar.
 *
 * O risco que estes testes cobrem não é de tipo: é o de uma mensagem voltar a
 * ser inútil. Toda regressão aqui é silenciosa — o app continua funcionando,
 * só que o jogador volta a levar "erro" na cara e não sabe o que fazer.
 */

import { mensagemDeConexao, mensagemDeErro } from './erros';

describe('mensagemDeErro (intenção recusada)', () => {
  it('traduz os códigos que o servidor realmente envia', () => {
    for (const code of [
      'NOT_AUTHORIZED',
      'ENTITY_NOT_FOUND',
      'INVALID_PAYLOAD',
      'RATE_LIMITED',
      'INTERNAL',
    ]) {
      const texto = mensagemDeErro(code);
      expect(texto).not.toBe('');
      // Nunca devolver o código cru: "NOT_AUTHORIZED" não é uma frase.
      expect(texto).not.toContain(code);
    }
  });

  it('prefere a mensagem crua do servidor a um genérico, quando o código é desconhecido', () => {
    expect(mensagemDeErro('CODIGO_NOVO', 'A carta já saiu da zona.')).toBe(
      'A carta já saiu da zona.',
    );
  });

  it('nunca devolve string vazia, mesmo sem código nem mensagem', () => {
    expect(mensagemDeErro(undefined, undefined).length).toBeGreaterThan(0);
    expect(mensagemDeErro('', '   ').length).toBeGreaterThan(0);
  });
});

describe('mensagemDeConexao', () => {
  /**
   * O `onAuth` do servidor lança `Error(CODIGO)`, e o Colyseus às vezes
   * embrulha essa mensagem em vez de repassá-la crua. Por isso a busca é por
   * conteúdo, não por igualdade — uma comparação exata silenciaria justamente
   * os três casos que o jogador mais encontra.
   */
  it('distingue os três motivos de recusa do seat token', () => {
    const invalido = mensagemDeConexao(new Error('INVALID_TOKEN'));
    const expirado = mensagemDeConexao(new Error('TOKEN_EXPIRED'));
    const usado = mensagemDeConexao(new Error('TOKEN_ALREADY_USED'));

    expect(new Set([invalido, expirado, usado]).size).toBe(3);
    // O passe expirado precisa dizer QUANTO tempo ele valia.
    expect(expirado).toContain('um dia');
    // O passe já usado precisa explicar por que recarregar a página o queima.
    expect(usado.toLowerCase()).toContain('recarregar');
  });

  it('encontra o código mesmo quando o Colyseus embrulha a mensagem', () => {
    const embrulhado = mensagemDeConexao(
      new Error('Server refused: TOKEN_ALREADY_USED (code 4212)'),
    );
    expect(embrulhado).toBe(mensagemDeConexao(new Error('TOKEN_ALREADY_USED')));
  });

  it('reconhece sala cheia e falha de rede', () => {
    expect(mensagemDeConexao(new Error('room is full')).toLowerCase()).toContain('cheia');
    expect(mensagemDeConexao(new Error('WebSocket connection failed')).toLowerCase()).toContain(
      'hibernando',
    );
  });

  it('não engole um motivo desconhecido: repassa o texto do servidor', () => {
    expect(mensagemDeConexao(new Error('BANIDO_DA_SALA'))).toContain('BANIDO_DA_SALA');
  });

  it('aguenta um erro que não é Error', () => {
    expect(mensagemDeConexao(undefined).length).toBeGreaterThan(0);
    expect(mensagemDeConexao('falhou').length).toBeGreaterThan(0);
  });
});
