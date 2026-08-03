import { TextDecoder, TextEncoder } from 'node:util';
import { deserialize, serialize } from 'node:v8';

// jsdom omits these globals: react-router reaches for TextEncoder at import time, and
// fake-indexeddb needs structuredClone to store values. V8 serialization is used rather
// than a JSON round-trip because the stored records contain BigInt.
Object.assign(globalThis, {
  TextEncoder: globalThis.TextEncoder ?? TextEncoder,
  TextDecoder: globalThis.TextDecoder ?? TextDecoder,
  structuredClone:
    globalThis.structuredClone ?? (<T>(value: T): T => deserialize(serialize(value)) as T),
});

import '@testing-library/jest-dom';
// LoginView/App persist the username to IndexedDB, which jsdom does not implement.
import 'fake-indexeddb/auto';
// BugView formats timestamps with the global `Temporal`, which Node 24 does not expose.
// The app degrades to printing raw nanoseconds when it is absent, so the polyfill is
// what lets these tests assert on real formatted dates. Shipped code has NO polyfill —
// it relies on the browser providing Temporal natively (see frontend/CLAUDE.md).
// Imported by path because the package only publishes an ESM "import" condition.
import 'temporal-polyfill/global.js';

// esbuild injects these via --define; under jest they are plain globals.
// USE_FAKE_API is irrelevant here because every test injects its own API stub,
// but api.ts reads it at module load and would otherwise construct a BackendApi
// pointed at localhost:9000.
(globalThis as Record<string, unknown>).USE_FAKE_API = true;
(globalThis as Record<string, unknown>).DEBUG_MODE = false;

// jsdom does not implement these; MUI's useMediaQuery and Drawer transitions need them.
if (typeof globalThis.matchMedia !== 'function') {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/**
 * Treat React warnings as failures.
 *
 * React reports unrecognized DOM props ("React does not recognize the `X` prop on a
 * DOM element", "Received `true` for a non-boolean attribute") through console.error.
 * Those are exactly the MUI v9 migration regressions these tests exist to catch, and
 * they are invisible to both esbuild and a plain smoke render, so we escalate them.
 */
const failOnConsole = (method: 'error' | 'warn') => {
  const original = console[method];
  return jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
    original(...args);
    const message = args
      .map((a) => (a instanceof Error ? a.message : String(a)))
      .join(' ');
    throw new Error(`Unexpected console.${method} during render:\n${message}`);
  });
};

let spies: ReturnType<typeof failOnConsole>[] = [];

beforeEach(() => {
  spies = [failOnConsole('error'), failOnConsole('warn')];
});

afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  spies = [];
});
