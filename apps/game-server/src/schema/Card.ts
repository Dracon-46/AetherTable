import { MapSchema, Schema, type, view } from '@colyseus/schema';

/**
 * Uma carta instanciada nesta partida.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ DESVIO DOCUMENTADO EM RELACAO A DOC-032 §3                                │
 * │                                                                           │
 * │ Os documentos especificam `@filter((client) => podeVer(...))` sobre o      │
 * │ campo `scryfallId`. Esse decorador NAO EXISTE em @colyseus/schema 3.x,     │
 * │ que e a versao exigida pelo Colyseus 0.16 — a propria versao-alvo de       │
 * │ DOC-022. O `@filter` foi removido e substituido por `view()` + StateView.  │
 * │                                                                           │
 * │ O REQUISITO nao muda (RN02, FR-06, ADR-004): a identidade da carta so sai  │
 * │ do servidor para quem tem direito. O MECANISMO muda:                       │
 * │                                                                           │
 * │   @filter  → predicado por cliente, avaliado a cada encode.               │
 * │   view()   → campo invisivel por padrao; o servidor inscreve             │
 * │              explicitamente cada cliente que pode ver, via StateView.     │
 * │                                                                           │
 * │ Consequencias praticas:                                                   │
 * │                                                                           │
 * │ 1. FALHA FECHADA DE GRACA. Sem inscricao, o campo nao e serializado para   │
 * │    ninguem. Esquecer de inscrever = carta invisivel (bug visivel e         │
 * │    inofensivo). Esta e a mesma propriedade que a clausula 7 de `podeVer`   │
 * │    buscava, agora garantida pelo serializador.                            │
 * │                                                                           │
 * │ 2. O RISCO SE INVERTE. Com @filter, o perigo era um predicado errado. Com  │
 * │    view(), o perigo e esquecer de REMOVER a inscricao quando o direito     │
 * │    expira (fim da olhada, troca de zona). Por isso toda mutacao relevante  │
 * │    passa por `reconciliarVisibilidade()`, que sempre RECALCULA a partir de │
 * │    `podeVer` em vez de aplicar deltas.                                    │
 * │                                                                           │
 * │ 3. E MAIS BARATO. DOC-032 §7 estimava o filtro rodando ~30.000x/s. A       │
 * │    reconciliacao roda por evento de visibilidade, nao por encode.          │
 * │                                                                           │
 * │ `podeVer()` segue sendo o UNICO ponto de decisao — ver visibility.ts.      │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export class Card extends Schema {
  /** UUID desta carta NESTA partida. Nao tem relacao com a identidade da carta. */
  @type('string') id!: string;
  /** Dono do deck. NUNCA muda. */
  @type('string') ownerId!: string;
  /** Quem manipula agora (RN08). */
  @type('string') controllerId!: string;
  @type('string') zone!: string;

  // ───────────────────────────────────────────────────────────────────────────
  //  CAMPO CRITICO — a identidade da carta.
  //  Invisivel por padrao. Sai do servidor SOMENTE para os sessionIds inscritos
  //  na StateView correspondente. Ver reconciliarVisibilidade().
  // ───────────────────────────────────────────────────────────────────────────
  @view()
  @type('string')
  scryfallId = '';

  // ── concessoes de visibilidade (RN13) ────────────────────────────────────
  // Strings com sessionIds separados por virgula, nao ArraySchema: a busca e
  // mais barata que iterar colecao, e a reconciliacao le estes campos com
  // frequencia.
  /** 'ALL' | 'sid1,sid2' — persistente ate troca de zona. */
  @type('string') revealedTo = '';
  /** 'sid1,sid2' — transitorio; limpo ao fechar o painel ou por timeout. */
  @type('string') peekedBy = '';

  @type('number') x = 0;
  @type('number') y = 0;
  /** 0 = normal, 90 = virada, 180 = invertida. */
  @type('number') rotation = 0;
  @type('number') zIndex = 0;

  @type('boolean') isTapped = false;
  /** morph / manifest / disguise / exilio oculto. */
  @type('boolean') faceDown = false;
  /** Marcador visual — o motor nao impoe efeito (RN01). */
  @type('boolean') phasedOut = false;
  @type('boolean') isToken = false;
  @type('boolean') isCopy = false;
  /** DFC mostrando a face de tras. */
  @type('boolean') isFlipped = false;

  /** sessionId de quem arrasta (FR-10). TTL de 5 s. */
  @type('string') lockedBy = '';
  /** Equipamento / aura anexada a outra carta. O grupo se move junto. */
  @type('string') attachedTo = '';
  /** Agrupa o exilio pela carta que exilou. */
  @type('string') exiledBy = '';
  @type('string') goadedBy = '';

  /** Anotacao livre, max. 120 caracteres, sanitizada. */
  @type('string') note = '';
  @type('string') highlight = '';

  /** Dano marcado — distinto de marcadores -1/-1. */
  @type('number') damage = 0;
  @type('number') powerOverride = 0;
  @type('number') toughnessOverride = 0;

  /**
   * Contadores com chave STRING LIVRE, nao enum: Magic tem 100+ tipos nomeados
   * e cada colecao adiciona outros (DOC-036 §5.1).
   */
  @type({ map: 'number' }) counters = new MapSchema<number>();

  // ───────────────────────────────────────────────────────────────────────────
  //  CAMPOS NOVOS VÃO SEMPRE NO FIM.
  //  O serializador do @colyseus/schema usa o ÍNDICE do campo. Inserir no meio
  //  desloca todos os seguintes e o mirror do cliente decodifica lixo, sem erro
  //  e sem aviso. `pnpm schema:check` guarda essa invariante.
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * P/T sobreposto ativo (DOC-036 item 57). `powerOverride`/`toughnessOverride`
   * só valem quando isto e true — sem o booleano, "0/0" e "sem override" sao
   * indistinguiveis.
   */
  @type('boolean') hasPtOverride = false;
  /** Marcador visual de "entrou este turno" (DOC-036 item 60). */
  @type('boolean') enteredThisTurn = false;

  /**
   * Esta carta E o comandante do dono.
   *
   * ─── POR QUE UM CAMPO, E NAO "esta na zona de comando" ────────────────────
   *
   * A zona nao serve para responder isso: o comandante passa a maior parte da
   * partida FORA da zona de comando — no campo, no cemiterio, no exilio. Quem
   * perguntasse "quem e o comandante do Bruno" olhando `zone === 'COMMAND'`
   * acertaria so enquanto ele estivesse guardado.
   *
   * Isto existe porque o painel de dano de comandante precisa dizer de QUAL
   * comandante veio o dano — e o jogador chama o comandante pelo nome da carta,
   * nao pelo nome do dono. Mostrar "aether_bruno" numa linha de dano de
   * comandante e trocar a informacao util pela que o jogador ja tem na tela.
   *
   * Vem do `boardType` do deck (COMMANDER / SIGNATURE_SPELL) no
   * provisionamento, e nunca muda durante a partida.
   */
  @type('boolean') isCommander = false;
}
