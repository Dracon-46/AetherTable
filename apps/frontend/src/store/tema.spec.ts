/**
 * tema.spec.ts — a tradução entre o enum do banco e o contrato.
 *
 * `UserPreference.theme` nasceu em inglês (`DARK`/`LIGHT`/`SYSTEM`) na primeira
 * migração, e o resto do domínio é em português. Migrar um enum do Postgres
 * para renomear três valores custa mais do que a tradução vale — então ela
 * existe, e mora num lugar só.
 *
 * O que estes casos protegem é a fronteira: um valor que não atravessa direito
 * volta como `ESCURO` em silêncio, e o sintoma seria "escolhi claro e ao
 * recarregar voltou escuro" — sem erro em lugar nenhum.
 */

import {
  DESCRICAO_DO_TEMA,
  TEMAS,
  TEMA_PADRAO,
  ehTema,
  temaDoPrisma,
  temaParaPrisma,
} from '@aethertable/shared-types';

describe('tradução do tema', () => {
  it('atravessa nos dois sentidos, para os três valores', () => {
    for (const tema of TEMAS) {
      expect(temaDoPrisma(temaParaPrisma(tema))).toBe(tema);
    }
  });

  it('cobre exatamente o enum do Prisma — nem a mais, nem a menos', () => {
    // Se alguém adicionar um valor ao enum do banco e esquecer da tradução,
    // este teste não pega (ele não lê o Prisma). O que ele pega é o inverso:
    // um valor no contrato sem par do outro lado, que vira `DARK` calado.
    const doBanco = ['DARK', 'LIGHT', 'SYSTEM'];
    expect(TEMAS.map(temaParaPrisma).sort()).toEqual([...doBanco].sort());
  });

  it('valor desconhecido do banco vira o padrão, sem lançar', () => {
    // A coluna é um enum, então isto não deveria acontecer — mas um `theme`
    // nulo acontece o tempo todo: é o valor de quem nunca abriu os ajustes.
    expect(temaDoPrisma(null)).toBe(TEMA_PADRAO);
    expect(temaDoPrisma(undefined)).toBe(TEMA_PADRAO);
    expect(temaDoPrisma('SEPIA')).toBe(TEMA_PADRAO);
    expect(temaDoPrisma(42)).toBe(TEMA_PADRAO);
  });

  it('o padrão é ESCURO, igual ao `@default(DARK)` da coluna', () => {
    // Divergir daqui faria a conta nova abrir clara e virar escura assim que a
    // hidratação chegasse — um piscar sem explicação.
    expect(TEMA_PADRAO).toBe('ESCURO');
    expect(temaParaPrisma(TEMA_PADRAO)).toBe('DARK');
  });

  it('ehTema aceita só os três', () => {
    expect(ehTema('CLARO')).toBe(true);
    expect(ehTema('claro')).toBe(false);
    expect(ehTema('DARK')).toBe(false);
    expect(ehTema(null)).toBe(false);
  });

  it('todo tema tem nome e resumo para a interface', () => {
    // O seletor desenha os três a partir deste mapa: um valor sem entrada
    // apareceria como um botão em branco.
    for (const tema of TEMAS) {
      expect(DESCRICAO_DO_TEMA[tema].nome.length).toBeGreaterThan(0);
      expect(DESCRICAO_DO_TEMA[tema].resumo.length).toBeGreaterThan(0);
    }
  });
});
