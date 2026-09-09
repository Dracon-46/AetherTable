'use client';

/**
 * useSalasPublicas.ts — a vitrine de mesas abertas.
 *
 * ─── POR QUE ESTA CHAMADA NÃO PASSA PELO `fetcher.ts` ──────────────────────
 *
 * O `api()` de `lib/fetcher.ts` fala com a API Core (`API_URL`) e anexa o
 * token de sessão. Esta lista vem do GAME SERVER, que é outro processo, em
 * outra porta, e a rota é pública de propósito — ela é uma vitrine, e o que
 * mostra de cada sala é o que o criador escolheu publicar ao marcá-la como
 * pública. Mandar o token da conta para um host diferente por descuido de
 * reaproveitamento seria vazá-lo sem nenhum ganho.
 *
 * O que ela reaproveita é o react-query: cache compartilhado, revalidação em
 * foco e estado de carregamento sem `useEffect` + `useState` escritos à mão em
 * cada tela.
 *
 * ─── LISTA AUSENTE NÃO É ERRO DE TELA ──────────────────────────────────────
 *
 * O game-server pode estar em manutenção enquanto a API Core segue de pé. Nesse
 * caso a Taverna continua oferecendo criar mesa e entrar por código — os dois
 * caminhos que sempre funcionaram — e a vitrine mostra o motivo no lugar da
 * lista, em vez de derrubar a página inteira.
 */

import { useQuery } from '@tanstack/react-query';
import type { SalaPublica } from '@aethertable/shared-types';
import { GAME_HTTP_URL } from '../lib/api';

/**
 * A vitrine envelhece rápido: alguém entra na mesa e a ocupação muda sem que
 * nada avise este cliente. Doze segundos é o intervalo em que a lista ainda
 * está honesta o bastante para o botão "Entrar" não levar a um ROOM_FULL na
 * maioria das vezes, sem transformar a Taverna aberta numa aba que consulta o
 * game server cinco vezes por minuto por pessoa.
 */
const INTERVALO_MS = 12_000;

async function buscarSalas(sinal: AbortSignal): Promise<SalaPublica[]> {
  const res = await fetch(`${GAME_HTTP_URL}/salas`, { signal: sinal });
  if (!res.ok) throw new Error('lista indisponível');
  const corpo = (await res.json()) as { salas?: SalaPublica[] };
  return Array.isArray(corpo.salas) ? corpo.salas : [];
}

export function useSalasPublicas() {
  return useQuery({
    queryKey: ['salas-publicas'],
    queryFn: ({ signal }) => buscarSalas(signal),
    refetchInterval: INTERVALO_MS,
    // Sem isto, voltar para a aba depois de meia hora mostra a lista velha por
    // um instante antes de atualizar — e nesse instante os botões mentem.
    refetchOnWindowFocus: true,
    /**
     * UMA tentativa a mais, e só.
     *
     * O padrão do react-query são três, com espera crescente. Numa lista que já
     * se atualiza sozinha a cada doze segundos, insistir só atrasa a mensagem
     * de "indisponível" — a próxima rodada tentaria de novo de qualquer jeito.
     */
    retry: 1,
  });
}

/** O que fazer com uma sala, do ponto de vista de quem olha a lista. */
export type AcaoDaSala = 'ENTRAR' | 'ASSISTIR' | 'NA_SALA';

/**
 * Decide o botão de uma linha da vitrine.
 *
 * ─── SALA CHEIA NÃO SOME DA LISTA ──────────────────────────────────────────
 *
 * O reflexo é filtrar a mesa lotada — ela não aceita mais ninguém, então para
 * que mostrá-la? Porque uma vitrine com poucas mesas abertas e nenhuma cheia
 * parece uma plataforma vazia, enquanto a mesma vitrine mostrando três partidas
 * em andamento parece uma plataforma viva. A mesa cheia vira conteúdo
 * assistível em vez de desaparecer.
 *
 * Isso só se sustenta se "Assistir" fizer alguma coisa — ver o comentário do
 * botão no painel.
 */
export function acaoDaSala(sala: SalaPublica, meuRoomCode?: string | null): AcaoDaSala {
  if (meuRoomCode && sala.roomCode === meuRoomCode) return 'NA_SALA';
  if (sala.cheia || sala.emPartida) return 'ASSISTIR';
  return 'ENTRAR';
}

/** Filtros da vitrine. Vazio em qualquer campo significa "tanto faz". */
export interface FiltrosDeSala {
  busca: string;
  gameType: string;
  comunicacao: string;
  idioma: string;
}

export const FILTROS_VAZIOS: FiltrosDeSala = {
  busca: '',
  gameType: '',
  comunicacao: '',
  idioma: '',
};

/**
 * Aplica busca e filtros. Função pura e exportada para poder ser testada sem
 * montar a tela — a mesma razão de `normalizarConfigDeSala` viver no contrato.
 */
export function filtrarSalas(salas: SalaPublica[], filtros: FiltrosDeSala): SalaPublica[] {
  // A busca ignora caixa e acento: quem procura "comandaria" tem de achar
  // "Comandaria de sexta", senão o campo só serve para quem digita exatamente
  // como o anfitrião digitou.
  const alvo = normalizarBusca(filtros.busca);

  return salas.filter((sala) => {
    if (alvo && !normalizarBusca(sala.nome).includes(alvo)) return false;
    if (filtros.gameType && sala.gameType !== filtros.gameType) return false;
    if (filtros.comunicacao && sala.comunicacao !== filtros.comunicacao) return false;
    if (filtros.idioma && sala.idioma !== filtros.idioma) return false;
    return true;
  });
}

/** Minúsculas e sem diacrítico, para a busca não exigir acentuação exata. */
function normalizarBusca(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
