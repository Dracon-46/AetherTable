/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        // O tsconfig do app usa `module: node16` com `isolatedModules: false`
        // (os decoradores do @colyseus/schema exigem isso). O ts-jest avisava a
        // cada arquivo transformado — 8 blocos de ruído por execução, que
        // escondiam o resultado real dos testes.
        diagnostics: { ignoreCodes: [151002] },
      },
    ],
  },
};
