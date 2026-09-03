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

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '../lib/fetcher';

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

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
