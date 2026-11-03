/**
 * mediador-da-sala.ts — o padrão MEDIATOR (GoF) no ciclo de vida da sala:
 * quem reage a cada acontecimento da mesa, e em que ordem (DOC-100).
 *
 * ─── O QUE HAVIA ANTES, E POR QUE INCOMODAVA ────────────────────────────────
 *
 * Quatro partes da sala precisam reagir quando a mesa muda: a vitrine pública
 * (o metadado que `GET /salas` lê), o descarte da sala vazia, os prazos que o
 * servidor fecha (votação e mulligan) e o registro da partida (quem jogou,
 * quando começou, quem começou).
 *
 * Cada ponto de entrada da `AetherRoom` — `onCreate`, entrar como jogador,
 * entrar como espectador, a saída do espectador, `removerJogador`, o despacho
 * de intenção, `aplicarConfig` e a mudança de lotação — chamava à mão a SUA
 * lista dessas reações. Oito listas, escritas em épocas diferentes, que
 * precisavam concordar sem nada que as ligasse. As cicatrizes estavam no
 * código: "a ocupação mudou: sem isto a lista pública mostraria 1/4" é um
 * comentário que só existe porque a linha faltou uma vez. E `removerJogador`
 * publicava a vitrine no meio do caminho, ANTES de decidir que o último que
 * ficou venceu — a mesa encerrada continuava listada como "em partida".
 *
 * ─── O QUE O PADRÃO MUDA ────────────────────────────────────────────────────
 *
 * Os pontos de entrada só contam O QUE aconteceu (`notificar`). Quem decide
 * QUEM reage, e em que ordem, é um lugar só: `CentralDaSala`. Os colegas não
 * se conhecem e não conhecem a Room; quando um deles tem algo a dizer — um
 * prazo venceu, a sala ficou abandonada —, ele também só avisa a central.
 *
 * Um ponto de entrada novo passa a ser uma linha (`notificar`) e não uma lista
 * a lembrar; uma reação nova entra num `case`, e todo ponto de entrada a ganha.
 */

import type { RoomState } from '../schema/RoomState';

/** O que a sala conta à central. É a única coisa que os pontos de entrada sabem dela. */
export type AcontecimentoDaSala =
  | { readonly tipo: 'SALA_CRIADA' }
  /** A config chegou (criação ou passe assinado) ou a lotação mudou por intenção. */
  | { readonly tipo: 'SALA_CONFIGURADA' }
  /** Jogador ou espectador admitido. */
  | { readonly tipo: 'ENTROU' }
  /** Espectador saiu, ou jogador foi removido de vez. */
  | { readonly tipo: 'SAIU' }
  | { readonly tipo: 'INTENCAO_APLICADA'; readonly faseAntes: string }
  /** Dito por `PrazosDaMesa`. */
  | { readonly tipo: 'PRAZO_DO_MULLIGAN_VENCEU' }
  /** Dito por `DescarteDaSalaVazia`. */
  | { readonly tipo: 'SALA_ABANDONADA' };

/** MEDIATOR — a interface que colegas e pontos de entrada enxergam. */
export interface MediadorDaSala {
  notificar(acontecimento: AcontecimentoDaSala): void;
}

/** O pedaço do `clock` do Colyseus que os prazos usam. */
export interface Relogio {
  setTimeout(acao: () => void, ms: number): { clear(): void };
}

/**
 * O que só a Room sabe fazer, e que a central pede em nome dos colegas.
 *
 * Fica de fora dos colegas de propósito: encerrar o mulligan passa pelo
 * REGISTRY com o contexto de cada jogador, e descartar é `disconnect()`. Um
 * colega que recebesse a Room inteira para isso voltaria a ser o acoplamento
 * que o padrão tira.
 */
export interface AcoesDaSala {
  encerrarMulliganPorTempo(): void;
  descartar(): void;
}

/** COLLEAGUE — conhece só o mediador, e só o recebe de quem o constrói. */
export abstract class ColegaDaSala {
  protected mediador: MediadorDaSala | null = null;

  ligar(mediador: MediadorDaSala): void {
    this.mediador = mediador;
  }
}

