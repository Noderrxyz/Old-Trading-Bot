export default {
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest'
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testEnvironment: 'node',
  transformIgnorePatterns: [
    'node_modules/(?!(@noderr)/)'
  ],
  collectCoverage: true,
  coverageReporters: ['text', 'lcov'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.{js,ts}',
    '!src/**/*.d.ts',
    '!src/**/index.{js,ts}'
  ],
  // For testing TypeScript files directly
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
  preset: 'ts-jest',
  // Focus only on our new test files
  testRegex: '(tests/StrategyMutationEngine.test.js|tests/RegimeCapitalAllocator.test.js|tests/StrategyPortfolioOptimizer.test.js|tests/solana_adapter.test.js)'
}; 