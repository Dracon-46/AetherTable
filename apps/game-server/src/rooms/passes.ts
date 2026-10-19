/**
 * passes.ts — o que o game-server aceita como passe de mesa, e o passe de voz
 * que ele emite de volta.
 *
 * ─── O ACCESS TOKEN DA API ENTRAVA EM QUALQUER SALA ─────────────────────────
 *
 * O passe era verificado com `jwt.verify(token, JWT_SECRET)` e mais nada: sem
 * audiência, sem algoritmo fixo, e com `roomId`, `jti` e `sub` opcionais (o
 * vínculo com a sala só era conferido "se houvesse `roomId`"). A API assina o
 * ACCESS TOKEN com o mesmo segredo — e ele não tem `roomId` nem `jti`. Quem
 * tinha uma sessão logada tinha, de brinde, um passe universal: entrava em
 * qualquer mesa, quantas vezes quisesse (sem `jti` não há uso único), e
 * continuava entrando depois de logout, banimento ou troca de senha, porque
 * nada disso revoga um JWT já emitido. O passe de CONFIGURAÇÃO (`roomId` +
 * `cfg`, sem `sub`) também passava.
 *
 * Agora o passe precisa ter a audiência da mesa (`aud: 'aethertable-mesa'`,
 * que a API Core já põe nos três passes — ver `auth/passe-de-mesa.ts` lá), ser
 * HS256, e trazer `sub`, `jti`, `roomId` e `exp`. O access token não tem
 * audiência; o passe de configuração não tem `sub` nem `jti`. Os dois caem
 * aqui.
 *
 * ─── POR QUE UM MÓDULO, E NÃO UM MÉTODO DA SALA ─────────────────────────────
 *
 * A validação roda em dois momentos: no `onAuth` ESTÁTICO, que o matchmaker
 * chama antes de criar sala ou reservar vaga, e (indiretamente) nos testes.
 * Duas cópias divergiriam exatamente no detalhe que importa.
 */

import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { ConfigDeSalaBruta, HandshakeError } from '@aethertable/shared-types';

import { config } from '../config';

/** Audiência dos passes que a API Core emite para a mesa. */
export const AUDIENCIA_DA_MESA = 'aethertable-mesa';
/** Audiência do passe de voz que ESTE servidor emite (contrato com a API). */
export const AUDIENCIA_DA_VOZ = 'aethertable-voz';

/** Conteúdo de um passe de mesa JÁ validado. */
export interface SeatTokenClaims {
  sub: string;
  username: string;
  roomId: string;
  jti: string;
  /**
   * OPCIONAL desde que o grimório passou a ser escolhido na sala de espera:
   * quem entra sem deck escolhe por `INTENT_SET_DECK`, dentro da sala.
   */
  deckId?: string;
  /**
   * Configuração da sala, ASSINADA pela API Core. Só o criador a traz; quem
   * aplica é a admissão do primeiro jogador (ver `AetherRoom.admitir`).
   */
  cfg?: ConfigDeSalaBruta;
  /**
   * `true` = passe de ESPECTADOR. Vem assinado, e não numa opção do
   * `joinOrCreate`, porque a diferença entre assistir e jogar decide quem
   * ocupa assento numa mesa cheia.
   */
  spectator?: boolean;
}

/**
 * Recusa de entrada esperada — passe ruim, mesa cheia, conta bloqueada.
 *
 * A mensagem É o código (`ROOM_FULL`...): o cliente procura o código dentro
 * dela (`mensagemDeConexao` no frontend), e o Colyseus repassa só a mensagem.
 * O código fica em `codigo`, e não em `code`, de propósito: `code` é o campo
 * NUMÉRICO do protocolo do Colyseus, e uma string ali mudaria a forma do erro
 * que o cliente recebe.
 */
export class RecusaDeEntrada extends Error {
  readonly codigo: HandshakeError;

  constructor(codigo: HandshakeError) {
    super(codigo);
    this.name = 'RecusaDeEntrada';
    this.codigo = codigo;
  }
}

/**
 * As claims que um passe de mesa PRECISA ter.
 *
 * `exp` obrigatório: um JWT sem expiração seria um passe eterno, e a API nunca
 * emite um assim. Os tetos de tamanho são folgados — o token é assinado por
 * nós —, e existem só para nenhum campo virar um vetor de inchaço do estado.
 */
const ClaimsDoPasse = z.object({
  sub: z.string().min(1).max(128),
  username: z.string().max(200).default(''),
  roomId: z.string().min(1).max(64),
  jti: z.string().min(1).max(128),
  exp: z.number(),
  // Vai para o caminho da URL da rota interna: só uuid, nunca texto livre.
  deckId: z.string().uuid().optional(),
  cfg: z.record(z.unknown()).optional(),
  spectator: z.boolean().optional(),
});

/**
 * Valida um passe de mesa e devolve SÓ as claims conhecidas.
 *
 * O objeto devolvido é montado campo a campo, e não o payload inteiro: ele vira
 * o `authData` do matchmaker, e `reserveSeatFor` usa `authData.sessionId`
 * como sessionId da vaga se existir. Repassar o payload cru deixaria o
 * conteúdo do token decidir a identidade da sessão.
 */
export function validarPasse(token: unknown, segredo: string = config.JWT_SECRET): SeatTokenClaims {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) {
    throw new RecusaDeEntrada('INVALID_TOKEN');
  }

  let bruto: string | jwt.JwtPayload;
  try {
    bruto = jwt.verify(token, segredo, {
      algorithms: ['HS256'],
      audience: AUDIENCIA_DA_MESA,
    });
  } catch (erro) {
    // jsonwebtoken distingue expirado de inválido; o cliente merece saber qual.
    throw new RecusaDeEntrada(
      erro instanceof jwt.TokenExpiredError ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
    );
  }

  const claims = ClaimsDoPasse.safeParse(bruto);
  if (!claims.success) throw new RecusaDeEntrada('INVALID_TOKEN');

  const { sub, username, roomId, jti, deckId, cfg, spectator } = claims.data;
  return {
    sub,
    username,
    roomId,
    jti,
    ...(deckId ? { deckId } : {}),
    ...(cfg ? { cfg } : {}),
    ...(spectator ? { spectator: true } : {}),
  };
}

/**
 * ─── O PASSE DE VOZ ─────────────────────────────────────────────────────────
 *
 * O passe da mesa é de uso único e vive na URL: ele prova que alguém PODIA
 * entrar, não que entrou. Quem sabe que a conta está sentada (ou assistindo)
 * nesta sala é o servidor que a admitiu — e é ele que atesta isso, mandando
 * este passe ao cliente logo depois de admiti-lo e a cada reconexão. O cliente
 * o apresenta à API para obter a voz (contrato combinado com a API Core).
 *
 * Audiência própria (`aethertable-voz`): nem a `JwtStrategy` da API nem o
 * `validarPasse` acima o aceitam no lugar errado. Seis horas cobrem uma
 * partida longa de Commander; o `jti` aleatório deixa a API recusar reuso.
 */
export function emitirPasseDeVoz(
  dados: { sub: string; roomId: string; spectator: boolean },
  segredo: string = config.JWT_SECRET,
): string {
  return jwt.sign({ sub: dados.sub, roomId: dados.roomId, spectator: dados.spectator }, segredo, {
    algorithm: 'HS256',
    audience: AUDIENCIA_DA_VOZ,
    expiresIn: '6h',
    jwtid: randomUUID(),
  });
}
