'use client';

/**
 * store.ts — cosméticos equipados e a preferência de acessibilidade.
 *
 * ─── OS COSMÉTICOS NÃO ERAM SALVOS, E O MOTIVO ERA ESTRUTURAL ──────────────
 *
 * O equipamento vivia SÓ em `localStorage`. Trocar de navegador, limpar dados
 * do site ou entrar de outra máquina perdia a escolha inteira — foi o relato
 * "os cosméticos não estão sendo salvos".
 *
 * O cabeçalho anterior deste arquivo dizia que a persistência por conta
 * "entra por" `UserPreference.activeSleeveId`. Não entrava, e não era
 * desleixo: aquelas colunas são `Uuid` com foreign key para `cosmetic_items`,
 * enquanto os cosméticos que o jogo desenha vêm do catálogo PROCEDURAL em
 * código e têm id de texto (`aether-classic`). Uma string dessas não cabe num
 * Uuid — ninguém poderia ter escrito ali.
 *
 * Agora há colunas de texto próprias (`user_preferences.sleeve_id` e
 * companhia), e o fluxo é: o servidor é a fonte da verdade entre dispositivos,
 * o `localStorage` continua sendo o CACHE que faz a mesa abrir sem piscar. A
 * mesa não pode esperar um round-trip para saber com que sleeve desenhar as
 * cartas, então ela lê o cache; a hidratação do servidor corrige em seguida se
 * houver divergência.
 *
 * A gravação é OTIMISTA e silenciosa: equipar aplica na hora, e o PATCH sai
 * atrás. Falha de rede não desfaz a escolha na tela — o `localStorage` já a
 * guardou, e a próxima hidratação bem-sucedida reconcilia.
 *
 * `cosmeticosDeOponentes` é requisito de acessibilidade, não de gosto
 * (DOC-060 §4): quem tem dificuldade de contraste precisa poder desligar o
 * playmat e o sleeve dos outros e ver o fundo neutro.
 */

import { create } from 'zustand';
import {
  COSMETICOS_PADRAO,
  type CosmeticosEquipados,
  type CosmeticTier,
} from '@aethertable/shared-types';
import { api } from '../lib/fetcher';

const CHAVE = 'aether-cosmeticos-v1';

interface CosmeticState extends CosmeticosEquipados {
  /** false = todo oponente é desenhado com o visual padrão. */
  cosmeticosDeOponentes: boolean;
  /**
   * Direito a cosmético de apoiador, vindo do `GET /users/me`.
   *
   * NÃO É PERSISTIDO no `localStorage`, e a ausência é deliberada: os
   * cosméticos equipados são cacheados localmente porque a mesa não pode
   * esperar um round-trip para saber com que sleeve desenhar. Um DIREITO
   * cacheado é outra coisa — ele viraria um valor que o usuário edita no
   * devtools para destravar a interface. Ele nasce `FREE` a cada carga e o
   * servidor diz o resto.
   *
   * De qualquer forma isto governa só a TELA: quem recusa é
   * `exigirDireitoAosCosmeticos`, no backend.
   */
  tier: CosmeticTier;
  definirTier: (tier: CosmeticTier) => void;
  equipar: (patch: Partial<CosmeticosEquipados>) => void;
  setCosmeticosDeOponentes: (v: boolean) => void;
  /** Aplica o que vem do servidor, sem reenviar. Ver `useHidratarPreferencias`. */
  aplicarDoServidor: (p: Partial<CosmeticosEquipados & { cosmeticosDeOponentes: boolean }>) => void;
}

/**
 * Envia o patch ao servidor, e engole a falha.
 *
 * Um erro aqui NÃO pode desfazer a escolha na tela: o `localStorage` já
 * guardou, a mesa já está desenhando, e transformar uma queda de rede em
 * "o cosmético voltou sozinho" é pior do que ficar dessincronizado até a
 * próxima hidratação. O `console.warn` deixa rastro para quem investigar.
 */
function salvarNaConta(patch: Record<string, unknown>): void {
  void api('/users/me', { method: 'PATCH', body: patch }).catch((erro) => {
    console.warn('[cosmeticos] não foi possível salvar na conta:', erro);
  });
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
  // Nasce FREE: o servidor corrige em `useHidratarPreferencias`. Errar para o
  // lado restritivo evita a interface prometer o que a API vai recusar.
  tier: 'FREE',

  definirTier: (tier) => set({ tier }),

  equipar: (patch) => {
    set(patch);
    gravar(get());
    salvarNaConta(patch);
  },

  setCosmeticosDeOponentes: (cosmeticosDeOponentes) => {
    set({ cosmeticosDeOponentes });
    gravar(get());
    salvarNaConta({ cosmeticosDeOponentes });
  },

  aplicarDoServidor: (p) => {
    // Só os campos que o servidor de fato tem. Um `null` lá significa "nunca
    // escolheu", e sobrescrever a escolha local com o padrão nesse caso
    // apagaria o que o jogador acabou de equipar em outra aba.
    const limpo = Object.fromEntries(
      Object.entries(p).filter(([, v]) => v !== null && v !== undefined),
    );
    if (Object.keys(limpo).length === 0) return;
    set(limpo as Partial<CosmeticState>);
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
