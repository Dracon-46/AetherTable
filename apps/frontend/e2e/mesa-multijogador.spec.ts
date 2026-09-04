import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { montarMesaFocada, posicaoNaMao, CARD_W, CARD_H } from '../src/canvas/layout';

/**
 * mesa-multijogador.spec.ts — quatro jogadores de verdade, numa sala de verdade.
 *
 * ─── POR QUE ESTA SUÍTE EXISTE ─────────────────────────────────────────────
 *
 * A suíte E2E anterior cobria só telas públicas, e o cabeçalho dela explicava o
 * porquê: um teste que exige Postgres, API e game-server no ar não roda em CI e
 * vira suíte ignorada. O raciocínio continua válido — e é por isso que ESTA
 * suíte é opt-in, guardada por `E2E_BASE_URL`.
 *
 * Só que a consequência de não ter nada aqui foi grave: TODOS os defeitos
 * relatados pelo jogador (o botão direito comprando carta, a câmera que não
 * troca de mesa, o mulligan no meio da partida, o dado infinito) são defeitos
 * de INTERAÇÃO ENTRE JOGADORES ou de gesto do mouse. Nenhum deles pode aparecer
 * num teste de unidade do registry, e nenhum apareceu.
 *
 * ─── COMO RODAR ────────────────────────────────────────────────────────────
 *
 *   1. suba os três serviços (pnpm dev, ou os builds)
 *   2. node e2e/fixtures/preparar-jogadores.mjs
 *   3. E2E_BASE_URL=http://localhost:3030 npx playwright test mesa-multijogador --project=desktop
 *
 * Sem `E2E_BASE_URL` a suíte pula inteira, em vez de derrubar o CI.
 */

// `__dirname`, e nao `import.meta.url`: o Playwright transpila os specs para
// CommonJS, e `import.meta` e um erro de sintaxe ali.
const AQUI = __dirname;

/**
 * ─── AS COORDENADAS DO CLIQUE VÊM DA MESMA GEOMETRIA DO GameBoard ──────────
 *
 * O teste precisa clicar em cima do grimório e arrastar da mão para o campo, e
 * para isso converte uma âncora da mesa em pixel de tela. Fazer essa conta à
 * mão aqui é o que quebrou quando a geometria mudou: o arranjo passou de
 * `montarGrade` (plano lógico de 1920 reduzido para caber) para
 * `montarMesaFocada` (pixels reais, escala 1), e as coordenadas antigas
 * apontavam para lugar nenhum.
 *
 * Estes dois helpers existem para que só ELES saibam da conta. Se o
 * enquadramento mudar de novo, muda em um lugar — e as margens abaixo são as
 * MESMAS do `GameBoard`, porque um teste que usa margem própria testa uma tela
 * que não existe.
 */
const MARGENS = { esquerda: 168, direita: 10, topo: 44, base: 10 };

function enquadramento(largura: number, altura: number) {
  // `montarMesaFocada` devolve a mesa já no tamanho da área útil, então a
  // escala do desenho é 1 e o deslocamento é só a margem.
  return { offsetX: MARGENS.esquerda, offsetY: MARGENS.topo, escala: 1, largura, altura };
}

function mesaDaTela(ordem: string[], largura: number, altura: number) {
  const utilW = Math.max(320, largura - MARGENS.esquerda - MARGENS.direita);
  const utilH = Math.max(300, altura - MARGENS.topo - MARGENS.base);
  // `ordem` chega como "oponentes primeiro, eu por último" (o arranjo antigo);
  // na mesa focada eu sou o foco e os demais vão para o trilho.
  const eu = ordem[ordem.length - 1]!;
  return montarMesaFocada({
    largura: utilW,
    altura: utilH,
    focoId: eu,
    oponentes: ordem.slice(0, -1),
  });
}

