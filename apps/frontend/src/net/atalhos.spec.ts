import {
  ACOES_DE_ATALHO,
  ALIAS_DE_TECLA,
  ATALHOS_PADRAO,
  TECLA_NAO_ATRIBUIDA,
  acaoDaTecla,
  ehAcaoDeAtalho,
  ehTeclaDeAtalho,
  normalizarTecla,
  resolverAtalhos,
} from '@aethertable/shared-types';
import { formatarTecla } from './atalhos';

/**
 * atalhos.spec.ts — a gramática de uma tecla, travada em teste.
 *
 * O risco deste recurso não é visual, é de IDENTIDADE: a mesma tecla física
 * precisa produzir a mesma string na captura do editor e na resolução durante a
 * partida. Se as duas divergirem, o jogador remapeia, vê a tecla nova gravada
 * na tela, e ela nunca dispara — o pior modo de falha possível, porque não há
 * erro nenhum para investigar.
 *
 * Os dois casos que motivaram a gramática atual e não podem regredir:
 *   1. Shift+P e P são atalhos DIFERENTES (o navegador entrega 'P' e 'p');
 *   2. Shift+= entrega '+' , então 'shift++' e '+' seriam a mesma tecla física
 *      com dois nomes — daí não existir prefixo shift para imprimível.
 */

const tecla = (key: string, mod: Partial<KeyboardEvent> = {}) =>
  normalizarTecla({
    key,
    ctrlKey: Boolean(mod.ctrlKey),
    metaKey: Boolean(mod.metaKey),
    altKey: Boolean(mod.altKey),
    shiftKey: Boolean(mod.shiftKey),
  });

describe('normalizarTecla', () => {
  it('caractere simples é a própria tecla', () => {
    expect(tecla('d')).toBe('d');
    expect(tecla('=')).toBe('=');
    expect(tecla('-')).toBe('-');
  });

  it('a caixa distingue Shift num imprimível, sem prefixo', () => {
    expect(tecla('P', { shiftKey: true })).toBe('P');
    expect(tecla('p')).toBe('p');
    expect(tecla('P', { shiftKey: true })).not.toBe(tecla('p'));
  });

  it('Shift + = chega como + e NÃO ganha prefixo shift', () => {
    // É o caso que quebraria a identidade: 'shift++' contra '+'.
    expect(tecla('+', { shiftKey: true })).toBe('+');
  });

  it('tecla nomeada é minúscula e aceita prefixo shift', () => {
    expect(tecla('Escape')).toBe('escape');
    expect(tecla('ArrowUp')).toBe('arrowup');
    expect(tecla('ArrowUp', { shiftKey: true })).toBe('shift+arrowup');
  });

  it('ctrl e meta colapsam no mesmo prefixo', () => {
    expect(tecla('z', { ctrlKey: true })).toBe('ctrl+z');
    expect(tecla('z', { metaKey: true })).toBe('ctrl+z');
  });

  it('alt não colapsa, e a ordem dos prefixos é fixa', () => {
    expect(tecla('1', { altKey: true })).toBe('alt+1');
    expect(tecla('1', { ctrlKey: true, altKey: true })).toBe('ctrl+alt+1');
  });

  it('é determinística: o mesmo evento sempre dá a mesma string', () => {
    // Captura no editor e resolução na partida chamam a MESMA função com o
    // mesmo evento — é o que garante que o gravado é o que dispara.
    const evento = { key: 'G', ctrlKey: false, shiftKey: true };
    expect(normalizarTecla(evento)).toBe(normalizarTecla(evento));
  });
});

describe('ehTeclaDeAtalho', () => {
  it('aceita a tecla vazia, que significa "desligado"', () => {
    expect(ehTeclaDeAtalho(TECLA_NAO_ATRIBUIDA)).toBe(true);
  });

  it('aceita tudo que normalizarTecla produz', () => {
    for (const t of ['d', '=', 'ctrl+z', 'escape', 'shift+arrowup', 'ctrl+alt+1', 'P']) {
      expect(ehTeclaDeAtalho(t)).toBe(true);
    }
  });

  it('recusa espaço, controle e string enorme', () => {
    expect(ehTeclaDeAtalho('ctrl + z')).toBe(false);
    expect(ehTeclaDeAtalho('a\nb')).toBe(false);
    expect(ehTeclaDeAtalho('x'.repeat(64))).toBe(false);
  });
});

