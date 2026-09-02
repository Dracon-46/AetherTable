import { MapSchema, Schema, type } from '@colyseus/schema';

/**
 * Um jogador sentado na mesa.
 *
 * TODOS os campos de "estado de jogo" aqui sao MARCADORES: o motor exibe, nao
 * impoe (RN01). Vida <= 0 nao elimina ninguem; `INTENT_CONCEDE` marca o jogador
 * como eliminado mas nao o remove da sala.
 *
 * Fonte canonica: docs/especificacao_do_motor_sandbox.md §3.
 */
export class Player extends Schema {
  /** sessionId do Colyseus. */
  @type('string') id!: string;
  /** Id persistente da conta. */
  @type('string') userId!: string;
  @type('string') name!: string;
  @type('string') avatarUrl = '';

  // ── Cosmeticos equipados (DOC-060) ───────────────────────────────────────
  //
  // Guardam o ID do item no catalogo fechado (packages/shared-types/cosmetics),
  // nunca uma URL. Os nomes anteriores (`playmatUrl`, `sleeveUrl`) prometiam um
  // endereco de imagem — e uma URL vinda do cliente seria upload disfarcado,
  // exatamente o que DOC-060 §1.1 proibe para nao expor a mesa a IP de
  // terceiros e a conteudo sensivel.
  //
  // Renomear campo de Schema e seguro: o serializador do @colyseus/schema usa
  // o INDICE, nao o nome. O mirror do cliente e regenerado por `pnpm schema:sync`.
  @type('string') playmatId = '';
  @type('string') sleeveId = '';
  @type('string') profileBorder = '';
  @type('string') chatTitle = '';

  /** 0..3 — posicao na mesa. */
  @type('number') seat = 0;

  @type('number') life = 40;
  @type('number') poison = 0;
  @type('number') energy = 0;
  @type('number') experience = 0;
  @type('number') commanderTax = 0;
  @type('boolean') isMonarch = false;
  @type('boolean') hasInitiative = false;
  @type('boolean') conceded = false;

  /** Dano de comandante recebido, indexado pelo jogador de origem. */
  @type({ map: 'number' }) commanderDamage = new MapSchema<number>();

  /**
   * Espelhos PUBLICOS de contagem. O jogo exige saber quantas cartas o oponente
   * tem na mao. Redundancia deliberada: e mais simples e mais seguro do que
   * depender do comportamento interno do serializador (DOC-032 §4.2).
   */
  @type('number') handCount = 0;
  @type('number') libraryCount = 0;
  @type('number') mulliganCount = 0;

  @type('boolean') connected = true;
  /** epoch ms; 0 = conectado. Janela de reconexao: 90 s (RN10). */
  @type('number') disconnectedAt = 0;

  // ── CAMPOS NOVOS SEMPRE NO FIM (ver o mesmo aviso em Card.ts) ─────────────

  /** Contadores de jogador restantes de PLAYER_COUNTERS (DOC-036 item 74). */
  @type('number') rad = 0;
  @type('number') ticket = 0;
  /** "Start your engines!" — 0..4 (DOC-036 item 113). */
  @type('number') speed = 0;
  /** "O Anel te tenta" — 0..4 (DOC-036 item 111). */
  @type('number') ringLevel = 0;
  /** `Card.id` da criatura portadora do Anel. */
  @type('string') ringBearerId = '';
  /** DOC-036 item 114. Marcador; o motor nao impoe descarte. */
  @type('number') maxHandSize = 7;

  /** Mascote da mesa. Ver PETS em @aethertable/shared-types. */
  @type('string') petId = '';

  // ── SALA DE ESPERA ────────────────────────────────────────────────────────

