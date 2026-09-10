import {
  FATOR_CARTA_MAX,
  FATOR_CARTA_MIN,
  PREFERENCIAS_DE_MESA_PADRAO,
  ehPreferenciaDeMesa,
  normalizarPreferenciasDeMesa,
} from '@aethertable/shared-types';
import { FATOR_CARTA_PADRAO } from '../canvas/layout';
import { useUIStore } from './game.store';
import { aplicarPreferenciasDaMesa, lerPreferenciasDaMesa } from './preferencias-da-conta';

describe('normalizarPreferenciasDeMesa', () => {
  it('devolve o padrão completo para entrada ausente ou de tipo errado', () => {
    for (const entrada of [null, undefined, 'não', 7, [], () => 0]) {
      expect(normalizarPreferenciasDeMesa(entrada)).toEqual(PREFERENCIAS_DE_MESA_PADRAO);
    }
  });

  it('prende o fator da carta na faixa, em vez de recusar o objeto', () => {
    // Preferência é conforto, não autorização: um campo estranho não pode
    // fazer a pessoa perder as outras dez.
    expect(normalizarPreferenciasDeMesa({ fatorCarta: 900 }).fatorCarta).toBe(FATOR_CARTA_MAX);
    expect(normalizarPreferenciasDeMesa({ fatorCarta: 0.01 }).fatorCarta).toBe(FATOR_CARTA_MIN);
  });

  it('NaN e infinito caem no padrão, e não no limite', () => {
    // `Math.min(2, NaN)` é NaN: sem a checagem de finitude, um valor corrompido
    // viraria uma carta de tamanho NaN, ou seja, invisível.
    expect(normalizarPreferenciasDeMesa({ fatorCarta: NaN }).fatorCarta).toBe(
      PREFERENCIAS_DE_MESA_PADRAO.fatorCarta,
    );
    expect(normalizarPreferenciasDeMesa({ fatorCarta: Infinity }).fatorCarta).toBe(
      PREFERENCIAS_DE_MESA_PADRAO.fatorCarta,
    );
  });

  it('valor de enum desconhecido cai no padrão', () => {
    expect(normalizarPreferenciasDeMesa({ vidaModo: 'banana' }).vidaModo).toBe('minha');
    // `boardView` guarda um sessionId quando aponta para um oponente, e
    // sessionId não sobrevive à partida: só as duas visões estáveis passam.
    expect(normalizarPreferenciasDeMesa({ boardView: 'sess_A3f' }).boardView).toBe('ALL');
    expect(normalizarPreferenciasDeMesa({ boardView: 'ME' }).boardView).toBe('ME');
  });

  it('preserva o que veio certo e completa o que faltou', () => {
    const r = normalizarPreferenciasDeMesa({ alinharNaGrade: true, fatorCarta: 1.4 });
    expect(r.alinharNaGrade).toBe(true);
    expect(r.fatorCarta).toBe(1.4);
    expect(r.vidaModo).toBe(PREFERENCIAS_DE_MESA_PADRAO.vidaModo);
  });

  it('ignora chave que não existe no contrato', () => {
    const r = normalizarPreferenciasDeMesa({ inventado: 1, fatorCarta: 1.2 });
    expect(Object.keys(r).sort()).toEqual(Object.keys(PREFERENCIAS_DE_MESA_PADRAO).sort());
  });
});

describe('ehPreferenciaDeMesa', () => {
  it('aceita objeto com chaves do contrato', () => {
    expect(ehPreferenciaDeMesa({})).toBe(true);
    expect(ehPreferenciaDeMesa({ fatorCarta: 1.5, vidaModo: 'mesa' })).toBe(true);
    expect(ehPreferenciaDeMesa(PREFERENCIAS_DE_MESA_PADRAO)).toBe(true);
  });

  it('recusa o que transformaria a coluna JSONB em armazenamento livre', () => {
    expect(ehPreferenciaDeMesa({ qualquerCoisa: 1 })).toBe(false);
    expect(ehPreferenciaDeMesa([1, 2, 3])).toBe(false);
    expect(ehPreferenciaDeMesa('texto')).toBe(false);
    expect(ehPreferenciaDeMesa(null)).toBe(false);
  });
});

describe('a ponte com o store da interface', () => {
  const inicial = useUIStore.getState();

  afterEach(() => {
    useUIStore.setState(inicial, true);
  });

  it('o padrão do contrato é o mesmo estado inicial do store', () => {
    // Se estes dois divergirem, uma conta nova abriria a mesa de um jeito e a
    // primeira gravação a mudaria sem ninguém ter pedido.
    const doStore = lerPreferenciasDaMesa();
    expect(doStore).toEqual(PREFERENCIAS_DE_MESA_PADRAO);
    expect(doStore.fatorCarta).toBe(FATOR_CARTA_PADRAO);
  });

  it('aplica o que veio da conta sobre o store', () => {
    aplicarPreferenciasDaMesa({ fatorCarta: 1.3, vidaModo: 'mesa', alinharNaGrade: true });
    const s = useUIStore.getState();
    expect(s.fatorCarta).toBe(1.3);
    expect(s.vidaModo).toBe('mesa');
    expect(s.alinharNaGrade).toBe(true);
  });

  it('objeto VAZIO não sobrescreve nada', () => {
    // `{}` é o valor de fábrica da coluna e significa "nunca configurou".
    // Sobrescrever aqui faria ajustar numa aba e recarregar outra devolver
    // tudo ao padrão.
    useUIStore.setState({ fatorCarta: 1.7 });
    aplicarPreferenciasDaMesa({});
    expect(useUIStore.getState().fatorCarta).toBe(1.7);
    aplicarPreferenciasDaMesa(null);
    expect(useUIStore.getState().fatorCarta).toBe(1.7);
  });

  it('a ida e a volta preservam o que a pessoa configurou', () => {
    useUIStore.setState({ fatorCarta: 1.6, vidaModo: 'minima', seguirTurno: true });
    const enviado = lerPreferenciasDaMesa();
    useUIStore.setState(inicial, true);
    aplicarPreferenciasDaMesa(enviado);
    const s = useUIStore.getState();
    expect(s.fatorCarta).toBe(1.6);
    expect(s.vidaModo).toBe('minima');
    expect(s.seguirTurno).toBe(true);
  });
});
