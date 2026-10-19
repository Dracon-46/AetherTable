/**
 * catalogo.service.spec.ts — uma escrita no meio da recarga não se perde.
 *
 * ─── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * A segunda invalidação, chegando com uma recarga em curso, devolvia a
 * promessa da primeira — que já tinha lido o banco ANTES da segunda escrita.
 * Criar dois cosméticos em sequência no backoffice publicava só o primeiro.
 *
 * O Prisma é um duplo cuja leitura fica pendurada até o teste soltar: é o
 * que deixa a segunda invalidação cair exatamente no meio da primeira.
 */

import { CatalogoDeCosmeticosService } from './catalogo.service.js';

function montar() {
  const leituras: (() => void)[] = [];
  const prisma = {
    cosmeticItem: {
      findMany: jest.fn(
        () =>
          new Promise<never[]>((resolve) => {
            leituras.push(() => resolve([]));
          }),
      ),
    },
  };
  const svc = new CatalogoDeCosmeticosService(prisma as never);
  /** Solta a leitura mais antiga ainda pendurada, e deixa a recarga andar. */
  const soltarLeitura = async () => {
    leituras.shift()?.();
    await new Promise((r) => setImmediate(r));
  };
  return { svc, prisma, soltarLeitura };
}

describe('CatalogoDeCosmeticosService.recarregar', () => {
  it('invalidar durante uma recarga faz o banco ser lido de novo ao fim dela', async () => {
    const { svc, prisma, soltarLeitura } = montar();

    const primeira = svc.recarregar();
    // A primeira já está lendo o banco quando a segunda escrita acontece.
    const segunda = svc.recarregar();
    expect(prisma.cosmeticItem.findMany).toHaveBeenCalledTimes(1);

    await soltarLeitura();
    // A releitura que cobre a segunda escrita começou sozinha.
    expect(prisma.cosmeticItem.findMany).toHaveBeenCalledTimes(2);

    await soltarLeitura();
    await Promise.all([primeira, segunda]);
    expect(prisma.cosmeticItem.findMany).toHaveBeenCalledTimes(2);
  });

  it('quem esperava a segunda só é liberado depois da releitura', async () => {
    const { svc, soltarLeitura } = montar();
    let liberada = false;

    void svc.recarregar();
    const segunda = svc.recarregar().then(() => {
      liberada = true;
    });

    await soltarLeitura();
    expect(liberada).toBe(false);

    await soltarLeitura();
    await segunda;
    expect(liberada).toBe(true);
  });

  it('três pedidos no meio de uma recarga custam UMA releitura, não três', async () => {
    const { svc, prisma, soltarLeitura } = montar();

    const pedidos = [svc.recarregar(), svc.recarregar(), svc.recarregar(), svc.recarregar()];
    await soltarLeitura();
    await soltarLeitura();
    await Promise.all(pedidos);

    expect(prisma.cosmeticItem.findMany).toHaveBeenCalledTimes(2);
  });
});
