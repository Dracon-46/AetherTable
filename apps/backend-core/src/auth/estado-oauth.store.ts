/**
 * estado-oauth.store.ts — o `state` que impede login por OAuth forjado.
 *
 * ─── O CONTROLE ESTAVA DOCUMENTADO E NÃO EXISTIA ───────────────────────────
 *
 * DOC-050 §2.4 lista, contra tomada de conta, "`state` aleatório validado +
 * PKCE". Nenhum dos dois existia: sem a opção `state`, o `passport-oauth2`
 * instala um `NullStore` — o `state` simplesmente **não é verificado**
 * (`passport-oauth2/lib/strategy.js:113`).
 *
 * O ataque que isso permite é login CSRF, e o resultado dele é contraintuitivo:
 * o atacante inicia o fluxo com a PRÓPRIA conta Google, captura o `code` do
 * redirect, e faz o navegador da vítima abrir o nosso callback com aquele
 * código. A vítima termina logada **na conta do atacante** sem perceber — e
 * passa a montar decks, entrar em mesas e, no limite, vincular dados dela a uma
 * conta que não é dela e que o atacante lê quando quiser.
 *
 * ─── POR QUE COOKIE, E NÃO SESSÃO ──────────────────────────────────────────
 *
 * `state: true` sozinho faz o Passport usar o `SessionStore`, que exige
 * `req.session` — ou seja, `express-session` e um armazenamento de sessão no
 * servidor. Esta API é deliberadamente sem estado (JWT no cabeçalho, nenhuma
 * sessão em lugar nenhum), e introduzir sessão de servidor por causa de um
 * valor que vive 10 minutos seria pagar caro no lugar errado: viraria estado
 * compartilhado entre nós no dia em que houver mais de um.
 *
 * O cookie é o mesmo valor, guardado no único lugar que já sobrevive ao
 * redirect sem custo nenhum — o navegador. Comparar o que voltou do provedor
 * com o que está no cookie é o padrão "double submit", e ele fecha o ataque
 * acima: o navegador da vítima não tem o cookie do fluxo iniciado pelo
 * atacante.
 *
 * ─── PKCE FICOU DE FORA, E A RAZÃO ESTÁ AQUI ───────────────────────────────
 *
 * PKCE protege cliente PÚBLICO — aplicativo nativo, SPA — onde o `code` pode
 * ser interceptado por outro aplicativo e não há segredo para impedir a troca.
 * Aqui o cliente é CONFIDENCIAL: a troca acontece no servidor, com
 * `client_secret`, sobre TLS. O ganho marginal é pequeno e o custo não é: o
 * `code_verifier` teria de atravessar o redirect junto, e o Passport só aceita
 * PKCE com `state: true` na forma de sessão. Fica registrado como decisão, não
 * como esquecimento.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * Os tipos do contrato `StateStore`, redeclarados.
 *
 * Eles vivem em `@types/passport-oauth2`, que é dependência TRANSITIVA (via
 * `@types/passport-google-oauth20`) e não direta deste app — importar de lá
 * quebraria com o `node_modules` estrito do pnpm. São três aliases de uma linha
 * cada, e a alternativa seria acrescentar uma dependência de tipos só para não
 * escrevê-los.
 *
 * O encaixe com o tipo real é ESTRUTURAL: se a assinatura mudar lá, a atribuição
 * de `store` em `google.strategy.ts` para de compilar. É o aviso que importa.
 */
type MetadadosOAuth = { authorizationURL: string; tokenURL: string; clientID: string };
type CallbackDeStore = (erro: Error | null, estado: string) => void;
type CallbackDeVerify = (erro: Error | null, ok: boolean, info: unknown) => void;

/**
 * O nome carrega o prefixo `__Host-`? Não, e de propósito: `__Host-` exige
 * `Path=/`, e este cookie é restrito a `/api/v1/auth` justamente para não ser
 * enviado em nenhuma outra rota da API.
 */
const NOME_DO_COOKIE = 'at_oauth_state';
const CAMINHO_DO_COOKIE = '/api/v1/auth';

/**
 * Dez minutos.
 *
 * É o tempo de ir ao Google, escolher a conta, talvez digitar a senha e o
 * segundo fator, e voltar. Mais que isso deixa uma janela aberta sem
 * necessidade; menos transformaria uma autenticação de dois fatores lenta em
 * "falha no login".
 */
const VALIDADE_MS = 10 * 60_000;

/** O mínimo de `express.Response` que o store usa. */
interface RespostaComCookie {
  cookie(nome: string, valor: string, opcoes: Record<string, unknown>): void;
  clearCookie(nome: string, opcoes: Record<string, unknown>): void;
}

/** O mínimo de `express.Request`. `res` existe em toda requisição do Express. */
export interface RequisicaoComCookie {
  headers: { cookie?: string };
  res?: RespostaComCookie;
}

