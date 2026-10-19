/**
 * perfil.ts — o corpo do `PATCH /users/me` que as telas de Perfil e Ajustes
 * montam.
 *
 * ─── O APELIDO VAZIO DERRUBAVA O SALVAMENTO INTEIRO ────────────────────────
 *
 * As duas telas mandavam `displayName: ''` sempre que o campo "Apelido"
 * estivesse em branco — e ele está em branco para quase todo mundo, porque é
 * opcional. O servidor exige ao menos um caractere quando o campo vem, então
 * a conta que só queria trocar o nome de usuário recebia "Dados inválidos." e
 * nada era salvo.
 *
 * Em branco agora significa duas coisas diferentes, e o corpo diz qual:
 *  - a pessoa nunca teve apelido → o campo NÃO VAI (nada a mudar);
 *  - a pessoa tinha e apagou     → vai `null`, o pedido explícito de limpar.
 */
/** O que `PATCH /users/me` devolve: só os campos que o salvamento pode mudar. */
export interface PerfilSalvo {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/** O que `GET /users/me` devolve e a tela de Perfil lê. */
export interface PerfilDaConta extends PerfilSalvo {
  email?: string;
  /** ISO 8601: data vem como texto no JSON. */
  createdAt?: string;
  _count?: { participions: number };
}

/**
 * A regra de nome de usuário do backend (`users.dto.ts`): 3 a 24 letras,
 * números, ponto, hífen ou underline, depois do `trim`.
 */
const USERNAME = /^[a-zA-Z0-9_.-]{3,24}$/;

export function usernameValido(nome: string): boolean {
  return USERNAME.test(nome.trim());
}

export function apelidoParaEnvio(
  digitado: string,
  anterior: string | null | undefined,
): string | null | undefined {
  const limpo = digitado.trim();
  if (limpo) return limpo;
  return anterior ? null : undefined;
}
