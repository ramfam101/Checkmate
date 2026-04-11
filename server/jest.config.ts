import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  rootDir: '.',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts', '.mts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: './tsconfig.jest.json' }],
  },
  moduleNameMapper: {
    '^@/validation/(.*)\\.js$': '<rootDir>/src/validation/$1.ts',
    '^@/utils/(AppError)\\.js$': '<rootDir>/src/utils/$1.ts',
    '^@/utils/(.*)\\.js$': '<rootDir>/src/utils/$1.ts',
    '^@/(.*)\\.ts$': '<rootDir>/src/$1.ts',
    '^@/(.*)\\.js$': '<rootDir>/src/$1.ts',
    '^@/(.*)$': '<rootDir>/src/$1.ts',
  },
  moduleFileExtensions: ['mts', 'ts', 'js', 'json', 'node'],
  testMatch: ['<rootDir>/test/**/*.test.ts', '<rootDir>/test/**/*.test.mts'],
  setupFilesAfterEnv: [],
  collectCoverageFrom: ['src/**/*.ts'],
  coveragePathIgnorePatterns: ['/node_modules/', '/test/'],
  clearMocks: true,
};

export default config;