describe('resolverAtalhos', () => {
  it('sem nada salvo, devolve o padrão inteiro', () => {
    expect(resolverAtalhos(null)).toEqual(ATALHOS_PADRAO);
    expect(resolverAtalhos({})).toEqual(ATALHOS_PADRAO);
  });

  it('o salvo sobrescreve, o resto vem do padrão', () => {
    const r = resolverAtalhos({ COMPRAR: 'k' });
    expect(r.COMPRAR).toBe('k');
    expect(r.EMBARALHAR).toBe(ATALHOS_PADRAO.EMBARALHAR);
  });

  it('ação que não existe mais é ignorada em silêncio', () => {
    // É o caminho de VOLTA de uma versão: quem jogou numa build com uma ação
    // que depois saiu não pode ficar com editor quebrado.
    const r = resolverAtalhos({ ACAO_QUE_NAO_EXISTE: 'k', COMPRAR: 'j' });
    expect(r).not.toHaveProperty('ACAO_QUE_NAO_EXISTE');
    expect(r.COMPRAR).toBe('j');
  });

  it('tecla com formato inválido cai no padrão daquela ação', () => {
    expect(resolverAtalhos({ COMPRAR: 'tecla invalida' }).COMPRAR).toBe(ATALHOS_PADRAO.COMPRAR);
  });

  it('uma ação NOVA numa versão futura chega com a tecla de fábrica', () => {
    // O mapa salvo é de uma versão que não conhecia todas as ações de hoje.
    const salvoAntigo = { COMPRAR: 'j' };
    const r = resolverAtalhos(salvoAntigo);
    for (const { id } of ACOES_DE_ATALHO) {
      expect(r[id]).toBeDefined();
    }
    expect(r.AUMENTAR_CARTA).toBe(ATALHOS_PADRAO.AUMENTAR_CARTA);
  });

  it('toda ação do catálogo tem entrada no padrão, e nenhuma TECLA se repete', () => {
    const usadas = new Map<string, string>();
    for (const { id } of ACOES_DE_ATALHO) {
      const t = ATALHOS_PADRAO[id];
      expect(ehAcaoDeAtalho(id)).toBe(true);
      // Toda ação precisa de ENTRADA — mas a entrada pode ser "sem tecla".
      // Desde que o catálogo passou de treze para quarenta ações, distribuir
      // tecla para todas significaria empilhar modificadores que ninguém
      // decora ou tomar atalhos do navegador; ação nova nasce desligada.
      expect(t).toBeDefined();
      if (t === TECLA_NAO_ATRIBUIDA) continue;
      // Duas ações na mesma tecla de fábrica seria um atalho cuja função
      // depende da ordem de uma constante.
      expect(usadas.has(t)).toBe(false);
      usadas.set(t, id);
    }
  });

  it('as treze teclas originais continuam nas mesmas ações', () => {
    // A mão de quem já jogava não pode mudar porque o catálogo cresceu.
    expect(ATALHOS_PADRAO.COMPRAR).toBe('d');
    expect(ATALHOS_PADRAO.DESVIRAR_TUDO).toBe('u');
    expect(ATALHOS_PADRAO.EMBARALHAR).toBe('s');
    expect(ATALHOS_PADRAO.PASSAR_TURNO).toBe('p');
    expect(ATALHOS_PADRAO.DESFAZER).toBe('ctrl+z');
    expect(ATALHOS_PADRAO.VIRAR_SELECAO).toBe('t');
    expect(ATALHOS_PADRAO.VIRAR_PARA_BAIXO).toBe('f');
    expect(ATALHOS_PADRAO.TRANSFORMAR).toBe('x');
    expect(ATALHOS_PADRAO.PARA_CEMITERIO).toBe('g');
    expect(ATALHOS_PADRAO.EDITAR_CARTA).toBe('e');
    expect(ATALHOS_PADRAO.LIMPAR_SELECAO).toBe('escape');
    expect(ATALHOS_PADRAO.AUMENTAR_CARTA).toBe('=');
    expect(ATALHOS_PADRAO.REDUZIR_CARTA).toBe('-');
  });

  it('toda ação do catálogo pertence a um dos quatro grupos do editor', () => {
    // O editor desenha por grupo: uma ação num grupo que ele não percorre
    // existiria no contrato e seria invisível para quem quer remapear.
    const grupos = new Set(['MESA', 'GRIMORIO', 'SELECAO', 'EXIBICAO']);
    for (const { id, grupo, descricao } of ACOES_DE_ATALHO) {
      expect(grupos.has(grupo)).toBe(true);
      // Descrição vazia deixaria uma linha em branco no editor.
      expect(descricao.length).toBeGreaterThan(3);
      expect(id.length).toBeGreaterThan(0);
    }
  });
});