/**
 * Lê UM cookie do cabeçalho, sem `cookie-parser`.
 *
 * O pacote é dependência do projeto e **não está montado** em `main.ts`.
 * Montá-lo para este caso passaria a analisar o cabeçalho `Cookie` de toda
 * requisição da API — inclusive as da mesa, que são as sensíveis a latência —
 * para atender duas rotas de OAuth. O recorte aqui é menor e não muda o
 * comportamento de nada além destas rotas.
 */
function lerCookie(cabecalho: string | undefined, nome: string): string | null {
  if (!cabecalho) return null;

  for (const parte of cabecalho.split(';')) {
    const separador = parte.indexOf('=');
    if (separador === -1) continue;
    if (parte.slice(0, separador).trim() !== nome) continue;

    try {
      return decodeURIComponent(parte.slice(separador + 1).trim());
    } catch {
      // Cookie corrompido vale como ausente: a verificação abaixo recusa.
      return null;
    }
  }

  return null;
}

/** Comparação em tempo constante, tolerante a tamanhos diferentes. */
function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // `timingSafeEqual` lança quando os tamanhos diferem — e o próprio lançamento
  // já vazaria o tamanho. A comparação de tamanho vem antes, explícita.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export class EstadoOAuthStore {
  constructor(private readonly emProducao: boolean) {}

  /**
   * ─── O NÚMERO DE PARÂMETROS É PARTE DO CONTRATO, EM RUNTIME ──────────────
   *
   * O `passport-oauth2` escolhe qual assinatura chamar pelo `.length` do método
   * (`strategy.js:289` e `:218`). Com a implementação abaixo, o JavaScript
   * compilado tem `store.length === 3` e `verify.length === 4` — o `?` do
   * TypeScript é apagado e NÃO reduz o `.length` —, então o Passport chama as
   * formas longas, com `meta`.
   *
   * Isso é frágil de um jeito específico: acrescentar ou remover um parâmetro
   * aqui muda qual sobrecarga o Passport invoca, **em runtime, sem nenhum erro
   * de compilação**. O sintoma seria o `meta` chegar no lugar do callback e o
   * login parar de funcionar com "callback is not a function". `estado-oauth.store.spec.ts`
   * trava os dois números por isso.
   *
   * O `?? metaOuCallback` cobre a forma curta, que é a que o Passport usaria se
   * esses números mudassem — e é barato o bastante para valer como cinto.
   */
  store(req: Request, callback: CallbackDeStore): void;
  store(req: Request, meta: MetadadosOAuth, callback: CallbackDeStore): void;
  store(
    req: RequisicaoComCookie,
    metaOuCallback: MetadadosOAuth | CallbackDeStore,
    callback?: CallbackDeStore,
  ): void {
    const cb = (callback ?? metaOuCallback) as CallbackDeStore;
    const estado = randomBytes(16).toString('base64url');

    req.res?.cookie(NOME_DO_COOKIE, estado, {
      httpOnly: true,
      // `lax` e não `strict`: o callback do provedor é uma navegação de nível
      // superior vinda de OUTRO site (accounts.google.com). Com `strict` o
      // cookie não acompanharia a volta, e o login falharia sempre.
      sameSite: 'lax',
      // Em desenvolvimento a API é http://localhost: `secure` impediria o
      // navegador de guardar o cookie e quebraria o fluxo inteiro localmente.
      secure: this.emProducao,
      maxAge: VALIDADE_MS,
      path: CAMINHO_DO_COOKIE,
    });

    cb(null, estado);
  }

  /** Mesma mecânica de sobrecarga do `store` acima. */
  verify(req: Request, state: string, callback: CallbackDeVerify): void;
  verify(req: Request, state: string, meta: MetadadosOAuth, callback: CallbackDeVerify): void;
  verify(
    req: RequisicaoComCookie,
    estadoRecebido: string,
    metaOuCallback: MetadadosOAuth | CallbackDeVerify,
    callback?: CallbackDeVerify,
  ): void {
    const cb = (callback ?? metaOuCallback) as CallbackDeVerify;
    const doCookie = lerCookie(req.headers?.cookie, NOME_DO_COOKIE);

    /**
     * O cookie morre aqui, dê certo ou não.
     *
     * Um `state` reutilizável é um `state` que não protege: bastaria ao
     * atacante fazer a vítima repetir o mesmo callback. Limpar antes de
     * decidir garante que não há caminho de saída que o preserve.
     */
    req.res?.clearCookie(NOME_DO_COOKIE, { path: CAMINHO_DO_COOKIE });

    if (!doCookie || !estadoRecebido) {
      return cb(null, false, {
        message: 'Fluxo de login expirado ou iniciado em outro navegador.',
      });
    }

    if (!iguais(doCookie, estadoRecebido)) {
      return cb(null, false, { message: 'Origem do login não confere.' });
    }

    // O terceiro argumento é o `info` que o Passport repassa; no caminho de
    // sucesso não há nada a informar.
    return cb(null, true, null);
  }
}
