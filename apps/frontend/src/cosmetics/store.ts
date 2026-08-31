'use client';

/**
 * store.ts — cosméticos equipados e a preferência de acessibilidade.
 *
 * O equipamento vive em `localStorage` e é anunciado à sala por
 * `INTENT_SET_COSMETICS` assim que a partida começa. O banco já tem
 * `UserPreference.activeSleeveId` e companhia (DOC-030), e a persistência por
 * conta entra por ali — mas a mesa não pode depender de um round-trip de API
 * para saber com que sleeve desenhar as cartas.
 *
 * `cosmeticosDeOponentes` é requisito de acessibilidade, não de gosto
 * (DOC-060 §4): quem tem dificuldade de contraste precisa poder desligar o
 * playmat e o sleeve dos outros e ver o fundo neutro.
 */

import { create } from 'zustand';
import { COSMETICOS_PADRAO, type CosmeticosEquipados } from '@aethertable/shared-types';

const CHAVE = 'aether-cosmeticos-v1';

interface CosmeticState extends CosmeticosEquipados {
  /** false = todo oponente é desenhado com o visual padrão. */
  cosmeticosDeOponentes: boolean;
  equipar: (patch: Partial<CosmeticosEquipados>) => void;
  setCosmeticosDeOponentes: (v: boolean) => void;
}

function ler(): CosmeticosEquipados & { cosmeticosDeOponentes: boolean } {
  const base = { ...COSMETICOS_PADRAO, cosmeticosDeOponentes: true };
  if (typeof window === 'undefined') return base;
  try {
    const cru = window.localStorage.getItem(CHAVE);
    return cru ? { ...base, ...JSON.parse(cru) } : base;
  } catch {
    return base;
  }
}

function gravar(estado: CosmeticState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CHAVE,
      JSON.stringify({
        sleeveId: estado.sleeveId,
        playmatId: estado.playmatId,
        borderId: estado.borderId,
        titleId: estado.titleId,
        petId: estado.petId,
        cosmeticosDeOponentes: estado.cosmeticosDeOponentes,
      }),
    );
  } catch {
    /* cota cheia ou aba privada: vale só nesta sessão */
  }
}

export const useCosmeticos = create<CosmeticState>((set, get) => ({
  ...ler(),

  equipar: (patch) => {
    set(patch);
    gravar(get());
  },

  setCosmeticosDeOponentes: (cosmeticosDeOponentes) => {
    set({ cosmeticosDeOponentes });
    gravar(get());
  },
}));

/**
 * O que usar ao desenhar um jogador.
 *
 * Quando os cosméticos alheios estão desligados, o oponente é desenhado com o
 * padrão — e o jogador local continua vendo os SEUS, porque a preferência é
 * sobre o que os outros impõem à sua tela, não sobre o que ele escolheu.
 */
export function cosmeticosVisiveis(
  jogador:
    | {
        id: string;
        sleeveId?: string;
        playmatId?: string;
        profileBorder?: string;
        chatTitle?: string;
        petId?: string;
      }
    | undefined,
  souEu: boolean,
  permitirDeOponentes: boolean,
): CosmeticosEquipados {
  if (!jogador) return COSMETICOS_PADRAO;
  if (!souEu && !permitirDeOponentes) return COSMETICOS_PADRAO;
  return {
    sleeveId: jogador.sleeveId || COSMETICOS_PADRAO.sleeveId,
    playmatId: jogador.playmatId || COSMETICOS_PADRAO.playmatId,
    borderId: jogador.profileBorder || COSMETICOS_PADRAO.borderId,
    titleId: jogador.chatTitle || COSMETICOS_PADRAO.titleId,
    petId: jogador.petId || COSMETICOS_PADRAO.petId,
  };
}
