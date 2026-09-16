/**
 * textureCache.spec.ts — o cache de texturas tem teto.
 *
 * ─── O DEFEITO QUE ESTES CASOS FIXAM ───────────────────────────────────────
 *
 * O cache era um `Map` que só crescia. `limparCache()` existia e nunca era
 * chamado durante a partida, então toda carta que apareceu alguma vez ficava
 * guardada — na qualidade `normal`, cujo bitmap decodificado ocupa uns 3 MB
 * independentemente do tamanho em disco.
 *
 * Numa mesa de Commander são 400 cartas distintas, mais fichas, mais o que
 * passou por cemitério e exílio. Centenas de entradas a 3 MB chegam ao
 * gigabyte, e o sintoma não é um erro: a aba fica progressivamente mais lenta e
 * depois trava. O relato foi "depois de uns 15 minutos o jogo trava", numa
 * partida de três a quatro horas.
 *
 * ─── POR QUE ESTE TESTE É FRÁGIL DE PROPÓSITO ──────────────────────────────
 *
 * Ele conta ENTRADAS, que é a única coisa observável daqui — não há como medir
 * memória num teste de unidade. Se alguém subir o teto, este arquivo quebra e
 * obriga a decisão a ser deliberada, em vez de um número mudado de passagem.
 */

import { getTexture, limparCache, tamanhoDoCache } from './textureCache';

beforeEach(() => {
  limparCache();
});

describe('cache de texturas', () => {
  it('a mesma carta pedida duas vezes é a MESMA imagem', () => {
    // É o motivo de o cache existir: um deck com 30 Mountains carrega uma
    // textura, não trinta.
    const a = getTexture('abc', 'normal', 'front');
    const b = getTexture('abc', 'normal', 'front');
    expect(a).toBe(b);
    expect(tamanhoDoCache()).toBe(1);
  });

  it('qualidade e face diferentes são entradas diferentes', () => {
    // Uma carta de dupla face tem as DUAS artes sob o mesmo id; colapsá-las
    // faria `INTENT_TRANSFORM` virar um booleano sem nada mudar na tela.
    getTexture('abc', 'normal', 'front');
    getTexture('abc', 'normal', 'back');
    getTexture('abc', 'small', 'front');
    expect(tamanhoDoCache()).toBe(3);
  });

  it('NÃO cresce sem limite — é o defeito que travava a partida longa', () => {
    // Mil cartas distintas é mais do que uma mesa vê numa partida inteira, e
    // sem teto seriam mil bitmaps vivos.
    for (let i = 0; i < 1000; i += 1) getTexture(`carta-${i}`, 'normal', 'front');
    expect(tamanhoDoCache()).toBeLessThanOrEqual(300);
  });

  it('descarta a MENOS usada recentemente, não a mais antiga de sempre', () => {
    /**
     * A distinção é o que faz o cache servir para alguma coisa: o sleeve padrão
     * e as cartas do campo são pedidos o tempo todo, e um descarte por idade de
     * inserção jogaria fora justamente elas depois de algumas centenas de
     * cartas novas.
     */
    const quente = getTexture('carta-quente', 'normal', 'front');

    for (let i = 0; i < 299; i += 1) {
      getTexture(`enche-${i}`, 'normal', 'front');
      // Continua sendo pedida: é o que a mantém viva.
      getTexture('carta-quente', 'normal', 'front');
    }

    // Agora enche até estourar o teto com folga.
    for (let i = 0; i < 400; i += 1) {
      getTexture(`estoura-${i}`, 'normal', 'front');
      getTexture('carta-quente', 'normal', 'front');
    }

    // A mesma instância — ela nunca saiu do cache.
    expect(getTexture('carta-quente', 'normal', 'front')).toBe(quente);
    expect(tamanhoDoCache()).toBeLessThanOrEqual(300);
  });

  it('uma carta descartada volta a funcionar — o cache não é a fonte da verdade', () => {
    // Descartar não perde nada: a imagem volta do cache do NAVEGADOR, que
    // continua valendo (a resposta tem `immutable` e ETag). O custo de um
    // descarte errado é uma decodificação, nunca um erro.
    const antes = getTexture('some', 'normal', 'front');
    const urlEsperada = antes.src;

    for (let i = 0; i < 400; i += 1) getTexture(`outra-${i}`, 'normal', 'front');

    const depois = getTexture('some', 'normal', 'front');
    expect(depois.src).toBe(urlEsperada);
  });

  it('descartar NÃO cancela o carregamento da imagem descartada', () => {
    /**
     * Sair do cache não significa sair da TELA: um nó do Konva pode estar
     * segurando a mesma instância. Uma versão anterior deste arquivo zerava o
     * `src` das descartadas para poupar banda — e isso deixaria uma carta
     * visível em branco para sempre, porque nada reemite o pedido enquanto
     * aquele nó não for reconstruído.
     */
    const segurada = getTexture('na-tela', 'normal', 'front');
    const urlOriginal = segurada.src;

    for (let i = 0; i < 400; i += 1) getTexture(`empurra-${i}`, 'normal', 'front');

    expect(segurada.src).toBe(urlOriginal);
  });

  it('`limparCache` zera tudo', () => {
    getTexture('a', 'normal', 'front');
    getTexture('b', 'normal', 'front');
    limparCache();
    expect(tamanhoDoCache()).toBe(0);
  });
});
