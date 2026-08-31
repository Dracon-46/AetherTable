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
