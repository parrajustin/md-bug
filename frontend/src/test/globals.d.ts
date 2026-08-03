// The Temporal polyfill only publishes ESM "import" conditions, so the global shim is
// imported by file path (see jest.config.js moduleNameMapper) and has no types here.
declare module 'temporal-polyfill/global.js';
