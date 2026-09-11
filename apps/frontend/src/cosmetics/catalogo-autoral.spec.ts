/**
 * catalogo-autoral.spec.ts — o catálogo que o backoffice escreve.
 *
 * ─── O QUE ESTES CASOS PROTEGEM ────────────────────────────────────────────
 *
 * Até aqui o catálogo era uma constante no bundle: impossível de corromper,
 * impossível de divergir entre processos. Agora ele recebe itens de fora, e
 * três coisas passaram a poder dar errado em silêncio:
 *
 *   1. Um item MALFORMADO chegar ao renderizador. `fillStyle` aceita quase
 *      qualquer string e falha em silêncio no que não entende — uma cor
 *      inválida não lança, desenha preto. O normalizador é a única barreira.
 *
 *   2. Um item autoral SOBRESCREVER um do código. `aether-classic` é o verso
 *      de toda carta oculta da mesa; redefini-lo por uma linha no banco
 *      mudaria a aparência do jogo inteiro.
 *
 *   3. Um item desativado CONTINUAR no catálogo. O registro substitui o
 *      conjunto em vez de acrescentar justamente por isso — e um registro
 *      incremental passaria neste arquivo inteiro menos por um caso.
 *
 * Os três são invisíveis: nenhum lança, nenhum aparece em log, e o sintoma
 * seria "o cosmético ficou preto" ou "desativei e continua lá".
 */

import {
  PETS,
  SLEEVES,
  SLEEVE_PADRAO,
  acharPet,
  acharSleeve,
  ehAutoral,
  ehPetValido,
  ehSleeveValido,
  listarPlaymats,
  listarSleeves,
  normalizarCosmeticoAutoral,
  normalizarCosmeticosAutorais,
  registrarCosmeticosAutorais,
  tierDoCosmetico,
  type CosmeticoAutoralBruto,
} from '@aethertable/shared-types';

const SLEEVE_BOM: CosmeticoAutoralBruto = {
  familia: 'sleeveId',
  id: 'trama-de-cobre',
  nome: 'Trama de Cobre',
  tier: 'FREE',
  cor1: '#7a4a1e',
  cor2: '#2b1a0c',
  borda: '#c98a3e',
  detalhe: '#f0c07a',
  padrao: 'circuito',
};

const PET_BOM: CosmeticoAutoralBruto = {
  familia: 'petId',
  id: 'tatu-de-bronze',
  nome: 'Tatu de Bronze',
  tier: 'APOIADOR',
  forma: 'slime',
  cor: '#b87333',
  animacao: 'balancar',
};

/** Toda suíte volta ao catálogo de código: o registro é global ao processo. */
afterEach(() => {
  registrarCosmeticosAutorais([]);
});

