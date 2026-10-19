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

/**
 * Placa de nome — a sexta família passa pelas mesmas duas trancas das outras:
 * o DTO confere que o id EXISTE no catálogo, e o service confere que a conta
 * tem DIREITO a ele. Uma família que pulasse qualquer uma delas reabriria o
 * cadeado decorativo que `podeEquipar` fechou.
 */
describe('placa de nome no PATCH /users/me', () => {
  function montar(supporterTier: 'FREE' | 'APOIADOR') {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({ supporterTier }),
        update: jest.fn().mockResolvedValue({ id: 'u1', username: 'gaspare' }),
      },
      userPreference: { upsert: jest.fn() },
    };
    return { prisma, svc: new UsersService(prisma as never) };
  }

  it('o DTO aceita uma placa do catálogo e null ("voltar ao padrão")', () => {
    expect(AtualizarPerfilDto.parse({ nameplateId: 'mare' }).nameplateId).toBe('mare');
    expect(AtualizarPerfilDto.parse({ nameplateId: null }).nameplateId).toBeNull();
  });

  it('o DTO recusa placa fora do catálogo — e URL, que seria upload disfarçado', () => {
    expect(AtualizarPerfilDto.safeParse({ nameplateId: 'placa-inventada' }).success).toBe(false);
    expect(AtualizarPerfilDto.safeParse({ nameplateId: 'https://x/y.png' }).success).toBe(false);
  });

  it('grava a placa na preferência, sem tocar nos outros cosméticos', async () => {
    const { prisma, svc } = montar('FREE');

    await svc.updateUser('u1', AtualizarPerfilDto.parse({ nameplateId: 'brasa' }));

    expect(prisma.userPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { nameplateId: 'brasa' } }),
    );
  });

  it('conta FREE não equipa placa de apoiador; conta APOIADOR equipa', async () => {
    const free = montar('FREE');
    await expect(
      free.svc.updateUser('u1', AtualizarPerfilDto.parse({ nameplateId: 'ouro-real' })),
    ).rejects.toThrow(/ouro-real/);
    expect(free.prisma.userPreference.upsert).not.toHaveBeenCalled();

    const apoiador = montar('APOIADOR');
    await apoiador.svc.updateUser('u1', AtualizarPerfilDto.parse({ nameplateId: 'ouro-real' }));
    expect(apoiador.prisma.userPreference.upsert).toHaveBeenCalled();
  });
});

/**
 * O nome de usuário não diferencia maiúsculas na checagem de disponibilidade.
 *
 * A consulta era `{ username }` exato: com "gaspare" cadastrado, outra conta
 * trocava o próprio nome para "Gaspare" e aparecia na mesa como a primeira.
 */
describe('UsersService.updateUser — username disponível sem diferenciar maiúsculas', () => {
  it('a checagem compara sem caixa e deixa a própria conta de fora', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'u1', username: 'Gaspare' }),
      },
      userPreference: { upsert: jest.fn() },
    };
    const svc = new UsersService(prisma as never);

    await svc.updateUser('u1', AtualizarPerfilDto.parse({ username: 'Gaspare' }));

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { username: { equals: 'Gaspare', mode: 'insensitive' }, id: { not: 'u1' } },
      }),
    );
  });

  it('"Gaspare" é recusado quando "gaspare" já é de outra conta', async () => {
    const prisma = {
      user: {
        // O duplo responde como o Postgres com `mode: 'insensitive'`.
        findFirst: jest.fn(
          async ({ where }: { where: { username: { equals: string; mode?: string } } }) =>
            where.username.mode === 'insensitive' &&
            where.username.equals.toLowerCase() === 'gaspare'
              ? { id: 'outra' }
              : null,
        ),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      userPreference: { upsert: jest.fn() },
    };
    const svc = new UsersService(prisma as never);

    await expect(
      svc.updateUser('u1', AtualizarPerfilDto.parse({ username: 'Gaspare' })),
    ).rejects.toThrow(/em uso/);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
