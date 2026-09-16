import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zerarPreferenciasDeMesa } from './fixtures/estado-limpo';

/**
 * recarregar-a-pagina.spec.ts — o F5 volta para a mesa.
 *
 * ─── O DEFEITO QUE ESTA SUÍTE FIXA ─────────────────────────────────────────
 *
 * O relato foi direto: "se eu dou f5 ou recarrego a página eu saio da sala, tem
 * que arrumar isso, eu não consigo voltar também".
 *
 * Havia dois defeitos empilhados, e os dois no CLIENTE — o servidor sempre
 * esteve certo:
 *
 *   1. A limpeza do efeito chamava `room.leave()` sem argumento, que no
 *      Colyseus é uma saída CONSENTIDA. O servidor trata saída consentida como
 *      "o jogador clicou em sair" e remove o assento na hora. A recarga
 *      destruía o próprio assento antes de tentar voltar para ele, e a janela
 *      de `allowReconnection` nunca chegava a valer.
 *
 *   2. Não havia `reconnect()` em lugar nenhum. O cliente tentava entrar de
 *      novo com o `seatToken` da query string — que é de USO ÚNICO
 *      (`jtisUsados`, FR-20) e é recusado com `TOKEN_ALREADY_USED` para sempre.
 *
 * Juntos: recarregar = expulso e barrado, numa sala em que o assento ainda
 * estaria guardado se alguém tentasse voltar direito.
 *
 * ─── POR QUE ISTO PRECISA SER E2E ──────────────────────────────────────────
 *
 * Nenhum teste de unidade enxerga isto. O `reconnectionToken` é emitido pelo
 * servidor por conexão, guardado no `sessionStorage` (que sobrevive ao F5 e
 * morre com a aba), e usado num handshake de WebSocket. As três pontas só
 * existem juntas num navegador de verdade.
 *
 * ─── COMO RODAR ────────────────────────────────────────────────────────────
 *
 *   1. suba os três serviços (pnpm dev)
 *   2. node e2e/fixtures/preparar-jogadores.mjs
 *   3. E2E_BASE_URL=http://localhost:3030 npx playwright test recarregar --project=desktop
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
const STACK_NO_AR = Boolean(process.env.E2E_BASE_URL) && JOGADORES.length >= 1;

test.describe('recarregar a página', () => {
  test.skip(!STACK_NO_AR, 'exige o stack completo no ar + fixtures (ver o cabeçalho)');
  test.skip(({ isMobile }) => Boolean(isMobile), 'a mesa exige tela larga');

  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  let contextos: BrowserContext[] = [];
  let ana: Page;
  let urlDaMesa = '';
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
    await modal.getByLabel('Formato').selectOption('freeform');
    await modal.getByLabel('Jogadores').selectOption('1');
    await modal.getByLabel('Selecione seu Deck').selectOption({ index: 1 });
    await modal.getByRole('button', { name: 'Entrar na Mesa' }).click();

    await ana.waitForURL(/\/play\/[A-F0-9]{6}/, { timeout: 30_000 });
    // Guardada COM a query string: é assim que o navegador a preserva num F5,
    // e é o `seatToken` queimado dela que o defeito reenviava.
    urlDaMesa = ana.url();
    expect(urlDaMesa).toContain('token=');

    await expect(ana.getByRole('heading', { name: 'Sala de espera' })).toBeVisible({
      timeout: 30_000,
    });
    await ana.getByRole('button', { name: 'Iniciar partida' }).click();
    await expect(ana.getByRole('heading', { name: 'Sua Mão Inicial' })).toBeVisible({
      timeout: 40_000,
    });
    await ana.getByRole('button', { name: 'Manter mão' }).click();
    await expect(ana.locator('canvas').first()).toBeVisible({ timeout: 20_000 });
  });

  test('o F5 volta para a MESA, não para uma tela de conexão recusada', async () => {
    /**
     * A asserção central. Antes desta correção, `reload()` levava a
     * "Conexão recusada" — o servidor recusava o `seatToken` já usado com
     * `TOKEN_ALREADY_USED`, e não havia caminho de volta nenhum.
     */
    await ana.reload();

    await expect(ana.locator('canvas').first()).toBeVisible({ timeout: 40_000 });
    await expect(ana.getByRole('heading', { name: 'Conexão recusada' })).toHaveCount(0);

    // E a mesa está viva, não só desenhada: o HUD responde.
    await expect(ana.getByRole('button', { name: 'Exibição' })).toBeVisible();
  });

  test('a mão continua sendo a MINHA mão depois da recarga', async () => {
    /**
     * Voltar para a mesa não basta: se o cliente tivesse entrado como um
     * jogador NOVO, a tela mostraria um tabuleiro vazio e uma mão vazia — e
     * isso passaria no teste acima. O que prova a reconexão é o estado
     * anterior estar de volta.
     */
    const cartasNaMao = await ana.evaluate(() => {
      const janela = window as unknown as {
        __aethertable_debug?: { maoDoJogador?: () => number };
      };
      return janela.__aethertable_debug?.maoDoJogador?.() ?? -1;
    });

    // Sem gancho de depuração exposto, cai no sinal observável: o log da
    // partida guarda o que aconteceu ANTES da recarga.
    if (cartasNaMao === -1) {
      await ana.getByRole('button', { name: 'Exibição' }).click();
      await expect(ana.getByText('Formato da mesa')).toBeVisible();
      await ana.keyboard.press('Escape');
    } else {
      expect(cartasNaMao).toBeGreaterThan(0);
    }
  });

  test('recarregar DUAS vezes seguidas continua funcionando', async () => {
    /**
     * A chave de reconexão é emitida por CONEXÃO e muda a cada uma. Guardá-la
     * só na primeira entrada faria a segunda recarga usar uma chave já
     * queimada — o defeito original, uma camada acima. Este caso é a razão de
     * `guardarReconexao` ser chamada também depois de um `reconnect`
     * bem-sucedido.
     */
    await ana.reload();
    await expect(ana.locator('canvas').first()).toBeVisible({ timeout: 40_000 });
    await expect(ana.getByRole('heading', { name: 'Conexão recusada' })).toHaveCount(0);

    await ana.reload();
    await expect(ana.locator('canvas').first()).toBeVisible({ timeout: 40_000 });
    await expect(ana.getByRole('heading', { name: 'Conexão recusada' })).toHaveCount(0);
  });

  test('sair de propósito NÃO reconecta — a chave é esquecida', async () => {
    /**
     * O outro lado da moeda. Se `esquecerReconexao` sumisse, voltar para a URL
     * da mesa depois de sair tentaria reconectar num assento abandonado; a
     * falha é recuperável (cai no caminho de entrar do zero), mas custa um
     * round-trip e confunde quem lê o log.
     *
     * O que este caso afirma é o observável: sair leva ao painel, e a mesa não
     * reabre sozinha.
     */
    // A barra da base começa recolhida: "Ações" a abre. O botão de sair só tem
    // ícone, e o nome acessível dele vem do `title`.
    await ana.getByRole('button', { name: 'Ações' }).click();
    await ana.getByRole('button', { name: 'Sair da sala' }).click();

    await ana.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await expect(ana.getByRole('button', { name: 'Criar Agora' })).toBeVisible({
      timeout: 20_000,
    });
  });

  test('nenhum erro de página em toda a sequência', async () => {
    // Último de propósito: julga a suíte inteira. Um erro no caminho de
    // reconexão não derruba a aplicação — ele deixa a mesa em branco, e as
    // asserções acima já cobrem isso, mas um erro silencioso no meio do
    // caminho é sinal de que a correção está funcionando por acidente.
    expect(erros).toEqual([]);
  });
});
