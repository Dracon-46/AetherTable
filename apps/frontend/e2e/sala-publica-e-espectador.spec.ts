import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zerarPreferenciasDeMesa } from './fixtures/estado-limpo';

/**
 * sala-publica-e-espectador.spec.ts — a vitrine de mesas e quem só assiste.
 *
 * ─── POR QUE ESTES DOIS ASSUNTOS NUM ARQUIVO SÓ ────────────────────────────
 *
 * Porque são um caminho só, do ponto de vista de quem usa: alguém abre a
 * Taverna, vê uma mesa que não pode entrar, e assiste. Separar em duas suítes
 * obrigaria a segunda a recriar a sala pública que a primeira acabou de montar
 * — e a montagem é a parte cara.
 *
 * ─── O QUE ELE PROTEGE QUE UM TESTE DE UNIDADE NÃO PEGA ───────────────────
 *
 * O modo espectador atravessa quatro camadas que só se encontram em execução:
 * a rota `POST /matches/:code/spectate` assina uma claim, o `onAuth` do
 * game-server lê essa claim para NÃO cobrar assento, o `onJoin` cria um
 * `Espectador` em vez de um `Player`, e a tela esconde os controles com base
 * no estado que voltou. Qualquer uma dessas quatro pode quebrar sozinha, e o
 * sintoma da maioria delas é silencioso: um espectador que ocupa assento, ou
 * uma barra de ações que aparece e só produz erro.
 *
 * ─── COMO RODAR ────────────────────────────────────────────────────────────
 *
 *   1. suba os três serviços (pnpm dev)
 *   2. node e2e/fixtures/preparar-jogadores.mjs
 *   3. E2E_BASE_URL=http://localhost:3030 npx playwright test sala-publica --project=desktop
 *
 * Sem `E2E_BASE_URL` a suíte pula inteira, em vez de derrubar o CI.
 */

const AQUI = __dirname;

interface Jogador {
  username: string;
  token: string;
  user: { id: string; username: string };
}

function carregarJogadores(): Jogador[] {
  try {
    // O arquivo é `{ senha, jogadores: [...] }`, e não um array solto — ler a
    // raiz devolve um objeto sem `.length`, e a suíte inteira pularia em
    // silêncio, que é exatamente o pior modo de falhar de um teste opt-in.
    const bruto = readFileSync(join(AQUI, 'fixtures', 'jogadores.json'), 'utf8');
    return JSON.parse(bruto).jogadores as Jogador[];
  } catch {
    return [];
  }
}

const JOGADORES = carregarJogadores();
const STACK_NO_AR = Boolean(process.env.E2E_BASE_URL) && JOGADORES.length >= 2;

/**
 * Nome único por execução.
 *
 * A vitrine é global e o banco é compartilhado: rodar a suíte duas vezes
 * deixaria duas "Mesa do Teste" abertas, e a busca acharia a da execução
 * anterior — que já morreu junto com o processo dela.
 */
const NOME_DA_MESA = `Mesa E2E ${Date.now().toString(36).toUpperCase()}`;

