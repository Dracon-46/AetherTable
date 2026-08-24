import { concede, contem, podeVer, revoga, type VisibilityInput } from './visibility';

function carta(over: Partial<VisibilityInput> = {}): VisibilityInput {
  return {
    zone: 'HAND',
    ownerId: 'p1',
    controllerId: 'p1',
    faceDown: false,
    revealedTo: '',
    peekedBy: '',
    ...over,
  };
}

describe('contem — busca de sessionId com fronteira de virgula', () => {
  it('encontra entrada exata', () => {
    expect(contem('abc', 'abc')).toBe(true);
    expect(contem('abc,def', 'abc')).toBe(true);
    expect(contem('abc,def', 'def')).toBe(true);
    expect(contem('a,abc,z', 'abc')).toBe(true);
  });

  it('nao casa por substring', () => {
    expect(contem('xabcy', 'abc')).toBe(false);
    expect(contem('abcd', 'abc')).toBe(false);
    expect(contem('zabc', 'abc')).toBe(false);
  });

  it('encontra a entrada real mesmo quando ha uma substring ANTES dela', () => {
    // Regressao: a implementacao de referencia de DOC-032 §3.0.1 testa apenas a
    // PRIMEIRA ocorrencia do indexOf. Aqui a primeira ocorrencia de 'abc' esta
    // dentro de 'xabcy' e falha na fronteira — a versao de referencia devolveria
    // false e negaria visibilidade a quem tinha direito.
    expect(contem('xabcy,abc', 'abc')).toBe(true);
    expect(contem('abcd,efg,abc', 'abc')).toBe(true);
  });

  it('lida com lista e sid vazios', () => {
    expect(contem('', 'abc')).toBe(false);
    expect(contem('abc', '')).toBe(false);
  });
});

describe('concede / revoga', () => {
  it('nao duplica', () => {
    expect(concede('', 'p1')).toBe('p1');
    expect(concede('p1', 'p1')).toBe('p1');
    expect(concede('p1', 'p2')).toBe('p1,p2');
  });

  it('remove sem deixar virgula solta', () => {
    expect(revoga('p1,p2', 'p1')).toBe('p2');
    expect(revoga('p1,p2,p3', 'p2')).toBe('p1,p3');
    expect(revoga('p1', 'p1')).toBe('');
    expect(revoga('p1,p2', 'p9')).toBe('p1,p2');
  });
});

describe('podeVer — tabela de decisao de DOC-032 §4.1', () => {
  it('1. revealedTo=ALL vence tudo, inclusive grimorio', () => {
    expect(podeVer(carta({ zone: 'LIBRARY', revealedTo: 'ALL' }), 'p9')).toBe(true);
    expect(podeVer(carta({ zone: 'HAND', revealedTo: 'ALL' }), 'p9')).toBe(true);
  });

  it('2. revelacao dirigida atinge so os escolhidos', () => {
    const c = carta({ zone: 'HAND', revealedTo: 'p2,p3' });
    expect(podeVer(c, 'p2')).toBe(true);
    expect(podeVer(c, 'p3')).toBe(true);
    expect(podeVer(c, 'p4')).toBe(false);
  });

  it('3. olhada ativa concede acesso ao grimorio', () => {
    const c = carta({ zone: 'LIBRARY', peekedBy: 'p1' });
    expect(podeVer(c, 'p1')).toBe(true);
    expect(podeVer(c, 'p2')).toBe(false);
  });

  it('4. faceDown esconde a identidade mesmo em zona publica', () => {
    const c = carta({ zone: 'BATTLEFIELD', faceDown: true, controllerId: 'p1' });
    expect(podeVer(c, 'p1')).toBe(true);
    expect(podeVer(c, 'p2')).toBe(false);
    expect(podeVer(c, 'p3')).toBe(false);
  });

  it('4b. faceDown segue o CONTROLLER, nao o owner (morph roubado)', () => {
    const c = carta({
      zone: 'BATTLEFIELD',
      faceDown: true,
      ownerId: 'p1',
      controllerId: 'p2',
    });
    expect(podeVer(c, 'p2')).toBe(true);
    expect(podeVer(c, 'p1')).toBe(false);
  });

  it('5. zonas publicas com a face para cima: todos veem', () => {
    for (const zone of ['BATTLEFIELD', 'GRAVEYARD', 'EXILE', 'COMMAND', 'STACK']) {
      expect(podeVer(carta({ zone }), 'qualquer-um')).toBe(true);
    }
  });

  it('6. HAND: so o dono', () => {
    const c = carta({ zone: 'HAND', ownerId: 'p1' });
    expect(podeVer(c, 'p1')).toBe(true);
    expect(podeVer(c, 'p2')).toBe(false);
  });

  it('6b. HAND segue o OWNER, nao o controller', () => {
    const c = carta({ zone: 'HAND', ownerId: 'p1', controllerId: 'p2' });
    expect(podeVer(c, 'p1')).toBe(true);
    expect(podeVer(c, 'p2')).toBe(false);
  });

  it('7. LIBRARY: ninguem, nem o dono', () => {
    const c = carta({ zone: 'LIBRARY', ownerId: 'p1' });
    expect(podeVer(c, 'p1')).toBe(false);
    expect(podeVer(c, 'p2')).toBe(false);
  });

  it('8. zona desconhecida NEGA — falha fechada', () => {
    expect(podeVer(carta({ zone: 'ZONA_QUE_ALGUEM_ESQUECEU' }), 'p1')).toBe(false);
    expect(podeVer(carta({ zone: '' }), 'p1')).toBe(false);
  });

  it('espectador (nao e dono nem controller de nada) nunca ve zona oculta', () => {
    // DOC-031 §5.5: o espectador recebe o filtro mais restritivo.
    const espectador = 'spec-1';
    expect(podeVer(carta({ zone: 'HAND', ownerId: 'p1' }), espectador)).toBe(false);
    expect(podeVer(carta({ zone: 'LIBRARY', ownerId: 'p1' }), espectador)).toBe(false);
    expect(
      podeVer(carta({ zone: 'BATTLEFIELD', faceDown: true, controllerId: 'p1' }), espectador),
    ).toBe(false);
  });

  it('limpar as concessoes em troca de zona corta o acesso (DOC-032 §4.1.2)', () => {
    // O erro mais facil de cometer neste modelo: nao zerar revealedTo/peekedBy
    // ao trocar de zona. Uma carta revelada na mao que vai ao campo e volta
    // continuaria visivel a todos para sempre.
    const revelada = carta({ zone: 'HAND', revealedTo: 'ALL' });
    expect(podeVer(revelada, 'p2')).toBe(true);

    const aposLimpeza = { ...revelada, revealedTo: '', peekedBy: '' };
    expect(podeVer(aposLimpeza, 'p2')).toBe(false);
  });
});
