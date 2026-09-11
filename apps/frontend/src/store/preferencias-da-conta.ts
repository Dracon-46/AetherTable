'use client';

/**
 * preferencias-da-conta.ts — a ponte entre o store da interface e a conta.
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
 * ─── POR QUE UMA ASSINATURA, E NÃO UM `salvarNaConta` EM CADA SETTER ───────
 *
 * São onze preferências, espalhadas por onze setters do `useUIStore`, e mais
 * nascem a cada tela de configuração. Chamar a API dentro de cada um seria
 * onze pontos para esquecer no décimo segundo — e o `ajustarFatorCarta` roda a
 * cada toque de `=`, o que viraria um PATCH por tecla.
 *
 * Uma assinatura só, com espera, resolve os dois: qualquer caminho que mude a
 * preferência (tecla, painel, menu) é captado, e uma rajada vira uma
 * requisição.
 *
 * ─── E POR QUE ELA SÓ COMEÇA DEPOIS DA HIDRATAÇÃO ─────────────────────────
 *
 * Se observássemos desde a montagem, o próprio ato de aplicar o que veio do
 * servidor dispararia um PATCH de volta — e, pior, o estado local (ainda o
 * padrão, antes da resposta chegar) poderia ser gravado por cima do que a
 * conta guardava. `useHidratarPreferencias` chama `observar()` DEPOIS de
 * aplicar a resposta, e a ordem é a garantia.
 */

import { normalizarPreferenciasDeMesa, type PreferenciasDeMesa } from '@aethertable/shared-types';
import { api } from '../lib/fetcher';
import { useUIStore } from './game.store';

/**
 * Espera antes de mandar. 1,5 s é mais que o intervalo entre dois toques de
 * `=` e menos que o tempo de alguém ajustar e sair da tela.
 */
const ESPERA_MS = 1500;

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
  });
}

/**
 * Aplica o que veio da conta.
 *
 * Objeto vazio é o valor de fábrica da coluna e significa "nunca configurou" —
 * não pode sobrescrever o que este navegador já tem, senão ajustar numa aba e
 * recarregar outra devolveria tudo ao padrão. Mesma regra dos atalhos.
 */
export function aplicarPreferenciasDaMesa(salvas: unknown): void {
  if (!salvas || typeof salvas !== 'object') return;
  if (Object.keys(salvas as Record<string, unknown>).length === 0) return;
  const p = normalizarPreferenciasDeMesa(salvas);
  useUIStore.setState({
    fatorCarta: p.fatorCarta,
    alinharNaGrade: p.alinharNaGrade,
    anexosDesativados: p.anexosDesativados,
    custoDeManaNaMao: p.custoDeManaNaMao,
    seguirTurno: p.seguirTurno,
    showZoneOutlines: p.contornoDasZonas,
    trilhoAberto: p.trilhoAberto,
    barraAberta: p.barraAberta,
    logAberto: p.logAberto,
    vidaModo: p.vidaModo,
    boardView: p.boardView,
    estiloDeMesa: p.estiloDeMesa,
  });
}

let temporizador: ReturnType<typeof setTimeout> | null = null;
/** O último corpo enviado. Evita PATCH que não muda nada. */
let ultimoEnviado: string | null = null;

function enviar(): void {
  const corpo = JSON.stringify(lerPreferenciasDaMesa());
  if (corpo === ultimoEnviado) return;
  ultimoEnviado = corpo;
  void api('/users/me', {
    method: 'PATCH',
    body: { preferenciasDeMesa: JSON.parse(corpo) as PreferenciasDeMesa },
  }).catch((erro) => {
    /**
     * Falhar aqui NÃO desfaz a preferência.
     *
     * O `localStorage` já guardou e a mesa já está desenhando com o valor
     * novo; transformar uma queda de rede em "o tamanho da carta voltou
     * sozinho" seria pior do que ficar dessincronizado até a próxima entrada.
     * Zerar o `ultimoEnviado` faz a próxima mudança tentar de novo.
     */
    ultimoEnviado = null;
    console.warn('[preferencias] não foi possível salvar na conta:', erro);
  });
}

/**
 * Passa a mandar para a conta toda mudança nas preferências de mesa.
 *
 * Devolve a função que cancela — o hook a usa na limpeza do efeito, para não
 * deixar assinatura viva depois de um logout.
 */
export function observarPreferenciasDaMesa(): () => void {
  ultimoEnviado = JSON.stringify(lerPreferenciasDaMesa());

  const cancelarAssinatura = useUIStore.subscribe((estado, anterior) => {
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
    const mudou =
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
      estado.estiloDeMesa !== anterior.estiloDeMesa;
    if (!mudou) return;
    if (temporizador) clearTimeout(temporizador);
    temporizador = setTimeout(enviar, ESPERA_MS);
  });

  return () => {
    cancelarAssinatura();
    if (temporizador) {
      clearTimeout(temporizador);
      temporizador = null;
    }
  };
}
