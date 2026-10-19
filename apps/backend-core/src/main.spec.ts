/**
 * main.spec.ts — o boot liga os ganchos de encerramento.
 *
 * ─── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * Sem `enableShutdownHooks`, o Nest não escuta SIGTERM: a cada deploy o
 * processo morria sem rodar `PrismaService.onModuleDestroy`, e as conexões
 * ficavam abertas no Postgres até o timeout.
 *
 * O `main.ts` sobe a aplicação ao ser carregado. Aqui a fábrica do Nest
 * devolve um dublê que só anota o que foi chamado — nenhuma porta é aberta e
 * nenhum módulo de verdade é instanciado.
 */

const mockApp = {
  get: jest.fn(() => ({ log: jest.fn() })),
  useLogger: jest.fn(),
  enableShutdownHooks: jest.fn(),
  set: jest.fn(),
  use: jest.fn(),
  disable: jest.fn(),
  setGlobalPrefix: jest.fn(),
  enableCors: jest.fn(),
  listen: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@nestjs/core', () => ({
  NestFactory: { create: jest.fn(async () => mockApp) },
}));
jest.mock('./app.module.js', () => ({ AppModule: class {} }));
// Pesados de carregar e sem uso com o dublê: o Swagger só sobe fora de
// produção, e o `Logger` do pino é só a chave de `app.get`.
jest.mock('@nestjs/swagger', () => ({ DocumentBuilder: class {}, SwaggerModule: {} }));
jest.mock('nestjs-pino', () => ({ Logger: class {} }));

describe('bootstrap', () => {
  const ambiente = { ...process.env };

  afterAll(() => {
    process.env = { ...ambiente };
  });

  it('liga os ganchos de encerramento antes de abrir a porta', async () => {
    // Produção pula o Swagger, que precisaria de uma aplicação de verdade.
    process.env.NODE_ENV = 'production';

    jest.requireActual('./main.js');
    for (let i = 0; i < 20 && mockApp.listen.mock.calls.length === 0; i++) {
      await new Promise((r) => setImmediate(r));
    }

    expect(mockApp.enableShutdownHooks).toHaveBeenCalledTimes(1);
    expect(mockApp.enableShutdownHooks.mock.invocationCallOrder[0]).toBeLessThan(
      mockApp.listen.mock.invocationCallOrder[0]!,
    );
  }, 30_000); // Carregar o `main.ts` compila os imports dele: folga para máquina ocupada.
});
