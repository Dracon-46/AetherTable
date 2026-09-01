/**
 * jest.config.js — testes do backend-core.
 *
 * POR QUE ESTE ARQUIVO PASSOU A EXISTIR
 *
 * O script era `jest --passWithNoTests` sem configuração nenhuma. Sem preset, o
 * Jest cai no Babel padrão, que não entende TypeScript: qualquer `.spec.ts`
 * morria com "Missing semicolon" na primeira anotação de tipo.
 *
 * Pior que falhar era o que acontecia depois. Sem `roots`, o Jest varria a pasta
 * inteira e encontrava os `.spec.js` COMPILADOS em `dist/` — de um build velho,
 * de código que talvez nem exista mais. A suíte terminava verde testando o
 * passado, e o `--passWithNoTests` garantia verde mesmo quando não achava nada.
 *
 * `ts-jest` já era dependência de desenvolvimento desde o início; só nunca
 * tinha sido ligado.
 */

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Só o fonte. `dist/` fica de fora por construção, não por lista de exclusão.
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        // O app compila com `module: node16`, então os imports relativos levam
        // a extensão `.js` mesmo apontando para `.ts`. É o Nest com ESM, e o
        // resolvedor do Jest precisa desfazer isso.
        diagnostics: { ignoreCodes: [151002] },
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
