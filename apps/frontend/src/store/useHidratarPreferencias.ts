'use client';

/**
 * useHidratarPreferencias.ts — traz da CONTA tudo que vive em
 * `user_preferences`.
 *
 * ─── POR QUE ISTO PRECISA SER UM HOOK, E UM SÓ ─────────────────────────────
 *
 * Os stores de cosméticos e de atalhos leem o `localStorage` no momento em que
 * o módulo é avaliado — é o que faz a mesa abrir já desenhando o sleeve certo e
 * o teclado já respondendo à tecla remapeada, sem esperar rede. Só que o
 * `localStorage` é POR NAVEGADOR: entrar de outra máquina, ou depois de limpar
 * dados do site, começava do padrão.
 *
 * A conta é a fonte da verdade entre dispositivos. Mas ela chega por rede, e
 * uma leitura de rede não pode acontecer na avaliação de um módulo — daí o
 * hook, montado uma vez na casca autenticada.
 *
 * Este arquivo substitui o `useHidratarCosmeticos`, que fazia exatamente isto
 * para os cosméticos. Os atalhos moram na MESMA linha de `user_preferences` e
 * chegam no MESMO `GET /users/me`: dois hooks seriam duas requisições
 * idênticas, e a segunda existiria só porque o nome do primeiro tinha ficado
 * estreito.
 *
 * ─── A ORDEM IMPORTA, E O CONFLITO TEM UM VENCEDOR CLARO ───────────────────
 *
 * O cache local aplica primeiro (instantâneo), o servidor corrige depois. Se os
 * dois divergirem, o SERVIDOR vence — ele representa a última escolha
 * deliberada da pessoa, possivelmente feita em outro dispositivo. A exceção é
 * campo vazio no servidor ("nunca escolheu"), que não sobrescreve nada: aí o
 * local é a única informação que existe.
 *
 * Roda uma vez por sessão. Não é uma query que revalida: preferência muda por
 * ação explícita do dono, e ficar reconciliando por foco de aba faria a mesa
 * piscar de visual no meio de uma partida.
 */

import { useEffect, useRef } from 'react';
import { api } from '../lib/fetcher';
import { useAuthStore } from './auth.store';
import { useAtalhos } from './atalhos.store';
import { useCosmeticos } from '../cosmetics/store';
import { aplicarPreferenciasDaMesa, observarPreferenciasDaMesa } from './preferencias-da-conta';
import type { CosmeticTier } from '@aethertable/shared-types';

interface PreferenciaDaConta {
  /**
   * Direito a cosmético de apoiador.
   *
   * Vem no MESMO `GET /users/me` das preferências, pela mesma razão de os
   * atalhos virem: uma requisição a mais só para saber um enum seria uma
   * requisição a mais no caminho de entrada da Taverna.
   *
   * O cliente usa isto só para DESABILITAR o que a conta não pode equipar e
   * dizer por quê. Quem recusa de verdade é o servidor
   * (`exigirDireitoAosCosmeticos`) — este campo é conveniência de interface,
   * não trava de segurança.
   */
  supporterTier?: CosmeticTier | null;
  preference?: {
    sleeveId?: string | null;
    playmatId?: string | null;
    borderId?: string | null;
    titleId?: string | null;
    petId?: string | null;
    cosmeticosDeOponentes?: boolean | null;
    keybindings?: Record<string, string> | null;
    /**
     * As preferências da MESA (tamanho da carta, grade, painel de vida…).
     *
     * Chega como JSON solto de propósito: a coluna é JSONB e uma versão
     * anterior do cliente pode ter gravado um conjunto diferente de chaves.
     * `normalizarPreferenciasDeMesa` é quem dá forma a isso.
     */
    preferenciasDeMesa?: unknown;
  } | null;
}

export function useHidratarPreferencias(): void {
  const token = useAuthStore((s) => s.accessToken);
  const aplicarCosmeticos = useCosmeticos((s) => s.aplicarDoServidor);
  const aplicarAtalhos = useAtalhos((s) => s.aplicarDoServidor);
  const definirTier = useCosmeticos((s) => s.definirTier);
  /**
   * Guarda de execução única.
   *
   * `token` entra nas dependências porque a reidratação do zustand o preenche
   * DEPOIS do primeiro render — sem ele, o efeito rodaria com `null` e
   * desistiria para sempre. Mas com ele, um `logout`/`login` na mesma sessão
   * dispararia de novo, e um re-render qualquer que trocasse a referência do
   * token faria uma requisição a mais. O ref fecha isso.
   */
  const jaBuscou = useRef(false);
  /** Cancela a assinatura das preferências de mesa. Ver o efeito abaixo. */
  const pararDeObservar = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!token || jaBuscou.current) return;
    jaBuscou.current = true;

    let ativo = true;
    void api<PreferenciaDaConta>('/users/me')
      .then((eu) => {
        if (!ativo) return;
        // O tier chega mesmo quando `preference` é nula: uma conta que nunca
        // mexeu em cosmético nenhum ainda pode ser apoiadora.
        definirTier(eu?.supporterTier ?? 'FREE');
        if (!eu?.preference) return;
        const p = eu.preference;
        aplicarCosmeticos({
          ...(p.sleeveId ? { sleeveId: p.sleeveId } : {}),
          ...(p.playmatId ? { playmatId: p.playmatId } : {}),
          ...(p.borderId ? { borderId: p.borderId } : {}),
          ...(p.titleId ? { titleId: p.titleId } : {}),
          ...(p.petId ? { petId: p.petId } : {}),
          ...(typeof p.cosmeticosDeOponentes === 'boolean'
            ? { cosmeticosDeOponentes: p.cosmeticosDeOponentes }
            : {}),
        });
        aplicarAtalhos(p.keybindings);
        aplicarPreferenciasDaMesa(p.preferenciasDeMesa);
        /**
         * Observar só DEPOIS de aplicar.
         *
         * Ligar a assinatura antes faria o próprio `aplicar` agendar um PATCH
         * de volta — e, se a resposta demorasse, o estado local (ainda o
         * padrão) seria gravado por cima do que a conta guardava.
         */
        pararDeObservar.current = observarPreferenciasDaMesa();
      })
      .catch((erro) => {
        /**
         * Falhar aqui é inofensivo, e por isso não vira toast.
         *
         * O jogador segue com o que o `localStorage` tem — o visual e o teclado
         * que ele já estava usando neste navegador. Um aviso de erro sobre
         * cosmético na entrada da taverna seria ruído sobre algo que não impede
         * nada. A próxima sessão tenta de novo.
         */
        console.warn('[preferencias] não foi possível hidratar da conta:', erro);
        jaBuscou.current = false;
        /**
         * Sem resposta do servidor NÃO se observa.
         *
         * O que este navegador tem pode ser o padrão de fábrica só porque a
         * hidratação falhou; começar a enviar daqui apagaria na conta a
         * configuração real da pessoa por causa de uma queda de rede.
         */
      });

    return () => {
      ativo = false;
      pararDeObservar.current?.();
      pararDeObservar.current = null;
    };
  }, [token, aplicarCosmeticos, aplicarAtalhos, definirTier]);
}
