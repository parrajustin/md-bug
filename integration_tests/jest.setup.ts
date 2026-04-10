import fetch from 'cross-fetch';

(globalThis as any).fetch = fetch;
(globalThis as any).USE_FAKE_API = false;
