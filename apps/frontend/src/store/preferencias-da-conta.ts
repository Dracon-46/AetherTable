'use client';

/**
 * preferencias-da-conta.ts — a ponte entre os stores da interface e a conta.
 *
 * ─── O QUE ESTAVA FALTANDO ─────────────────────────────────────────────────
 *
 * Tamanho da carta, alinhar à grade, custo de mana na mão, seguir o turno,
 * modo do painel de vida — a fatia de preferências da mesa foi entregue
 * guardando tudo em `localStorage` e nada na conta. O commit prometia que
 * seguiam a pessoa; seguiam o NAVEGADOR. Trocar de máquina ou limpar dados do
 * site devolvia a mesa ao padrão, que é exatamente o relato que já tinha
 * levado cosméticos e atalhos para `user_preferences`.
 *
 * O mesmo relato voltou ("se eu troco de PC, zera") e trouxe junto o que
 * ainda tinha ficado para trás: cinco preferências da mesa (log dividido,
 * rastreador de mana, prévia ao lado, sons, tremor do comandante) e a
 * aparência do site inteira (`aparencia.store`). As duas pontes moram aqui,
 * com o mesmo desenho.
 *
 * ─── POR QUE UMA ASSINATURA, E NÃO UM `salvarNaConta` EM CADA SETTER ───────
 *
 * São dezessete preferências de mesa e oito de aparência, espalhadas por
 * setters de dois stores, e mais nascem a cada tela de configuração. Chamar a
 * API dentro de cada um seria um ponto para esquecer a cada setter novo — e o
 * `ajustarFatorCarta` roda a cada toque de `=`, o que viraria um PATCH por
 * tecla.
 *
 * Uma assinatura por store, com espera, resolve os dois: qualquer caminho que
 * mude a preferência (tecla, painel, menu) é captado, e uma rajada vira uma
 * requisição.
 *
 * ─── E POR QUE ELA SÓ COMEÇA DEPOIS DA HIDRATAÇÃO ─────────────────────────
 *
 * Se observássemos desde a montagem, o próprio ato de aplicar o que veio do
 * servidor dispararia um PATCH de volta — e, pior, o estado local (ainda o
 * padrão, antes da resposta chegar) poderia ser gravado por cima do que a
 * conta guardava. `useHidratarPreferencias` chama `observar…()` DEPOIS de
 * aplicar a resposta, e a ordem é a garantia.
 *
 * ─── A CONTA SEM A CHAVE NÃO APAGA O NAVEGADOR ─────────────────────────────
 *
 * Uma chave AUSENTE no objeto salvo quer dizer "a conta ainda não tem isto" —
 * `{}` de fábrica, uma conta gravada por uma versão anterior do site, ou a API
 * ainda na versão antiga durante a troca. Nos três casos aplicar o padrão
 * por cima do navegador apagaria uma escolha que só ele conhece. Por isso
 * `aplicar…` toca SÓ as chaves presentes, e diz se sobrou no navegador alguma
 * escolha fora do padrão que a conta não tem — aí o observador sobe o objeto
 * completo logo depois de ligar.
 *
 * O "fora do padrão" importa: um navegador novo, todo no padrão, não sobe
 * nada. Se subisse, o padrão viraria escolha gravada na conta e apagaria, na
 * próxima hidratação, o que outra máquina mais antiga tinha configurado.
 */

import {
  CHAVES_DE_PREFERENCIA_DE_INTERFACE,
  CHAVES_DE_PREFERENCIA_DE_MESA,
  normalizarPreferenciasDeInterface,
  normalizarPreferenciasDeMesa,
  PREFERENCIAS_DE_INTERFACE_PADRAO,
  PREFERENCIAS_DE_MESA_PADRAO,
  type PreferenciasDeInterface,
  type PreferenciasDeMesa,
} from '@aethertable/shared-types';
import { api } from '../lib/fetcher';
import { useAuthStore } from './auth.store';
import { useAparencia } from './aparencia.store';
import { useUIStore } from './game.store';

/**
 * Espera antes de mandar. 1,5 s é mais que o intervalo entre dois toques de
 * `=` e menos que o tempo de alguém ajustar e sair da tela.
 */