  /**
   * Clicou em "pronto". O anfitriao so consegue iniciar com a mesa toda pronta.
   *
   * Antes o anfitriao iniciava quando quisesse: quem ainda estava escolhendo
   * deck, ajustando cosmetico ou simplesmente ainda carregando o grimorio era
   * jogado na partida com a mesa pela metade — e como a mao inicial e comprada
   * no START_MATCH, quem nao tinha grimorio provisionado comprava zero cartas
   * e passava a partida assistindo.
   */
  @type('boolean') ready = false;

  /**
   * Ja decidiu ficar com a mao inicial. Fecha a janela de mulligan.
   *
   * O mulligan e a unica acao do jogo que so faz sentido numa janela: antes da
   * primeira jogada. Sem este campo, o botao seguia ativo no turno seis e
   * devolvia a mao inteira ao grimorio no meio da partida.
   */
  @type('boolean') keptHand = false;

  /** Nome do grimorio escolhido na sala de espera. So para exibicao. */
  @type('string') deckName = '';

  /**
   * Zonas ocultas que este jogador ABRIU para outros, por consentimento
   * (`INTENT_RESPOND_VIEW`). Chave = zona, valor = sessionIds separados por
   * virgula.
   *
   * ─── POR QUE NO JOGADOR, E NAO SO NA CARTA ────────────────────────────────
   *
   * A concessao de visibilidade vive em `Card.revealedTo`, e toda troca de zona
   * a APAGA (`limparConcessoes`) — o que esta certo: uma carta que sai da mao e
   * volta nao pode continuar revelada por acidente.
   *
   * So que "deixar fulano ver a minha mao" nao e uma concessao sobre AQUELAS
   * sete cartas: e sobre a mao, que muda a cada compra. Guardada so na carta, a
   * permissao evaporava na primeira compra e o observador via a mao encolher
   * sem entender por que. Aqui ela sobrevive, e `aplicarEfeitosDeZona` a
   * reaplica a cada carta que entra na zona.
   *
   * Revogar (`INTENT_REVOKE_VIEW`) apaga dos dois lugares.
   */
  @type({ map: 'string' }) sharedZones = new MapSchema<string>();

  // ── DERROTA ───────────────────────────────────────────────────────────────

  /**
   * O jogador saiu do jogo — por regra ou por vontade.
   *
   * ─── ISTO REVERTE RN01, DE PROPOSITO ──────────────────────────────────────
   *
   * O motor nasceu como sandbox puro: "vida <= 0 NAO elimina ninguem". A ideia
   * era que a mesa combinasse tudo, como numa partida de papel. Na pratica isso
   * deixava as quatro condicoes de derrota de Magic sem NENHUMA representacao:
   * 21 de dano de comandante era um numero que ficava vermelho e mais nada,
   * veneno chegava a 10 e a partida seguia, e comprar de grimorio vazio nao
   * produzia nem um aviso — o handler comprava menos cartas em silencio.
   *
   * Agora o servidor aplica as quatro. O que RN01 preservava e que continua
   * valendo: o eliminado NAO e removido da sala. Ele continua sentado, vendo a
   * mesa e conversando — o que muda e que a partida sabe que ele saiu.
   *
   * `eliminated` e DERIVADO e recalculado (`reavaliarEliminacao`): se a vida
   * voltar a subir, ou um `INTENT_UNDO` desfizer o golpe, o jogador volta. Um
   * clique errado em "-1" com 1 de vida nao pode ser irreversivel.
   */
  @type('boolean') eliminated = false;

  /** LIFE | POISON | COMMANDER | DECKED | CONCEDED — vazio quando vivo. */
  @type('string') eliminationReason = '';

  /**
   * Tentou comprar de um grimorio vazio.
   *
   * Precisa ser PEGAJOSO, ao contrario das outras tres condicoes: "estar sem
   * cartas" nao e o que mata — o que mata e TENTAR COMPRAR sem ter. Um efeito
   * que devolva cartas ao grimorio depois nao desfaz a derrota, entao isto nao
   * pode ser recalculado a partir do tamanho da lista.
   */
  @type('boolean') decked = false;
}
