/**
 * token-de-redefinicao.spec.ts — o que precisa continuar verdadeiro no link
 * que redefine uma senha.
 *
 * Três dos casos aqui vieram de defeitos clássicos desta funcionalidade, e
 * nenhum deles aparece em teste manual: o token que continua valendo depois de
 * usado, o token que nunca expira porque a conta foi criada com fuso diferente,
 * e a hash que muda de comprimento e passa a não bater com a coluna.
 */

import {
  CAMINHO_DE_REDEFINICAO,
  VALIDADE_EM_MINUTOS,
  expiracaoAPartirDe,
  gerarTokenDeRedefinicao,
  hashDoToken,
  tokenUtilizavel,
} from './token-de-redefinicao.js';

describe('gerarTokenDeRedefinicao', () => {
  it('usa alfabeto que sobrevive a uma querystring', () => {
    // `+`, `/` e `=` do base64 padrao quebram ao ser colados de um cliente de
    // e-mail ou ao viajar sem escape na URL. O sintoma seria "link invalido"
    // para uma parte dos usuarios e nao para outra.
    for (let i = 0; i < 50; i++) {
      expect(gerarTokenDeRedefinicao()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('não repete', () => {
    const vistos = new Set(Array.from({ length: 200 }, () => gerarTokenDeRedefinicao()));
    expect(vistos.size).toBe(200);
  });

  it('tem entropia suficiente para não ser adivinhado', () => {
    // 32 bytes em base64url dao 43 caracteres. Um token curto seria forca
    // bruta viavel contra uma rota que, por definicao, e publica.
    expect(gerarTokenDeRedefinicao().length).toBeGreaterThanOrEqual(43);
  });
});

describe('hashDoToken', () => {
  it('devolve sempre 64 hexadecimais — o tamanho da coluna', () => {
    expect(hashDoToken(gerarTokenDeRedefinicao())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('é determinístico: o mesmo token acha a mesma linha', () => {
    const token = gerarTokenDeRedefinicao();
    expect(hashDoToken(token)).toBe(hashDoToken(token));
  });

  it('não devolve o token', () => {
    // A garantia inteira do modulo: o banco nao pode conter o segredo.
    const token = gerarTokenDeRedefinicao();
    expect(hashDoToken(token)).not.toContain(token);
  });
});

describe('expiracaoAPartirDe', () => {
  it('soma exatamente a validade declarada', () => {
    const agora = new Date('2026-09-17T12:00:00.000Z');
    expect(expiracaoAPartirDe(agora).toISOString()).toBe('2026-09-17T12:30:00.000Z');
    expect(VALIDADE_EM_MINUTOS).toBe(30);
  });
});

describe('tokenUtilizavel', () => {
  const agora = new Date('2026-09-17T12:00:00.000Z');

  it('aceita token novo e não usado', () => {
    expect(tokenUtilizavel({ expiresAt: expiracaoAPartirDe(agora), usedAt: null }, agora)).toBe(
      true,
    );
  });

  it('recusa token já usado, mesmo dentro do prazo', () => {
    // O caso que importa: o link fica na caixa de entrada. Reutilizavel, ele e
    // uma conta aberta para quem ler o e-mail depois da troca.
    expect(
      tokenUtilizavel({ expiresAt: expiracaoAPartirDe(agora), usedAt: new Date() }, agora),
    ).toBe(false);
  });

  it('recusa token vencido', () => {
    const vencido = new Date(agora.getTime() - 1);
    expect(tokenUtilizavel({ expiresAt: vencido, usedAt: null }, agora)).toBe(false);
  });

  it('recusa no instante exato do vencimento', () => {
    expect(tokenUtilizavel({ expiresAt: new Date(agora.getTime()), usedAt: null }, agora)).toBe(
      false,
    );
  });
});

describe('CAMINHO_DE_REDEFINICAO', () => {
  it('é a rota que o frontend expõe', () => {
    // Uma constante dos dois lados nao impede a divergencia sozinha, mas
    // deixa o lugar unico onde corrigir quando a rota mudar.
    expect(CAMINHO_DE_REDEFINICAO).toBe('/senha/redefinir');
  });
});
