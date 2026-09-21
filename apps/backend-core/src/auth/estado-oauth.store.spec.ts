/**
 * estado-oauth.store.spec.ts — o `state` que DOC-050 §2.4 dava como existente.
 *
 * Ele não existia: sem a opção `store`, o `passport-oauth2` instala um
 * `NullStore` e o valor não é verificado. O ataque que isso permite é login
 * CSRF — a vítima termina logada na conta do ATACANTE, que é o caso coberto
 * pelo último teste daqui.
 */

import type { Request } from 'express';
import { EstadoOAuthStore } from './estado-oauth.store.js';

/** `express.Request`/`Response` de mentira, guardando os cookies num mapa. */
function requisicao(cookieDoNavegador?: string) {
  const definidos: Record<string, { valor: string; opcoes: Record<string, unknown> }> = {};
  const limpos: string[] = [];

  const req = {
    headers: cookieDoNavegador ? { cookie: cookieDoNavegador } : {},
    res: {
      cookie: (nome: string, valor: string, opcoes: Record<string, unknown>) => {
        definidos[nome] = { valor, opcoes };
      },
      clearCookie: (nome: string) => {
        limpos.push(nome);
      },
    },
  };

  // O store toca em `headers.cookie` e `res`, e mais nada. Montar um
  // `express.Request` inteiro so para satisfazer o tipo seria ruido.
  return { req: req as unknown as Request, definidos, limpos };
}

const NOME = 'at_oauth_state';

describe('contrato de arity com o passport-oauth2', () => {
  /**
   * ─── ESTE É O TESTE QUE MAIS IMPORTA AQUI ────────────────────────────────
   *
   * O `passport-oauth2` escolhe qual assinatura chamar pelo `.length` do método
   * (`strategy.js:289` e `:218`). Acrescentar ou remover um parâmetro no store
   * muda qual sobrecarga ele invoca — **em runtime, sem erro de compilação**. O
   * sintoma seria o objeto `meta` chegar na posição do callback, e o login por
   * OAuth quebrar com "callback is not a function" no primeiro clique em
   * produção.
   *
   * O `?` do TypeScript é apagado na compilação e NÃO reduz o `.length`: é por
   * isso que os números abaixo são 3 e 4, e não 2 e 3.
   */
  it('mantém `store.length === 3` e `verify.length === 4`', () => {
    const store = new EstadoOAuthStore(false);
    expect(store.store.length).toBe(3);
    expect(store.verify.length).toBe(4);
  });

  it('funciona também na forma curta, sem `meta`', () => {
    // A forma que o Passport usaria se os números acima mudassem.
    const store = new EstadoOAuthStore(false);
    const { req } = requisicao();

    let recebido: string | undefined;
    store.store(req, (_erro, estado) => {
      recebido = estado;
    });

    expect(recebido).toBeTruthy();
  });

  it('funciona na forma longa, com `meta` — a que o Passport usa hoje', () => {
    const store = new EstadoOAuthStore(false);
    const { req, definidos } = requisicao();
    const meta = { authorizationURL: 'https://x/auth', tokenURL: 'https://x/token', clientID: 'c' };

    let recebido: string | undefined;
    store.store(req, meta, (_erro, estado) => {
      recebido = estado;
    });

    expect(recebido).toBeTruthy();
    expect(definidos[NOME]?.valor).toBe(recebido);
  });
});