export const ESPERA_MS = 1500;

// ─── O OBSERVADOR COM ESPERA, UM SÓ PARA TODOS ─────────────────────────────────

export interface OpcoesDeObservacao {
  /**
   * Sobe o estado atual logo depois de ligar (com a mesma espera), em vez de
   * esperar a primeira mudança. É o que `aplicar…` pede quando o navegador tem
   * escolha que a conta não tem.
   */
  enviarJa?: boolean;
}

interface Observacao<S> {
  /** `useUIStore.subscribe`, `useAparencia.subscribe`… */
  assinar: (ouvinte: (estado: S, anterior: S) => void) => () => void;
  /** Mudou alguma coisa que vai para a conta? */
  mudou: (estado: S, anterior: S) => boolean;
  /** O corpo COMPLETO do `PATCH /users/me` — a conta substitui, não mescla. */
  corpo: () => Record<string, unknown>;
  /** Para o aviso no console. */
  rotulo: string;
}

/**
 * Assina um store e manda o corpo para a conta, uma vez por rajada.
 *
 * Cada chamada tem o próprio temporizador e o próprio "último enviado": a mesa
 * e a aparência não se atropelam, e um PATCH que não muda nada não sai.
 *
 * Devolve a função que para. Parar com um envio PENDENTE manda na hora em vez
 * de jogar fora: o observador é desligado quando a casca desmonta — sair da
 * taverna para a mesa, por exemplo —, e descartar ali perderia a última
 * escolha justo antes de a página seguinte hidratar da conta e trazer de volta
 * o valor antigo. Sem sessão (o desligamento do logout), não há para quem
 * mandar.
 */
export function observarComEspera<S>(
  o: Observacao<S>,
  { enviarJa = false }: OpcoesDeObservacao = {},
): () => void {
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  /** O último corpo enviado. Evita PATCH que não muda nada. */
  let ultimoEnviado: string | null = enviarJa ? null : JSON.stringify(o.corpo());

  const enviar = (): void => {
    temporizador = null;
    const corpo = JSON.stringify(o.corpo());
    if (corpo === ultimoEnviado) return;
    ultimoEnviado = corpo;
    void api('/users/me', {
      method: 'PATCH',
      body: JSON.parse(corpo) as Record<string, unknown>,
    }).catch((erro) => {
      /**
       * Falhar aqui NÃO desfaz a preferência.
       *
       * O `localStorage` já guardou e a tela já está desenhando com o valor
       * novo; transformar uma queda de rede em "o tamanho da carta voltou
       * sozinho" seria pior do que ficar dessincronizado até a próxima entrada.
       * Zerar o `ultimoEnviado` faz a próxima mudança tentar de novo.
       */
      ultimoEnviado = null;
      console.warn(`[preferencias] não foi possível salvar ${o.rotulo} na conta:`, erro);
    });
  };

  const agendar = (): void => {
    if (temporizador) clearTimeout(temporizador);
    temporizador = setTimeout(enviar, ESPERA_MS);
  };

  const cancelarAssinatura = o.assinar((estado, anterior) => {
    if (o.mudou(estado, anterior)) agendar();
  });
  if (enviarJa) agendar();

  return () => {
    cancelarAssinatura();
    if (!temporizador) return;
    clearTimeout(temporizador);
    temporizador = null;
    if (useAuthStore.getState().accessToken) enviar();
  };
}

// ─── O QUE A CONTA TEM E O NAVEGADOR NÃO ───────────────────────────────────────

/** As chaves do contrato que o objeto salvo de fato traz. */
function chavesPresentes<K extends string>(salvas: unknown, chaves: readonly K[]): K[] {
  if (!salvas || typeof salvas !== 'object' || Array.isArray(salvas)) return [];
  return chaves.filter((c) => Object.hasOwn(salvas, c));
}

/** Sobrou no navegador alguma escolha FORA do padrão que a conta não tem? */
function sobrouNoNavegador<T>(
  local: T,
  padrao: Readonly<T>,
  presentes: readonly (keyof T)[],
  chaves: readonly (keyof T)[],
): boolean {
  return chaves.some((c) => !presentes.includes(c) && local[c] !== padrao[c]);
}