describe('acaoDaTecla', () => {
  const padrao = resolverAtalhos(null);

  it('resolve a tecla de fábrica', () => {
    expect(acaoDaTecla(padrao, 'd')).toBe('COMPRAR');
    expect(acaoDaTecla(padrao, 'ctrl+z')).toBe('DESFAZER');
    expect(acaoDaTecla(padrao, 'escape')).toBe('LIMPAR_SELECAO');
  });

  it('tecla sem ação devolve null, e é o que preserva Ctrl+T do navegador', () => {
    expect(acaoDaTecla(padrao, 'ctrl+t')).toBeNull();
    expect(acaoDaTecla(padrao, 'f5')).toBeNull();
  });

  it('ação desligada não responde a tecla vazia', () => {
    const mapa = { ...padrao, COMPRAR: TECLA_NAO_ATRIBUIDA };
    expect(acaoDaTecla(mapa, TECLA_NAO_ATRIBUIDA)).toBeNull();
  });

  it('o apelido faz + valer como = num teclado ABNT2', () => {
    expect(ALIAS_DE_TECLA['+']).toBe('=');
    expect(acaoDaTecla(padrao, '+')).toBe('AUMENTAR_CARTA');
    expect(acaoDaTecla(padrao, '_')).toBe('REDUZIR_CARTA');
  });

  it('o apelido NÃO atropela um remapeamento para a própria tecla', () => {
    // Quem remapeou "comprar" para '+' aperta '+' e compra — o apelido só vale
    // quando a tecla apertada não tem ação própria.
    const mapa = { ...padrao, COMPRAR: '+' };
    expect(acaoDaTecla(mapa, '+')).toBe('COMPRAR');
  });
});

describe('formatarTecla', () => {
  it('escreve o modificador por extenso', () => {
    expect(formatarTecla('ctrl+z')).toBe('Ctrl + Z');
    expect(formatarTecla('alt+1')).toBe('Alt + 1');
  });

  it('a maiúscula da canônica aparece como Shift', () => {
    // Sem isto, 'P' e 'p' apareceriam com o mesmo rótulo na lista.
    expect(formatarTecla('P')).toBe('Shift + P');
    expect(formatarTecla('p')).toBe('P');
  });

  it('tecla nomeada ganha nome de tecla, não de código', () => {
    expect(formatarTecla('escape')).toBe('Esc');
    expect(formatarTecla('arrowup')).toBe('↑');
    expect(formatarTecla('shift+arrowup')).toBe('Shift + ↑');
  });

  it('pontuação aparece como está', () => {
    expect(formatarTecla('=')).toBe('=');
    expect(formatarTecla('-')).toBe('-');
    expect(formatarTecla('+')).toBe('+');
  });

  it('sem tecla é dito, não deixado em branco', () => {
    expect(formatarTecla(TECLA_NAO_ATRIBUIDA)).toBe('sem tecla');
  });
});