describe('EstadoOAuthStore.store', () => {
  it('grava o mesmo valor que devolve ao Passport', () => {
    const { req, definidos } = requisicao();
    const store = new EstadoOAuthStore(false);

    let devolvido: string | undefined;
    store.store(req, (_erro, estado) => {
      devolvido = estado;
    });

    expect(devolvido).toBeTruthy();
    expect(definidos[NOME]?.valor).toBe(devolvido);
  });

  it('não repete o valor entre fluxos', () => {
    const store = new EstadoOAuthStore(false);
    const gerados = new Set<string>();

    for (let i = 0; i < 100; i++) {
      const { req } = requisicao();
      store.store(req, (_e, estado) => gerados.add(estado));
    }

    expect(gerados.size).toBe(100);
  });

  it('o cookie é httpOnly e SameSite=lax', () => {
    const { req, definidos } = requisicao();
    new EstadoOAuthStore(false).store(req, () => {});

    const opcoes = definidos[NOME]!.opcoes;
    expect(opcoes.httpOnly).toBe(true);
    // `strict` quebraria o login SEMPRE: o callback do provedor é uma navegação
    // de nível superior vinda de outro site, e o cookie não acompanharia.
    expect(opcoes.sameSite).toBe('lax');
    // Restrito às rotas de auth — não acompanha as requisições da mesa.
    expect(opcoes.path).toBe('/api/v1/auth');
  });

  it('`secure` acompanha o ambiente', () => {
    // Em dev a API é http://localhost: com `secure`, o navegador nem guardaria
    // o cookie, e o fluxo inteiro falharia localmente.
    const dev = requisicao();
    new EstadoOAuthStore(false).store(dev.req, () => {});
    expect(dev.definidos[NOME]!.opcoes.secure).toBe(false);

    const prod = requisicao();
    new EstadoOAuthStore(true).store(prod.req, () => {});
    expect(prod.definidos[NOME]!.opcoes.secure).toBe(true);
  });
});

describe('EstadoOAuthStore.verify', () => {
  const store = new EstadoOAuthStore(false);

  function verificar(cookie: string | undefined, recebido: string) {
    const { req, limpos } = requisicao(cookie);
    let ok: boolean | undefined;
    let info: unknown;

    store.verify(req, recebido, (_erro, resultado, detalhe) => {
      ok = resultado;
      info = detalhe;
    });

    return { ok, info, limpos };
  }

  it('aceita quando o cookie e o `state` do provedor conferem', () => {
    expect(verificar(`${NOME}=abc123`, 'abc123').ok).toBe(true);
  });

  it('recusa quando o navegador não tem o cookie', () => {
    // É o caso de quem começou o login em outro navegador, ou passou dos 10
    // minutos de validade.
    expect(verificar(undefined, 'abc123').ok).toBe(false);
  });

  it('recusa quando o provedor não devolveu `state`', () => {
    expect(verificar(`${NOME}=abc123`, '').ok).toBe(false);
  });

  it('APAGA o cookie mesmo quando a verificação passa', () => {
    // Um `state` reutilizável nao protege: bastaria fazer a vitima repetir o
    // mesmo callback.
    expect(verificar(`${NOME}=abc123`, 'abc123').limpos).toContain(NOME);
    expect(verificar(`${NOME}=abc123`, 'outro').limpos).toContain(NOME);
  });

  it('ignora outros cookies do mesmo cabeçalho', () => {
    const cabecalho = `tema=escuro; ${NOME}=abc123; outro=1`;
    expect(verificar(cabecalho, 'abc123').ok).toBe(true);
  });

  it('não casa por prefixo de nome', () => {
    // `at_oauth_state_falso` nao pode ser lido como `at_oauth_state`.
    expect(verificar(`${NOME}_falso=abc123`, 'abc123').ok).toBe(false);
  });

  it('LOGIN CSRF: o `state` do atacante não passa no navegador da vítima', () => {
    // O atacante inicia o fluxo com a propria conta, captura o `code` e o
    // `state`, e faz o navegador da vitima abrir o nosso callback com eles. O
    // cookie da vitima e de outro fluxo — ou nao existe.
    const doAtacante = 'estado-gerado-no-navegador-do-atacante';

    expect(verificar(undefined, doAtacante).ok).toBe(false);
    expect(verificar(`${NOME}=estado-da-vitima`, doAtacante).ok).toBe(false);
  });
});