// ─── A MESA ────────────────────────────────────────────────────────────────────

/** Lê do store da interface o subconjunto que vai para a conta. */
export function lerPreferenciasDaMesa(): PreferenciasDeMesa {
  const s = useUIStore.getState();
  return normalizarPreferenciasDeMesa({
    fatorCarta: s.fatorCarta,
    alinharNaGrade: s.alinharNaGrade,
    anexosDesativados: s.anexosDesativados,
    custoDeManaNaMao: s.custoDeManaNaMao,
    seguirTurno: s.seguirTurno,
    contornoDasZonas: s.showZoneOutlines,
    trilhoAberto: s.trilhoAberto,
    barraAberta: s.barraAberta,
    logAberto: s.logAberto,
    vidaModo: s.vidaModo,
    // `boardView` guarda um sessionId quando aponta para um oponente, e
    // sessionId não sobrevive à partida: o normalizador derruba para 'ALL'.
    boardView: s.boardView,
    estiloDeMesa: s.estiloDeMesa,
    logDividido: s.logDividido,
    manaAberto: s.manaAberto,
    previaAoLado: s.previaAoLado,
    efeitosSonoros: s.efeitosSonoros,
    tremorDoComandante: s.tremorDoComandante,
  });
}

/** O contrato chama de `contornoDasZonas` o que o store chama de `showZoneOutlines`. */
function paraOStoreDaMesa(p: Partial<PreferenciasDeMesa>) {
  const { contornoDasZonas, ...resto } = p;
  return contornoDasZonas === undefined ? resto : { ...resto, showZoneOutlines: contornoDasZonas };
}

/**
 * Aplica o que veio da conta — SÓ as chaves que ela traz — e diz se o
 * navegador tem escolha que a conta não tem (e por isso precisa subir).
 *
 * Objeto vazio é o valor de fábrica da coluna e significa "nunca configurou":
 * não sobrescreve nada, senão ajustar numa aba e recarregar outra devolveria
 * tudo ao padrão. Mesma regra dos atalhos. Ver o cabeçalho para a chave
 * ausente.
 */
export function aplicarPreferenciasDaMesa(salvas: unknown): boolean {
  const presentes = chavesPresentes(salvas, CHAVES_DE_PREFERENCIA_DE_MESA);
  const local = lerPreferenciasDaMesa();
  if (presentes.length > 0) {
    const p = normalizarPreferenciasDeMesa(salvas);
    const daConta = Object.fromEntries(
      presentes.map((c) => [c, p[c]]),
    ) as Partial<PreferenciasDeMesa>;
    useUIStore.setState(paraOStoreDaMesa(daConta));
  }
  return sobrouNoNavegador(
    local,
    PREFERENCIAS_DE_MESA_PADRAO,
    presentes,
    CHAVES_DE_PREFERENCIA_DE_MESA,
  );
}

/**
 * Passa a mandar para a conta toda mudança nas preferências de mesa.
 *
 * Devolve a função que cancela — o hook a usa na limpeza do efeito, para não
 * deixar assinatura viva depois de um logout.
 */
