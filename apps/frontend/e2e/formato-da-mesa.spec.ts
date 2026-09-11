import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zerarPreferenciasDeMesa } from './fixtures/estado-limpo';

/**
 * formato-da-mesa.spec.ts — os três arranjos do tabuleiro desenham de verdade.
 *
 * ─── POR QUE ESTA SUÍTE EXISTE ─────────────────────────────────────────────
 *
 * `montarMesa` e `montarGrade` estão em `canvas/layout.ts` desde sempre,
 * completos e com teste de unidade — e ficaram SEM CHAMADOR quando a mesa
 * focada virou o arranjo fixo. Continuaram compilando, continuaram passando
 * nos próprios testes, e deixaram de existir para quem joga.
 *
 * É o modo de falha que teste de unidade não pega por construção: os dois
 * arranjos estavam corretos. O que faltava era alguém chamá-los.
 *
 * Por isso a asserção aqui não é sobre geometria — `layout.spec.ts` já cobre
 * isso, e melhor. É sobre a mesa CONTINUAR DESENHANDO depois da troca: o
 * canvas de pé, as cartas na tela, nenhum erro de página. Trocar o arranjo é a
 * única ação do jogo que substitui o sistema de coordenadas inteiro, e um erro
 * ali apaga o tabuleiro sem derrubar a aplicação.
 *
 * ─── COMO RODAR ────────────────────────────────────────────────────────────
 *
 *   1. suba os três serviços (pnpm dev)
 *   2. node e2e/fixtures/preparar-jogadores.mjs
 *   3. E2E_BASE_URL=http://localhost:3030 npx playwright test formato-da-mesa --project=desktop
 */

const AQUI = __dirname;

interface Jogador {
  username: string;
  token: string;
  deckId: string;
  user: { id: string; username: string };
}

function carregarJogadores(): Jogador[] {
  try {
    const bruto = readFileSync(join(AQUI, 'fixtures', 'jogadores.json'), 'utf8');
    return JSON.parse(bruto).jogadores as Jogador[];
  } catch {
    return [];
  }
}

const JOGADORES = carregarJogadores();
const STACK_NO_AR = Boolean(process.env.E2E_BASE_URL) && JOGADORES.length >= 2;

test.describe('formato da mesa', () => {
  test.skip(!STACK_NO_AR, 'exige o stack completo no ar + fixtures (ver o cabeçalho)');
  test.skip(({ isMobile }) => Boolean(isMobile), 'o painel de exibição exige tela larga');

  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  let contextos: BrowserContext[] = [];
  let ana: Page;
  /** Erros de página que apareceram em qualquer momento da suíte. */
  const erros: string[] = [];

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    await zerarPreferenciasDeMesa([JOGADORES[0]!.token]);

    const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
    await ctx.addInitScript(
      ([token, user]) => {
        window.localStorage.setItem(
          'aethertable-auth-storage',
          JSON.stringify({ state: { accessToken: token, user }, version: 0 }),
        );
      },
      [JOGADORES[0]!.token, JOGADORES[0]!.user] as [string, Jogador['user']],
    );
    contextos.push(ctx);
    ana = await ctx.newPage();

    /**
     * Um arranjo que quebra NÃO derruba a aplicação — o React isola o erro do
     * canvas e a página segue de pé, só que sem tabuleiro. Sem este coletor, a
     * suíte passaria numa tela vazia.
     */
    ana.on('pageerror', (e: Error) => erros.push(e.message));
  });

  test.afterAll(async () => {
    for (const ctx of contextos) await ctx.close();
    contextos = [];
  });

  test('abre uma mesa solo e chega ao tabuleiro', async () => {
    await ana.goto('/dashboard');
    await ana.getByRole('button', { name: 'Criar Agora' }).click();

    const modal = ana.getByRole('dialog');
    // Mesa de um lugar: a partida começa sem esperar ninguém.
    await modal.getByLabel('Formato').selectOption('freeform');
    await modal.getByLabel('Jogadores').selectOption('1');
    await modal.getByLabel('Selecione seu Deck').selectOption({ index: 1 });
    await modal.getByRole('button', { name: 'Entrar na Mesa' }).click();

    await ana.waitForURL(/\/play\/[A-F0-9]{6}/, { timeout: 30_000 });
    await expect(ana.getByRole('heading', { name: 'Sala de espera' })).toBeVisible({
      timeout: 30_000,
    });

    await ana.getByRole('button', { name: 'Iniciar partida' }).click();
    await expect(ana.getByRole('heading', { name: 'Sua Mão Inicial' })).toBeVisible({
      timeout: 40_000,
    });
    await ana.getByRole('button', { name: 'Manter mão' }).click();

    // O canvas de pé é a condição de todos os testes abaixo.
    await expect(ana.locator('canvas').first()).toBeVisible({ timeout: 20_000 });
  });

  test('o painel de Exibição oferece os TRÊS formatos', async () => {
    await ana.getByRole('button', { name: 'Exibição' }).click();

    // A afirmação que importa: os três existem como escolha. Dois deles não
    // apareciam em lugar nenhum antes desta mudança.
    await expect(ana.getByText('Formato da mesa')).toBeVisible();
    for (const nome of ['Focada', 'Faixas', 'Grade']) {
      await expect(ana.getByRole('button', { name: nome, exact: true })).toBeVisible();
    }
  });

  /**
   * Trocar de arranjo substitui o sistema de coordenadas inteiro: a focada
   * devolve pixels reais e os outros dois um plano lógico de 1920 que precisa
   * de escala. Errar a conta não lança exceção — desenha a mesa fora da tela,
   * ou com carta de 74px, e o teste precisa ver que ela continua ali.
   */
  for (const formato of ['Faixas', 'Grade', 'Focada'] as const) {
    test(`o formato "${formato}" desenha a mesa`, async () => {
      await ana.getByRole('button', { name: formato, exact: true }).click();

      const canvas = ana.locator('canvas').first();
      await expect(canvas).toBeVisible();

      // O canvas ocupa área de verdade — um arranjo com escala zerada ou
      // negativa colapsaria a caixa sem derrubar nada.
      const caixa = await canvas.boundingBox();
      expect(caixa!.width).toBeGreaterThan(400);
      expect(caixa!.height).toBeGreaterThan(300);

      // E o HUD continua respondendo, que é o sinal de que o React não ficou
      // preso num render quebrado.
      await expect(ana.getByRole('button', { name: 'Exibição' })).toBeVisible();
    });
  }

  test('nenhum erro de página em toda a troca de formatos', async () => {
    // Deixado por último de propósito: ele julga a suíte inteira. Um arranjo
    // que lança no primeiro render some da tela sem derrubar a aplicação, e
    // todas as asserções acima continuariam passando numa página sem canvas se
    // não fosse `toBeVisible`.
    expect(erros).toEqual([]);
  });
});