/**
 * Publica a sala no matchMaker — ou a esconde.
 *
 * METADADO, e não estado: é o que `matchMaker.query` consulta SEM abrir a sala
 * nem tocar no `RoomState`. Uma lista pública que precisasse instanciar cada
 * sala para saber o nome dela não escalaria além de algumas dezenas.
 *
 * Só sala PÚBLICA é publicada. Privada significa não listada (não existe senha
 * de sala — o `seatToken` já governa a entrada), e a forma de honrar isso é não
 * ter nada para o `GET /salas` encontrar.
 */
export class Vitrine extends ColegaDaSala {
  constructor(
    private readonly state: RoomState,
    private readonly gravar: (metadado: Record<string, unknown>) => void,
  ) {
    super();
  }

  publicar(): void {
    if (this.state.visibilidade !== 'PUBLICA') {
      this.gravar({ visibilidade: 'PRIVADA' });
      return;
    }

    this.gravar({
      visibilidade: 'PUBLICA',
      roomCode: this.state.roomCode,
      nome: this.state.nome,
      gameType: this.state.gameType,
      comunicacao: this.state.comunicacao,
      idioma: this.state.idioma,
      nivelDePoder: this.state.nivelDePoder,
      // A ocupação vive no metadado porque a lista precisa dela para decidir
      // entre "Entrar" e "Assistir", e `clients.length` não atravessa o
      // matchMaker por conta própria.
      ocupacao: this.state.players.size,
      espectadores: this.state.espectadores.size,
      maxSeats: this.state.maxSeats,
      emPartida: this.state.phase === 'PLAYING',
    });
  }
}

/**
 * ─── A SALA PÚBLICA SUMIA DA VITRINE ─────────────────────────────────────────
 *
 * Com o `autoDispose` padrão do Colyseus, a sala é destruída no instante em
 * que o último cliente sai. O criador de uma mesa pública não consegue estar
 * no lobby e na Taverna na mesma aba: bastava voltar para a lista para ver se
 * a mesa aparecia, e ela já não existia mais — "as salas que eu crio não
 * aparecem".
 *
 * Agora a sala vazia espera. Pública espera mais, porque é justamente quem
 * está na vitrine que alguém pode chegar a encontrar; privada espera o
 * bastante para um F5 ou um "voltar" acidental não custar a mesa e o convite.
 *
 * Vazia é sem clientes E sem jogador aguardando reconexão: quem caiu tem o
 * assento guardado por `RECONNECTION_WINDOW_S`, e descartar a sala antes
 * disso desfaria a reserva.
 */
export class DescarteDaSalaVazia extends ColegaDaSala {
  private agendado: { clear(): void } | null = null;

  constructor(
    private readonly state: RoomState,
    private readonly relogio: Relogio,
    private readonly clientesConectados: () => number,
  ) {
    super();
  }

  agendarSeVazia(): void {
    this.cancelar();
    // Pelo ESTADO, e não pelos clientes: dentro do `onLeave` o cliente que
    // está saindo pode ainda constar da lista, e a sala que acabou de esvaziar
    // nunca agendaria o próprio descarte — com o `autoDispose` desligado, ela
    // ficaria aberta para sempre.
    if (!this.vazia()) return;

    const espera = this.state.visibilidade === 'PUBLICA' ? 180_000 : 30_000;
    this.agendado = this.relogio.setTimeout(() => {
      if (this.vazia() && this.clientesConectados() === 0) {
        this.mediador?.notificar({ tipo: 'SALA_ABANDONADA' });
      }
    }, espera);
  }

  cancelar(): void {
    this.agendado?.clear();
    this.agendado = null;
  }

  private vazia(): boolean {
    return this.state.players.size === 0 && this.state.espectadores.size === 0;
  }
}

/** Os dois prazos que o servidor fecha no relógio da sala. */
export class PrazosDaMesa extends ColegaDaSala {
  private fimDaVotacao: { clear(): void } | null = null;
  private fimDaVotacaoAgendado = 0;
  private fimDoMulligan: { clear(): void } | null = null;
  private fimDoMulliganAgendado = 0;

