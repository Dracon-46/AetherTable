/**
 * token-de-redefinicao.ts — o segredo que chega por e-mail, e o que fica no banco.
 *
 * ─── O TEXTO PURO NUNCA É GRAVADO ──────────────────────────────────────────
 *
 * A tabela guarda o SHA-256 do token, não o token. A diferença aparece num
 * cenário só, e é justamente o que importa: um dump do banco — backup exposto,
 * `SELECT` de uma injeção, o painel do provedor de Postgres aberto na máquina
 * errada — entregaria, com o token em claro, uma lista de links de redefinição
 * VIVOS para as contas mais recentes da plataforma. Com a hash, entrega uma
 * coluna inútil: a redefinição exige o texto que só existe na caixa de entrada
 * da pessoa.
 *
 * Não há sal e não há Argon2 aqui, e isso é deliberado, não uma economia. Sal e
 * custo de CPU existem para proteger segredos que um humano escolheu e que são
 * adivinháveis por dicionário. Este segredo tem 256 bits de `randomBytes` e
 * vive 30 minutos: não há dicionário, e uma hash lenta só tornaria lenta a
 * consulta por chave primária que valida o link.
 *
 * ─── POR QUE ESTE MÓDULO É SEPARADO DO SERVIÇO ─────────────────────────────
 *
 * Mesma razão de `ttl.ts`: as decisões que quebram silenciosamente aqui são
 * aritmética de data e formato de string, e elas se testam sem banco, sem Nest
 * e sem servidor de e-mail. `recuperacao.service.ts` fica com o I/O.
 */

import { createHash, randomBytes } from 'node:crypto';

/**
 * Trinta minutos.
 *
 * O prazo curto é o que limita o estrago de um link que vazou — encaminhado
 * sem querer, lido num e-mail corporativo arquivado, deixado numa caixa aberta
 * em computador compartilhado. Vinte e quatro horas, que é o padrão de muita
 * biblioteca, transformaria cada e-mail de redefinição num acesso à conta
 * válido pelo resto do dia.
 *
 * Meia hora cobre com folga o caminho real: pedir, trocar de aba, esperar o
 * e-mail chegar, clicar. Quem demorar mais pede outro — o custo de errar para
 * menos é um clique, e para mais é uma conta.
 */
export const VALIDADE_EM_MINUTOS = 30;

/** Prefixo do link que vai no e-mail. Uma constante porque o frontend tem a rota igual. */
export const CAMINHO_DE_REDEFINICAO = '/senha/redefinir';

/**
 * 32 bytes de CSPRNG em base64url.
 *
 * `base64url` e não `hex` pelo mesmo motivo da senha temporária do backoffice:
 * o alfabeto não tem `+`, `/` nem `=`, que quebram ao viajar numa querystring
 * ou ao ser colados de um cliente de e-mail que "ajuda" quebrando a linha.
 */
export function gerarTokenDeRedefinicao(): string {
  return randomBytes(32).toString('base64url');
}

/** O que vai para a coluna. 64 caracteres hexadecimais, sempre. */
export function hashDoToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** O instante em que um token gerado agora deixa de valer. */
export function expiracaoAPartirDe(agora: Date = new Date()): Date {
  return new Date(agora.getTime() + VALIDADE_EM_MINUTOS * 60_000);
}

/** O registro mínimo que a checagem abaixo precisa enxergar. */
export interface LinhaDeToken {
  expiresAt: Date;
  usedAt: Date | null;
}

/**
 * `true` só quando o token ainda vale: não foi usado e não venceu.
 *
 * ─── USO ÚNICO NÃO É FORMALIDADE ───────────────────────────────────────────
 *
 * Sem `usedAt`, o link continuaria funcionando depois da troca — e ele mora
 * numa caixa de entrada, que é exatamente o lugar de onde um invasor com acesso
 * ao e-mail o pegaria DEPOIS de a pessoa já ter redefinido a senha e acreditado
 * que resolveu o problema. Um token de redefinição reutilizável é uma conta
 * permanentemente aberta para quem ler o e-mail uma vez.
 *
 * A comparação de expiração usa `>`, não `>=`: um token no milissegundo exato
 * do vencimento está vencido. Não muda nada na prática e evita a dúvida.
 */
export function tokenUtilizavel(linha: LinhaDeToken, agora: Date = new Date()): boolean {
  if (linha.usedAt) return false;
  return linha.expiresAt.getTime() > agora.getTime();
}
