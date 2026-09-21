import { z } from 'zod';

/**
 * auth.dto.ts — validação de entrada das rotas públicas de autenticação.
 *
 * `login` e `register` recebiam `Record<string, any>` e liam
 * `dto.email` / `dto.password` direto. O próprio código admitia a lacuna num
 * comentário ("um DTO rigoroso entraria aqui"). Sem validação, um corpo sem
 * `password` chegava ao `bcrypt.compare` como `undefined` e derrubava a rota
 * com 500 em vez de 400 — e o mesmo caminho aceitava um `email` de 10 MB.
 *
 * O plano de segurança (DOC-050) trata validação de borda como obrigatória.
 */

export const LoginDto = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});
export type LoginDto = z.infer<typeof LoginDto>;

export const RegisterDto = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  /** Aparece publicamente em /u/[username]: sem espaço nem caractere de controle. */
  username: z
    .string()
    .trim()
    .min(3)
    .max(24)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Use apenas letras, números, ponto, hífen ou underline'),
  password: z.string().min(8, 'A senha precisa de ao menos 8 caracteres').max(200),
});
export type RegisterDto = z.infer<typeof RegisterDto>;

/**
 * Trocar a própria senha.
 *
 * ─── A SENHA ATUAL É EXIGIDA, E NÃO É BUROCRACIA ───────────────────────────
 *
 * Um token de sessão vive 24 horas. Um notebook desbloqueado por um minuto, um
 * navegador de laboratório, uma aba aberta num computador emprestado — em todos
 * esses, quem chega tem o token e não tem a senha. Sem esta confirmação, trocar
 * a senha (e portanto DERRUBAR o dono da própria conta) seria a primeira coisa
 * que qualquer um faria.
 *
 * O mínimo de 8 caracteres é o mesmo do cadastro, e é deliberado: uma regra
 * mais frouxa aqui viraria o caminho para burlar a do cadastro.
 */
export const TrocarSenhaDto = z
  .object({
    senhaAtual: z.string().min(1, 'Informe sua senha atual').max(200),
    novaSenha: z.string().min(8, 'A senha nova precisa de ao menos 8 caracteres').max(200),
  })
  .refine((d) => d.senhaAtual !== d.novaSenha, {
    message: 'A senha nova precisa ser diferente da atual',
    path: ['novaSenha'],
  });
export type TrocarSenhaDto = z.infer<typeof TrocarSenhaDto>;

/**
 * Pedir o link de redefinição.
 *
 * Só o e-mail. Não há campo de "confirme que é você" nem captcha, e a proteção
 * é outra: a resposta é sempre a mesma (`202`), o link vai para a caixa de
 * entrada do dono do endereço, e o throttler da rota limita o volume. Ver
 * `recuperacao.service.ts`.
 */
export const EsqueciSenhaDto = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});
export type EsqueciSenhaDto = z.infer<typeof EsqueciSenhaDto>;

/**
 * Redefinir a senha com o token do e-mail.
 *
 * ─── O MÍNIMO É O MESMO DO CADASTRO, E ISSO IMPORTA ────────────────────────
 *
 * Oito caracteres, igual a `RegisterDto` e a `TrocarSenhaDto`. Uma regra mais
 * frouxa aqui viraria o caminho para burlar a dos outros dois: bastaria pedir a
 * redefinição para escolher uma senha que o cadastro recusaria.
 *
 * O `max(512)` do token não é decoração: ele chega pela querystring da URL e
 * daí para o corpo do POST. Sem teto, um "token" de 10 MB atravessaria até o
 * `createHash` — que aceitaria de bom grado e gastaria CPU numa rota pública.
 */
export const RedefinirComTokenDto = z.object({
  token: z.string().trim().min(1, 'Link de redefinição inválido').max(512),
  novaSenha: z.string().min(8, 'A senha precisa de ao menos 8 caracteres').max(200),
});
export type RedefinirComTokenDto = z.infer<typeof RedefinirComTokenDto>;
