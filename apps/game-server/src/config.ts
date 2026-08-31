/**
 * Configuracao do game server, validada na subida.
 *
 * Validar aqui e deliberado: um `JWT_SECRET` ausente vira "Invalid seat token"
 * no handshake, um sintoma que nao aponta para a causa. Melhor nao subir.
 */

import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(2567),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  /** Precisa ser IDENTICO ao do backend-core. */
  JWT_SECRET: z.string().min(16, 'JWT_SECRET precisa de pelo menos 16 caracteres'),
  BACKEND_CORE_URL: z.string().url().default('http://localhost:3333'),
  /**
   * Segredo das rotas maquina-a-maquina da API Core. `GET /internal/decks/:id`
   * devolve o decklist completo sem checar dono — em producao a API recusa a
   * chamada sem este cabecalho. Ver common/internal-api.guard.ts.
   */
  INTERNAL_API_TOKEN: z.string().default(''),
  PUBLIC_WS_URL: z.string().default('ws://localhost:2567'),
  /** Opcional em dev de um no; OBRIGATORIO em producao multi-no. */
  USE_REDIS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const detalhes = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(
    `Configuracao invalida do game-server:\n${detalhes}\n\n` +
      'Copie apps/game-server/.env.example para .env e preencha.\n' +
      'Lembrete: JWT_SECRET precisa ser identico ao do backend-core.',
  );
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';