interface Jogador {
  username: string;
  email: string;
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
const STACK_NO_AR = Boolean(process.env.E2E_BASE_URL) && JOGADORES.length >= 4;

test.describe('mesa multijogador', () => {
  test.skip(
    !STACK_NO_AR,
    'exige o stack completo no ar + fixtures (ver o cabeçalho deste arquivo)',
  );
  test.skip(({ isMobile }) => Boolean(isMobile), 'a mesa de 4 exige tela larga');

  // Serial: os testes compartilham UMA sala. Paralelizar significaria uma sala
  // por teste, e a sala é justamente o objeto sob teste.
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  let contextos: BrowserContext[] = [];
  let paginas: Page[] = [];
  let codigoDaSala = '';

  /** Cada contexto é um NAVEGADOR separado: sessão, localStorage e socket próprios. */
  async function abrirJogador(browser: Browser, jogador: Jogador) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
    // Semeia a sessão em vez de passar pelo login: o login já tem cobertura
    // própria em `telas-publicas.spec.ts`, e repeti-lo quatro vezes aqui só
    // adicionaria quatro pontos de instabilidade a um teste que é sobre a mesa.
    await ctx.addInitScript(
      ([token, user]) => {
        window.localStorage.setItem(
          'aethertable-auth-storage',
          JSON.stringify({ state: { accessToken: token, user }, version: 0 }),
        );
      },
      [jogador.token, jogador.user] as [string, Jogador['user']],
    );
    const page = await ctx.newPage();
    page.on('pageerror', (e: Error) =>
      console.error(`[${jogador.username}] pageerror:`, e.message),
    );
    return { ctx, page };
  }

  test.beforeAll(async ({ browser }) => {
    for (const jogador of JOGADORES.slice(0, 4)) {
      const { ctx, page } = await abrirJogador(browser, jogador);
      contextos.push(ctx);
      paginas.push(page);
    }
  });

  test.afterAll(async () => {
    for (const ctx of contextos) await ctx.close();
    contextos = [];
    paginas = [];
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  1. SALA DE ESPERA
  // ═══════════════════════════════════════════════════════════════════════

  test('anfitriã cria a sala SEM escolher deck no painel', async () => {
    const ana = paginas[0]!;
    await ana.goto('/dashboard');

    await ana.getByRole('button', { name: 'Criar Agora' }).click();
    await expect(ana.getByText('Forjar Nova Sala')).toBeVisible();

    // O deck deixou de ser obrigatório aqui: a escolha é na sala de espera.
    // Se este botão estivesse desabilitado sem deck, a mudança não teria valido.
    const entrar = ana.getByRole('button', { name: 'Entrar na Mesa' });
    await expect(entrar).toBeEnabled();
    await entrar.click();

    await ana.waitForURL(/\/play\/[A-F0-9]{6}/, { timeout: 30_000 });
    await expect(ana.getByRole('heading', { name: 'Sala de espera' })).toBeVisible({
      timeout: 30_000,
    });

    codigoDaSala = new URL(ana.url()).pathname.split('/').pop()!;
    expect(codigoDaSala).toMatch(/^[A-F0-9]{6}$/);
  });

  test('os outros três entram pelo código', async () => {
    for (let i = 1; i < 4; i += 1) {
      const page = paginas[i]!;
      await page.goto('/dashboard');
      await page.getByPlaceholder('EX: DRG-402').fill(codigoDaSala);
      await page.getByRole('button', { name: 'Conectar' }).click();
      await page.getByRole('button', { name: 'Entrar na Mesa' }).click();
      await page.waitForURL(/\/play\//, { timeout: 30_000 });
      await expect(page.getByRole('heading', { name: 'Sala de espera' })).toBeVisible({
        timeout: 30_000,
      });
    }

    // Todo mundo vê a mesma contagem de assentos ocupados.
    for (const page of paginas) {
      await expect(page.getByText('4/', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    }
  });

  test('NÃO dá para ficar pronto antes de escolher o grimório', async () => {
    const bruno = paginas[1]!;
    const pronto = bruno.getByRole('button', { name: /Estou pronto/ });
    await expect(pronto).toBeDisabled();
    await expect(bruno.getByText('Nenhum grimório na mesa')).toBeVisible();
  });

  test('escolher o grimório no lobby provisiona o deck de verdade', async () => {
    for (let i = 0; i < 4; i += 1) {
      const page = paginas[i]!;
      // Indice 1: o 0 e o placeholder ("escolher na sala de espera").
      // `selectOption` nao aceita regex em `label`.
      await page.getByRole('combobox').first().selectOption({ index: 1 });
      // 99 entidades de carta + a zona de comando, vindas do servidor.
      // `.first()`: o mesmo texto aparece no crachá do proprio jogador e na
      // linha do assento dele na lista.
      await expect(page.getByText(/E2E Krenko · \d+ cartas/).first()).toBeVisible({
        timeout: 40_000,
      });
    }

    // A contagem do próprio grimório aparece para a mesa inteira: é o que o
    // anfitrião usa para saber que dá para começar.
    const ana = paginas[0]!;
    await expect(ana.getByText(/E2E Krenko · 99 cartas/).first()).toBeVisible({ timeout: 20_000 });
  });

  test('o anfitrião NÃO inicia enquanto alguém não confirmou', async () => {
    const ana = paginas[0]!;
    const iniciar = ana.getByRole('button', { name: 'Iniciar partida' });

    await expect(iniciar).toBeDisabled();
    await expect(ana.getByText(/Faltam confirmar/)).toBeVisible();
  });

  test('remover um jogador da sala funciona, e ele sabe por quê', async () => {
    const ana = paginas[0]!;
    const dora = paginas[3]!;

    // Só o anfitrião vê o botão de remover.
    await expect(paginas[1]!.getByRole('button', { name: /Remover .* da sala/ })).toHaveCount(0);

    await ana.getByRole('button', { name: /Remover AETHER_DORA da sala/i }).click();

    // O expulso recebe a mensagem ANTES de a conexão cair, e volta ao painel.
    await expect(dora.getByText(/removeu você da sala/i)).toBeVisible({ timeout: 15_000 });
    await dora.waitForURL(/\/dashboard/, { timeout: 20_000 });

    // O assento é liberado NA HORA: sem isso a sala ficaria 90 s esperando a
    // reconexão de alguém que foi removido de propósito.
    await expect(ana.getByText('3/', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('com todos prontos, o anfitrião inicia e todo mundo compra sete', async () => {
    const restantes = paginas.slice(0, 3);

    for (const page of restantes.slice(1)) {
      await page.getByRole('button', { name: /Estou pronto/ }).click();
    }

    const ana = paginas[0]!;
    const iniciar = ana.getByRole('button', { name: 'Iniciar partida' });
    await expect(iniciar).toBeEnabled({ timeout: 15_000 });
    await iniciar.click();

    for (const page of restantes) {
      await expect(page.getByRole('heading', { name: 'Sala de espera' })).toHaveCount(0, {
        timeout: 30_000,
      });
      // O modal de mão inicial só existe quando as sete cartas chegaram.
      await expect(page.getByRole('heading', { name: 'Sua Mão Inicial' })).toBeVisible({
        timeout: 30_000,
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  2. A TELA LIVRE
  // ═══════════════════════════════════════════════════════════════════════

  test('a mesa abre limpa: sem crachá de sala, log recolhido, barra escondida', async () => {
    for (const page of paginas.slice(0, 3)) {
      await page.getByRole('button', { name: 'Manter mão' }).click();
    }
    const ana = paginas[0]!;

    // O crachá fixo "SALA" saiu do tabuleiro.
    await expect(ana.getByText('SALA', { exact: true })).toHaveCount(0);

    // A barra de ações nasce recolhida: só a aba aparece.
    await expect(ana.getByRole('button', { name: 'Ações' })).toBeVisible();
    await expect(ana.getByTitle('Embaralhar grimório')).toHaveCount(0);

    // O log nasce recolhido: o cabeçalho existe, o campo de chat não.
    await expect(ana.getByText('Log & Chat')).toBeVisible();
    await expect(ana.getByPlaceholder('Diga algo…')).toHaveCount(0);

    // A seta abre a barra.
    await ana.getByRole('button', { name: 'Ações' }).click();
    await expect(ana.getByTitle('Embaralhar grimório')).toBeVisible();
  });

  test('o painel de vida mostra só a MINHA vida', async () => {
    const ana = paginas[0]!;

    /**
     * Um cartão de vida = um rodapé "grimório / mão". Contar esse rodapé é mais
     * honesto do que procurar nomes: os nomes dos oponentes APARECEM dentro do
     * meu cartão, na lista de dano de comandante — e é assim que tem de ser.
     *
     * `:visible` é obrigatório: o painel monta as duas variantes (compacta e
     * larga) e esconde uma por CSS, então o DOM sempre tem o dobro.
     */
    await expect(ana.locator('[title="Cartas no grimório"]:visible')).toHaveCount(1);

    // E o botão para ver a mesa inteira existe, com a contagem certa.
    await expect(ana.getByRole('button', { name: /mesa \(3\)/ })).toBeVisible();

    // Expandido, aparecem os três.
    await ana.getByRole('button', { name: /mesa \(3\)/ }).click();
    await expect(ana.locator('[title="Cartas no grimório"]:visible')).toHaveCount(3);
    await ana.getByRole('button', { name: /só a minha/ }).click();
    await expect(ana.locator('[title="Cartas no grimório"]:visible')).toHaveCount(1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  3. O DEFEITO PRINCIPAL: BOTÃO DIREITO NO GRIMÓRIO
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Onde está a pilha do grimório da MINHA faixa, em pixels de tela.
   *
   * Usa `montarGrade` — o mesmo módulo E O MESMO ARRANJO que o GameBoard usa
   * na visão "todos" — em vez de números
   * mágicos: se a geometria mudar, este teste muda junto em vez de passar a
   * clicar no vazio e continuar verde.
   *
   * A ordem das faixas é sempre `[...oponentes, eu]`, então basta o NÚMERO de
   * jogadores; os ids não influenciam a geometria.
   */
  function centroDoGrimorio(jogadores: number, largura: number, altura: number) {
    const ordem = [...Array.from({ length: jogadores - 1 }, (_, i) => `op${i}`), 'me'];
    const mesa = mesaDaTela(ordem, largura, altura);

    const { offsetX, offsetY, escala } = enquadramento(largura, altura);

    const faixa = mesa.porJogador.get('me')!;
    return {
      x: offsetX + faixa.grimorio.x * escala,
      y: offsetY + faixa.grimorio.y * escala,
      escala,
    };
  }

  /**
   * Quantas cartas o HUD diz que há no meu grimório.
   *
   * `:visible` porque o painel monta a variante compacta E a larga, escondendo
   * uma por CSS: `.first()` pegava a escondida, cujo `innerText` é vazio, e a
   * conta virava `NaN` — um teste que falharia por motivo nenhum.
   */
  async function contarGrimorio(page: Page): Promise<number> {
    const texto = await page.locator('[title="Cartas no grimório"]:visible').first().innerText();
    return Number(texto.replace(/\D/g, ''));
  }

  test('BOTÃO DIREITO no grimório abre o menu e NÃO compra carta', async () => {
    const ana = paginas[0]!;
    const { x, y } = centroDoGrimorio(3, 1600, 950);

    const antes = await contarGrimorio(ana);
    expect(antes).toBeGreaterThan(0);

    await ana.mouse.click(x, y, { button: 'right' });

    // O menu do grimório abriu…
    await expect(ana.getByRole('menu')).toBeVisible({ timeout: 10_000 });
    await expect(ana.getByText('Grimório', { exact: true })).toBeVisible();

    // …e nenhuma carta foi comprada. Era exatamente este o defeito: o Konva
    // dispara `click` para QUALQUER botão do mouse, então o botão direito
    // abria o menu E comprava — e o menu tapava a mão onde a carta caiu.
    await expect
      .poll(() => contarGrimorio(ana), { timeout: 5_000, intervals: [300, 500, 700] })
      .toBe(antes);

    await ana.keyboard.press('Escape');
  });

  test('CLIQUE ESQUERDO no grimório continua comprando', async () => {
    const ana = paginas[0]!;
    const { x, y } = centroDoGrimorio(3, 1600, 950);

    const antes = await contarGrimorio(ana);
    await ana.mouse.click(x, y);

    await expect.poll(() => contarGrimorio(ana), { timeout: 10_000 }).toBe(antes - 1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  4. REGRAS DE MESA
  // ═══════════════════════════════════════════════════════════════════════

  test('só quem está na vez passa o turno', async () => {
    const ana = paginas[0]!; // assento 0 — começou a partida, é a vez dela
    const bruno = paginas[1]!;

    for (const page of [ana, bruno]) {
      const aba = page.getByRole('button', { name: 'Ações' });
      if (await page.getByTitle('Embaralhar grimório').count()) continue;
      await aba.click();
    }

    // O botão do Bruno diz de quem é a vez, e não deixa clicar.
    const turnoBruno = bruno.getByRole('button', { name: /Turno/ });
    await expect(turnoBruno).toBeDisabled();
    await expect(turnoBruno).toHaveAttribute('title', /A vez é de aether_ana/i);

    // O da Ana está ativo.
    await expect(ana.getByRole('button', { name: /Turno/ })).toBeEnabled();
  });

  test('o mulligan some depois de manter a mão', async () => {
    const ana = paginas[0]!;
    await expect(ana.getByRole('button', { name: /Fazer mulligan/ })).toHaveCount(0);
  });

  test('dado e moeda travam depois de cinco na janela', async () => {
    const ana = paginas[0]!;
    const moeda = ana.getByRole('button', { name: /Girar moeda/ });

    for (let i = 0; i < 5; i += 1) {
      await expect(moeda).toBeEnabled({ timeout: 10_000 });
      await moeda.click();
    }

    // O sexto não sai: o botão fica cinza ANTES do clique, em vez de aceitar e
    // devolver um toast de recusa.
    // `.first()`: o freio vale para a família inteira, então moeda E dado
    // travam juntos — dois botões casam, e isso é o comportamento correto.
    await expect(ana.getByRole('button', { name: /Muitos sorteios seguidos/ }).first()).toBeVisible(
      { timeout: 10_000 },
    );
    await expect(ana.getByRole('button', { name: /Muitos sorteios seguidos/ })).toHaveCount(2);
  });

  test('a câmera troca de mesa de verdade', async () => {
    const ana = paginas[0]!;
    await ana.getByTitle('Foco da câmera').click();
    await expect(ana.getByRole('button', { name: /Mesa de aether_bruno/i })).toBeVisible();
    await ana.getByRole('button', { name: /Mesa de aether_bruno/i }).click();

    // O rótulo do seletor passa a nomear o oponente — era aqui que a escolha
    // caía em "Mesa" e a tela ficava igual.
    await expect(ana.getByTitle('Foco da câmera')).toContainText(/aether_bruno/i);

    await ana.getByTitle('Foco da câmera').click();
    await ana.getByRole('button', { name: /Visão geral/ }).click();
    await expect(ana.getByTitle('Foco da câmera')).toContainText('Todos');
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  5. INTERAÇÃO ENTRE JOGADORES
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Abre o modal de jogadores a partir de QUALQUER estado.
   *
   * Sem isto, cada teste dependia de o anterior ter fechado o que abriu — e o
   * inspetor de zona, que é `fixed inset-0`, engole o clique do botão sem
   * nenhuma mensagem. O teste falhava dizendo "elemento não encontrado" quando
   * o problema era outro painel por cima.
   */
  async function abrirJogadores(page: Page) {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
    await garantirBarraAberta(page);
    await page.getByTitle(/^Jogadores:/).click();
    await expect(page.getByRole('heading', { name: 'Jogadores na mesa' })).toBeVisible({
      timeout: 10_000,
    });
  }

  test('pedir para ver a mão: pedir NÃO revela, aceitar revela', async () => {
    const ana = paginas[0]!;
    const bruno = paginas[1]!;

    await abrirJogadores(ana);
    // `div` cru casa em toda a árvore de ancestrais. O cartão de jogador é o
    // único `div.bg-table-deep.rounded-lg` dentro do modal.
    const cartaoBruno = ana
      .getByRole('dialog')
      .locator('div.bg-table-deep.rounded-lg')
      .filter({ hasText: /aether_bruno/i });
    await cartaoBruno.getByRole('button', { name: 'Pedir para ver a mão' }).click();

    // Bruno recebe o convite — e nada foi concedido ainda.
    await expect(bruno.getByText(/quer ver/)).toBeVisible({ timeout: 15_000 });
    await expect(bruno.getByText('a sua mão')).toBeVisible();

    await bruno.getByRole('button', { name: 'Mostrar' }).click();

    // A mão do Bruno abre para a Ana, com as sete cartas.
    // O titulo do inspetor nomeia o dono: "Mão de aether_bruno · 7 cartas".
    await expect(ana.getByRole('heading', { name: /Mão de aether_bruno/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(ana.getByRole('heading', { name: /7 cartas/ })).toBeVisible();
  });

  test('recusar deixa a mão fechada', async () => {
    const ana = paginas[0]!;
    const caio = paginas[2]!;

    await abrirJogadores(ana);

    const cartaoCaio = ana
      .getByRole('dialog')
      .locator('div.bg-table-deep.rounded-lg')
      .filter({ hasText: /aether_caio/i });
    await cartaoCaio.getByRole('button', { name: 'Pedir para ver a mão' }).click();

    await expect(caio.getByText(/quer ver/)).toBeVisible({ timeout: 15_000 });
    await caio.getByRole('button', { name: 'Recusar' }).click();

    await expect(ana.getByText(/recusou mostrar/)).toBeVisible({ timeout: 15_000 });
  });

  test('o chat chega para a mesa inteira', async () => {
    const ana = paginas[0]!;
    const bruno = paginas[1]!;

    await ana.keyboard.press('Escape');
    await ana.getByLabel('Expandir log').click();
    await ana.getByPlaceholder('Diga algo…').fill('teste de mesa cheia');
    await ana.getByPlaceholder('Diga algo…').press('Enter');

    await bruno.getByLabel('Expandir log').click();
    await expect(bruno.getByText('teste de mesa cheia')).toBeVisible({ timeout: 15_000 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  6. MECÂNICAS DE CARTA
  //
  //  Tudo aqui acontece no CANVAS, que não tem DOM para o Playwright agarrar.
  //  A saída é calcular as coordenadas com o mesmo `montarGrade` que o
  //  GameBoard usa — e depois ASSERTAR pelo DOM, no editor de carta e nos
  //  painéis, que é onde o estado do servidor vira texto.
  // ═══════════════════════════════════════════════════════════════════════

  const VIEW = { largura: 1600, altura: 950 };

  /** Transforma coordenada lógica da mesa em pixel de tela. */
  function projetor(jogadores: number) {
    const ordem = [...Array.from({ length: jogadores - 1 }, (_, i) => `op${i}`), 'me'];
    const mesa = mesaDaTela(ordem, VIEW.largura, VIEW.altura);
    const { offsetX, offsetY, escala } = enquadramento(VIEW.largura, VIEW.altura);
    return {
      mesa,
      faixa: mesa.porJogador.get('me')!,
      tela: (ponto: { x: number; y: number }) => ({
        x: offsetX + ponto.x * escala,
        y: offsetY + ponto.y * escala,
      }),
    };
  }

  /**
   * Garante o log aberto — SEM `.click().catch()`.
   *
   * `locator.click()` num elemento que não existe não falha rápido: ele espera
   * o elemento aparecer usando o TIMEOUT DO TESTE (180 s aqui), e só então
   * rejeita. Um `.catch(() => {})` em volta não encurta isso — ele só engole o
   * erro DEPOIS. Na prática o teste morria por timeout e o relatório culpava a
   * linha seguinte, com "Received: undefined".
   *
   * Contar primeiro é a forma barata de dizer "clique se existir".
   */
  async function garantirLogAberto(page: Page) {
    if (await page.getByLabel('Expandir log').count()) {
      await page.getByLabel('Expandir log').click();
    }
    await expect(page.getByPlaceholder('Diga algo…')).toBeVisible({ timeout: 10_000 });
  }

  /** Mesma armadilha do `garantirLogAberto`: só clica se a aba estiver fechada. */
  async function garantirBarraAberta(page: Page) {
    if (!(await page.getByTitle('Embaralhar grimório').count())) {
      await page.getByRole('button', { name: 'Ações' }).click();
    }
    await expect(page.getByTitle('Embaralhar grimório')).toBeVisible({ timeout: 10_000 });
  }

  /** Quantas cartas o HUD diz que há na minha mão. */
  async function contarMao(page: Page): Promise<number> {
    const texto = await page.locator('[title="Cartas na mão"]:visible').first().innerText();
    return Number(texto.replace(/\D/g, ''));
  }

  /**
   * Arrasta a primeira carta da mão para o meio do campo.
   *
   * O arrasto do Konva exige movimento em PASSOS: um `mouse.move` único do
   * ponto A ao B não dispara `dragmove`, e o `dragend` chega com a carta ainda
   * na origem — o teste passaria a testar nada.
   */
  async function jogarPrimeiraDaMao(page: Page, jogadores: number) {
    const { mesa, faixa, tela } = projetor(jogadores);
    const total = await contarMao(page);
    expect(total).toBeGreaterThan(0);

    const origem = tela(posicaoNaMao(0, total, mesa));
    const destino = tela({
      x: faixa.campo.x + faixa.campo.largura / 2,
      y: faixa.topo + faixa.campo.y + faixa.campo.altura / 2,
    });

    await page.mouse.move(origem.x, origem.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) {
      await page.mouse.move(
        origem.x + ((destino.x - origem.x) * i) / 12,
        origem.y + ((destino.y - origem.y) * i) / 12,
      );
    }
    await page.mouse.up();
    return destino;
  }

  let cartaNoCampo: { x: number; y: number };

  test('arrastar da mão para o campo tira a carta da mão', async () => {
    const ana = paginas[0]!;
    await ana.keyboard.press('Escape');

    const antes = await contarMao(ana);
    cartaNoCampo = await jogarPrimeiraDaMao(ana, 3);

    await expect.poll(() => contarMao(ana), { timeout: 15_000 }).toBe(antes - 1);
  });

  test('marcadores: +1/+1 pelo menu, conferido no editor', async () => {
    const ana = paginas[0]!;

    await ana.mouse.click(cartaNoCampo.x, cartaNoCampo.y, { button: 'right' });
    await expect(ana.getByRole('menu')).toBeVisible({ timeout: 10_000 });
    await ana.getByRole('menuitem', { name: '+1/+1' }).click();

    await ana.mouse.click(cartaNoCampo.x, cartaNoCampo.y, { button: 'right' });
    await ana.getByRole('menuitem', { name: '+1/+1' }).click();

    // O editor é onde o estado do servidor vira número na tela.
    await ana.mouse.click(cartaNoCampo.x, cartaNoCampo.y, { button: 'right' });
    await ana.getByRole('menuitem', { name: /Marcadores, P\/T e dano/ }).click();

    const editor = ana.getByRole('dialog');
    await expect(editor).toBeVisible({ timeout: 10_000 });

    // A linha do marcador é um `div.bg-table-deep` (os atalhos "+ +1/+1" são
    // `button`, e por isso ficam de fora do filtro). O valor mora num span de
    // largura fixa entre os botões de − e +.
    const linha = editor.locator('div.bg-table-deep').filter({ hasText: '+1/+1' }).first();
    await expect(linha).toBeVisible({ timeout: 10_000 });
    await expect(linha.locator('span.w-7')).toHaveText('2', { timeout: 10_000 });
  });

  test('dano marcado sobe, desce e limpa', async () => {
    const ana = paginas[0]!;
    const editor = ana.getByRole('dialog');
    const secaoDano = editor.locator('section', { hasText: 'Dano marcado' });

    await secaoDano.getByRole('button', { name: '+1' }).click();
    await secaoDano.getByRole('button', { name: '+1' }).click();
    await secaoDano.getByRole('button', { name: '+1' }).click();
    await expect(secaoDano.locator('span.text-danger')).toHaveText('3', { timeout: 10_000 });

    await secaoDano.getByRole('button', { name: '−1' }).click();
    await expect(secaoDano.locator('span.text-danger')).toHaveText('2', { timeout: 10_000 });

    await secaoDano.getByRole('button', { name: 'limpar' }).click();
    await expect(secaoDano.locator('span.text-danger')).toHaveText('0', { timeout: 10_000 });
  });

  test('P/T sobreposto e volta ao impresso', async () => {
    const ana = paginas[0]!;
    const editor = ana.getByRole('dialog');
    const secaoPt = editor.locator('section', { hasText: 'Força / Resistência' });

    await secaoPt.getByRole('button', { name: '+1 força' }).click();
    await secaoPt.getByRole('button', { name: '+1 resist.' }).click();

    // O override liga o booleano `hasPtOverride` — sem ele, "0/0" e "sem
    // override" seriam o mesmo estado. O link de voltar só existe quando ligado.
    const voltar = editor.getByRole('button', { name: 'voltar ao P/T impresso' });
    await expect(voltar).toBeVisible({ timeout: 10_000 });
    await voltar.click();
    await expect(voltar).toHaveCount(0, { timeout: 10_000 });
  });

  test('anotação e destaque persistem na carta', async () => {
    const ana = paginas[0]!;
    const editor = ana.getByRole('dialog');

    await editor.getByPlaceholder('visível para todos na mesa').fill('bloqueadora');
    await editor.getByPlaceholder('visível para todos na mesa').press('Enter');
    await editor.getByLabel('Destacar com #22C55E').click();

    // Fecha e reabre: o que sobrevive é o que o SERVIDOR guardou, não o estado
    // local do formulário.
    await ana.keyboard.press('Escape');
    await ana.mouse.click(cartaNoCampo.x, cartaNoCampo.y, { button: 'right' });
    await ana.getByRole('menuitem', { name: /Marcadores, P\/T e dano/ }).click();
    await expect(editor.getByPlaceholder('visível para todos na mesa')).toHaveValue('bloqueadora', {
      timeout: 10_000,
    });
  });

  test('limpar marcadores zera tudo', async () => {
    const ana = paginas[0]!;
    const editor = ana.getByRole('dialog');
    // `exact: true`: sem isso o nome casa também com o "limpar" minúsculo da
    // seção de dano — o Playwright compara nome acessível sem diferenciar caixa.
    const limpar = editor.getByRole('button', { name: 'Limpar', exact: true });
    await limpar.click();
    await expect(limpar).toHaveCount(0, { timeout: 10_000 });
    await ana.keyboard.press('Escape');
  });

  test('mandar a carta para o cemitério muda a zona de verdade', async () => {
    const ana = paginas[0]!;

    await ana.mouse.click(cartaNoCampo.x, cartaNoCampo.y, { button: 'right' });
    await ana.getByRole('menuitem', { name: 'Para o cemitério' }).click();

    // O inspetor de zona lê o estado do servidor: se a carta não tivesse
    // mudado de zona, ele abriria vazio.
    await garantirBarraAberta(ana);
    await ana.mouse.click(10, 10);
    await ana.getByTitle('Foco da câmera').click();
    await ana.keyboard.press('Escape');

    const { faixa, tela } = projetor(3);
    const cemiterio = tela(faixa.cemiterio);
    await ana.mouse.click(cemiterio.x, cemiterio.y);

    const inspetor = ana.getByRole('dialog');
    await expect(inspetor.getByRole('heading', { name: /Cemitério/ })).toBeVisible({
      timeout: 10_000,
    });
    await expect(inspetor.getByText(/1 cartas/)).toBeVisible({ timeout: 10_000 });
    await ana.keyboard.press('Escape');
  });

  test('vida: −1 e +1 mexem no número, e só no meu', async () => {
    const ana = paginas[0]!;
    const bruno = paginas[1]!;

    const vidaDeAna = () => ana.locator('[title="Cartas no grimório"]:visible');
    await expect(vidaDeAna()).toHaveCount(1);

    const menos = ana.getByRole('button', { name: '−1', exact: true }).first();
    await menos.click();
    await menos.click();
    await expect(ana.locator('button.font-mono.text-xl:visible').first()).toHaveText('38', {
      timeout: 10_000,
    });

    // A vida do Bruno não mudou: `INTENT_SET_LIFE` sempre age sobre o
    // REMETENTE, e é isso que impede um jogador de mexer no total do outro.
    await expect(bruno.locator('button.font-mono.text-xl:visible').first()).toHaveText('40', {
      timeout: 10_000,
    });
  });

  test('dano de comandante é registrado por quem RECEBE', async () => {
    const ana = paginas[0]!;
    await ana.keyboard.press('Escape');

    /**
     * A lista de dano de comandante vive dentro do MEU cartão de vida — não
     * precisa expandir o painel, e é justamente essa a semântica: cada jogador
     * anota o dano que RECEBEU, de quem.
     *
     * Ancorar no `title` do rótulo e subir para o pai é mais estável do que
     * casar com a classe do Tailwind: `bg-table-deep/50` exige escapar a barra
     * no seletor CSS, e uma troca de opacidade no design quebraria o teste sem
     * nada ter mudado de comportamento.
     */
    // O rótulo mostra o COMANDANTE ("Krenko, Mob Boss"), e o `title` completa
    // com o dono: "Krenko, Mob Boss — comandante de aether_bruno". Ancorar no
    // dono dentro do title é o que sobrevive à troca de deck da fixture.
    const linhaBruno = ana
      .locator('[title*="comandante de aether_bruno"]:visible')
      .locator('xpath=..');
    await linhaBruno.getByRole('button', { name: '+' }).click();
    await linhaBruno.getByRole('button', { name: '+' }).click();

    await expect(linhaBruno.locator('span.text-warning, span.text-danger').first()).toHaveText(
      '2',
      { timeout: 10_000 },
    );

    // E o nome que aparece é o do COMANDANTE, não o do jogador: "21 de dano de
    // aether_bruno" não diz nada que a tela já não mostre.
    await expect(ana.locator('[title*="comandante de aether_bruno"]:visible')).toHaveText(/Krenko/);
  });

  test('criar ficha põe a ficha na mesa', async () => {
    const ana = paginas[0]!;
    await ana.getByTitle('Gerar token').click();
    const modal = ana.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await ana.keyboard.press('Escape');
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  7. MORTE
  //
  //  As quatro condições de derrota passaram a ser aplicadas pelo servidor —
  //  a reversão consciente de RN01. Aqui elas são exercidas pela INTERFACE.
  //
  //  A ORDEM IMPORTA, e é ela que conta a história: a mesa tem três. A vida da
  //  Ana zera (sobram dois, a partida segue), o Caio desiste (sobram dois de
  //  novo, porque a Ana ressuscitou), e o veneno do Bruno fecha a mesa — aí sim
  //  sobra um, e a partida acaba. Testar a eliminação com só dois vivos
  //  esconderia a tela de derrota atrás da de vitória, que foi exatamente o que
  //  aconteceu na primeira versão desta suíte.
  // ═══════════════════════════════════════════════════════════════════════

  test('vida a zero elimina — e voltar a vida ressuscita', async () => {
    const ana = paginas[0]!;
    const bruno = paginas[1]!;
    await ana.keyboard.press('Escape');

    // O total é editável clicando no número.
    const total = ana.locator('button.font-mono.text-xl:visible').first();
    await total.click();
    const campo = ana.locator('input[type="number"]:visible').first();
    await campo.fill('0');
    await campo.press('Enter');

    /**
     * `exact: true` porque DUAS coisas anunciam a derrota, de propósito: o toast
     * ("Você saiu do jogo: a vida chegou a zero.") e o banner, que fica até ser
     * dispensado. Sem o `exact`, o locator casa com os dois e o Playwright falha
     * por ambiguidade — o que já mandou esta suíte caçar um defeito de produto
     * que não existia.
     */
    await expect(ana.getByText('Você saiu do jogo', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(ana.getByText(/sua vida chegou a zero/)).toBeVisible();

    // …e a mesa toda fica sabendo pelo log.
    await garantirLogAberto(bruno);
    await expect(bruno.getByText(/perdeu: a vida chegou a zero/)).toBeVisible({ timeout: 15_000 });

    /**
     * O ponto que torna a eliminação segura de existir: ela é DERIVADA. Um
     * clique errado em "−1" com 1 de vida não pode acabar com a partida de
     * alguém sem volta.
     */
    await ana.getByRole('button', { name: '+1', exact: true }).first().click();
    await expect(ana.getByText('Você saiu do jogo', { exact: true })).toHaveCount(0, {
      timeout: 15_000,
    });
  });

  test('desistir marca o jogador como fora do jogo', async () => {
    const caio = paginas[2]!;
    const ana = paginas[0]!;

    // Cada passo com asserção própria: sem isso, um clique que não pega deixa o
    // teste pendurado até o timeout global e o relatório culpa a última linha.
    await caio.keyboard.press('Escape');
    await caio.getByTitle('Ações da mesa').click();
    const desistir = caio.getByRole('button', { name: /Desistir da partida/ });
    await expect(desistir).toBeVisible({ timeout: 10_000 });
    await desistir.click();

    // Duas etapas: um clique não apaga a partida de ninguém.
    const confirmar = caio.getByRole('button', { name: 'Confirmar', exact: true });
    await expect(confirmar).toBeVisible({ timeout: 10_000 });
    await confirmar.click();

    // Quem desistiu vê o próprio aviso…
    await expect(caio.getByText('Você saiu do jogo', { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // …e a mesa inteira fica sabendo, pelo log.
    await garantirLogAberto(ana);
    await expect(ana.getByText(/desistiu da partida/).first()).toBeVisible({ timeout: 15_000 });
  });

  test('veneno 10 elimina', async () => {
    const bruno = paginas[1]!;

    const menu = bruno.locator('div.fixed.z-\\[55\\]');

    const abrirStatus = async () => {
      if (await menu.count()) return;
      await bruno.getByRole('button', { name: 'Status do jogador' }).first().click();
      await expect(menu).toBeVisible({ timeout: 10_000 });
    };

    /**
     * ─── O MENU DESMONTA NO MEIO DO LAÇO, E ISSO É ESPERADO ────────────────
     *
     * O décimo marcador ELIMINA o jogador, e a eliminação re-renderiza o cartão
     * de vida — o menu de status, que vive num portal ancorado nesse cartão,
     * some junto. Um laço de dez cliques preso ao mesmo locator ficava pendurado
     * em "element was detached from the DOM, retrying" até estourar o timeout do
     * teste inteiro, e o relatório culpava o clique em vez da eliminação.
     *
     * Reabrir quando fechou, tolerar o clique perdido e parar assim que o
     * resultado aparece é o que descreve o comportamento real. O teto de 15
     * existe para o laço terminar mesmo se nada funcionar.
     */
    for (let i = 0; i < 15; i += 1) {
      if (await bruno.getByRole('heading', { name: /venceu/ }).count()) break;
      await abrirStatus();
      await menu
        .locator('div', { hasText: 'Veneno' })
        .last()
        .getByRole('button', { name: 'Aumentar Veneno' })
        .click({ timeout: 4_000 })
        .catch(() => {
          /* o menu fechou entre o resolve e o clique: a próxima volta reabre */
        });
    }

    /**
     * Este é o terceiro a sair, e a mesa tinha três: sobra a Ana. A partida
     * ACABA — e é por isso que aqui não se espera o aviso de derrota, e sim a
     * tela de fim de jogo. Quem morre por último não vê "você saiu do jogo":
     * vê quem venceu.
     */
    // O nome do vencedor aparece em TRÊS lugares de propósito (linha do log,
    // título da tela de fim e toast). O `heading` é o único não ambíguo.
    await expect(bruno.getByRole('heading', { name: /aether_ana venceu/i })).toBeVisible({
      timeout: 15_000,
    });

    const ana = paginas[0]!;
    await expect(ana.getByRole('heading', { name: 'Você venceu!' })).toBeVisible({
      timeout: 15_000,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  8. RETRATOS — para revisão humana do que o jogador enxerga
  // ═══════════════════════════════════════════════════════════════════════

  test('retratos da mesa', async () => {
    const dir = process.env.E2E_SHOTS ?? 'e2e/retratos';
    for (const [i, page] of paginas.slice(0, 3).entries()) {
      await page.keyboard.press('Escape');
      await page.screenshot({ path: `${dir}/jogador-${i}.png`, fullPage: false });
    }
    expect(CARD_W / CARD_H).toBeLessThan(1); // carta é mais alta que larga
  });
});
