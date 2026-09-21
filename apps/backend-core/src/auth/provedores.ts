/**
 * provedores.ts — quais provedores de OAuth existem NESTE ambiente.
 *
 * ─── O BOTÃO QUE NÃO LEVAVA A LUGAR NENHUM ─────────────────────────────────
 *
 * As duas estratégias eram instanciadas sempre, com `'DUMMY_GOOGLE_CLIENT_ID'`
 * quando a variável faltava. E a tela de login mostrava os dois botões sempre —
 * `render.yaml` nunca declarou `GOOGLE_CLIENT_ID` nem `DISCORD_CLIENT_ID`, o
 * que significa que em PRODUÇÃO os botões levavam o usuário a uma página de erro
 * do próprio Google ("The OAuth client was not found"). O aviso de "DUMMY KEYS"
 * na tela era condicionado a `NODE_ENV`, não à configuração real: em produção
 * ele sumia e deixava só o botão quebrado.
 *
 * Aqui a pergunta passa a ter uma resposta única, e ela é lida em três lugares:
 * o módulo (registra a estratégia?), o guard (aceita a rota?) e a rota pública
 * que o frontend consulta para decidir se desenha o botão.
 *
 * ─── POR QUE NÃO BASTA ESCONDER O BOTÃO ────────────────────────────────────
 *
 * Esconder no frontend resolve a tela e não resolve a rota: `GET /auth/google`
 * continuaria existindo, e sem estratégia registrada o Passport responde
 * `Unknown authentication strategy "google"` como erro 500. Um 404 honesto é o
 * que um provedor desligado deve devolver.
 */

export const PROVEDORES = ['google', 'discord'] as const;
export type Provedor = (typeof PROVEDORES)[number];

/** O mínimo de `ConfigService` que este módulo usa. */
export interface LeitorDeConfig {
  get<T = string>(chave: string): T | undefined;
}

/**
 * As duas variáveis precisam estar presentes.
 *
 * `clientId` sem `clientSecret` é o erro de configuração mais comum (alguém
 * copia o id do console do provedor e deixa o segredo para depois), e ele
 * produziria uma estratégia registrada que falha só no callback — depois de o
 * usuário já ter autorizado o acesso na tela do Google.
 */
export function credenciaisDoProvedor(
  config: LeitorDeConfig,
  provedor: Provedor,
): { clientId: string; clientSecret: string; callbackUrl: string } | null {
  const prefixo = provedor.toUpperCase();
  const clientId = config.get<string>(`${prefixo}_CLIENT_ID`)?.trim();
  const clientSecret = config.get<string>(`${prefixo}_CLIENT_SECRET`)?.trim();

  if (!clientId || !clientSecret) return null;

  return { clientId, clientSecret, callbackUrl: urlDeCallback(config, provedor) };
}

export function provedorConfigurado(config: LeitorDeConfig, provedor: Provedor): boolean {
  return credenciaisDoProvedor(config, provedor) !== null;
}

/** `{ google: boolean, discord: boolean }` — o que a tela de login consome. */
export function provedoresDisponiveis(config: LeitorDeConfig): Record<Provedor, boolean> {
  return {
    google: provedorConfigurado(config, 'google'),
    discord: provedorConfigurado(config, 'discord'),
  };
}

/**
 * Para onde o provedor devolve o navegador.
 *
 * ─── ISTO ERA UM LITERAL COM `localhost` ───────────────────────────────────
 *
 * `process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3333/api/v1/auth/google/callback'`,
 * e `GOOGLE_CALLBACK_URL` não existia no `.env.example` nem no `render.yaml` —
 * ou seja, o padrão era o valor efetivo em todo lugar. Em produção, o Google
 * devolveria o usuário para `localhost`, na máquina dele.
 *
 * `API_PUBLIC_URL` entra como fonte derivada porque o endereço da própria API é
 * um dado que o deploy já conhece, e uma variável por provedor é uma variável
 * por provedor para esquecer de atualizar. A específica continua tendo
 * precedência: há provedores que exigem um caminho de redirecionamento exato e
 * registrado, e não se argumenta com o console deles.
 */
export function urlDeCallback(config: LeitorDeConfig, provedor: Provedor): string {
  const especifica = config.get<string>(`${provedor.toUpperCase()}_CALLBACK_URL`)?.trim();
  if (especifica) return especifica;

  const base = (config.get<string>('API_PUBLIC_URL')?.trim() ?? 'http://localhost:3333/api/v1')
    // `/api/v1` já faz parte da base; a barra final duplicaria no meio da URL.
    .replace(/\/+$/, '');

  return `${base}/auth/${provedor}/callback`;
}
