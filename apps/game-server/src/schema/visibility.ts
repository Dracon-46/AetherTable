/**
 * UNICO ponto de decisao de visibilidade de identidade de carta.
 *
 * Este e o trecho de codigo mais critico do sistema inteiro. Esta extraido do
 * decorador de proposito, para ser testado isoladamente.
 *
 * Fonte canonica: docs/especificacao_do_motor_sandbox.md §3.0.1 e §4.1.
 * Requisitos: RN02, RN13, FR-06, ADR-004.
 */

import { HIDDEN_ZONES, PUBLIC_ZONES, type Zone } from '@aethertable/shared-types';

/** O minimo que `podeVer` precisa saber. Mantem a funcao testavel sem o Schema. */
export interface VisibilityInput {
  zone: string;
  ownerId: string;
  controllerId: string;
  faceDown: boolean;
  /** 'ALL' | 'sid1,sid2' */
  revealedTo: string;
  /** 'sid1,sid2' */
  peekedBy: string;
}

/**
 * A ORDEM DAS CLAUSULAS IMPORTA. Revelacao e olhada vem ANTES da checagem de
 * zona, porque sao exatamente os casos em que a zona diz "oculto" e a concessao
 * explicita diz "este jogador pode". Inverter tornaria INTENT_PEEK e
 * INTENT_REVEAL inoperantes em zona oculta — ou seja, em todos os casos que
 * importam.
 */
export function podeVer(card: VisibilityInput, sid: string): boolean {
  // 1. Revelacao explicita vence tudo (RN13) — inclusive zona oculta.
  if (card.revealedTo === 'ALL') return true;
  if (card.revealedTo && contem(card.revealedTo, sid)) return true;

  // 2. Olhada explicita e ainda ativa (RN13).
  if (card.peekedBy && contem(card.peekedBy, sid)) return true;

  // 3. Face para baixo: a zona e publica, a identidade nao.
  //    Vale para BATTLEFIELD (morph) e EXILE (foretell / plot).
  if (card.faceDown) return sid === card.controllerId;

  // 4. Zonas publicas com a face para cima: todos veem.
  if (PUBLIC_ZONES.has(card.zone as Zone)) return true;

  // 5. Mao e reserva: so o dono.
  if (card.zone === 'HAND' || card.zone === 'SIDEBOARD') return sid === card.ownerId;

  // 6. Grimorio: NINGUEM — nem o dono. Chegar aqui so acontece sem revelacao
  //    nem olhada, tratadas em 1 e 2.
  if (card.zone === 'LIBRARY') return false;

  // 7. Zona desconhecida: NEGA por padrao. Falha fechada, nunca aberta.
  //
  //    Esta e a clausula mais importante para seguranca. Se alguem adicionar uma
  //    zona nova e esquecer de trata-la aqui, o efeito e a carta ficar invisivel
  //    — um bug visivel e inofensivo. O oposto (liberar por padrao) seria um
  //    vazamento silencioso.
  return false;
}

/**
 * Busca de sessionId em lista separada por virgula, com verificacao de
 * fronteira.
 *
 * Existe para evitar falso positivo por substring: um `indexOf` cru faria o
 * sessionId `abc` casar dentro de `xabcy`. A verificacao de fronteira resolve
 * isso SEM alocar array — relevante porque esta funcao roda dezenas de milhares
 * de vezes por segundo.
 *
 * Percorre todas as ocorrencias: `sid` pode aparecer primeiro como substring de
 * outro id e so depois como entrada real.
 */
export function contem(lista: string, sid: string): boolean {
  if (!lista || !sid) return false;

  const VIRGULA = 44;
  let i = lista.indexOf(sid);

  while (i !== -1) {
    const antes = i === 0 || lista.charCodeAt(i - 1) === VIRGULA;
    const fim = i + sid.length;
    const depois = fim === lista.length || lista.charCodeAt(fim) === VIRGULA;
    if (antes && depois) return true;
    i = lista.indexOf(sid, i + 1);
  }

  return false;
}

/** Adiciona um sessionId a uma lista separada por virgula, sem duplicar. */
export function concede(lista: string, sid: string): string {
  if (contem(lista, sid)) return lista;
  return lista ? `${lista},${sid}` : sid;
}

/** Remove um sessionId de uma lista separada por virgula. */
export function revoga(lista: string, sid: string): string {
  if (!contem(lista, sid)) return lista;
  return lista
    .split(',')
    .filter((entrada) => entrada !== sid)
    .join(',');
}

/** A zona esconde a identidade da carta por padrao? */
export function zonaEOculta(zone: string): boolean {
  return HIDDEN_ZONES.has(zone as Zone);
}