  constructor(
    private readonly state: RoomState,
    private readonly relogio: Relogio,
  ) {
    super();
  }

  /**
   * Chamado depois de cada intenção: é quando um prazo nasce (votar,
   * START_MATCH), morre (RESET_MATCH) ou deixa de importar (todo mundo
   * decidiu o mulligan).
   */
  reagendar(): void {
    this.agendarFimDaVotacao();
    this.agendarFimDoMulligan();
  }

  /**
   * A votação vencida é ENCERRADA pelo servidor, no prazo.
   *
   * Antes ela só era varrida no voto seguinte, e o painel decidia sumir
   * comparando `votacaoExpiraEm` (relógio do servidor) com o relógio do
   * NAVEGADOR: com o relógio do jogador adiantado um minuto, a votação nunca
   * aparecia para ele; atrasado, aparecia depois de vencida. Agora a votação
   * aberta é `votacaoAlvo !== ''`, e quem a fecha é o servidor.
   */
  private agendarFimDaVotacao(): void {
    const { votacaoAlvo, votacaoExpiraEm } = this.state;
    if (!votacaoAlvo || this.fimDaVotacaoAgendado === votacaoExpiraEm) return;
    this.fimDaVotacao?.clear();
    this.fimDaVotacaoAgendado = votacaoExpiraEm;
    this.fimDaVotacao = this.relogio.setTimeout(
      () => {
        this.fimDaVotacao = null;
        this.fimDaVotacaoAgendado = 0;
        if (this.state.votacaoAlvo && this.state.votacaoExpiraEm <= Date.now()) {
          this.state.votacaoAlvo = '';
          this.state.votacaoAutor = '';
          this.state.votacaoSim = '';
          this.state.votacaoExpiraEm = 0;
        }
      },
      Math.max(0, votacaoExpiraEm - Date.now()) + 50,
    );
  }

  /**
   * ─── O PRAZO DO MULLIGAN ───────────────────────────────────────────────────
   *
   * Mesmo desenho da votação: o estado diz QUANDO vence (`mulliganExpiraEm`)
   * e quem fecha é o servidor, no relógio da sala — não o cliente, que pode
   * estar com a aba em segundo plano, desconectado ou simplesmente mentindo.
   *
   * Fechar é mover cartas pelo REGISTRY, o que só a Room sabe fazer: o prazo
   * vencido é avisado à central, e não executado aqui.
   */
  private agendarFimDoMulligan(): void {
    const { mulliganExpiraEm, phase } = this.state;
    if (!mulliganExpiraEm) return;
    // Todo mundo decidiu antes do prazo: o relógio some da tela de todos.
    const faltaAlguem = Array.from(this.state.players.values()).some((p) => !p.keptHand);
    if (phase !== 'PLAYING' || !faltaAlguem) {
      this.state.mulliganExpiraEm = 0;
      return;
    }
    if (this.fimDoMulliganAgendado === mulliganExpiraEm) return;
    this.fimDoMulligan?.clear();
    this.fimDoMulliganAgendado = mulliganExpiraEm;
    this.fimDoMulligan = this.relogio.setTimeout(
      () => {
        this.fimDoMulligan = null;
        this.fimDoMulliganAgendado = 0;
        this.mediador?.notificar({ tipo: 'PRAZO_DO_MULLIGAN_VENCEU' });
      },
      Math.max(0, mulliganExpiraEm - Date.now()) + 50,
    );
  }
}

/**
 * ─── O QUE O RESUMO PÓS-PARTIDA PRECISA, E O ESTADO NÃO TEM MAIS ────────────
 *
 * `onDispose` roda DEPOIS de todo mundo sair: nesse momento `state.players`
 * está vazio e `clients` também. Perguntar ao estado quem jogou, ali, devolve
 * "ninguém" — e era assim que qualquer tentativa de gravar o resumo a partir
 * do estado registraria uma partida sem participantes.
 *
 * Por isso estas coisas são acumuladas ao longo da vida da sala. A foto de
 * cada jogador e o envio do resumo continuam na Room, que os lê daqui.
 */