test.describe('sala pública e espectador', () => {
  test.skip(!STACK_NO_AR, 'exige o stack completo no ar + fixtures (ver o cabeçalho)');
  test.skip(({ isMobile }) => Boolean(isMobile), 'a vitrine e a mesa exigem tela larga');

  // Serial: os testes compartilham UMA sala, que é o objeto sob teste.
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  let contextos: BrowserContext[] = [];
  let ana: Page;
  let bruno: Page;

  async function abrirJogador(browser: Browser, jogador: Jogador) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
    await ctx.addInitScript(
      ([token, user]) => {
        window.localStorage.setItem(
          'aethertable-auth-storage',
          JSON.stringify({ state: { accessToken: token, user }, version: 0 }),
        );
      },
      [jogador.token, jogador.user] as [string, Jogador['user']],
    );
    contextos.push(ctx);
    return ctx.newPage();
  }

  test.beforeAll(async ({ browser }) => {
    // As duas suites usam as MESMAS contas, entao rodar esta depois da outra
    // herdava o estado dela — a ordem de execucao virava parte do resultado.
    await zerarPreferenciasDeMesa([JOGADORES[0]!.token, JOGADORES[1]!.token]);

    ana = await abrirJogador(browser, JOGADORES[0]!);
    bruno = await abrirJogador(browser, JOGADORES[1]!);
  });

  test.afterAll(async () => {
    for (const ctx of contextos) await ctx.close();
    contextos = [];
  });

  test('criar uma mesa PÚBLICA, com nome e sem lugar sobrando', async () => {
    await ana.goto('/dashboard');
    await ana.getByRole('button', { name: 'Criar Agora' }).click();
    await expect(ana.getByText('Forjar Nova Sala')).toBeVisible();

    // ESCOPADO AO DIÁLOGO. A vitrine tem os próprios selects de formato,
    // comunicação e idioma, e eles vêm antes no DOM: um `getByRole('combobox')`
    // solto acerta o filtro da lista em vez do campo do formulário.
    const modal = ana.getByRole('dialog');

    await modal.getByPlaceholder(/Mesa de/).fill(NOME_DA_MESA);

    // Pública é uma ESCOLHA: o padrão é privada, e o botão diz o que cada uma
    // significa em vez de só rotulá-las.
    await modal.getByRole('button', { name: /Pública/ }).click();

    // Mesa de um lugar só: ela nasce cheia, que é a condição para o botão do
    // outro jogador virar "Assistir" em vez de "Entrar".
    await modal.getByLabel('Formato').selectOption('freeform');
    await modal.getByLabel('Jogadores').selectOption('1');

    await modal.getByRole('button', { name: 'Entrar na Mesa' }).click();
    await ana.waitForURL(/\/play\/[A-F0-9]{6}/, { timeout: 30_000 });
    await expect(ana.getByRole('heading', { name: 'Sala de espera' })).toBeVisible({
      timeout: 30_000,
    });

    // A configuração assinada venceu: o rodapé do lobby lê do ESTADO da sala,
    // não da querystring — é a diferença que faz o convidado ver o mesmo que o
    // criador.
    await expect(ana.getByText('Pública', { exact: true })).toBeVisible();
  });

  test('a mesa aparece na vitrine de outra conta, e o botão certo é "Assistir"', async () => {
    await bruno.goto('/dashboard');

    // A vitrine se atualiza sozinha a cada 12 s; o botão força a ida agora.
    await bruno.getByRole('button', { name: 'Atualizar' }).click();

    const busca = bruno.getByPlaceholder('Buscar pelo nome da mesa');
    await busca.fill(NOME_DA_MESA);

    const cartao = bruno.locator('li', { hasText: NOME_DA_MESA });
    await expect(cartao).toBeVisible({ timeout: 30_000 });

    // SALA CHEIA NÃO SOME DA LISTA — ela vira conteúdo assistível. É o que
    // mantém a vitrine viva quando há poucas mesas abertas.
    await expect(cartao.getByText('1/1')).toBeVisible();
    await expect(cartao.getByRole('button', { name: 'Assistir' })).toBeVisible();
    await expect(cartao.getByRole('button', { name: 'Entrar' })).toHaveCount(0);
  });

  test('a busca da vitrine ignora acento e caixa', async () => {
    const busca = bruno.getByPlaceholder('Buscar pelo nome da mesa');

    await busca.fill(NOME_DA_MESA.toLowerCase());
    await expect(bruno.locator('li', { hasText: NOME_DA_MESA })).toBeVisible();

    // Um nome que não existe esvazia a lista, com o texto certo — e não com o
    // "nenhuma mesa aberta", que diria outra coisa.
    await busca.fill('mesa que nao existe zzz');
    await expect(bruno.getByText('Nenhuma mesa com esses filtros')).toBeVisible();

    await busca.fill(NOME_DA_MESA);
  });

  test('assistir entra na sala SEM ocupar assento', async () => {
    const cartao = bruno.locator('li', { hasText: NOME_DA_MESA });
    await cartao.getByRole('button', { name: 'Assistir' }).click();

    await bruno.waitForURL(/\/play\/[A-F0-9]{6}/, { timeout: 30_000 });
    await expect(bruno.getByRole('heading', { name: 'Você está assistindo' })).toBeVisible({
      timeout: 30_000,
    });

    // O ASSENTO NÃO FOI OCUPADO. Se `onAuth` tivesse cobrado assento desta
    // entrada, a mesa passaria a 2/1 — ou a entrada teria sido recusada com
    // ROOM_FULL, que é o que acontecia antes de `maxClients` separar plateia de
    // assentos.
    await expect(ana.getByText('Assistindo (1)')).toBeVisible({ timeout: 20_000 });
    await expect(ana.getByText('AETHER_BRUNO')).toBeVisible();
  });

  test('quem assiste não recebe controles de sala de espera', async () => {
    // Nem pronto, nem grimório: os dois prometeriam um lugar na mesa que o
    // passe de espectador não dá.
    await expect(bruno.getByRole('button', { name: /Estou pronto/ })).toHaveCount(0);
    await expect(bruno.getByText('Seu grimório')).toHaveCount(0);

    // Mas ele LÊ o que a mesa combinou — é metade do sentido de assistir.
    await expect(bruno.getByText('Configurações de jogo')).toBeVisible();
  });

  test('com a partida em andamento, o espectador vê a mesa e não a barra de ações', async () => {
    // A anfitriã escolhe o deck e começa sozinha (mesa de um lugar).
    await ana.getByLabel('Seu grimório').selectOption({ index: 1 });
    await expect(ana.getByText(/E2E Krenko · \d+ cartas/).first()).toBeVisible({
      timeout: 40_000,
    });

    await ana.getByRole('button', { name: 'Iniciar partida' }).click();
    await expect(ana.getByRole('heading', { name: 'Sua Mão Inicial' })).toBeVisible({
      timeout: 30_000,
    });
    await ana.getByRole('button', { name: 'Manter mão' }).click();

    // O lobby sai da frente do espectador junto com o da jogadora.
    await expect(bruno.getByRole('heading', { name: 'Você está assistindo' })).toHaveCount(0, {
      timeout: 30_000,
    });

    /**
     * ─── NENHUM CONTROLE QUE SÓ PRODUZIRIA ERRO ─────────────────────────────
     *
     * O servidor barra toda intenção de espectador menos o chat, então uma
     * barra de ações visível aqui não seria uma brecha — seria pior: um botão
     * que promete o que não existe. Eles ficam AUSENTES, não desabilitados.
     */
    await expect(bruno.getByRole('button', { name: 'Ações' })).toHaveCount(0);
    await expect(bruno.getByRole('button', { name: 'Mesa' })).toHaveCount(0);
    await expect(bruno.getByRole('heading', { name: 'Sua Mão Inicial' })).toHaveCount(0);

    // O que ele TEM: a mesa desenhada e o log/chat.
    await expect(bruno.getByText('Log & Chat')).toBeVisible();
  });

  test('o espectador comenta, e a mesa lê o comentário com o nome dele', async () => {
    // O chat é a única intenção que a plateia dispara — comentar é o conteúdo
    // inteiro de assistir. E ele chega assinado: sem a busca na plateia que o
    // `nomeDe` do servidor faz, o comentário sairia como "Alguem".
    // O log nasce recolhido — é o botão que expande, não o cabeçalho.
    await bruno.getByLabel('Expandir log').click();
    const campo = bruno.getByPlaceholder('Diga algo…');
    await expect(campo).toBeVisible();
    await campo.fill('boa jogada');
    await campo.press('Enter');

    await ana.getByLabel('Expandir log').click();
    await expect(ana.getByText('boa jogada')).toBeVisible({ timeout: 15_000 });
    // ASSINADO. O nome vem da plateia, que é um mapa separado de `players`:
    // sem a busca nos dois lados, o comentário aparecia com um pedaço do
    // sessionId no lugar do nome de quem falou.
    await expect(ana.getByText('AETHER_BRUNO', { exact: false }).first()).toBeVisible();
  });

  test('sair de assistir libera a vaga da plateia', async () => {
    await bruno.goto('/dashboard');
    // Espectador sai NA HORA, sem os 90 s de janela de reconexão: não há
    // assento nem cartas para guardar.
    await expect(ana.getByText('Assistindo (1)')).toHaveCount(0, { timeout: 20_000 });
  });
});
