/**
 * Jest config for frontend component tests.
 *
 * These are jsdom render tests: each view is mounted with a stub API injected via
 * `inject_api`, so no backend is required. `src/test/setup.ts` turns any React
 * console.error/warn into a test failure, which is what catches MUI "unknown prop
 * on a DOM element" regressions that esbuild never sees.
 */
module.exports = {
  testEnvironment: 'jsdom',
  // jest's 5s default is marginal for these: userEvent types character by character and
  // each keystroke re-renders a MUI form, so a loaded machine tips them over. The tests
  // themselves take well under a second when the box is idle.
  testTimeout: 20_000,
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  // standard-ts-lib is consumed as raw TypeScript source via a file: dependency,
  // so it must be transformed rather than ignored like the rest of node_modules.
  transformIgnorePatterns: ['/node_modules/(?!.*standard-ts-lib)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    // esbuild bundles CSS; jest cannot parse it.
    '\\.(css|less|scss)$': 'identity-obj-proxy',
    '\\.(png|jpe?g|gif|svg|webp)$': '<rootDir>/src/test/file_stub.ts',
    // marked ships ESM-only via its "exports" map; point jest at the UMD build.
    '^marked$': '<rootDir>/node_modules/marked/lib/marked.umd.js',
    // Same story for the Temporal polyfill's global shim.
    '^temporal-polyfill/global\\.js$': '<rootDir>/node_modules/temporal-polyfill/global.js',
  },
};