describe('normalizarCosmeticoAutoral', () => {
  it('aceita um item completo e devolve exatamente os campos do contrato', () => {
    const r = normalizarCosmeticoAutoral(SLEEVE_BOM);
    expect(r).not.toBeNull();
    expect(r!.familia).toBe('sleeveId');
    // Os campos crus (`cor1`, `cor2`) viram o par `cores` que o renderizador
    // espera — se isso mudar, o sleeve desenha sem gradiente e ninguém repara.
    expect(r!.item).toEqual({
      id: 'trama-de-cobre',
      nome: 'Trama de Cobre',
      tier: 'FREE',
      cores: ['#7a4a1e', '#2b1a0c'],
      borda: '#c98a3e',
      detalhe: '#f0c07a',
      padrao: 'circuito',
    });
  });

  it('recusa cor que não seja #rrggbb', () => {
    // Todas estas são aceitas por `fillStyle` ou falham em silêncio nele. É
    // por isso que a barreira tem de estar aqui e não no desenho.
    for (const ruim of ['red', '#fff', 'rgb(1,2,3)', '#12345g', 'url(x)', '']) {
      expect(normalizarCosmeticoAutoral({ ...SLEEVE_BOM, cor1: ruim })).toBeNull();
    }
  });

  it('recusa padrão fora do vocabulário que o cliente sabe desenhar', () => {
    expect(normalizarCosmeticoAutoral({ ...SLEEVE_BOM, padrao: 'xadrez' })).toBeNull();
    // O padrão de playmat não vale para sleeve: as duas listas são separadas
    // porque os dois renderizadores são separados.
    expect(normalizarCosmeticoAutoral({ ...SLEEVE_BOM, padrao: 'nebulosa' })).toBeNull();
  });

  it('recusa identificador que não seja slug', () => {
    for (const ruim of ['Trama Cobre', 'trama_cobre', '-trama', 'a', '../x', 'TRAMA']) {
      expect(normalizarCosmeticoAutoral({ ...SLEEVE_BOM, id: ruim })).toBeNull();
    }
  });

  it('recusa campo faltando, em vez de completar com um padrão', () => {
    // Completar seria pior: o item entraria no catálogo com uma cor que
    // ninguém escolheu, e o administrador veria um item que não é o dele.
    const { detalhe: _ignorado, ...semDetalhe } = SLEEVE_BOM;
    expect(normalizarCosmeticoAutoral(semDetalhe)).toBeNull();
  });

  it('recusa família desconhecida', () => {
    expect(normalizarCosmeticoAutoral({ ...SLEEVE_BOM, familia: 'chapeuId' })).toBeNull();
    expect(normalizarCosmeticoAutoral({ ...SLEEVE_BOM, familia: undefined })).toBeNull();
  });

  it('normaliza a cor para minúsculas, para o mesmo item não gerar duas chaves de cache', () => {
    const r = normalizarCosmeticoAutoral({ ...SLEEVE_BOM, cor1: '#7A4A1E' });
    expect((r!.item as { cores: string[] }).cores[0]).toBe('#7a4a1e');
  });

  /**
   * ─── O CASO QUE FALTAVA, E O DEFEITO QUE ELE DEIXOU PASSAR ───────────────
   *
   * Os casos acima só exercitavam a forma de ENTRADA (`cor1`/`cor2`), que é o
   * que o formulário manda. O servidor grava o item JÁ NORMALIZADO — onde os
   * dois viraram a tupla `cores` — e normaliza de novo ao ler.
   *
   * Sem idempotência, a releitura devolvia `null` e a linha era descartada em
   * silêncio: o cosmético era criado com sucesso (201), gravado corretamente
   * no banco, e simplesmente nunca aparecia para ninguém. `null` ali significa
   * "linha inválida, pula", então não havia erro, log nem sintoma além da
   * ausência.
   */
  it('é idempotente: normalizar o que já foi normalizado devolve o mesmo item', () => {
    const uma = normalizarCosmeticoAutoral(SLEEVE_BOM)!;
    // Exatamente o que a coluna `parametros` guarda.
    const duas = normalizarCosmeticoAutoral({ ...uma.item, familia: uma.familia })!;
    expect(duas).not.toBeNull();
    expect(duas.item).toEqual(uma.item);

    // E de novo, porque "duas vezes funciona" e "estável" não são a mesma
    // afirmação.
    const tres = normalizarCosmeticoAutoral({ ...duas.item, familia: duas.familia })!;
    expect(tres.item).toEqual(uma.item);
  });

  it('vale para as duas famílias que têm par de cores', () => {
    const playmat = normalizarCosmeticoAutoral({
      familia: 'playmatId',
      id: 'campo-de-bronze',
      nome: 'Campo de Bronze',
      tier: 'FREE',
      cor1: '#3a2a12',
      cor2: '#12100a',
      destaque: '#c98a3e',
      padrao: 'runas',
    })!;
    const relido = normalizarCosmeticoAutoral({ ...playmat.item, familia: 'playmatId' })!;
    expect(relido.item).toEqual(playmat.item);
  });

  it('a tupla `cores` com conteúdo inválido é recusada como qualquer outra cor', () => {
    // Aceitar as duas formas não pode virar uma porta que valida menos.
    expect(normalizarCosmeticoAutoral({ ...SLEEVE_BOM, cores: ['red', '#000000'] })).toBeNull();
    expect(normalizarCosmeticoAutoral({ ...SLEEVE_BOM, cores: ['#000000'] })).toBeNull();
    expect(normalizarCosmeticoAutoral({ ...SLEEVE_BOM, cores: 'preto' })).toBeNull();
  });

  it('uma lista com item ruim perde só o item ruim', () => {
    // O caso real: uma linha corrompida no banco não pode derrubar a
    // sincronização e levar junto os itens que estavam certos.
    const itens = normalizarCosmeticosAutorais([
      SLEEVE_BOM,
      { familia: 'sleeveId', id: 'quebrado' },
      PET_BOM,
    ]);
    expect(itens.map((i) => i.item.id)).toEqual(['trama-de-cobre', 'tatu-de-bronze']);
  });
});

