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
  /**
   * URL da API Core.
   *
   * No Render, `fromService.property: host` entrega apenas o HOSTNAME
   * ("aethertable-api.onrender.com") — sem esquema. Com `z.string().url()`
   * cru, a validação falhava na subida e o game-server NÃO BOOTAVA em
   * produção: o erro aparecia como "Configuracao invalida" e o serviço ficava
   * em restart loop. Normalizar aqui é mais barato do que exigir que quem faz
   * o deploy lembre de digitar o https:// à mão.
   */
  BACKEND_CORE_URL: z
    .string()
    .default('http://localhost:3333')
    .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
    .pipe(z.string().url()),
  /**
   * Segredo das rotas maquina-a-maquina da API Core. `GET /internal/decks/:id`
   * devolve o decklist completo sem checar dono — em producao a API recusa a
   * chamada sem este cabecalho. Ver common/internal-api.guard.ts.
   */
  INTERNAL_API_TOKEN: z.string().default(''),
  /**
   * Origens que podem ler `GET /salas` do NAVEGADOR.
   *
   * Ate esta fatia o express deste processo so servia `/health`, `/metrics` e o
   * monitor — tudo consumido por maquina ou aberto direto no navegador, nunca
   * por `fetch` de outra origem. O WebSocket tambem nao precisa de CORS. Entao
   * nao havia CORS nenhum aqui, e a vitrine de salas — que e a PRIMEIRA coisa
   * neste processo chamada por `fetch` a partir do frontend, que roda noutra
   * porta — batia num erro de origem que o painel so conseguia reportar como
   * "a lista de mesas esta indisponivel".
   *
   * Mesma variavel e mesmo formato do backend-core (`CORS_ORIGINS`), para o
   * deploy configurar as duas pontas com um valor so.
   */
  CORS_ORIGINS: z.string().default('http://localhost:3030'),
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
