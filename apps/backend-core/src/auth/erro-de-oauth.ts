/**
 * erro-de-oauth.ts — o que o usuário vê quando "Entrar com Google" não dá certo.
 *
 * ─── O QUE ACONTECIA ANTES ─────────────────────────────────────────────────
 *
 * As estratégias chamavam `done(new Error('A conta Google não expôs um e-mail
 * utilizável.'))`. O Passport transformava isso num `401`, e o Nest devolvia
 * JSON — **no navegador do usuário**, que tinha acabado de ser redirecionado de
 * volta do Google. A tela era literalmente
 * `{"statusCode":401,"message":"Unauthorized"}` numa página em branco, sem
 * caminho de volta para o login e sem dizer o que houve.
 *
 * Um callback de OAuth é navegação, não chamada de API: o resultado — inclusive
 * o resultado ruim — precisa ser um redirect para uma tela.
 *
 * ─── POR QUE UM CÓDIGO, E NÃO A MENSAGEM NA URL ────────────────────────────
 *
 * O código viaja na querystring e vira texto no frontend. Mandar a mensagem
 * pronta significaria aceitar texto arbitrário vindo da URL e desenhá-lo na
 * tela — a forma mais simples de transformar a própria tela de login numa
 * página de phishing hospedada no domínio certo ("Sua conta foi bloqueada,
 * ligue para 0800…"). Com um código fechado, o frontend só sabe escrever as
 * frases que ele mesmo tem.
 */

/** Os códigos que a tela de login sabe traduzir. */
export type CodigoDeOAuth =
  'indisponivel' | 'sem_email' | 'email_em_uso' | 'email_nao_verificado' | 'recusado' | 'falhou';

export class ErroDeOAuth extends Error {
  constructor(
    readonly codigo: CodigoDeOAuth,
    /** O que vai para o log do servidor — nunca para a URL. */
    detalhe: string,
  ) {
    super(detalhe);
    this.name = 'ErroDeOAuth';
  }
}
