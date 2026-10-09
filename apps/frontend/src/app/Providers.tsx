'use client';

/**
 * Providers.tsx — contexto de cliente que todas as telas compartilham.
 *
 * ─── POR QUE O REACT-QUERY ENTROU AGORA ────────────────────────────────────
 *
 * `@tanstack/react-query` era dependência do frontend desde o começo e não
 * estava importado em NENHUM arquivo. Sem ele, cada tela buscava com
 * `useEffect` + `fetch` + `useState`, e o efeito acumulado era a lentidão que
 * o usuário sentia como "o sistema demora para responder":
 *
 *  - voltar para a lista de grimórios refazia a lista inteira, sempre, mesmo
 *    tendo saído dela dois segundos antes;
 *  - abrir um deck refazia o deck inteiro (que no servidor custava dois
 *    round-trips à Scryfall — ver `decks.service.ts`);
 *  - cada `+1` numa carta disparava a mutação E um recarregamento completo do
 *    deck, em série: o número na tela só mudava depois das duas viagens.
 *
 * Com um cache, "Voltar" mostra dado na hora e revalida ao fundo; com mutação
 * otimista, o `+1` aparece no mesmo quadro do clique.
 *
 * `staleTime` de 30 s é o número que faz a navegação parecer instantânea sem
 * mostrar dado velho: dentro da janela, trocar de tela e voltar não gera
 * requisição nenhuma.
 */

import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '../lib/fetcher';
import { useAuthStore } from '../store/auth.store';

export function Providers({ children }: { children: React.ReactNode }) {
  // `useState` e não um módulo global: no App Router, um QueryClient de módulo
  // é compartilhado entre requisições no servidor e vaza dado de um usuário
  // para outro.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            // Refetch ao focar a aba é útil na mesa e ruído no deckbuilder:
            // voltar do navegador não deve piscar a tela inteira.
            refetchOnWindowFocus: false,
            retry: (tentativas, erro) => {
              // 4xx não melhora com repetição — e insistir num 429 é
              // exatamente o que estende o bloqueio. Só 5xx e falha de rede.
              if (erro instanceof ApiError && erro.status >= 400 && erro.status < 500) {
                return false;
              }
              return tentativas < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );

  useLimparCacheAoTrocarDeConta(client);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * ─── O CACHE ERA DA ABA, NÃO DA CONTA ──────────────────────────────────────
 *
 * As chaves não carregam o usuário (`['decks', 'lista']`, `['admin', 'eu']`),
 * e nem sair nem entrar tocava no `QueryClient`. Sair da conta A e entrar com
 * a B na mesma aba mostrava os grimórios de A — e, dentro dos 30 s de
 * `staleTime`, nem revalidava: a lista de outra pessoa ficava na tela como se
 * fosse a sua. Com `['admin', 'eu']`, a porta do backoffice de um admin
 * continuava aberta no menu de quem entrasse depois.
 *
 * Pôr o id do usuário em cada chave resolveria só as chaves lembradas; limpar
 * no ponto em que a identidade muda resolve todas, inclusive as que ainda vão
 * nascer. A comparação é pelo ID: trocar o nome de usuário no perfil regrava o
 * `user` do store e não pode esvaziar o cache de quem continua a mesma pessoa.
 *
 * Limpa quando uma conta SAI de cena — logout, 401, ou outra conta entrando por
 * cima (OAuth com sessão aberta). Entrar vindo de "ninguém" não limpa: a saída
 * já limpou, e o que se acumula sem sessão é público (provedores de login,
 * catálogo, busca de cartas). Limpar ali derrubava a query ativa da própria
 * tela de login, que refazia `GET /auth/provedores` e piscava os botões de
 * OAuth no meio do redirecionamento.
 */
function useLimparCacheAoTrocarDeConta(client: QueryClient): void {
  useEffect(() => {
    let anterior = useAuthStore.getState().user?.id ?? null;
    return useAuthStore.subscribe((estado) => {
      const atual = estado.user?.id ?? null;
      if (atual === anterior) return;
      const saiuUmaConta = anterior !== null;
      anterior = atual;
      if (saiuUmaConta) client.clear();
    });
  }, [client]);
}
