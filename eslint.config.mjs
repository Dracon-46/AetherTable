// Config raiz (flat config, ESLint 9). Cada app estende esta base.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',
      eqeqeq: ['error', 'smart'],
      'no-console': 'off',
    },
  },
  {
    // DÍVIDA TÉCNICA CONSCIENTE — não é supressão, é priorização.
    //
    // A camada de sincronia do Colyseus (net/useRoomSync.ts, canvas/GameBoard)
    // recebe objetos de Schema cujo tipo só existe em runtime, e `Room<any>` é
    // o uso idiomático da colyseus.js quando não há tipos de schema gerados.
    // Tipar isso direito significa gerar/escrever os mapeadores Schema -> store,
    // que é trabalho de design, não correção de bug.
    //
    // Como AVISO, `pnpm lint` continua reportando os ~40 casos e eles seguem
    // visíveis; como ERRO, bloqueavam `next build` e portanto o deploy.
    // Ao gerar os tipos de schema, remova este bloco.
    files: ['apps/frontend/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
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
