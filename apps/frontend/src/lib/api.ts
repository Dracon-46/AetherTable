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

/**
 * O mesmo game server, pelo lado HTTP.
 *
 * O processo serve `/health`, `/metrics` e agora `/salas` no mesmo express em
 * que o WebSocket está pendurado — é literalmente o mesmo host e a mesma porta,
 * com outro esquema. Derivar em vez de criar `NEXT_PUBLIC_GAME_HTTP_URL` é
 * deliberado: uma segunda variável para o mesmo endereço é uma segunda variável
 * para esquecer de atualizar no deploy, e o sintoma seria a lista de salas
 * apontando para o game server de outro ambiente.
 *
 * A troca precisa ser ancorada no INÍCIO da string (`^`). Sem a âncora, um
 * host que contenha `ws` no nome — `wss://ws.aethertable.gg` é o caso que
 * aparece primeiro — teria a ocorrência errada substituída.
 */
export function httpDoWebSocket(url: string): string {
  return url.replace(/^ws(s?):\/\//, 'http$1://');
}

/** Base HTTP do game server, para `GET /salas`. */
export const GAME_HTTP_URL = httpDoWebSocket(WS_URL);

/** Monta os headers de uma chamada autenticada. */
export function authHeaders(token: string | null): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
