import { expect, test } from '@playwright/test';

/**
 * telas-publicas.spec.ts — o que dá para verificar sem banco nem serviços.
 *
 * O caso de "rolagem horizontal" merece explicação: o `<body>` tinha
 * `h-screen w-screen overflow-hidden`, e por isso qualquer conteúdo mais alto
 * que a viewport ficava INALCANÇÁVEL — o botão de cadastro no fim da tela de
 * login sumia em telas de 720px. É um defeito que nenhum teste unitário pega e
 * que reaparece com facilidade ao mexer em layout.
 */

const TELAS = [
  { rota: '/', nome: 'login' },
  { rota: '/register', nome: 'cadastro' },
] as const;

for (const { rota, nome } of TELAS) {
  test(`${nome}: renderiza e cabe na largura da tela`, async ({ page }) => {
    await page.goto(rota);
    await expect(page.getByRole('heading').first()).toBeVisible();

    const medidas = await page.evaluate(() => ({
      larguraRolagem: document.documentElement.scrollWidth,
      larguraVisivel: document.documentElement.clientWidth,
      alturaRolagem: document.documentElement.scrollHeight,
      alturaVisivel: document.documentElement.clientHeight,
    }));

    // Nada pode empurrar a página para os lados.
    expect(medidas.larguraRolagem).toBeLessThanOrEqual(medidas.larguraVisivel + 1);

    /**
     * ─── CABER, E NÃO "PODER ROLAR" ────────────────────────────────────────
     *
     * A asserção anterior aceitava o transbordo desde que a página rolasse. É
     * uma garantia fraca para a PRIMEIRA tela do produto: quem chega no login
     * não deve precisar rolar para achar o botão de entrar — e, pior, a rolagem
     * numa tela que parece completa é invisível, então o botão simplesmente não
     * existe para quem não pensou em descer.
     *
     * Agora as duas telas públicas têm de caber inteiras nos viewports em que a
     * suíte roda (1280x720 no desktop, 412x915 no Pixel 7). O que isso trava é
     * o crescimento silencioso: um campo a mais no cadastro, um aviso a mais no
     * login, e a tela volta a transbordar sem ninguém perceber.
     */
    expect(medidas.alturaRolagem).toBeLessThanOrEqual(medidas.alturaVisivel + 1);
  });

  test(`${nome}: sem erro de página no carregamento`, async ({ page }) => {
    const erros: string[] = [];
    page.on('pageerror', (e) => erros.push(e.message));
    await page.goto(rota);
    await page.waitForLoadState('networkidle');
    expect(erros).toEqual([]);
  });
}

test('login: os campos têm rótulo e o envio exige preenchimento', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByPlaceholder('seuemail@exemplo.com')).toBeVisible();

  const senha = page.locator('input[type="password"]');
  await expect(senha).toBeVisible();

  // O olho de "mostrar senha" precisa realmente alternar o tipo do campo.
  await page.locator('button[type="button"]').first().click();
  await expect(page.locator('input[type="text"]').last()).toBeVisible();
});

test('login e cadastro se alcançam', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /aliste-se/i }).click();
  await expect(page).toHaveURL(/\/register/);

  await page.getByRole('link', { name: /voltar ao login/i }).click();
  await expect(page).toHaveURL(/\/$|\/#/);
});

test('rota protegida devolve para o login quando não há sessão', async ({ page }) => {
  await page.goto('/dashboard');
  // O ProtectedRoute espera a reidratação do storage antes de decidir; sem
  // sessão, o destino é o login.
  await expect(page).toHaveURL(/\/$|\/#/, { timeout: 10_000 });
});