describe('registrarCosmeticosAutorais', () => {
  it('o item registrado passa a existir para o resolvedor e para o validador', () => {
    registrarCosmeticosAutorais(normalizarCosmeticosAutorais([SLEEVE_BOM, PET_BOM]));

    expect(ehSleeveValido('trama-de-cobre')).toBe(true);
    expect(acharSleeve('trama-de-cobre').nome).toBe('Trama de Cobre');
    expect(ehPetValido('tatu-de-bronze')).toBe(true);
    expect(acharPet('tatu-de-bronze').forma).toBe('slime');
  });

  it('o tier do item autoral vale para o direito de equipar', () => {
    // Sem isto, um item marcado como exclusivo de apoiador no painel seria
    // equipável por qualquer conta — o cadeado voltaria a ser decorativo.
    registrarCosmeticosAutorais(normalizarCosmeticosAutorais([SLEEVE_BOM, PET_BOM]));
    expect(tierDoCosmetico('sleeveId', 'trama-de-cobre')).toBe('FREE');
    expect(tierDoCosmetico('petId', 'tatu-de-bronze')).toBe('APOIADOR');
  });

  it('entra nas listas que o seletor desenha', () => {
    const antes = listarSleeves().length;
    registrarCosmeticosAutorais(normalizarCosmeticosAutorais([SLEEVE_BOM]));
    expect(listarSleeves().length).toBe(antes + 1);
    expect(listarSleeves().some((s) => s.id === 'trama-de-cobre')).toBe(true);
  });

  it('SUBSTITUI o conjunto: desativar um item o faz sumir', () => {
    registrarCosmeticosAutorais(normalizarCosmeticosAutorais([SLEEVE_BOM, PET_BOM]));
    expect(ehSleeveValido('trama-de-cobre')).toBe(true);

    // A sincronização seguinte traz só o mascote — é assim que "desativado no
    // painel" chega aos outros processos. Um registro incremental deixaria o
    // sleeve no ar para sempre.
    registrarCosmeticosAutorais(normalizarCosmeticosAutorais([PET_BOM]));
    expect(ehSleeveValido('trama-de-cobre')).toBe(false);
    expect(ehPetValido('tatu-de-bronze')).toBe(true);

    registrarCosmeticosAutorais([]);
    expect(ehPetValido('tatu-de-bronze')).toBe(false);
  });

  it('NÃO deixa um item autoral sobrescrever um item do código', () => {
    const originalDoPadrao = acharSleeve(SLEEVE_PADRAO);

    const aceitos = registrarCosmeticosAutorais(
      normalizarCosmeticosAutorais([
        { ...SLEEVE_BOM, id: SLEEVE_PADRAO, nome: 'Sequestro do Padrão' },
      ]),
    );

    expect(aceitos).toBe(0);
    // O verso de toda carta oculta da mesa continua o que sempre foi.
    expect(acharSleeve(SLEEVE_PADRAO)).toEqual(originalDoPadrao);
    expect(acharSleeve(SLEEVE_PADRAO).nome).not.toBe('Sequestro do Padrão');
  });

  it('o catálogo de código sobrevive intacto a qualquer registro', () => {
    // A garantia de degradar sem quebrar: o que veio no bundle é o piso, e
    // nenhuma sincronização pode tirar item de lá.
    registrarCosmeticosAutorais(normalizarCosmeticosAutorais([SLEEVE_BOM]));
    for (const s of SLEEVES) expect(ehSleeveValido(s.id)).toBe(true);
    for (const p of PETS) expect(ehPetValido(p.id)).toBe(true);
    expect(listarPlaymats().length).toBeGreaterThan(0);
  });

  it('`ehAutoral` distingue a origem do item', () => {
    // O painel precisa disso para não oferecer "editar cores" num item que
    // vive no código e só mudaria por deploy.
    registrarCosmeticosAutorais(normalizarCosmeticosAutorais([SLEEVE_BOM]));
    expect(ehAutoral('sleeveId', 'trama-de-cobre')).toBe(true);
    expect(ehAutoral('sleeveId', SLEEVE_PADRAO)).toBe(false);
  });

  it('id desconhecido continua caindo no padrão, sem lançar', () => {
    // O contrato dos resolvedores não muda por existir catálogo dinâmico: um
    // cliente desatualizado que receba um id que não conhece desenha o padrão
    // em vez de deixar a mesa sem sleeve.
    expect(acharSleeve('nunca-existiu').id).toBe(SLEEVE_PADRAO);
    expect(tierDoCosmetico('sleeveId', 'nunca-existiu')).toBe('FREE');
  });
});
