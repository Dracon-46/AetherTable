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
    `${nome} moveu {Carta} de ${de} para ${para}`,
    scryfallId || undefined,
  );
}

/** Variante obrigatoria quando origem OU destino e zona oculta. */
export function logTrocaZonaOculta(actorId: string, nome: string, para: string): LogEvent {
  return criarLog('ZONE_CHANGE_HIDDEN', actorId, `${nome} moveu uma carta para ${para}`);
}

export function logEmbaralhar(actorId: string, nome: string): LogEvent {
  return criarLog('SHUFFLE', actorId, `${nome} embaralhou o grimorio`);
}

/** Publica CONTAGEM, nunca identidade. */
export function logOlhada(actorId: string, nome: string, amount: number): LogEvent {
  return criarLog('PEEK', actorId, `${nome} olhou as ${amount} do topo do grimorio`);
}

export function logBusca(actorId: string, nome: string, zona: string): LogEvent {
  return criarLog('SEARCH', actorId, `${nome} esta procurando em ${zona}`);
}

export function logMoer(actorId: string, nome: string, amount: number): LogEvent {
  return criarLog('MILL', actorId, `${nome} moveu ${amount} cartas do grimorio para o cemiterio`);
}

export function logVida(actorId: string, nome: string, antes: number, depois: number): LogEvent {
  return criarLog('LIFE', actorId, `${nome}: vida ${antes} -> ${depois}`);
}

export function logDado(actorId: string, nome: string, sides: number, resultado: number): LogEvent {
  return criarLog('DICE', actorId, `${nome} rolou D${sides} e tirou ${resultado}`);
}

export function logSistema(actorId: string, texto: string): LogEvent {
  return criarLog('SYSTEM', actorId, texto);
}
