/**
 * sala.spec.ts — os limites da configuração de sala.
 *
 * Mora no frontend porque `@aethertable/shared-types` não tem jest próprio e o
 * frontend já é onde os testes de contrato rodam (ver `atalhos.spec.ts`).
 *
 * O que estes casos protegem é uma coisa só: `normalizarConfigDeSala` é
 * chamada NAS DUAS PONTAS — o formulário de criação a usa para não oferecer o
 * que o servidor recusaria, e o `onCreate` a usa porque as opções chegam
 * escritas pelo navegador e não são assinadas. Se ela deixar de ser total (uma
 * entrada que devolve algo inválido) ou de ser idempotente, as duas pontas
 * divergem e o sintoma é "criei a mesa e ela abriu diferente do que escolhi".
 */

import {
  CONFIG_DE_SALA_PADRAO,
  LIMITES_DE_SALA,
  acharFormato,
  cartasParaDevolverNoMulligan,
  ehNomeDeSala,
  formatoTemNivelDePoder,
  nomeDeSalaSugerido,
  nomeDoCronometro,
  nomeDoNivelDePoder,
  normalizarConfigDeSala,
} from '@aethertable/shared-types';

describe('ehNomeDeSala', () => {
  it('recusa nome curto demais, longo demais e só com espaço', () => {
    expect(ehNomeDeSala('ab')).toBe(false);
    expect(ehNomeDeSala('a'.repeat(LIMITES_DE_SALA.NOME_MAX + 1))).toBe(false);
    expect(ehNomeDeSala('   ')).toBe(false);
  });

  it('mede o nome APARADO, não o cru', () => {
    // `'  ab  '` tem seis caracteres e dois de conteúdo. Medir o cru deixaria
    // passar exatamente o nome que a lista de salas mostra vazio.
    expect(ehNomeDeSala('  ab  ')).toBe(false);
    expect(ehNomeDeSala('  abc  ')).toBe(true);
  });

  it('recusa caractere de controle e espaço de largura zero', () => {
    // Uma quebra de linha destrói o cartão da lista; o `\u200b` produz um nome
    // que parece vazio na tela e passa no `length`.
    expect(ehNomeDeSala('Mesa\ndo Gaspare')).toBe(false);
    expect(ehNomeDeSala('Mesa\u200b\u200b\u200b')).toBe(false);
    expect(ehNomeDeSala('Mesa do Gaspare')).toBe(true);
  });

  it('aceita acento e pontuação — não é um campo de identificador', () => {
    expect(ehNomeDeSala('Comandaria de sexta — só pauper!')).toBe(true);
  });
});

describe('normalizarConfigDeSala', () => {
  it('config vazia devolve o padrão', () => {
    expect(normalizarConfigDeSala({})).toEqual(CONFIG_DE_SALA_PADRAO);
    expect(normalizarConfigDeSala()).toEqual(CONFIG_DE_SALA_PADRAO);
  });

  it('aplica o teto de jogadores do FORMATO, não uma lista fixa de 2 a 8', () => {
    // Duel Commander é jogado com exatamente dois. Era possível abrir uma mesa
    // dele com oito assentos porque o único teto era `REALTIME_LIMITS`.
    const duel = acharFormato('duel_commander');
    expect(duel.jogadores.max).toBe(2);

    const config = normalizarConfigDeSala({ gameType: 'duel_commander', maxClients: 8 });
    expect(config.maxClients).toBe(2);
  });

  it('preserva o piso de 1 jogador — a mesa solo é caso de uso', () => {
    const config = normalizarConfigDeSala({ gameType: 'freeform', maxClients: 1 });
    expect(config.maxClients).toBe(1);
  });

  it('zera o nível de poder em formato sem zona de comando', () => {
    // Os brackets são uma escala de Commander: "nível 4" em Modern não tem
    // referência nenhuma, e a lista pública exibiria um número sem sentido.
    expect(formatoTemNivelDePoder('modern')).toBe(false);
    expect(normalizarConfigDeSala({ gameType: 'modern', nivelDePoder: 4 }).nivelDePoder).toBeNull();

    expect(formatoTemNivelDePoder('commander')).toBe(true);
    expect(normalizarConfigDeSala({ gameType: 'commander', nivelDePoder: 4 }).nivelDePoder).toBe(4);
  });

  it('recusa nível fora de 1..5 e nível não inteiro', () => {
    for (const bruto of [0, 6, -1, 2.5, Number.NaN]) {
      const config = normalizarConfigDeSala({ gameType: 'commander', nivelDePoder: bruto });
      expect(config.nivelDePoder).toBeNull();
    }
  });

  it('normalizar duas vezes dá o mesmo resultado (idempotência)', () => {
    const brutas = [
      {},
      { nome: '  Mesa   do   Gaspare  ', gameType: 'FORMATO_QUE_NAO_EXISTE', maxClients: 99 },
      { gameType: 'duel_commander', maxClients: 8, nivelDePoder: 5 },
      { nome: 'ab', visibilidade: 'SEI_LA', comunicacao: 'MIMICA', idioma: 'tlh' },
      { gameType: 'pauper', nivelDePoder: 3, visibilidade: 'PUBLICA' },
    ] as const;

    for (const bruta of brutas) {
      const uma = normalizarConfigDeSala(bruta as never);
      expect(normalizarConfigDeSala(uma)).toEqual(uma);
    }
  });

  it('um gameType desconhecido volta como o id do formato padrão, não como o lixo recebido', () => {
    // É o ponto que quase quebrou a idempotência: devolver o id cru fazia a
    // segunda passada receber de novo o id inválido.
    const config = normalizarConfigDeSala({ gameType: 'FORMATO_QUE_NAO_EXISTE' });
    expect(config.gameType).toBe(acharFormato(null).id);
    expect(acharFormato(config.gameType).id).toBe(config.gameType);
  });

  it('cai no padrão em enum inválido, sem lançar', () => {
    const config = normalizarConfigDeSala({
      visibilidade: 'PUBLICA_MAS_NAO_MUITO',
      comunicacao: 'TELEPATIA',
      idioma: 'tlh',
    } as never);
    expect(config.visibilidade).toBe('PRIVADA');
    expect(config.comunicacao).toBe('QUALQUER');
    expect(config.idioma).toBe('pt-BR');
  });

  it('nasce PRIVADA — publicar uma mesa é uma escolha, nunca um padrão', () => {
    expect(CONFIG_DE_SALA_PADRAO.visibilidade).toBe('PRIVADA');
  });

  it('apara e colapsa o espaço interno do nome', () => {
    expect(normalizarConfigDeSala({ nome: '  Mesa   do   Gaspare  ' }).nome).toBe(
      'Mesa do Gaspare',
    );
  });
});

