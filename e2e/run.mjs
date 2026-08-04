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
/// Pins the generated bot identity so goldens do not need the name scrubbed out.
const FIXED_BOT_SUFFIX = 'fixed_test_bot';
const EXPECTED_BOT_IDENTITY = `admin--${FIXED_BOT_SUFFIX}`;

const log = (msg) => console.log(`  ${msg}`);

/// `fetch` with a deadline. Node's built-in fetch has no default timeout, so a request
/// that never answers hangs the whole run silently.
async function api(url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
}

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
    {
      cwd: join(REPO, 'backend'),
      stdio: ['ignore', 'pipe', 'pipe'],
      // Pin the generated bot name so captures are reproducible without scrubbing it
      // out afterwards. Only the name is fixable; the secret stays CSPRNG.
      env: { ...process.env, MD_BUG_BOT_SUFFIX: FIXED_BOT_SUFFIX },
    }
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
      animation-duration: 1ms !important;
      animation-delay: 0s !important;
      transition-duration: 1ms !important;
      transition-delay: 0s !important;
      caret-color: transparent !important;
    }`,
  });
}

/// Blanks rendered timestamps before a capture.
///
/// Bug pages show a real creation time, which changes every run — two runs a minute
/// apart would diff. This only affects the screenshot, not what is asserted.
async function freezeTimestamps(page) {
  await page.evaluate(() => {
    const stamp = /[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} (AM|PM)/g;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (stamp.test(node.nodeValue ?? '')) {
        node.nodeValue = (node.nodeValue ?? '').replace(stamp, '<timestamp>');
      }
    }
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
  // Clicking tabs and fields scrolls the page, and where it lands varies run to run.
  // Normalise before capturing or the golden can never match.
  // The app scrolls an inner container, not the window, so reset both.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll('*').forEach((el) => {
      if (el.scrollTop) el.scrollTop = 0;
    });
  });
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
    // Without this every wait defaults to 30s, so a handful of misses turn a 40-second
    // run into several minutes of apparent hang.
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(15_000);

    // Several views report success/failure with a native alert(). Puppeteer never
    // dismisses dialogs on its own, so an un-handled one blocks the page forever — which
    // looks exactly like a hang with no error. Accept them and record what they said.
    page.on('dialog', async (dialog) => {
      log(`  .. dialog: ${dialog.message()}`);
      await dialog.accept();
    });

    const base = `http://localhost:${port}`;

    // ---- Step 1: the login screen ----------------------------------------------
    await page.goto(base, { waitUntil: 'domcontentloaded' });
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
    await page.waitForSelector('header');
    await page.waitForSelector('::-p-text(Components)');
    await capture(page, 'signed-in-home');

    // A token for the runner's own API assertions. Scraping it from the page mid-flight
    // races the app's client-side navigations and detaches the frame.
    const apiToken = await (
      await api(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: NEW_ADMIN_PASSWORD }),
      })
    )
      .json()
      .then((b) => b.access_token);

    // ---- Step 7: the session survives a reload ---------------------------------
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('header', { timeout: 15_000 });
    await capture(page, 'session-persists-after-reload');

    // ---- Step 8: an admin sees the root-component toggle ------------------------
    await page.goto(`${base}/create_component`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="root-toggle"]');
    await capture(page, 'create-component-admin');

    // ---- Step 9: toggling it replaces the parent picker -------------------------
    await page.click('[data-testid="root-toggle"]');
    await page.waitForSelector('[data-testid="root-mode-notice"]');
    await capture(page, 'root-toggle-on');

    // ---- Step 10: creating a root component actually works ---------------------
    await page.type('[data-testid="component-name"]', 'e2e_root');
    await page.click('button::-p-text(Create Component)');
    
    await page.waitForSelector('header', { timeout: 15_000 });
    await capture(page, 'after-creating-root');

    // Confirm it landed server-side rather than trusting the screenshot.
    const listResp = await api(`${base}/api/component_list`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    const components = await listResp.json();
    if (!Array.isArray(components) || !components.some((c) => c.name === 'e2e_root')) {
      throw new Error(
        `expected a root component named e2e_root, got ${JSON.stringify(components)}`
      );
    }
    log('behaviour       root component created via the API and listed');

    // ---- Step 11: the user menu offers an Account entry ------------------------
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.click('[data-testid="user-menu"]');
    await page.waitForSelector('[data-testid="menu-account"]');
    await capture(page, 'user-menu-open');

    // ---- Step 12: the account page ---------------------------------------------
    await page.click('[data-testid="menu-account"]');
    await page.waitForSelector('[data-testid="account-view"]');
    if (!page.url().endsWith('/account')) {
      throw new Error(`Account menu item should navigate to /account, got ${page.url()}`);
    }
    // Reload so the capture is not covered by the closing menu's backdrop, and so the
    // page is in the state a user reaching /account directly would see.
    await page.goto(`${base}/account`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="account-view"]');
    await capture(page, 'account-view');

    // ---- Step 13: changing the password from the account page ------------------
    const ACCOUNT_PASSWORD = 'changed-from-account-1';
    await page.type('[data-testid="account-current-password"]', NEW_ADMIN_PASSWORD);
    await page.type('[data-testid="account-new-password"]', 'short');
    await page.type('[data-testid="account-confirm-password"]', 'short');
    await page.click('[data-testid="change-password"]');
    await page.waitForSelector('[data-testid="password-error"]');
    await capture(page, 'account-password-validation');

    for (const field of ['account-new-password', 'account-confirm-password']) {
      await page.click(`[data-testid="${field}"]`, { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.type(`[data-testid="${field}"]`, ACCOUNT_PASSWORD);
    }
    await page.click('[data-testid="change-password"]');
    // The change revokes every token, so the app drops the session and returns to login.
    await page.waitForSelector('[data-testid="login-card"]');
    await capture(page, 'signed-out-after-password-change');

    const oldPasswordResp = await api(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: NEW_ADMIN_PASSWORD }),
    });
    if (oldPasswordResp.status !== 401) {
      throw new Error(
        `the previous password should be rejected, got ${oldPasswordResp.status}`
      );
    }
    log('behaviour       previous password rejected after account-page change (401)');

    // Sign back in with the new password and return to the account page.
    await page.type('[data-testid="login-username"]', 'admin');
    await page.type('[data-testid="login-password"]', ACCOUNT_PASSWORD);
    await page.click('[data-testid="login-submit"]');
    await page.waitForSelector('header');
    await page.goto(`${base}/account`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="account-view"]');

    const apiToken2 = await (
      await api(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: ACCOUNT_PASSWORD }),
      })
    )
      .json()
      .then((b) => b.access_token);

    // ---- Step 16: creating a bot token reveals it once --------------------------
    // First an API token: the user's own credential, which acts as them.
    await page.click('[data-testid="create-api-token"]');
    await page.waitForSelector('[data-testid="revealed-token"]');
    const userApiToken = await page.$eval(
      '[data-testid="revealed-token"]',
      (el) => el.value
    );
    if (!userApiToken.startsWith('mdb_api_')) {
      throw new Error(`expected an API token, got ${userApiToken.slice(0, 12)}`);
    }
    await page.click('[data-testid="dismiss-token"]');
    // The closing dialog's fields linger in the DOM; without waiting for them to go, the
    // next waitForSelector matches the stale one and reads an empty value.
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="revealed-token"]')
    );

    // An API token is the caller, so it sees exactly what they see.
    const asUser = await (
      await api(`${base}/api/auth/me`, {
        headers: { Authorization: `Bearer ${userApiToken}` },
      })
    ).json();
    if (asUser.username !== 'admin' || asUser.is_bot !== false) {
      throw new Error(`API token should act as admin, got ${JSON.stringify(asUser)}`);
    }
    const userVisible = await (
      await api(`${base}/api/component_list`, {
        headers: { Authorization: `Bearer ${userApiToken}` },
      })
    ).json();
    if (userVisible.length === 0) {
      throw new Error('an API token should see what its owner sees');
    }
    log(
      `behaviour       API token acts as admin and sees ${userVisible.length} component(s)`
    );

    // Now a bot: a separate account that starts with nothing.
    await page.click('[data-testid="create-bot-token"]');
    await page.waitForSelector('[data-testid="revealed-token"]');
    const botToken = await page.$eval('[data-testid="revealed-token"]', (el) => el.value);
    const botIdentity = await page.$eval(
      '[data-testid="revealed-identity"]',
      (el) => el.value
    );
    if (botIdentity !== EXPECTED_BOT_IDENTITY) {
      throw new Error(
        `expected the pinned identity ${EXPECTED_BOT_IDENTITY}, got ${botIdentity}`
      );
    }
    log(`behaviour       token identity: ${botIdentity} (pinned via MD_BUG_BOT_SUFFIX)`);
    // Only the secret still varies; blank it or the golden could never match.
    await page.$eval('[data-testid="revealed-token"]', (el) => {
      el.value = 'mdb_pat_<redacted for screenshot stability>';
    });
    // The list refreshes behind the dialog once the create resolves; wait for it so the
    // capture is not racing that render.
    await page.waitForSelector('[data-testid="bot-token-list"]');
    await capture(page, 'token-revealed');

    await page.click('[data-testid="dismiss-token"]');
    await page.waitForSelector('[data-testid="bot-token-list"]');
    await capture(page, 'account-with-token');

    // ---- Behaviour: the bot is a distinct identity, capped at its owner ---------
    const meResp = await api(`${base}/api/auth/me`, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    const me = await meResp.json();
    if (me.username !== botIdentity) {
      throw new Error(`bot should act as its own identity, got ${JSON.stringify(me)}`);
    }
    if (me.owner_username !== 'admin' || me.is_bot !== true) {
      throw new Error(`bot should report its owner, got ${JSON.stringify(me)}`);
    }
    if (me.is_admin !== false) {
      throw new Error('a bot must never be an admin, even when its owner is');
    }
    log(`behaviour       bot authenticates as ${me.username}, owner admin, is_admin false`);

    // The owner is an admin, but the bot must still be refused root creation.
    const botRoot = await api(`${base}/api/create_root_component`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'bot_root', description: '' }),
    });
    if (botRoot.status !== 403) {
      throw new Error(`bot root creation should be 403, got ${botRoot.status}`);
    }
    log('behaviour       bot refused root creation (403) despite admin owner');

    // ---- A new account is created with a generated password --------------------
    //
    // The admin never chooses it and the server returns it exactly once, so the whole
    // handover is: create, read the password, give it to the person.
    const createdUser = await api(`${base}/api/auth/users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken2}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: 'newbie', is_admin: false }),
    });
    if (createdUser.status !== 201) {
      throw new Error(`creating a user should be 201, got ${createdUser.status}`);
    }
    const newUser = await createdUser.json();
    if (!newUser.password || newUser.password.length < 20) {
      throw new Error(`expected a generated password, got ${JSON.stringify(newUser)}`);
    }
    log(
      `behaviour       account created with a generated ${newUser.password.length}-char password`
    );

    // That password gets the new user as far as the rotation screen and no further.
    const newbieLogin = await (
      await api(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'newbie', password: newUser.password }),
      })
    ).json();
    if (newbieLogin.must_change_password !== true) {
      throw new Error('a freshly created account must be flagged for rotation');
    }
    const blocked = await api(`${base}/api/component_list`, {
      headers: { Authorization: `Bearer ${newbieLogin.access_token}` },
    });
    if (blocked.status !== 403) {
      throw new Error(
        `an un-rotated account must be refused, got ${blocked.status}`
      );
    }
    log('behaviour       new account is refused (403) until it rotates its password');

    // Walk that first login through the UI.
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => indexedDB.deleteDatabase('md-bug-db'));
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="login-card"]');
    await page.type('[data-testid="login-username"]', 'newbie');
    await page.type('[data-testid="login-password"]', newUser.password);
    await page.click('[data-testid="login-submit"]');
    await page.waitForSelector('[data-testid="change-password-card"]');
    await capture(page, 'new-user-forced-rotation');

    const NEWBIE_PASSWORD = 'newbie-picked-this-1';
    await page.type('[data-testid="current-password"]', newUser.password);
    await page.type('[data-testid="new-password"]', NEWBIE_PASSWORD);
    await page.type('[data-testid="confirm-password"]', NEWBIE_PASSWORD);
    await page.click('[data-testid="change-password-submit"]');
    await page.waitForSelector('[data-testid="login-card"]');

    await page.type('[data-testid="login-username"]', 'newbie');
    await page.type('[data-testid="login-password"]', NEWBIE_PASSWORD);
    await page.click('[data-testid="login-submit"]');
    await page.waitForSelector('header');
    await capture(page, 'new-user-signed-in');
    log('behaviour       new account works after rotating its generated password');

    // Back to the admin for the remaining steps.
    await page.evaluate(() => indexedDB.deleteDatabase('md-bug-db'));
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="login-card"]');
    await page.type('[data-testid="login-username"]', 'admin');
    await page.type('[data-testid="login-password"]', ACCOUNT_PASSWORD);
    await page.click('[data-testid="login-submit"]');
    await page.waitForSelector('header');

    // ---- The admin console ------------------------------------------------------
    await page.click('[data-testid="user-menu"]');
    await page.waitForSelector('[data-testid="menu-admin"]');
    await page.click('[data-testid="menu-admin"]');
    await page.waitForSelector('[data-testid="admin-view"]');
    await page.goto(`${base}/admin`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="admin-view"]');
    await capture(page, 'admin-console');

    // Create an account through the UI and read the generated password from the dialog.
    await page.type('[data-testid="new-username"]', 'contractor');
    await page.click('[data-testid="create-user"]');
    await page.waitForSelector('[data-testid="generated-password"]');
    const contractorPassword = await page.$eval(
      '[data-testid="generated-password"]',
      (el) => el.value
    );
    await page.$eval('[data-testid="generated-password"]', (el) => {
      el.value = '<generated, redacted for screenshot stability>';
    });
    await capture(page, 'admin-created-user');
    await page.click('[data-testid="dismiss-password"]');
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="generated-password"]')
    );

    // The account works (as far as its forced rotation) before being disabled.
    const beforeDisable = await api(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'contractor', password: contractorPassword }),
    });
    if (beforeDisable.status !== 200) {
      throw new Error(`a new account should be able to log in, got ${beforeDisable.status}`);
    }

    await page.click('[data-testid="toggle-disabled-contractor"]');
    await page.waitForSelector('[data-testid="user-row-contractor"] .MuiChip-colorError');
    await capture(page, 'admin-disabled-user');

    const afterDisable = await api(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'contractor', password: contractorPassword }),
    });
    if (afterDisable.status !== 401) {
      throw new Error(
        `a disabled account must not log in, got ${afterDisable.status}`
      );
    }
    log('behaviour       disabled account can no longer log in (401)');

    // ---- Steps 14-17: grant the bot access to a component it could not see ------
    //
    // This is the whole feature end to end: a bot starts with nothing (PUBLIC does not
    // apply to automation), gets added to a component's ACL like any user, and only then
    // can see it.
    const listAsBot = async () => {
      const resp = await api(`${base}/api/component_list`, {
        headers: { Authorization: `Bearer ${botToken}` },
      });
      return resp.json();
    };

    const beforeGrant = await listAsBot();
    if (beforeGrant.length !== 0) {
      throw new Error(
        `a bot with no explicit grant must see nothing, saw ${JSON.stringify(beforeGrant)}`
      );
    }
    log('behaviour       bot sees 0 components before being granted anything');

    // Create a component to grant it access to.
    await page.goto(`${base}/create_component`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="component-name"]');
    await page.type('[data-testid="component-name"]', 'bot_playground');
    await page.click('button::-p-text(Create Component)');
    // The view navigates to '/' on success; let that finish before the next goto, or the
    // two navigations race and the frame detaches.
    await page.waitForFunction(() => window.location.pathname === '/');
    await page.waitForSelector('::-p-text(Components)');
    await capture(page, 'component-created-for-bot');

    // Find it, then open its Access tab.
    const created = await (
      await api(`${base}/api/component_list`, {
        headers: { Authorization: `Bearer ${apiToken2}` },
      })
    ).json();
    const target = created.find((c) => c.name === 'bot_playground');
    if (!target) throw new Error('bot_playground was not created');

    await page.goto(`${base}/component/${target.id}`, { waitUntil: 'domcontentloaded' });
    await page.click('button::-p-text(Access)');
    await page.waitForSelector('[data-testid="members-issue-contributors"]');
    await capture(page, 'component-access-tab');

    // Add the bot to the Issue Contributors group, exactly as you would a username.
    //
    // Typed with real key events rather than by assigning `.value`: these are controlled
    // React inputs, and a direct assignment updates the DOM without notifying React, so
    // the change would be silently discarded on the next render.
    const membersField = '[data-testid="members-issue-contributors"]';
    await page.waitForSelector(membersField);
    await page.click(membersField, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type(membersField, `PUBLIC, ${botIdentity}`);
    // The field keeps raw text while focused and commits on blur, so the change must be
    // committed before saving.
    await page.$eval(membersField, (el) => el.blur());

    const saved = page.waitForResponse(
      (r) => r.url().includes('/update_metadata') && r.request().method() === 'POST'
    );
    // Dispatched in-page rather than via page.click: puppeteer's actionability checks
    // wait for the element to stop moving, and this form re-renders enough that the
    // click never becomes "stable", blocking past any timeout.
    await page.$eval('[data-testid="save-component"]', (el) => el.click());
    const savedResp = await saved;
    if (!savedResp.ok()) {
      throw new Error(`saving component access failed: HTTP ${savedResp.status()}`);
    }


    await capture(page, 'bot-added-to-component');

    // ---- Starring and upvoting a bug --------------------------------------------
    const bugId = await (
      await api(`${base}/api/create_bug`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken2}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          component_id: target.id,
          template_name: '',
          title: 'A bug worth starring',
          description: 'body',
          collaborators: [],
          cc: [],
        }),
      })
    ).json();

    await page.goto(`${base}/issue/${bugId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="star-button"]');
    await freezeTimestamps(page);
    await capture(page, 'bug-markers-neutral');

    await page.click('[data-testid="star-button"]');
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="star-button"]')?.getAttribute('aria-pressed') ===
        'true'
    );
    await page.click('[data-testid="upvote-button"]');
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="upvote-button"]')
          ?.getAttribute('aria-pressed') === 'true'
    );
    // Move the pointer away so a hover tooltip does not float over the capture.
    await page.mouse.move(0, 0);
    await freezeTimestamps(page);
    await capture(page, 'bug-markers-active');

    // Confirm they were persisted, not just flipped optimistically in the browser.
    const markedBug = await (
      await api(`${base}/api/bug/${bugId}`, {
        headers: { Authorization: `Bearer ${apiToken2}` },
      })
    ).json();
    if (!markedBug.metadata.starred_by.includes('admin')) {
      throw new Error(`star was not persisted: ${JSON.stringify(markedBug.metadata.starred_by)}`);
    }
    if (!markedBug.metadata.upvoted_by.includes('admin')) {
      throw new Error(`upvote was not persisted: ${JSON.stringify(markedBug.metadata.upvoted_by)}`);
    }
    log('behaviour       star and +1 persisted server-side');

    // And that they survive a reload, rather than living only in local state.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="star-button"][aria-pressed="true"]');
    log('behaviour       markers survive a reload');

    const afterGrant = await listAsBot();
    if (!afterGrant.some((c) => c.name === 'bot_playground')) {
      throw new Error(
        `bot should see the component it was granted, saw ${JSON.stringify(afterGrant)}`
      );
    }
    log('behaviour       bot sees the component only after being added explicitly');

    // Assert on behaviour too, not only on pixels: a screenshot cannot tell us the old
    // password stopped working.
    const stillWorks = await api(`${base}/api/auth/login`, {
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
