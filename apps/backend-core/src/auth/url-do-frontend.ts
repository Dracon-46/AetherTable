/**
 * url-do-frontend.ts — para onde a API manda o navegador de volta.
 *
 * ─── POR QUE SAIU DE DENTRO DO CONTROLLER ──────────────────────────────────
 *
 * `AuthController.urlDoFrontend` era um método privado, e servia a um consumidor
 * só: o redirect do OAuth. Com a recuperação de senha, o link que vai no e-mail
 * precisa da MESMA base — e um segundo cálculo, no serviço de e-mail, seria a
 * chance de os dois divergirem. O sintoma dessa divergência é específico e
 * difícil de flagrar: o OAuth funciona, e só o link do e-mail leva ao ambiente
 * errado (ou à máquina do desenvolvedor).
 *
 * ─── A CASCATA, E O QUE ELA CORRIGIU ───────────────────────────────────────
 *
 * Havia `http://localhost:3000/dashboard` escrito à mão nos dois callbacks de
 * OAuth — e 3000 nem é a porta do projeto (é 3030, ver `CORS_ORIGINS`). Em
 * produção o usuário era redirecionado para a própria máquina dele.
 *
 * A primeira origem de `CORS_ORIGINS` entra como último palpite antes do padrão
 * porque é, por definição, uma origem de frontend que esta API já aceita — um
 * chute melhor do que um literal. `OAUTH_REDIRECT_BASE` existia no `.env` do
 * projeto e nunca era lido por nada.
 */

/** O mínimo de `ConfigService` que esta função usa — mantém o módulo testável sem Nest. */
export interface LeitorDeConfig {
  get<T = string>(chave: string): T | undefined;
}

export function urlDoFrontend(config: LeitorDeConfig): string {
  const primeiraOrigemCors = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .find(Boolean);

  const base =
    config.get<string>('FRONTEND_URL') ??
    config.get<string>('OAUTH_REDIRECT_BASE') ??
    primeiraOrigemCors ??
    'http://localhost:3030';

  // A barra final duplicaria com a do caminho concatenado: `.../ /dashboard`.
  return base.replace(/\/+$/, '');
}
