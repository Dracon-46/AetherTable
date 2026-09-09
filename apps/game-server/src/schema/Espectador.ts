import { Schema, type } from '@colyseus/schema';

/**
 * Quem esta na mesa SEM jogar.
 *
 * ─── POR QUE UM SCHEMA PROPRIO, E NAO UM `Player` COM UMA FLAG ─────────────
 *
 * A tentacao obvia era `Player.espectador = true` com `seat = -1`, e ela quebra
 * em quatro lugares ao mesmo tempo — todos silenciosos, porque nenhum deles
 * lanca erro:
 *
 *   1. `removerJogador` reordena os assentos com
 *      `restantes.forEach((p, i) => p.seat = i)`. O espectador entraria na
 *      lista e receberia o assento 0 — quer dizer, viraria ANFITRIAO.
 *   2. `INTENT_START_MATCH` recusa iniciar enquanto houver `connected && !ready`.
 *      Um espectador travaria a partida esperando um "pronto" que ele nao tem
 *      como dar.
 *   3. `semGrimorio` barraria por deck ausente, e espectador nao tem deck.
 *   4. `INTENT_PASS_TURN` monta a rotacao a partir de `state.players`: a vez
 *      passaria para quem so esta olhando.
 *
 * `state.players` significa EXATAMENTE "quem esta jogando", e um monte de
 * codigo depende disso sem dizer. Manter esse significado intacto e o que
 * permite o modo espectador nao ter tocado em nenhuma dessas quatro regras.
 *
 * ─── O QUE ELE VE ──────────────────────────────────────────────────────────
 *
 * Nada de zona oculta. `podeVer` (schema/visibility.ts) ja resolve isso sem
 * nenhuma clausula nova: o espectador nao e dono nem controller de carta
 * nenhuma, entao cai na regra mais restritiva em toda zona oculta — e o caso
 * ja estava coberto por teste desde antes deste arquivo existir
 * (`visibility.spec.ts`, "espectador nunca ve zona oculta").
 */
export class Espectador extends Schema {
  @type('string') id!: string;
  @type('string') userId = '';
  @type('string') name = '';
  /**
   * Espectador nao tem janela de reconexao: perder a conexao de quem assiste
   * nao guarda nada, porque nao ha assento nem cartas para guardar. O campo
   * existe para a lista da mesa nao piscar durante um reconnect do proprio
   * Colyseus.
   */
  @type('boolean') connected = true;
}
