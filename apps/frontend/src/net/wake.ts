/**
 * Cold start dos serviços em plano gratuito.
 *
 * O PROBLEMA: Render, Koyeb e afins hibernam um serviço free após ~15 min sem
 * tráfego. A primeira requisição depois disso não falha rápido — ela FICA
 * PENDURADA por ~50 s enquanto o container sobe. Um `fetch` comum nesse estado
 * parece travamento: o usuário clica em "Entrar", nada acontece, ele clica de
 * novo, e agora há duas requisições pendentes.
 *
 * Isso NÃO afeta partida em andamento: o patch de 20 Hz do Colyseus mantém o
 * serviço acordado enquanto alguém está jogando. O custo é só na primeira
 * conexão.
 *
 * A SOLUÇÃO aqui é honesta, não mágica: não dá para eliminar a espera, só para
 * torná-la legível. Avisamos a UI de que o serviço está acordando e tentamos de
 * novo com backoff, em vez de deixar o usuário no escuro.
 *
 * Ao migrar para um plano pago sem hibernação, este módulo vira inofensivo: a
 * primeira tentativa responde e nenhum callback de "acordando" dispara.
 */

import { API_URL } from '@/lib/api';

export type EstadoAcordar = 'conectando' | 'acordando' | 'pronto' | 'falhou';

/** Tempo após o qual assumimos que o serviço está hibernando, não lento. */
const LIMITE_PARA_SUSPEITAR_MS = 3_000;

/** Teto total de espera. Cold start do Render fica em ~50 s; 90 s dá folga. */
const TETO_TOTAL_MS = 90_000;

const ESPERA_ENTRE_TENTATIVAS_MS = 3_000;

/**
 * Garante que a API está de pé antes de mandar a requisição que importa.
 *
 * @param onEstado chamado a cada mudança — use para trocar o texto do botão.
 * @returns true se o serviço respondeu dentro do teto.
 */
export async function acordarApi(onEstado?: (estado: EstadoAcordar) => void): Promise<boolean> {
  const inicio = Date.now();
  let avisouQueEstaAcordando = false;

  onEstado?.('conectando');

  while (Date.now() - inicio < TETO_TOTAL_MS) {
    // Se a primeira tentativa já demorou, é hibernação — avisa a UI.
    if (!avisouQueEstaAcordando && Date.now() - inicio > LIMITE_PARA_SUSPEITAR_MS) {
      avisouQueEstaAcordando = true;
      onEstado?.('acordando');
    }

    try {
      const resposta = await fetch(`${API_URL}/health`, {
        method: 'GET',
        cache: 'no-store',
      });

      if (resposta.ok) {
        onEstado?.('pronto');
        return true;
      }
    } catch {
      // Rede indisponível ou serviço ainda subindo: é o caso esperado aqui,
      // não um erro a propagar.
    }

    if (!avisouQueEstaAcordando) {
      avisouQueEstaAcordando = true;
      onEstado?.('acordando');
    }

    await new Promise((r) => setTimeout(r, ESPERA_ENTRE_TENTATIVAS_MS));
  }

  onEstado?.('falhou');
  return false;
}

/** Texto pronto para a UI, por estado. */
export const MENSAGEM_POR_ESTADO: Record<EstadoAcordar, string> = {
  conectando: 'Conectando...',
  acordando: 'Acordando o servidor — isso leva até 1 minuto na primeira vez...',
  pronto: 'Conectado',
  falhou: 'O servidor não respondeu. Tente novamente em instantes.',
};