export function observarPreferenciasDaMesa(opcoes?: OpcoesDeObservacao): () => void {
  return observarComEspera(
    {
      assinar: useUIStore.subscribe,
      /**
       * Só as chaves que vão para a conta, comparadas UMA A UMA e com nome.
       *
       * O store dispara a cada `set` — e os `set` mais frequentes são
       * `setHoveredCard` (uma vez por carta sob o mouse) e a seleção. Sem esta
       * comparação, passar o mouse pela mesa agendaria um envio por carta.
       *
       * Escrito campo a campo em vez de percorrer as chaves com índice porque
       * um nome errado num acesso indexado não quebra a compilação: viraria
       * `undefined !== undefined`, ou seja, uma preferência que silenciosamente
       * deixaria de ser salva.
       */
      mudou: (estado, anterior) =>
        estado.fatorCarta !== anterior.fatorCarta ||
        estado.alinharNaGrade !== anterior.alinharNaGrade ||
        estado.anexosDesativados !== anterior.anexosDesativados ||
        estado.custoDeManaNaMao !== anterior.custoDeManaNaMao ||
        estado.seguirTurno !== anterior.seguirTurno ||
        estado.showZoneOutlines !== anterior.showZoneOutlines ||
        estado.trilhoAberto !== anterior.trilhoAberto ||
        estado.barraAberta !== anterior.barraAberta ||
        estado.logAberto !== anterior.logAberto ||
        estado.vidaModo !== anterior.vidaModo ||
        estado.boardView !== anterior.boardView ||
        estado.estiloDeMesa !== anterior.estiloDeMesa ||
        estado.logDividido !== anterior.logDividido ||
        estado.manaAberto !== anterior.manaAberto ||
        estado.previaAoLado !== anterior.previaAoLado ||
        estado.efeitosSonoros !== anterior.efeitosSonoros ||
        estado.tremorDoComandante !== anterior.tremorDoComandante,
      corpo: () => ({ preferenciasDeMesa: lerPreferenciasDaMesa() }),
      rotulo: 'as preferências da mesa',
    },
    opcoes,
  );
}

// ─── A APARÊNCIA DO SITE ───────────────────────────────────────────────────────

/**
 * Lê do `aparencia.store` o que vai para a conta. `menuRecolhido` e
 * `painelDeBuscaRecolhido` ficam de fora: são do aparelho, não da pessoa.
 */
export function lerPreferenciasDeInterface(): PreferenciasDeInterface {
  const s = useAparencia.getState();
  return normalizarPreferenciasDeInterface({
    visaoDeDeck: s.visaoDeDeck,
    agrupamentoDeDeck: s.agrupamentoDeDeck,
    ordenacaoDeDeck: s.ordenacaoDeDeck,
    tamanhoDeCarta: s.tamanhoDeCarta,
    densidade: s.densidade,
    animacoesReduzidas: s.animacoesReduzidas,
    idiomaDasCartas: s.idiomaDasCartas,
    idiomaDaInterface: s.idiomaDaInterface,
  });
}

/** Mesma regra de `aplicarPreferenciasDaMesa`: só as chaves que a conta traz. */
export function aplicarPreferenciasDeInterface(salvas: unknown): boolean {
  const presentes = chavesPresentes(salvas, CHAVES_DE_PREFERENCIA_DE_INTERFACE);
  const local = lerPreferenciasDeInterface();
  if (presentes.length > 0) {
    const p = normalizarPreferenciasDeInterface(salvas);
    useAparencia.setState(
      Object.fromEntries(presentes.map((c) => [c, p[c]])) as Partial<PreferenciasDeInterface>,
    );
  }
  return sobrouNoNavegador(
    local,
    PREFERENCIAS_DE_INTERFACE_PADRAO,
    presentes,
    CHAVES_DE_PREFERENCIA_DE_INTERFACE,
  );
}

/** Passa a mandar para a conta toda mudança de aparência. Ver `observarComEspera`. */
export function observarPreferenciasDeInterface(opcoes?: OpcoesDeObservacao): () => void {
  return observarComEspera(
    {
      assinar: useAparencia.subscribe,
      // Campo a campo, pela mesma razão da mesa: alternar o menu (que é do
      // aparelho) também dispara o store, e não pode virar um PATCH.
      mudou: (estado, anterior) =>
        estado.visaoDeDeck !== anterior.visaoDeDeck ||
        estado.agrupamentoDeDeck !== anterior.agrupamentoDeDeck ||
        estado.ordenacaoDeDeck !== anterior.ordenacaoDeDeck ||
        estado.tamanhoDeCarta !== anterior.tamanhoDeCarta ||
        estado.densidade !== anterior.densidade ||
        estado.animacoesReduzidas !== anterior.animacoesReduzidas ||
        estado.idiomaDasCartas !== anterior.idiomaDasCartas ||
        estado.idiomaDaInterface !== anterior.idiomaDaInterface,
      corpo: () => ({ preferenciasDeInterface: lerPreferenciasDeInterface() }),
      rotulo: 'a aparência',
    },
    opcoes,
  );
}
