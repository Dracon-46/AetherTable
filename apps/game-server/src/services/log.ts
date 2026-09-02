/**
 * Construcao das mensagens de log da mesa.
 *
 * TODAS neutras (RN09): o log conta QUE algo aconteceu sem revelar informacao
 * oculta. Os oponentes sempre sabem que houve uma olhada, sem saber o que foi
 * visto — isso torna o historico da partida uma auditoria completa de acesso.
 *
 * Fonte canonica: docs/especificacao_websocket_e_eventos.md §4.3.
 *
 * REGRA DE OURO: acao em zona oculta usa a variante neutra. Se voce esta
 * escrevendo o nome de uma carta numa mensagem, pergunte de qual zona ela veio.
 */

import { randomUUID } from 'node:crypto';
import { NEUTRAL_LOG_TYPES, type LogEvent, type LogType } from '@aethertable/shared-types';

/**
 * Nome da zona como o JOGADOR a chama.
 *
 * O log imprimia o enum cru: "moveu uma carta para GRAVEYARD", "esta
 * procurando em LIBRARY". O enum e o nome que o CODIGO usa — na mesa, ninguem
 * chama o cemiterio de GRAVEYARD, e quem nao le ingles simplesmente nao
 * entende a linha.
 *
 * Um id desconhecido cai nele mesmo em vez de virar "undefined": zona nova
 * aparecendo crua no log e feio, mas some do historico e bem pior.
 */
const NOME_DA_ZONA: Record<string, string> = {
  LIBRARY: 'o grimório',
  HAND: 'a mão',
  BATTLEFIELD: 'o campo de batalha',
  GRAVEYARD: 'o cemitério',
  EXILE: 'o exílio',
  COMMAND: 'a zona de comando',
  SIDEBOARD: 'a reserva',
};

export function nomeDaZona(zona: string): string {
  return NOME_DA_ZONA[zona] ?? zona;
}

export function criarLog(
  type: LogType,
  actorId: string,
  text: string,
  /** So para acao PUBLICA. Ver a guarda logo abaixo. */
  scryfallId?: string,
): LogEvent {
  // A invariante mais importante deste arquivo: tipo neutro NUNCA carrega
  // identidade. Falhar aqui, em desenvolvimento, e barato; descobrir em
  // producao significa que o log vazou o conteudo de uma zona oculta.
  if (scryfallId && NEUTRAL_LOG_TYPES.has(type)) {
    throw new Error(
      `Log de tipo neutro "${type}" recebeu scryfallId. Use a variante publica ou remova o id.`,
    );
  }

  if (process.env.NODE_ENV !== 'production' && NEUTRAL_LOG_TYPES.has(type)) {
    // Guarda de desenvolvimento: tipos neutros nao devem carregar identidade de
    // carta. Nao da para detectar isso com certeza, mas um nome entre chaves e
    // um sinal forte de que a variante errada foi usada.
    if (/\{Carta\}|scryfall/i.test(text)) {
      throw new Error(`Log de tipo neutro "${type}" tentou incluir identidade de carta: ${text}`);
    }
  }

  return {
    id: randomUUID(),
    timestamp: Date.now(),
    type,
    actorId,
    text,
    ...(scryfallId ? { scryfallId } : {}),
  };
}

/** "{Jogador} comprou {N} carta(s)" — nunca revela o que foi comprado. */
export function logCompra(actorId: string, nome: string, amount: number): LogEvent {
  return criarLog('DRAW', actorId, `${nome} comprou ${amount} carta(s)`);
}

/**
 * Zona -> zona quando AMBAS sao publicas: pode nomear a carta.
 *
 * O `{Carta}` e um marcador — o servidor nao conhece nomes, so ids. Quem
 * resolve e o cliente, com o catalogo da Scryfall.
 */
export function logTrocaZonaPublica(
  actorId: string,
  nome: string,
  scryfallId: string | undefined,
  de: string,
  para: string,
): LogEvent {
  return criarLog(
    'ZONE_CHANGE',
    actorId,
    `${nome} moveu {Carta} de ${nomeDaZona(de)} para ${nomeDaZona(para)}`,
    scryfallId || undefined,
  );
}

/** Variante obrigatoria quando origem OU destino e zona oculta. */
export function logTrocaZonaOculta(actorId: string, nome: string, para: string): LogEvent {
  return criarLog(
    'ZONE_CHANGE_HIDDEN',
    actorId,
    `${nome} moveu uma carta para ${nomeDaZona(para)}`,
  );
}

export function logEmbaralhar(actorId: string, nome: string): LogEvent {
  return criarLog('SHUFFLE', actorId, `${nome} embaralhou o grimório`);
}

/** Publica CONTAGEM, nunca identidade. */
export function logOlhada(actorId: string, nome: string, amount: number): LogEvent {
  return criarLog('PEEK', actorId, `${nome} olhou as ${amount} do topo do grimório`);
}

export function logBusca(actorId: string, nome: string, zona: string): LogEvent {
  return criarLog('SEARCH', actorId, `${nome} está procurando em ${nomeDaZona(zona)}`);
}

export function logMoer(actorId: string, nome: string, amount: number): LogEvent {
  return criarLog('MILL', actorId, `${nome} moveu ${amount} cartas do grimório para o cemitério`);
}

export function logVida(actorId: string, nome: string, antes: number, depois: number): LogEvent {
  return criarLog('LIFE', actorId, `${nome}: vida ${antes} → ${depois}`);
}

export function logDado(actorId: string, nome: string, sides: number, resultado: number): LogEvent {
  return criarLog('DICE', actorId, `${nome} rolou D${sides} e tirou ${resultado}`);
}

export function logSistema(actorId: string, texto: string): LogEvent {
  return criarLog('SYSTEM', actorId, texto);
}
