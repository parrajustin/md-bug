/**
 * End-to-end test: drives a real Chrome through the auth flow against a real backend,
 * capturing a screenshot at each step and comparing it to a golden.
 *
 * Everything is built from scratch on each run — a fresh temp data directory, a freshly
 * bootstrapped admin, a new port — so the run is hermetic and repeatable. Nothing
 * touches `backend/bug-data`.
 *
 *   node run.mjs                    compare against goldens (fails on drift)
 *   node run.mjs --update-goldens   rewrite the goldens from this run
 *   node run.mjs --headed           watch it happen in a visible browser
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import puppeteer from 'puppeteer';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const GOLDEN_DIR = join(HERE, 'goldens');
const OUTPUT_DIR = join(HERE, 'output');

const UPDATE_GOLDENS = process.argv.includes('--update-goldens');
const HEADED = process.argv.includes('--headed');

const VIEWPORT = { width: 1280, height: 800 };
/** Allow a couple of stray pixels for antialiasing without letting real drift through. */
const MAX_DIFF_PIXELS = 40;

const NEW_ADMIN_PASSWORD = 'chosen-by-the-operator-1';

const log = (msg) => console.log(`  ${msg}`);

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Starts the backend against a throwaway data directory and returns the bootstrap admin
 * password it prints on first run. That password is generated, printed once, and never
 * recoverable — so the test has to read it from stdout exactly like a human would.
 */
async function startBackend(dataDir, port) {
  const child = spawn(
    'cargo',
    [
      'run',
      '--quiet',
      '--bin',
      'md-bug-backend',
      '--',
      '-r',
      dataDir,
      '-p',
      String(port),
      '-f',
      join(REPO, 'frontend', 'public'),
    ],
    { cwd: join(REPO, 'backend'), stdio: ['ignore', 'pipe', 'pipe'] }
  );

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d.toString()));
  child.stderr.on('data', (d) => (stderr += d.toString()));

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`backend exited early (${child.exitCode})\n${stdout}\n${stderr}`);
    }
    try {
      const resp = await fetch(`http://localhost:${port}/api/auth/me`);
      if (resp.status === 401) break; // up, and correctly refusing anonymous callers
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  const match = stdout.match(/password:\s*(\S+)/);
  if (!match) {
    throw new Error(`could not find the bootstrap password in backend output:\n${stdout}`);
  }
  return { child, adminPassword: match[1] };
}

/**
 * Screenshots settle badly when things are still moving, so freeze animations and
 * transitions before capturing. MUI's ripples and drawer slides are the main offenders.
 */
