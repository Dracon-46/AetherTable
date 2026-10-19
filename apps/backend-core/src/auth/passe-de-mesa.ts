/**
 * passe-de-mesa.ts — o que separa um passe da mesa de uma sessão da API.
 *
 * ─── O PASSE DA MESA ABRIA A API INTEIRA ────────────────────────────────────
 *
 * O seat token, o passe de espectador e o passe de configuração eram assinados
 * com o MESMO `JWT_SECRET` do access token, e `JwtStrategy.validate` só
 * conferia se havia `sub`. O seat token tem `sub` — então ele era aceito como
 * sessão em toda rota protegida.
 *
 * E o seat token é justamente o token que VIAJA: ele mora na URL da mesa
 * (`/play/CODE?token=...`), vale um dia, e essa URL é a que se manda no grupo.
 * Quem recebesse o link podia chamar `PATCH /users/me`, apagar decks, trocar o
 * nome — tudo como a pessoa que o compartilhou.
 *
 * ─── A SAÍDA: AUDIÊNCIA PRÓPRIA, E A API RECUSA PASSE DE MESA ───────────────
 *
 * Os três passes saem com `aud: 'aethertable-mesa'`. O access token não tem
 * audiência nenhuma. A `JwtStrategy` recusa qualquer token com audiência, e
 * também qualquer um com as claims que só um passe de mesa carrega (`roomId`,
 * `spectator`, `cfg`) — este segundo critério é o que derruba os passes
 * emitidos ANTES desta mudança, que ainda vivem por até um dia sem `aud`.
 *
 * Trocar o segredo do passe (um `SEAT_TOKEN_SECRET` separado) resolveria igual,
 * mas foi descartado: o game-server verifica o passe com `JWT_SECRET`, e mudar
 * o segredo exigiria deploy coordenado dos dois serviços. A audiência não muda
 * nada lá — `jwt.verify` sem a opção `audience` não confere a claim `aud`.
 */

/** Audiência dos passes emitidos para o game-server. */
export const AUDIENCIA_DA_MESA = 'aethertable-mesa';

/** Claims que só existem num passe de mesa — nunca num access token. */
const CLAIMS_DE_MESA = ['roomId', 'spectator', 'cfg'] as const;

/**
 * `true` quando o payload decodificado NÃO é um access token da API.
 *
 * Qualquer `aud` conta, e não só a da mesa: o access token é emitido sem
 * audiência, então um token com audiência foi feito para outro destinatário —
 * seja ele qual for, a API não é esse destinatário.
 */
export function naoEhSessaoDaApi(payload: object): boolean {
  const claims = payload as Record<string, unknown>;
  if (claims.aud !== undefined) return true;
  return CLAIMS_DE_MESA.some((c) => claims[c] !== undefined);
}
