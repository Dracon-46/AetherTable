import { chaveDaZona, idDoTopo, ordenarDoTopo } from './ordem-de-zona';

const c = (id: string) => ({ id });

describe('idDoTopo', () => {
  it('devolve o ULTIMO id, porque o topo fica no fim da lista', () => {
    expect(idDoTopo(['fundo', 'meio', 'topo'])).toBe('topo');
  });

  it('devolve undefined para zona vazia ou ainda não espelhada', () => {
    expect(idDoTopo([])).toBeUndefined();
    expect(idDoTopo(undefined)).toBeUndefined();
  });
});

describe('ordenarDoTopo', () => {
  it('inverte a lista do servidor: topo primeiro', () => {
    const cartas = [c('a'), c('b'), c('c')];
    expect(ordenarDoTopo(cartas, ['a', 'b', 'c']).map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });

  it('não depende da ordem em que as cartas chegaram do mapa', () => {
    const cartas = [c('c'), c('a'), c('b')];
    expect(ordenarDoTopo(cartas, ['a', 'b', 'c']).map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });

  it('mantém no fim a carta que ainda não está na ordem — some é pior que fora de ordem', () => {
    const cartas = [c('a'), c('b'), c('nova')];
    expect(ordenarDoTopo(cartas, ['a', 'b']).map((x) => x.id)).toEqual(['b', 'a', 'nova']);
  });

  it('ignora id da ordem que não está mais na zona', () => {
    const cartas = [c('a')];
    expect(ordenarDoTopo(cartas, ['a', 'saiu']).map((x) => x.id)).toEqual(['a']);
  });

  it('sem ordem espelhada, devolve as cartas como vieram (e não a lista vazia)', () => {
    const cartas = [c('a'), c('b')];
    expect(ordenarDoTopo(cartas, undefined).map((x) => x.id)).toEqual(['a', 'b']);
    expect(ordenarDoTopo(cartas, []).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('não devolve a mesma referência de array — o chamador pode ordenar de novo', () => {
    const cartas = [c('a')];
    expect(ordenarDoTopo(cartas, undefined)).not.toBe(cartas);
  });

  it('não repete carta quando a ordem tem id duplicado (vale a ocorrência mais ao topo)', () => {
    const cartas = [c('a'), c('b')];
    expect(ordenarDoTopo(cartas, ['a', 'b', 'a']).map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('chaveDaZona', () => {
  it('usa o formato do servidor', () => {
    expect(chaveDaZona('sess1', 'GRAVEYARD')).toBe('sess1:GRAVEYARD');
  });
});
