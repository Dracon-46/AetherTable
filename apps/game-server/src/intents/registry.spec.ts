/**
 * registry.spec.ts — a lacuna entre o que o CLIENTE pede e o que o SERVIDOR
 * entende precisa ser visível em teste, não em produção.
 *
 * Contexto: o frontend expunha 35 emissores de intenção enquanto o REGISTRY
 * implementava 20. Colyseus descarta mensagem sem handler EM SILÊNCIO — o
 * botão era clicado, a mensagem saía e nada acontecia. Não havia erro, log nem
 * teste que revelasse isso; só um jogador reclamando que "não funciona".
 */

import { REGISTRY, INTENCOES_PENDENTES } from './registry';
import type { IntentType } from '@aethertable/shared-types';

/**
 * Ações marcadas M (must) ou S (should) para MVP/V1 no catálogo DOC-036.
 * Esta lista é a fonte da verdade do teste: acrescentar uma entrada aqui
 * quebra o build até o handler existir.
 */
const OBRIGATORIAS: IntentType[] = [
  // movimento
  'INTENT_GRAB',
  'INTENT_MOVE_CARD',
  'INTENT_RELEASE',
  'INTENT_BRING_TO_FRONT',
  // zona e grimório
  'INTENT_CHANGE_ZONE',
  'INTENT_DRAW',
  'INTENT_MILL',
  'INTENT_MOVE_TOP_TO_BOTTOM',
  'INTENT_SHUFFLE',
  'INTENT_MULLIGAN',
  'INTENT_RETURN_ZONE',
  'INTENT_REORDER',
  // visibilidade
  'INTENT_PEEK',
  'INTENT_CLOSE_PEEK',
  'INTENT_SCRY',
  'INTENT_SCRY_COMMIT',
  'INTENT_SURVEIL',
  'INTENT_SURVEIL_COMMIT',
  'INTENT_SEARCH_ZONE',
  'INTENT_REVEAL',
  'INTENT_REVEAL_ZONE',
  'INTENT_REVEAL_TOP',
  'INTENT_UNREVEAL',
  // propriedades de carta
  'INTENT_TAP',
  'INTENT_TAP_ALL',
  'INTENT_UNTAP_ALL',
  'INTENT_UPDATE_PROPERTY',
  'INTENT_TRANSFORM',
  'INTENT_ATTACH',
  'INTENT_DETACH',
  'INTENT_SET_PT',
  'INTENT_SET_DAMAGE',
  'INTENT_CLEAR_DAMAGE',
  'INTENT_SET_NOTE',
  'INTENT_SET_HIGHLIGHT',
  'INTENT_SET_CONTROLLER',
  'INTENT_BATCH_UPDATE',
  'INTENT_SET_COMMANDER',
  // contadores
  'INTENT_ADD_COUNTER',
  'INTENT_SET_COUNTER',
  'INTENT_CLEAR_COUNTERS',
  'INTENT_ADD_PLAYER_COUNTER',
  'INTENT_BATCH_COUNTER',
  // jogador
  'INTENT_SET_LIFE',
  'INTENT_SET_COMMANDER_DAMAGE',
  'INTENT_SET_PLAYER_COUNTER',
  'INTENT_TOGGLE_DESIGNATION',
  'INTENT_SET_COMMANDER_TAX',
  'INTENT_SET_RING',
  'INTENT_SET_DAY_NIGHT',
  'INTENT_SET_TURN_ORDER',
  'INTENT_CONCEDE',
  // objetos criados
  'INTENT_CREATE_TOKEN',
  'INTENT_COPY_CARD',
  'INTENT_DESTROY_TOKEN',
  'INTENT_CLEAR_TOKENS',
  // aleatoriedade
  'INTENT_ROLL_DICE',
  'INTENT_FLIP_COIN',
  'INTENT_RANDOM_PLAYER',
  'INTENT_RANDOM_CARD',
  'INTENT_DISCARD_RANDOM',
  'INTENT_DISCARD_ALL',
  // mesa e comunicação
  'INTENT_CHAT',
  'INTENT_PING',
  'INTENT_ARROW',
  'INTENT_CLEAR_ARROWS',
  'INTENT_SET_TURN',
  'INTENT_PASS_TURN',
  'INTENT_UNDO',
  // ciclo
  'INTENT_RESET_MATCH',
  'INTENT_CAST_COMMANDER',
  'INTENT_FETCH_FROM_SIDEBOARD',
];

describe('REGISTRY — paridade com o catálogo de ações (DOC-036)', () => {
  it('implementa toda ação obrigatória do catálogo', () => {
    const implementadas = new Set(Object.keys(REGISTRY));
    const faltando = OBRIGATORIAS.filter((i) => !implementadas.has(i));
    expect(faltando).toEqual([]);
  });

  it('declara schema, autorização e execução em toda entrada', () => {
    for (const [nome, handler] of Object.entries(REGISTRY)) {
      expect(handler.schema).toBeDefined();
      expect(typeof handler.executa).toBe('function');
      expect(['QUALQUER_JOGADOR', 'CONTROLLER', 'OWNER', 'OWNER_DA_ZONA']).toContain(
        handler.autoriza,
      );
      expect(nome.startsWith('INTENT_')).toBe(true);
    }
  });

  it('não deixa pendência sem motivo escrito', () => {
    for (const p of INTENCOES_PENDENTES) {
      expect(p.motivo.length).toBeGreaterThan(10);
      expect(Object.keys(REGISTRY)).not.toContain(p.intent);
    }
  });
});