async function freezeAnimations(page) {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      caret-color: transparent !important;
    }`,
  });
}

/// Reads the access token the page is holding, so assertions can call the API as the
/// same user the browser is signed in as.
async function readAccessToken(page) {
  return page.evaluate(async () => {
    return new Promise((resolve) => {
      const open = indexedDB.open('md-bug-db', 1);
      open.onsuccess = () => {
        const db = open.result;
        const req = db.transaction('settings', 'readonly').objectStore('settings').get('session');
        req.onsuccess = () => resolve(req.result?.accessToken ?? '');
        req.onerror = () => resolve('');
      };
      open.onerror = () => resolve('');
    });
  });
}

let stepCounter = 0;
const results = [];

/**
 * Captures a screenshot and compares it against its golden.
 *
 * Filenames carry the capture-order number (`01-login-screen.png`) so the sequence is
 * readable straight from a directory listing and a newly inserted step is obvious.
 */
async function capture(page, name) {
  stepCounter += 1;
  const fileName = `${String(stepCounter).padStart(2, '0')}-${name}.png`;
  const actualPath = join(OUTPUT_DIR, fileName);
  const goldenPath = join(GOLDEN_DIR, fileName);

  await freezeAnimations(page);
  await new Promise((r) => setTimeout(r, 150));
  await page.screenshot({ path: actualPath });

  if (UPDATE_GOLDENS) {
    await writeFile(goldenPath, await readFile(actualPath));
    log(`golden written  ${fileName}`);
    results.push({ fileName, status: 'written' });
    return;
  }

  if (!existsSync(goldenPath)) {
    log(`NO GOLDEN       ${fileName}  (run with --update-goldens)`);
    results.push({ fileName, status: 'missing-golden' });
    return;
  }

  const actual = PNG.sync.read(await readFile(actualPath));
  const golden = PNG.sync.read(await readFile(goldenPath));

  if (actual.width !== golden.width || actual.height !== golden.height) {
    log(
      `SIZE MISMATCH   ${fileName}  golden ${golden.width}x${golden.height}, got ${actual.width}x${actual.height}`
    );
    results.push({ fileName, status: 'failed', reason: 'size mismatch' });
    return;
  }

  const diff = new PNG({ width: actual.width, height: actual.height });
  const differing = pixelmatch(
    golden.data,
    actual.data,
    diff.data,
    actual.width,
    actual.height,
    { threshold: 0.1 }
  );

  if (differing > MAX_DIFF_PIXELS) {
    const diffPath = join(OUTPUT_DIR, `${fileName.replace('.png', '')}-diff.png`);
    await writeFile(diffPath, PNG.sync.write(diff));
    log(`DIFF            ${fileName}  ${differing} px differ → ${diffPath}`);
    results.push({ fileName, status: 'failed', reason: `${differing} px differ` });
  } else {
    log(`match           ${fileName}  (${differing} px)`);
    results.push({ fileName, status: 'passed' });
  }
}

async function main() {
  await mkdir(GOLDEN_DIR, { recursive: true });
  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(OUTPUT_DIR, { recursive: true });

  const dataDir = await mkdtemp(join(tmpdir(), 'md-bug-e2e-'));
  const port = await freePort();
  log(`data dir ${dataDir}`);
  log(`port     ${port}`);

  let backend;
  let browser;
  try {
    const started = await startBackend(dataDir, port);
    backend = started.child;
    const adminPassword = started.adminPassword;
    log(`bootstrap password captured (${adminPassword.length} chars)`);

    browser = await puppeteer.launch({
      headless: !HEADED,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
    });
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);

    const base = `http://localhost:${port}`;

    // ---- Step 1: the login screen ----------------------------------------------
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid="login-card"]');
    await capture(page, 'login-screen');

    // ---- Step 2: a rejected password -------------------------------------------
    await page.type('[data-testid="login-username"]', 'admin');
    await page.type('[data-testid="login-password"]', 'definitely-wrong');
    await page.click('[data-testid="login-submit"]');
    await page.waitForSelector('[data-testid="login-error"]');
    await capture(page, 'login-rejected');

    // ---- Step 3: forced password change ----------------------------------------
    await page.click('[data-testid="login-password"]', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('[data-testid="login-password"]', adminPassword);
    await page.click('[data-testid="login-submit"]');
    await page.waitForSelector('[data-testid="change-password-card"]');
    await capture(page, 'forced-password-change');

    // ---- Step 4: client-side validation ----------------------------------------
    await page.type('[data-testid="current-password"]', adminPassword);
    await page.type('[data-testid="new-password"]', 'short');
    await page.type('[data-testid="confirm-password"]', 'short');
    await page.click('[data-testid="change-password-submit"]');
    await page.waitForSelector('[data-testid="change-password-error"]');
    await capture(page, 'password-too-short');

    // ---- Step 5: a successful change sends the user back to sign in ------------
    for (const field of ['new-password', 'confirm-password']) {
      await page.click(`[data-testid="${field}"]`, { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.type(`[data-testid="${field}"]`, NEW_ADMIN_PASSWORD);
    }
    await page.click('[data-testid="change-password-submit"]');
    await page.waitForSelector('[data-testid="login-card"]');
    await capture(page, 'back-to-login-after-change');

    // ---- Step 6: signed in with the new password -------------------------------
    await page.type('[data-testid="login-username"]', 'admin');
    await page.type('[data-testid="login-password"]', NEW_ADMIN_PASSWORD);
    await page.click('[data-testid="login-submit"]');
    await page.waitForSelector('header', { timeout: 15_000 });
    await page.waitForNetworkIdle({ idleTime: 500 }).catch(() => {});
    await capture(page, 'signed-in-home');

    // ---- Step 7: the session survives a reload ---------------------------------
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('header', { timeout: 15_000 });
    await capture(page, 'session-persists-after-reload');

    // ---- Step 8: an admin sees the root-component toggle ------------------------
    await page.goto(`${base}/create_component`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid="root-toggle"]');
    await capture(page, 'create-component-admin');

    // ---- Step 9: toggling it replaces the parent picker -------------------------
    await page.click('[data-testid="root-toggle"]');
    await page.waitForSelector('[data-testid="root-mode-notice"]');
    await capture(page, 'root-toggle-on');

    // ---- Step 10: creating a root component actually works ---------------------
    await page.type('[data-testid="component-name"]', 'e2e_root');
    await page.click('button::-p-text(Create Component)');
    await page.waitForNetworkIdle({ idleTime: 500 }).catch(() => {});
    await page.waitForSelector('header', { timeout: 15_000 });
    await capture(page, 'after-creating-root');

    // Confirm it landed server-side rather than trusting the screenshot.
    const listResp = await fetch(`${base}/api/component_list`, {
      headers: { Authorization: `Bearer ${await readAccessToken(page)}` },
    });
    const components = await listResp.json();
    if (!Array.isArray(components) || !components.some((c) => c.name === 'e2e_root')) {
      throw new Error(
        `expected a root component named e2e_root, got ${JSON.stringify(components)}`
      );
    }
    log('behaviour       root component created via the API and listed');

    // Assert on behaviour too, not only on pixels: a screenshot cannot tell us the old
    // password stopped working.
    const stillWorks = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: adminPassword }),
    });
    if (stillWorks.status !== 401) {
      throw new Error(
        `the original bootstrap password should be rejected after rotation, got ${stillWorks.status}`
      );
    }
    log('behaviour       old password rejected after rotation (401)');
  } finally {
    if (browser) await browser.close();
    if (backend) backend.kill('SIGTERM');
    await rm(dataDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => r.status === 'failed');
  const missing = results.filter((r) => r.status === 'missing-golden');

  console.log('');
  console.log(`  ${results.length} screenshots captured`);
  if (UPDATE_GOLDENS) {
    console.log(`  goldens updated in ${GOLDEN_DIR}`);
    return;
  }
  if (missing.length) {
    console.log(`  ${missing.length} without goldens — run: npm run update-goldens`);
  }
  if (failed.length) {
    console.log(`  ${failed.length} FAILED:`);
    for (const f of failed) console.log(`    ${f.fileName}: ${f.reason}`);
    process.exitCode = 1;
    return;
  }
  if (!missing.length) console.log('  all screenshots match their goldens');
}

main().catch((err) => {
  console.error('\ne2e run failed:', err.message);
  process.exitCode = 1;
});