export class RegistroDaPartida extends ColegaDaSala {
  /** Ids de CONTA (`sub` do seat token) que ocuparam assento. Não inclui plateia. */
  readonly contasQueJogaram = new Set<string>();
  /**
   * Ocupação no AUGE, e não no fim. Uma mesa de quatro que termina com um
   * jogador — porque três saíram — foi uma partida de quatro.
   */
  augeDeJogadores = 0;
  /** Epoch ms do primeiro START_MATCH. A duração da partida não inclui o lobby. */
  inicioDaPartida = 0;
  /** Conta de quem estava na vez quando a partida começou. */
  quemComecou = '';

  constructor(private readonly state: RoomState) {
    super();
  }

  /**
   * Só com a partida RODANDO: quem passou pela sala de espera e saiu antes do
   * início não jogou, e uma mesa pública com entra-e-sai passava de oito
   * participantes — o backend recusa o resumo acima de MAX_PLAYERS e a partida
   * não era gravada.
   */
  registrarParticipantes(): void {
    this.state.players.forEach((p) => {
      if (p.userId) this.contasQueJogaram.add(p.userId);
    });
    this.augeDeJogadores = Math.max(this.augeDeJogadores, this.state.players.size);
  }

  /** A partida começou (ou recomeçou: o início e quem começou são os do primeiro START_MATCH). */
  marcarInicio(): void {
    if (!this.inicioDaPartida) this.inicioDaPartida = Date.now();
    this.registrarParticipantes();
    if (!this.quemComecou) {
      this.quemComecou = this.state.players.get(this.state.activePlayerId)?.userId ?? '';
    }
  }
}

/**
 * CONCRETE MEDIATOR — a única tabela de "aconteceu X, reage Y".
 *
 * A ordem dentro de cada `case` é parte do contrato, e é por isso que ela mora
 * num lugar só: a vitrine é a ÚLTIMA a falar porque ela publica o retrato da
 * sala, e o retrato só está certo depois que todo o resto reagiu.
 */
export class CentralDaSala implements MediadorDaSala {
  constructor(
    private readonly state: RoomState,
    private readonly vitrine: Vitrine,
    private readonly descarte: DescarteDaSalaVazia,
    private readonly prazos: PrazosDaMesa,
    private readonly registro: RegistroDaPartida,
    private readonly acoes: AcoesDaSala,
  ) {
    for (const colega of [vitrine, descarte, prazos, registro]) colega.ligar(this);
  }

  notificar(acontecimento: AcontecimentoDaSala): void {
    switch (acontecimento.tipo) {
      case 'SALA_CRIADA':
        // Cobre a sala que ninguém chega a ocupar.
        this.descarte.agendarSeVazia();
        return;

      case 'SALA_CONFIGURADA':
        this.vitrine.publicar();
        return;

      case 'ENTROU':
        this.descarte.cancelar();
        // Quem chega com a partida andando também jogou.
        if (this.state.phase === 'PLAYING') this.registro.registrarParticipantes();
        // A ocupação mudou: sem isto a lista pública mostraria "1/4" numa mesa
        // que já encheu, e o botão "Entrar" levaria a um ROOM_FULL.
        this.vitrine.publicar();
        return;

      case 'SAIU':
        // Uma vaga abriu: a mesa volta para a lista com "Entrar" em vez de
        // "Assistir" — e, se acabou de acabar, sem "em partida".
        this.vitrine.publicar();
        this.descarte.agendarSeVazia();
        return;

      case 'INTENCAO_APLICADA':
        this.prazos.reagendar();
        // START_MATCH e RESET_MATCH mudam `emPartida` na lista pública; o
        // REGISTRY não tem — nem deve ter — acesso à vitrine.
        if (this.state.phase === acontecimento.faseAntes) return;
        if (this.state.phase === 'PLAYING') this.registro.marcarInicio();
        this.vitrine.publicar();
        return;

      case 'PRAZO_DO_MULLIGAN_VENCEU':
        this.acoes.encerrarMulliganPorTempo();
        return;

      case 'SALA_ABANDONADA':
        this.acoes.descartar();
        return;
    }
  }
}
