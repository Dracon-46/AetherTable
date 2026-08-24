/**
 * Base da API Core.
 *
 * FONTE ÚNICA da URL da API. Antes disso, `http://localhost:4000/api/v1` estava
 * escrito à mão em 12 lugares, enquanto o `.env` apontava para 3333 — o
 * resultado era o `.env` não ter efeito nenhum e o game-server, que lia a env,
 * procurar a API em outra porta.
 *
 * Em Next, variáveis `NEXT_PUBLIC_*` são substituídas em tempo de build. Por
 * isso a leitura precisa ser literal (`process.env.NEXT_PUBLIC_API_URL`) e não
 * dinâmica — indexar `process.env` por variável não funciona no cliente.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333/api/v1';

/** URL do WebSocket do game server. */
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:2567';

/** Monta os headers de uma chamada autenticada. */
export function authHeaders(token: string | null): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
