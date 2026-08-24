import nextJest from 'next/jest.js';

/**
 * next/jest cuida do transform (SWC), do alias `@/` do tsconfig, do CSS e das
 * variáveis NEXT_PUBLIC_*. Configurar Babel/ts-jest à mão aqui só recriaria,
 * pior, o que o Next já faz.
 */
const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/', '<rootDir>/e2e/'],
};

export default createJestConfig(config);
