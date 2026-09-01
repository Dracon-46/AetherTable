import { defineConfig, devices } from '@playwright/test';
import type { ReporterDescription } from '@playwright/test';

/**
 * playwright.config.ts
 *
 * `pnpm test:e2e` já existia no `package.json` e apontava para `playwright
 * test` — sem config e sem NENHUM arquivo de teste. O comando falhava na hora,
 * e a pirâmide de testes de DOC-052 §2 prometia "~20 cenários E2E" que não
 * existiam.
 *
 * ESCOPO DESTA SUÍTE: o que roda SEM banco e SEM os dois serviços de pé.
 * Um E2E que exige Postgres, API e game-server no ar não roda em CI e vira
 * suíte ignorada — que é pior que suíte nenhuma, porque dá a impressão de
 * cobertura. Os cenários de partida (entrar na sala, comprar, mover carta)
 * precisam do stack completo e estão listados como pendência em
 * `docs/estado_de_implementacao.md`.
 *
 * O que é coberto aqui: renderização das telas públicas, responsividade real
 * (nada estourando a viewport), acessibilidade básica de formulário e o
 * roteamento entre login e cadastro.
 */
// Em CI: anotações inline no diff (`github`) + um relatório HTML que o
// workflow guarda como artefato quando algo falha.
const RELATORIOS_CI: ReporterDescription[] = [['github'], ['html', { open: 'never' }]];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? RELATORIOS_CI : 'list',

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3210',
    trace: 'on-first-retry',
    // Escape hatch para ambientes que já trazem um Chromium instalado (imagens
    // de CI, sandboxes sem rede para `playwright install`). Sem isso o
    // Playwright exige a revisão exata que ele mesmo baixaria e a suíte inteira
    // falha antes de abrir uma página.
    launchOptions: process.env.E2E_CHROMIUM_PATH
      ? { executablePath: process.env.E2E_CHROMIUM_PATH }
      : undefined,
  },

  // Sobe o build de produção: `next dev` tem overlay de erro e recompilação
  // sob demanda, que tornam o E2E lento e instável.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm build && pnpm start --port 3210',
        url: 'http://127.0.0.1:3210',
        // Deliberadamente `false`: reaproveitar um servidor já de pé faz a
        // suíte testar um build antigo sem avisar — aconteceu aqui, e os
        // testes de layout passaram contra CSS de outra versão. Para apontar
        // para um servidor existente, use `E2E_BASE_URL`, que é explícito.
        reuseExistingServer: false,
        timeout: 180_000,
      },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
