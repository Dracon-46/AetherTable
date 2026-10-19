// Config raiz (flat config, ESLint 9). Cada pacote roda `eslint src` e herda
// esta base; a raiz roda `eslint tools` (ver `lint:raiz` no package.json).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';

/** Specs e E2E: o que roda no Jest e no Playwright, não em produção. */
const TESTES = ['**/*.spec.{ts,tsx}', '**/e2e/**/*.ts'];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.d.ts',
      // Configs CommonJS de ferramentas: `module.exports` não é erro aqui.
      '**/jest.config.js',
      '**/jest.setup.js',
      '**/*.config.cjs',
    ],
  },
  js.configs.recommended,
  // ─── LINT COM TIPOS ─────────────────────────────────────────────────────────
  //
  // O preset `recommended` sem tipos olha cada arquivo isolado e não sabe o que
  // uma expressão devolve. Por isso ele não via a classe de defeito mais cara
  // deste projeto: a promessa que ninguém espera. Um `fetch` sem `await` num
  // handler, um `async` passado onde se esperava `void` — o erro vira rejeição
  // sem dono e some, sem log e sem teste vermelho.
  //
  // Com o `projectService`, cada arquivo é lido pelo `tsconfig.json` do próprio
  // pacote, e as regras sabem o tipo de verdade: `no-floating-promises`,
  // `no-misused-promises`, `no-base-to-string` ("[object Object]" na tela),
  // `no-unsafe-*` (o `any` que vaza de um ponto para o resto do código).
  //
  // O preset `stylistic` entra junto para o código ter UM jeito de escrever a
  // mesma coisa (`T[]` e não `Array<T>`, `a?.b` e não `a && a.b`), e quem revisa
  // não gastar atenção com isso.
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'smart'],
      'no-console': 'off',
      // `onClick={async () => …}` é o jeito do React de disparar uma ação
      // assíncrona; o atributo JSX descarta o retorno de propósito. Fora do
      // JSX — `setTimeout(async …)`, `.forEach(async …)`, `app.get(…, async)` —
      // a regra continua valendo inteira.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      // `||` em string é deliberado neste código: variável de ambiente VAZIA e
      // nome de exibição em branco precisam cair no padrão, e `??` deixaria a
      // string vazia passar. Para número, objeto e booleano a regra vale.
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        { ignorePrimitives: { string: true } },
      ],
      // `() => {}` é o "não faça nada" explícito de callback e de `.catch`; uma
      // função ou método vazio continua sendo acusado.
      '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],
    },
  },
  {
    // JavaScript não tem tipos para as regras com tipos lerem. Fica DEPOIS do
    // bloco acima porque configurar uma regra religa a regra.
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // TESTES: o dublê é `any` por natureza.
    //
    // `jest.fn()` devolve `any`, e um mock de PrismaService com quarenta métodos
    // não ganha nada sendo tipado método a método. As regras `no-unsafe-*` só
    // acusariam o próprio dublê. `unbound-method` acusa o idioma
    // `expect(obj.metodo).toHaveBeenCalled()`, e `require-await` acusa o mock que
    // é `async` para imitar a assinatura do método real.
    files: TESTES,
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // Scripts de apoio (`apps/*/scripts/**`, `tools/**`, fixtures de E2E) rodam
    // no Node, fora do bundle: `require`, `module`, `console` e `process` são
    // globais legítimos ali. Sem isto o lint acusava `no-undef` em cada linha
    // desses arquivos.
    //
    // `e2e/**/*.mjs` entrou junto com `preparar-jogadores.mjs`, que cria as
    // contas e os decks da suíte multijogador. Ele é um script de linha de
    // comando como os de `tools/` — não é código de navegador, e tratá-lo como
    // tal fazia o lint acusar `fetch`, `console` e `process` como indefinidos.
    files: ['**/scripts/**/*.{js,cjs,mjs,ts}', '**/tools/**/*.{js,mjs}', '**/e2e/**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        // Node 22 tem `fetch` global (undici) — o mesmo que os serviços usam.
        fetch: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // `consistent-type-imports` É INCOMPATÍVEL COM O NEST — e o estrago é mudo.
    //
    // O backend compila com `emitDecoratorMetadata`, e é dela que o Nest tira o
    // `design:paramtypes` de cada construtor para saber o que injetar. Um
    // `import type` some no JS emitido: o parâmetro vira `Function` e o
    // container falha no boot com "Nest can't resolve dependencies of the
    // DecksService (?)" apontando `[Function: Function]`.
    //
    // Não é hipótese. Um `pnpm lint:fix` aplicou o autofix desta regra nos 14
    // imports de injetáveis (PrismaService, JwtService, AuthService, …) e
    // derrubou a API inteira — o typecheck passava, o build passava, e só o
    // runtime acusava. A própria documentação do typescript-eslint desaconselha
    // a regra em projetos com `emitDecoratorMetadata`.
    //
    // Tipos de verdade (interfaces, aliases) continuam podendo usar
    // `import type` à mão; o que fica proibido é o autofix decidir isso.
    files: ['apps/backend-core/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    // REGRAS DOS HOOKS — não estavam habilitadas, e o preço foi alto.
    //
    // A auditoria encontrou quatro violações que só se manifestavam em runtime,
    // todas derrubando a mesa inteira:
    //   - CardInspector e ZoneInspector com `return null` ANTES do useEffect;
    //   - ActionBar e LifePanel chamando hooks do LiveKit dentro de try/catch.
    // Nenhuma delas aparecia no lint nem no typecheck. Com o plugin ligado,
    // qualquer reincidência falha o `pnpm lint`.
    files: ['apps/frontend/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // O PLUGIN DO NEXT NUNCA TINHA RODADO.
    //
    // O frontend usava `next lint`, que procura o plugin do Next na config — e
    // esta config nunca o carregou: o `next lint` avisava "The Next.js plugin was
    // not detected" e seguia só com as regras genéricas. As regras do Next
    // (`<img>` sem otimização, `<a>` para rota interna, scripts síncronos,
    // Core Web Vitals) não eram verificadas em lugar nenhum. E o `next lint`
    // está deprecado: sai no Next 16. O frontend passou para a CLI do ESLint, com
    // o plugin declarado aqui.
    files: ['apps/frontend/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    settings: { next: { rootDir: 'apps/frontend/' } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // Regra do roteador `pages/`. O projeto é App Router: sem a pasta, a regra
      // só emitia "Pages directory cannot be found" a cada execução.
      '@next/next/no-html-link-for-pages': 'off',
      // ARTE DE CARTA NÃO PASSA PELO OTIMIZADOR DO NEXT, DE PROPÓSITO.
      //
      // Toda imagem de carta vem de `GET /api/v1/cards/img/:id`, que já serve a
      // versão no tamanho certo da CDN da Scryfall. O `next/image` poria o
      // otimizador da Vercel no meio: cada carta de cada deck viraria uma
      // "transformação", e a cota do plano gratuito acaba numa tarde de
      // deckbuilding. O `<img loading="lazy">` é a ferramenta certa aqui.
      '@next/next/no-img-element': 'off',
    },
  },
  {
    // RN06: aleatoriedade no game server vem SEMPRE de services/rng.ts (CSPRNG).
    // Math.random() em qualquer outro lugar do game server e bloqueante em revisao.
    files: ['apps/game-server/src/**/*.ts'],
    ignores: ['apps/game-server/src/services/rng.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'RN06: use services/rng.ts (crypto.randomInt). Math.random() nao e aceitavel no game server.',
        },
      ],
    },
  },
);
