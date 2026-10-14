/**
 * placa-de-nome.spec.tsx — a placa aparece para quem deve, e some para quem
 * pediu.
 *
 * A placa de nome é o único cosmético desenhado nos DOIS mundos: no painel de
 * vida (DOM) e no rótulo da faixa (Konva). Os dois leem o mesmo item por
 * `estiloCssDaPlaca` e `placaNoCanvas`, e os dois passam por
 * `cosmeticosVisiveis` — que é onde mora a preferência de acessibilidade de
 * DOC-060 §4. Um oponente com placa dourada não pode continuar dourado na tela
 * de quem desligou cosméticos alheios.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { acharNameplate, COSMETICOS_PADRAO, NAMEPLATE_PADRAO } from '@aethertable/shared-types';
import { cosmeticosVisiveis } from './store';
import { estiloCssDaPlaca, placaNoCanvas } from './render';
import { NomeComPlaca } from '../components/Avatar';

const OPONENTE = { id: 'b', profileNameplate: 'ouro-real', profileBorder: 'chama' };

describe('cosmeticosVisiveis — placa de nome', () => {
  it('a placa equipada chega ao desenho de quem permite cosméticos alheios', () => {
    expect(cosmeticosVisiveis(OPONENTE, false, true).nameplateId).toBe('ouro-real');
  });

  it('desligar cosméticos alheios tira a placa do oponente, junto com a borda', () => {
    const visto = cosmeticosVisiveis(OPONENTE, false, false);
    expect(visto.nameplateId).toBe(NAMEPLATE_PADRAO);
    expect(visto.borderId).toBe(COSMETICOS_PADRAO.borderId);
  });

  it('a MINHA placa continua, mesmo com cosméticos alheios desligados', () => {
    // A preferência é sobre o que os outros impõem à minha tela, não sobre o
    // que eu escolhi.
    expect(cosmeticosVisiveis(OPONENTE, true, false).nameplateId).toBe('ouro-real');
  });

  it('jogador sem placa no estado cai no padrão', () => {
    expect(cosmeticosVisiveis({ id: 'c' }, false, true).nameplateId).toBe(NAMEPLATE_PADRAO);
  });
});

describe('estiloCssDaPlaca e placaNoCanvas — o mesmo item nos dois mundos', () => {
  it('o padrão é "sem placa" nos dois', () => {
    const padrao = acharNameplate(NAMEPLATE_PADRAO);
    expect(estiloCssDaPlaca(padrao)).toBeNull();
    expect(placaNoCanvas(padrao, 120)).toBeNull();
  });

  it('as cores do DOM e do canvas são as mesmas do item', () => {
    const placa = acharNameplate('mare');
    const css = estiloCssDaPlaca(placa)!;
    const canvas = placaNoCanvas(placa, 120)!;

    expect(css.background).toBe(`linear-gradient(90deg, ${placa.cores[0]}, ${placa.cores[1]})`);
    expect(canvas.fillLinearGradientColorStops).toEqual([0, placa.cores[0], 1, placa.cores[1]]);
    expect(css.color).toBe(placa.texto);
    expect(canvas.texto).toBe(placa.texto);
    expect(canvas.stroke).toBe(placa.borda);
    // O gradiente do Konva vai até a largura medida do texto.
    expect(canvas.fillLinearGradientEndPoint).toEqual({ x: 120, y: 0 });
  });

  it('só o estilo "brilho" ganha halo — nos dois', () => {
    expect(estiloCssDaPlaca(acharNameplate('mare'))!.boxShadow).toBeUndefined();
    expect(placaNoCanvas(acharNameplate('mare'), 80)!.shadowBlur).toBeUndefined();
    expect(estiloCssDaPlaca(acharNameplate('ouro-real'))!.boxShadow).toBeDefined();
    expect(placaNoCanvas(acharNameplate('ouro-real'), 80)!.shadowBlur).toBeGreaterThan(0);
  });

  it('nenhuma placa do catálogo referencia imagem', () => {
    // DOC-060 §1.1: só cor e estilo. Uma `url(...)` num `background` seria
    // upload disfarçado entrando pelo lado do CSS.
    for (const id of ['ardosia', 'mare', 'brasa', 'ouro-real', 'eter']) {
      expect(JSON.stringify(estiloCssDaPlaca(acharNameplate(id)))).not.toMatch(/url\(|https?:/i);
    }
  });
});

describe('NomeComPlaca', () => {
  it('sem placa, é o nome cru com as classes do chamador', () => {
    render(<NomeComPlaca nome="Ana" nameplateId={NAMEPLATE_PADRAO} className="text-text" />);
    const nome = screen.getByText('Ana');
    expect(nome.getAttribute('style')).toBeNull();
    expect(nome.className).toBe('text-text');
  });

  it('com placa, o nome ganha o fundo e a cor de texto da placa', () => {
    render(<NomeComPlaca nome="Bia" nameplateId="brasa" />);
    const nome = screen.getByText('Bia');
    const placa = acharNameplate('brasa');
    expect(nome.style.background).toContain('linear-gradient');
    // jsdom devolve a cor em rgb(); o que importa é que é a do item.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(placa.texto.slice(i, i + 2), 16));
    expect(nome.style.color).toBe(`rgb(${r}, ${g}, ${b})`);
  });

  it('`placa` vence `nameplateId` — a prévia do backoffice desenha item não registrado', () => {
    const autoral = { ...acharNameplate('mare'), id: 'ainda-nao-registrada' };
    render(<NomeComPlaca nome="Cid" nameplateId="ainda-nao-registrada" placa={autoral} />);
    expect(screen.getByText('Cid').style.background).toContain('linear-gradient');
  });
});
