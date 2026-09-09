/**
 * direito.spec.ts — quem pode equipar o quê.
 *
 * ─── O CADEADO ERA DECORATIVO ────────────────────────────────────────────────
 *
 * O catálogo marca itens como `APOIADOR` desde sempre, e a marca não valia
 * nada em lugar nenhum: o `<button>` do `CosmeticPicker` desenhava um ícone de
 * cadeado e não recebia `disabled`; o DTO do backend validava só que o id
 * EXISTE no catálogo (`ehSleeveValido`), nunca o tier; e `updateUser` gravava
 * o que chegasse. Qualquer conta equipava qualquer coisa, e um PATCH direto
 * contornava até a interface.
 *
 * `podeEquipar` é a regra num lugar só, chamada pelas duas pontas. Estes
 * testes existem porque uma segunda implementação divergiria no primeiro item
 * novo do catálogo — e a divergência apareceria como um item que a tela deixa
 * clicar e a API recusa.
 */

import {
  CHAT_TITLES,
  PETS,
  PLAYMATS,
  PROFILE_BORDERS,
  SLEEVES,
  COSMETICOS_PADRAO,
  podeEquipar,
  tierDoCosmetico,
  type FamiliaDeCosmetico,
} from '@aethertable/shared-types';

/** As cinco famílias, com o catálogo de cada uma. */
const FAMILIAS: Array<{ familia: FamiliaDeCosmetico; itens: readonly { id: string }[] }> = [
  { familia: 'sleeveId', itens: SLEEVES },
  { familia: 'playmatId', itens: PLAYMATS },
  { familia: 'borderId', itens: PROFILE_BORDERS },
  { familia: 'titleId', itens: CHAT_TITLES },
  { familia: 'petId', itens: PETS },
];

describe('tierDoCosmetico', () => {
  it('resolve o tier de cada item do catálogo, em todas as famílias', () => {
    for (const { familia, itens } of FAMILIAS) {
      for (const item of itens) {
        expect(['FREE', 'APOIADOR']).toContain(tierDoCosmetico(familia, item.id));
      }
    }
  });

  it('id desconhecido vale como FREE', () => {
    // Mesmo motivo dos resolvedores do catálogo: um id que não existe cai no
    // padrão, e o padrão é sempre gratuito. Devolver APOIADOR aqui trancaria
    // o jogador fora de um item que ele nem tem.
    expect(tierDoCosmetico('sleeveId', 'nao-existe')).toBe('FREE');
    expect(tierDoCosmetico('petId', '')).toBe('FREE');
  });
});

describe('podeEquipar', () => {
  it('APOIADOR equipa tudo que existe no catálogo', () => {
    for (const { familia, itens } of FAMILIAS) {
      for (const item of itens) {
        expect(podeEquipar('APOIADOR', familia, item.id)).toBe(true);
      }
    }
  });

  it('FREE equipa exatamente os itens FREE, e nenhum de apoiador', () => {
    for (const { familia, itens } of FAMILIAS) {
      for (const item of itens) {
        const esperado = tierDoCosmetico(familia, item.id) === 'FREE';
        expect(podeEquipar('FREE', familia, item.id)).toBe(esperado);
      }
    }
  });

  it('existe pelo menos um item de apoiador — senão este teste não prova nada', () => {
    // Sem esta asserção, o caso acima passaria com um catálogo 100% gratuito e
    // ninguém notaria que a regra deixou de ser exercitada.
    const apoiador = FAMILIAS.flatMap(({ familia, itens }) =>
      itens.filter((i) => tierDoCosmetico(familia, i.id) === 'APOIADOR'),
    );
    expect(apoiador.length).toBeGreaterThan(0);
  });

  it('os padrões são sempre equipáveis, inclusive por conta FREE', () => {
    // O padrão é para onde o servidor devolve alguém rebaixado de tier. Se um
    // deles fosse APOIADOR, rebaixar deixaria a conta num estado que ela não
    // consegue nem reproduzir.
    const padroes: Array<[FamiliaDeCosmetico, string]> = [
      ['sleeveId', COSMETICOS_PADRAO.sleeveId],
      ['playmatId', COSMETICOS_PADRAO.playmatId],
      ['borderId', COSMETICOS_PADRAO.borderId],
      ['titleId', COSMETICOS_PADRAO.titleId],
      ['petId', COSMETICOS_PADRAO.petId],
    ];
    for (const [familia, id] of padroes) {
      expect(podeEquipar('FREE', familia, id)).toBe(true);
    }
  });
});
