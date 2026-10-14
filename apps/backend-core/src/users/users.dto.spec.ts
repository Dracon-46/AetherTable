/**
 * users.dto.spec.ts — salvar o perfil de quem não tem nome de exibição.
 *
 * ─── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * `displayName` exigia ao menos um caractere. A conta criada sem nome de
 * exibição tem o campo vazio no formulário, e Perfil/Ajustes reenviam `''` em
 * todo salvamento: trocar o tema, o idioma ou um cosmético falhava com "Dados
 * inválidos" por causa de um campo que a pessoa nem tocou.
 */

import { AtualizarPerfilDto } from './users.dto.js';
import { UsersService } from './users.service.js';

describe('AtualizarPerfilDto — displayName vazio é "sem nome"', () => {
  it("'' vira null e o resto do formulário passa", () => {
    const r = AtualizarPerfilDto.safeParse({ displayName: '', language: 'pt-BR' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ displayName: null, language: 'pt-BR' });
  });

  it('só espaços também vira null', () => {
    expect(AtualizarPerfilDto.parse({ displayName: '   ' }).displayName).toBeNull();
  });

  it('null explícito é aceito', () => {
    expect(AtualizarPerfilDto.parse({ displayName: null }).displayName).toBeNull();
  });

  it('o nome continua aparado e limitado a 48', () => {
    expect(AtualizarPerfilDto.parse({ displayName: '  Gaspare  ' }).displayName).toBe('Gaspare');
    expect(AtualizarPerfilDto.safeParse({ displayName: 'x'.repeat(49) }).success).toBe(false);
  });

  it('ausente continua ausente — não apaga o nome de quem não mandou o campo', () => {
    expect('displayName' in AtualizarPerfilDto.parse({ language: 'en' })).toBe(false);
  });
});

describe('UsersService.updateUser — null apaga o nome de exibição', () => {
  it('grava null na coluna', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'u1', username: 'gaspare', displayName: null }),
      },
      userPreference: { upsert: jest.fn() },
    };
    const svc = new UsersService(prisma as never);

    const dto = AtualizarPerfilDto.parse({ displayName: '' });
    await svc.updateUser('u1', dto);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { displayName: null } }),
    );
  });
});
