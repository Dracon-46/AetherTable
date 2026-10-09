/**
 * admin.dto.spec.ts — "false" é falso.
 *
 * `z.coerce.boolean()` é `Boolean(valor)`: toda string não vazia vira `true`.
 * Na querystring, `?incluirApagados=false` mostrava as contas banidas; no
 * corpo, `"ativo": "false"` ativava o cosmético.
 */

import {
  AtualizarCosmeticoDto,
  BuscarUsuariosDto,
  CriarCosmeticoDto,
  MudarFlagDto,
} from './admin.dto.js';

describe('DTOs do painel — booleanos de verdade', () => {
  it('?incluirApagados=false e ?apenasSuspensos=false são falsos', () => {
    const dto = BuscarUsuariosDto.parse({ incluirApagados: 'false', apenasSuspensos: 'false' });
    expect(dto.incluirApagados).toBe(false);
    expect(dto.apenasSuspensos).toBe(false);
  });

  it('?incluirApagados=true continua verdadeiro', () => {
    expect(BuscarUsuariosDto.parse({ incluirApagados: 'true' }).incluirApagados).toBe(true);
  });

  it('o booleano do corpo JSON segue funcionando', () => {
    expect(MudarFlagDto.parse({ ligado: false }).ligado).toBe(false);
    expect(MudarFlagDto.parse({ ligado: true }).ligado).toBe(true);
  });

  it('"false" como texto no corpo também é falso', () => {
    expect(MudarFlagDto.parse({ ligado: 'false' }).ligado).toBe(false);
    expect(AtualizarCosmeticoDto.parse({ ativo: 'false' }).ativo).toBe(false);
  });

  it('valor que não é booleano é recusado, em vez de virar true', () => {
    expect(MudarFlagDto.safeParse({ ligado: 'talvez' }).success).toBe(false);
  });

  it('criar cosmético sem `ativo` continua nascendo ativo', () => {
    const dto = CriarCosmeticoDto.parse({
      catalogoId: 'aether-classic',
      tipo: 'SLEEVE',
      nome: 'X',
    });
    expect(dto.ativo).toBe(true);
  });
});
