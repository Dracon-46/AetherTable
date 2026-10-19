/**
 * erros.ts — tradução de código de erro para frase que o jogador entende.
 *
 * ─── O PROBLEMA ─────────────────────────────────────────────────────────────
 *
 * O servidor sempre soube exatamente o que deu errado. Ele distingue token
 * inválido de token expirado de token já usado; distingue payload malformado de
 * ação não autorizada de rate limit. Nada disso chegava ao jogador:
 *
 *   - `error` e `warning` da sala caíam num `console.warn` e paravam ali. A
 *     ação simplesmente não acontecia, sem nenhuma pista na tela. Da cadeira do
 *     jogador, "não autorizado" e "o clique não funcionou" são a mesma coisa.
 *   - a falha de conexão virava uma frase só, um chute com três hipóteses:
 *     "o token pode ser inválido ou a sala está cheia".
 *
 * ─── A REGRA ────────────────────────────────────────────────────────────────
 *
 * Toda mensagem daqui diz DUAS coisas: o que aconteceu e o que fazer. Um erro
 * que não sugere ação é só um beco sem saída mais bonito.
 *
 * O que NÃO entra aqui: nome de carta, id de sessão, stack. DOC-031 §5.4 é
 * explícito — uma mensagem de erro não pode vazar informação de zona oculta.
 */

/** Mensagens de rejeição de intenção (canal `error` da sala). */
const INTENCAO: Record<string, string> = {
  NOT_AUTHORIZED: 'Essa ação não é sua para fazer — a carta é de outro jogador.',
  ENTITY_NOT_FOUND: 'A carta saiu da mesa antes da ação chegar ao servidor.',
  INVALID_PAYLOAD: 'O servidor recusou a ação por dados inválidos. Recarregue a página.',
  RATE_LIMITED: 'Ações rápidas demais — algumas foram descartadas. Vá com calma.',
  NOT_YOUR_TURN: 'Não é a sua vez. Só quem está na vez passa o turno.',
  NOT_HOST: 'Só o anfitriao da mesa (o primeiro assento) pode fazer isso.',
  INTERNAL: 'Erro interno do servidor nessa ação. As outras continuam funcionando.',
  // Tetos do servidor contra estado inchado: fichas por jogador, cartas na sala,
  // contadores por carta e setas por jogador.
  LIMIT:
    'A mesa chegou a um limite (fichas, cartas, contadores ou setas). Remova algo antes de criar mais.',
};

/**
 * Mensagens de falha ao ENTRAR na sala.
 *
 * `TOKEN_ALREADY_USED` é o campeão de confusão e merece explicação, não só
 * nome: o passe da mesa vale uma vez só. Recarregar a página, voltar no
 * navegador ou abrir a mesa numa segunda aba consome o passe, e a próxima
 * tentativa bate aqui. Quem lê "token já usado" não tem como adivinhar que a
 * saída é voltar à Taverna e entrar de novo.
 */
const CONEXAO: Record<string, string> = {
  INVALID_TOKEN: 'O passe desta mesa não é válido. Volte à Taverna e entre na sala de novo.',
  TOKEN_EXPIRED:
    'O passe desta mesa expirou — ele vale um dia a partir do momento em que você pede para entrar. Volte à Taverna e entre de novo.',
  TOKEN_ALREADY_USED:
    'Este passe já foi usado. Ele vale uma entrada só, então recarregar a página ou abrir a mesa em outra aba o consome. Volte à Taverna e entre na sala de novo.',
  ROOM_FULL:
    'A mesa está cheia. O anfitrião pode abrir mais assentos na sala de espera, ou alguém pode sair.',
  PLAYER_BLOCKED: 'Você foi removido desta mesa e não pode voltar a ela.',
  ALREADY_SEATED:
    'Você já está sentado nesta mesa em outra aba ou aparelho. Feche a outra sessão e tente de novo.',
};

/** Rejeição de intenção → frase. */
export function mensagemDeErro(code?: string, fallback?: string): string {
  if (code && INTENCAO[code]) return INTENCAO[code];
  // O `fallback` é a mensagem crua do servidor. Melhor ela do que "erro".
  return fallback?.trim() || 'A mesa recusou essa ação e não disse o motivo.';
}

/**
 * Falha de conexão → frase.
 *
 * A mensagem do Colyseus chega como texto livre (`e.message`), porque o
 * `onAuth` do servidor lança `Error(CODIGO)`. Procuramos o código DENTRO da
 * string em vez de comparar por igualdade: dependendo da versão, o Colyseus
 * embrulha a mensagem em vez de repassá-la crua, e uma comparação exata
 * silenciaria justamente os casos que este mapa existe para explicar.
 */
export function mensagemDeConexao(erro: unknown): string {
  let bruto = '';
  if (erro && typeof erro === 'object') {
    // Objeto sem `message` (um evento de fechamento, por exemplo) viraria
    // "[object Object]" na frase de recusa. Sem texto, cai na frase genérica.
    if ('message' in erro) bruto = String(erro.message);
  } else if (typeof erro === 'string' || typeof erro === 'number' || typeof erro === 'boolean') {
    bruto = String(erro);
  }

  for (const [code, texto] of Object.entries(CONEXAO)) {
    if (bruto.includes(code)) return texto;
  }

  // A sala cheia não vem com código: o Colyseus recusa antes do `onAuth`.
  if (/full|lotad/i.test(bruto)) return CONEXAO.ROOM_FULL!;

  if (/timeout|ECONN|network|failed to fetch|WebSocket/i.test(bruto)) {
    return 'Não foi possível alcançar o servidor da mesa. Ele pode estar hibernando — espere alguns segundos e tente de novo.';
  }

  return bruto
    ? `A mesa recusou a conexão: ${bruto}`
    : 'A mesa recusou a conexão e não informou o motivo.';
}
