/**
 * acoesDeAuditoria.spec.ts — toda ação que o backend grava tem rótulo.
 *
 * `USER_PASSWORD_RESET` e `USER_PURGE` entraram no enum do Prisma e o
 * dicionário da tela não acompanhou: a linha aparecia com o código cru, em tom
 * neutro (uma exclusão definitiva pintada como rotina), e o filtro — gerado
 * deste dicionário — não oferecia as duas. O teste lê o enum do próprio
 * `schema.prisma`, então o próximo valor novo quebra aqui e não em produção.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ACOES_DE_AUDITORIA } from './acoesDeAuditoria';

const SCHEMA = path.resolve(__dirname, '../../../backend-core/prisma/schema.prisma');

function valoresDoEnum(nome: string): string[] {
  const fonte = fs.readFileSync(SCHEMA, 'utf8');
  const bloco = new RegExp(`enum ${nome} \\{([\\s\\S]*?)\\}`).exec(fonte);
  if (!bloco) throw new Error(`enum ${nome} não encontrado em ${SCHEMA}`);
  return bloco[1]!
    .split('\n')
    .map((linha) => linha.replace(/\/\/.*$/, '').trim())
    .filter((linha) => /^[A-Z_]+$/.test(linha));
}

describe('ACOES_DE_AUDITORIA', () => {
  const doBanco = valoresDoEnum('AdminAction');

  it('lê um enum de verdade (o teste não passa por estar vazio)', () => {
    expect(doBanco.length).toBeGreaterThan(10);
    expect(doBanco).toContain('USER_BAN');
  });

  it('cada AdminAction do Prisma tem rótulo — e, por isso, entrada no filtro', () => {
    const semRotulo = doBanco.filter((acao) => !ACOES_DE_AUDITORIA[acao]);
    expect(semRotulo).toEqual([]);
  });

  it('não há rótulo para ação que o banco não conhece (o filtro daria 400)', () => {
    const fantasmas = Object.keys(ACOES_DE_AUDITORIA).filter((acao) => !doBanco.includes(acao));
    expect(fantasmas).toEqual([]);
  });

  it('redefinir senha é alerta e expurgar conta é perigo', () => {
    expect(ACOES_DE_AUDITORIA.USER_PASSWORD_RESET).toEqual({
      rotulo: 'Redefiniu senha',
      tom: 'alerta',
    });
    expect(ACOES_DE_AUDITORIA.USER_PURGE).toEqual({
      rotulo: 'Excluiu conta definitivamente',
      tom: 'perigo',
    });
  });
});
