'use client';

import { useQuery } from '@tanstack/react-query';
import {
  normalizarCosmeticosAutorais,
  registrarCosmeticosAutorais,
  type CosmeticoAutoralBruto,
} from '@aethertable/shared-types';
import { api } from '../lib/fetcher';

/**
 * useCatalogo.ts — trazer os cosméticos criados no backoffice para o cliente.
 *
 * ─── POR QUE ISTO NÃO É UM `useQuery` COMUM ────────────────────────────────
 *
 * O resto do app lê dados do react-query pelo valor que o hook devolve. Aqui o
 * dado precisa ir para OUTRO lugar: o registro em `shared-types`, que é global
 * ao processo. A razão é que quem consulta o catálogo não são componentes —
 * são funções síncronas chamadas de dentro do `<canvas>` (`acharSleeve`,
 * `acharPet`), de onde não há hook para chamar.
 *
 * Então o hook busca, registra, e devolve a versão. Quem precisa redesenhar
 * observa a VERSÃO mudar, não a lista.
 *
 * ─── NÃO HÁ NADA A FAZER SE FALHAR ─────────────────────────────────────────
 *
 * Sem a sincronização, o catálogo é o do bundle — que é o que o produto tinha
 * antes de existir cosmético autoral. Um erro na tela por causa disso seria
 * ruído sobre algo que o jogador não pode resolver, então a falha é silenciosa
 * e o react-query tenta de novo sozinho.
 */

interface Resposta {
  versao: number;
  itens: Array<{ familia: unknown; item: CosmeticoAutoralBruto }>;
}

/** A versão aplicada. Muda quando o catálogo muda, e só então. */
export function useCatalogoDeCosmeticos(): number {
  const { data } = useQuery({
    queryKey: ['cosmeticos', 'catalogo'],
    queryFn: async ({ signal }) => {
      const r = await api<Resposta>('/cosmeticos/catalogo', { signal });
      const itens = normalizarCosmeticosAutorais(
        (r.itens ?? []).map((i) => ({ ...i.item, familia: i.familia })),
      );
      registrarCosmeticosAutorais(itens);
      return r.versao ?? 0;
    },
    // Cinco minutos. O catálogo muda quando um administrador mexe nele, o que
    // acontece em escala de semanas — e uma aba aberta o dia todo não precisa
    // perguntar a cada foco de janela.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 2,
  });
  return data ?? 0;
}