describe('rótulos', () => {
  it('nomeDoNivelDePoder devolve vazio para não declarado', () => {
    expect(nomeDoNivelDePoder(null)).toBe('');
    expect(nomeDoNivelDePoder(0)).toBe('');
    expect(nomeDoNivelDePoder(5)).toContain('cEDH');
  });

  it('nomeDoCronometro diz "Desligado" no zero', () => {
    expect(nomeDoCronometro(0)).toBe('Desligado');
    expect(nomeDoCronometro(120)).toBe('2 min');
  });

  it('nomeDeSalaSugerido cabe nos limites, inclusive com username longo', () => {
    expect(nomeDeSalaSugerido('Gaspare')).toBe('Mesa de Gaspare');
    expect(ehNomeDeSala(nomeDeSalaSugerido('x'.repeat(60)))).toBe(true);
    expect(ehNomeDeSala(nomeDeSalaSugerido(''))).toBe(true);
  });
});

/**
 * O custo do mulligan é decidido no CLIENTE — o servidor devolve a mão,
 * embaralha e compra sete em todos os tipos. Estes casos existem porque a conta
 * morava dentro do JSX do modal, sem teste, e cobrava do jogador de Commander o
 * mulligan que a regra dá de graça.
 */
describe('cartasParaDevolverNoMulligan', () => {
  it('COMMANDER dá o primeiro mulligan de graça', () => {
    expect(cartasParaDevolverNoMulligan('COMMANDER', 1)).toBe(0);
    expect(cartasParaDevolverNoMulligan('COMMANDER', 2)).toBe(1);
    expect(cartasParaDevolverNoMulligan('COMMANDER', 7)).toBe(6);
  });

  it('LONDON cobra desde o primeiro', () => {
    expect(cartasParaDevolverNoMulligan('LONDON', 1)).toBe(1);
    expect(cartasParaDevolverNoMulligan('LONDON', 2)).toBe(2);
  });

  /**
   * LIVRE não cobra, e isto não é só coerência com o nome: a janela do LIVRE
   * não tem teto, então `mulliganCount` passa de sete. Cobrar N cartas de uma
   * mão de sete deixaria o botão "Confirmar" impossível de satisfazer — o
   * jogador ficaria preso na tela de devolução.
   */
  it('LIVRE não cobra carta nenhuma, em nenhuma contagem', () => {
    expect(cartasParaDevolverNoMulligan('LIVRE', 1)).toBe(0);
    expect(cartasParaDevolverNoMulligan('LIVRE', 12)).toBe(0);
  });

  it('sem mulligan nenhum, ninguém devolve nada', () => {
    expect(cartasParaDevolverNoMulligan('COMMANDER', 0)).toBe(0);
    expect(cartasParaDevolverNoMulligan('LONDON', 0)).toBe(0);
  });

  it('não pede número negativo nem quebrado de cartas', () => {
    expect(cartasParaDevolverNoMulligan('LONDON', -3)).toBe(0);
    expect(cartasParaDevolverNoMulligan('LONDON', 2.7)).toBe(2);
    expect(cartasParaDevolverNoMulligan('COMMANDER', Number.NaN)).toBe(0);
  });
});
