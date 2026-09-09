import { MapSchema, Schema, type } from '@colyseus/schema';
import { Arrow } from './Arrow';
import { Card } from './Card';
import { Espectador } from './Espectador';
import { Player } from './Player';
import { ZoneOrderList } from './ZoneOrderList';

/**
 * Estado autoritativo da sala.
 *
 * Vive na RAM do game node. NUNCA no Postgres (ADR-006, RN12): muta dezenas de
 * vezes por segundo e nao tem valor depois da partida.
 *
 * Fonte canonica: docs/especificacao_do_motor_sandbox.md §3.
 */
export class RoomState extends Schema {
  @type('string') roomCode!: string;
  /** WAITING | PLAYING | PAUSED | CLOSING */
  @type('string') phase = 'WAITING';
  /** Marcador VISUAL apenas (F29). O motor nao controla turnos. */
  @type('number') turn = 1;
  /** Marcador VISUAL apenas. */
  @type('string') activePlayerId = '';
  @type('number') startedAt = 0;

  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Card }) cards = new MapSchema<Card>();

  /**
   * Ordem por zona: `zoneOrder["p1:LIBRARY"] = [cardId, ...]`.
   *
   * Separado das cartas de proposito: HAND, LIBRARY, GRAVEYARD e EXILE sao
   * ordenadas, e guardar a ordem como indice dentro de `Card` obrigaria a
   * reindexar N cartas a cada insercao — N patches para uma unica compra.
   *
   * SEGURANCA: contem IDs DE MESA (`Card.id`), nunca `scryfallId`. Conhecer a
   * ordem dos UUIDs de um grimorio nao revela nada: os UUIDs sao gerados por
   * partida e nao tem relacao com a identidade da carta (DOC-032 §3.1).
   */
  @type({ map: ZoneOrderList }) zoneOrder = new MapSchema<ZoneOrderList>();

  /**
   * Campos da SALA DE ESPERA. Vivem no estado (e nao na querystring do
   * /play/:code) porque quem entra pelo codigo nunca recebeu essas opcoes:
   * so o criador as tinha na URL, e o lobby dele mostrava dados que o
   * convidado nao via.
   *
   * ATENCAO: campos novos vao no FIM. O @colyseus/schema serializa por INDICE
   * — inserir no meio desloca todos os seguintes e o mirror do cliente decodifica
   * lixo. Foi exatamente esse o defeito de `Player.mulliganCount`.
   */
  @type('number') maxSeats = 4;
  /** COMMANDER | STANDARD | MODERN | PAUPER ... */
  @type('string') gameType = 'COMMANDER';

  /** DAY | NIGHT | NEITHER (DOC-036 item 110). Marcador visual. */
  @type('string') dayNight = 'NEITHER';
  /** Rotulo livre de fase, escrito por INTENT_SET_TURN (DOC-036 item 127). */
  @type('string') turnPhase = '';
  /** Setas de alvo persistentes (DOC-036 item 126). */
  @type({ map: Arrow }) arrows = new MapSchema<Arrow>();

  /**
   * ─── CONFIGURACAO ESCOLHIDA NA CRIACAO DA SALA ───────────────────────────
   *
   * Mesma razao de `maxSeats` e `gameType` acima: quem entra pelo codigo nunca
   * recebeu as opcoes do criador. O contrato destes campos e
   * `ConfigDeSala`, em `@aethertable/shared-types`, e quem os grava e
   * `normalizarConfigDeSala` — a MESMA funcao que o formulario do navegador
   * chamou antes de enviar.
   *
   * CAMPOS NOVOS VAO NO FIM. Ver o aviso do bloco anterior.
   */

  /** Nome escolhido pelo criador. Livre, 3-40 — ver `ehNomeDeSala`. */
  @type('string') nome = '';
  /** PRIVADA | PUBLICA. Privada nao aparece em GET /salas. */
  @type('string') visibilidade = 'PRIVADA';
  /** QUALQUER | VOZ | TEXTO. Sinalizacao social; o sistema nao impoe. */
  @type('string') comunicacao = 'QUALQUER';
  @type('string') idioma = 'pt-BR';
  /**
   * 0 = nao declarado.
   *
   * `number` com zero em vez de `string` anulavel porque `@colyseus/schema` nao
   * tem tipo opcional: um `''` num campo numerico obrigaria a converter em toda
   * leitura, dos dois lados.
   *
   * DECLARADO PELO ANFITRIAO, NUNCA CALCULADO. Nao existe calculador de bracket
   * aqui — o numero e uma etiqueta que o criador escolheu, e a interface tem de
   * dizer isso com essas palavras.
   */
  @type('number') nivelDePoder = 0;

  /**
   * ─── CONFIGURACAO DE JOGO, AJUSTADA NA SALA DE ESPERA ────────────────────
   *
   * Os campos acima sao decididos na CRIACAO e nao mudam mais. Estes o
   * anfitriao ajusta com a mesa ja montada, por `INTENT_SET_ROOM_CONFIG`, e
   * eles vivem no estado — e nao na tela dele — porque o convidado precisa
   * saber o mulligan e o cronometro ANTES de marcar pronto.
   */

  /** COMMANDER | LONDON | LIVRE. */
  @type('string') tipoDeMulligan = 'COMMANDER';
  /**
   * '' = sortear no inicio. Senao, o sessionId escolhido pelo anfitriao.
   *
   * Ate aqui quem clicava em "iniciar" comecava a partida — uma vantagem
   * silenciosa do anfitriao em TODAS as mesas, que ninguem tinha combinado.
   */
  @type('string') jogadorInicial = '';
  /** true = a ordem de turno segue os assentos, sem sorteio. */
  @type('boolean') ordemPelosAssentos = false;
  /**
   * false = `INTENT_FETCH_FROM_SIDEBOARD` recusa durante a partida.
   *
   * A ZONA CONTINUA EXISTINDO. Esta preferencia governa o ACESSO a reserva
   * durante a partida, nao a existencia dela: o deck do jogador continua tendo
   * reserva, e ela volta a ser alcancavel se a mesa mudar de ideia.
   */
  @type('boolean') sideboardPermitido = false;
  /**
   * Segundos por turno. 0 = desligado.
   *
   * CONTA E AVISA, NUNCA AGE (RN01: nao existe motor de regras). Um cronometro
   * que passasse o turno sozinho seria a primeira regra que o servidor impoe.
   */
  @type('number') cronometroDeTurno = 0;
  /**
   * Epoch ms em que o turno atual comecou. 0 = sem cronometro rodando.
   *
   * O cliente calcula o tempo decorrido a partir DESTE timestamp, em vez de
   * receber um tique por segundo: um `broadcast` por segundo por sala seria
   * trafego constante numa mesa que fica minutos parada pensando.
   */
  @type('number') turnoIniciadoEm = 0;

  /**
   * Quem esta assistindo. SEPARADO de `players`, e a separacao e o ponto —
   * ver o cabecalho de `Espectador.ts` para os quatro lugares que quebrariam
   * se espectador fosse um `Player` com uma flag.
   */
  @type({ map: Espectador }) espectadores = new MapSchema<Espectador>();
}
