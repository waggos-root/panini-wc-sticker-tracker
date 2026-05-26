// End-to-end verifier for the offline -> online sync flow in App.jsx.
//
// What this catches: the regression where the online sticker-load path
// overwrites local state with the server snapshot WITHOUT applying the
// IndexedDB `pending` queue on top. To make the assertion observable, we
// block /api/backup so the sync drain can't run; what remains in the cache
// then directly reflects whether the load path consulted the queue.
//
// This spins up its OWN server instance against an in-memory SQLite on a
// throwaway port (default 3099) — it never touches the production DB. Run
// it on the VM where system Chromium is installed (apk add chromium nss
// font-freefont harfbuzz freetype) or anywhere with a chromium binary path
// passed via CHROMIUM_PATH.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const TMP_DIR = join(__dirname, 'tmp');
const PORT = Number(process.env.VERIFY_PORT || 3099);
const BASE_URL = `http://localhost:${PORT}`;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const TARGET_CODE = 'ARG1';

mkdirSync(TMP_DIR, { recursive: true });
// The /api/backup endpoint refuses :memory: DBs, so the harness needs a
// real file even though it's discarded at the end. Tempdir keeps it out of
// the repo's data/.
const DB_DIR = mkdtempSync(join(tmpdir(), 'panini-verify-'));
const DB_PATH = join(DB_DIR, 'verify.sqlite');

const log = [];
function record(label, detail) {
  const entry = { ts: new Date().toISOString(), label, detail };
  log.push(entry);
  const compact = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log(`[verify] ${label}: ${compact}`);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // server still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`test server did not respond on ${BASE_URL} within 10s`);
}

async function readIdb(page, storeName) {
  return page.evaluate(
    (store) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('panini');
        open.onsuccess = () => {
          const tx = open.result.transaction(store, 'readonly');
          const req = tx.objectStore(store).getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        };
        open.onerror = () => reject(open.error);
      }),
    storeName,
  );
}

async function readCachedStickers(page, profileId) {
  return page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('panini');
        open.onsuccess = () => {
          const tx = open.result.transaction('meta', 'readonly');
          const req = tx.objectStore('meta').get(`stickers:${id}`);
          req.onsuccess = () => resolve(req.result?.value ?? null);
          req.onerror = () => reject(req.error);
        };
        open.onerror = () => reject(open.error);
      }),
    profileId,
  );
}

const server = spawn('node', ['server/server.js'], {
  cwd: REPO_ROOT,
  env: { ...process.env, PORT: String(PORT), DB_PATH },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverChunks = [];
server.stdout.on('data', (chunk) => serverChunks.push(`[server] ${chunk}`));
server.stderr.on('data', (chunk) => serverChunks.push(`[server!] ${chunk}`));

let browser;
let exitCode = 0;
try {
  await waitForServer();
  record('server-up', BASE_URL);

  // System Chromium on Alpine spawns chrome_crashpad_handler without the
  // --database arg it requires, killing the launch. --disable-features=Crashpad
  // suppresses the spawn entirely; --no-sandbox / --disable-dev-shm-usage are
  // the standard container-Chromium incantation.
  browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-features=Crashpad',
      '--no-crash-upload',
    ],
    env: { ...process.env, BREAKPAD_DISABLE_HANDLER: '1' },
  });
  // Allow the service worker — it caches the app shell, which is the only
  // way an offline reload can serve a document at all. The SW's own drain
  // only fires on a Background Sync event the harness never triggers, so the
  // page-side useEffect is still what's under test.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => record('pageerror', String(error)));

  // --- Initial online load + SW priming ---
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('select');
  await page.evaluate(() => navigator.serviceWorker?.ready);
  // Reload once so the SW controls this client (first load installs but does
  // not yet claim). Without this, the next offline reload has no cached doc.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('select');
  await page.screenshot({ path: join(TMP_DIR, '01-initial.png') });

  const profileId = await page.evaluate(() =>
    Number.parseInt(window.localStorage.getItem('panini.activeProfile') || '1', 10),
  );
  record('profile-id', profileId);

  const initialServer = await page
    .evaluate(async (id) => (await fetch(`/api/profiles/${id}/stickers`)).json(), profileId)
    .then((rows) => rows.find((row) => row.code === TARGET_CODE)?.quantity ?? null);
  record('initial-server-qty', { code: TARGET_CODE, qty: initialServer });

  // Default mode is read-only; flip it so clicks actually mutate.
  const readOnlyButton = page.getByRole('button', { name: /Solo lectura|Edición/ });
  if ((await readOnlyButton.getAttribute('aria-pressed')) === 'true') {
    await readOnlyButton.click();
  }
  record('edit-mode', true);

  // --- Go offline and bump the target sticker ---
  await context.setOffline(true);
  record('went-offline', true);

  const tile = page.locator(`button:has(span:text-is("${TARGET_CODE}"))`).first();
  await tile.click();
  await page.waitForTimeout(150); // optimistic state + IDB write
  await page.screenshot({ path: join(TMP_DIR, '02-clicked-offline.png') });

  const pendingAfterClick = await readIdb(page, 'pending');
  record('pending-after-click', pendingAfterClick);

  // --- Reload offline; offline-fallback path should re-render the bump ---
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('select');
  await page.waitForTimeout(300);
  const offlineChip = await page.locator('span.rounded-full.bg-slate-100').first().textContent();
  record('chip-after-offline-reload', offlineChip);
  await page.screenshot({ path: join(TMP_DIR, '03-offline-reload.png') });

  // --- Block /api/backup so the sync drain can't run, then go online + reload.
  // With the fix, the online load path applies the pending overlay before
  // setStickers/setCachedStickers. Without the fix, the cache gets overwritten
  // with server state. The drain is blocked, so what's in the cache after
  // reload directly reveals which branch executed.
  await page.route('**/api/backup', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"blocked by verifier"}' }),
  );
  await context.setOffline(false);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('select');
  await page.waitForTimeout(800); // let load + sync attempt finish
  await page.screenshot({ path: join(TMP_DIR, '04-online-backup-blocked.png') });

  const chipAfterOnlineReload = await page
    .locator('span.rounded-full.bg-slate-100')
    .first()
    .textContent();
  record('chip-after-online-reload', chipAfterOnlineReload);

  const cachedAfterReload = await readCachedStickers(page, profileId);
  const cachedTarget = cachedAfterReload?.find((row) => row.code === TARGET_CODE);
  record('cached-target-after-reload', cachedTarget);

  const pendingAfterReload = await readIdb(page, 'pending');
  record('pending-after-online-reload', pendingAfterReload);

  // --- Now unblock backup and let the drain finish for the happy-path leg.
  // The sync useEffect only re-runs when one of its deps changes; after the
  // earlier backup failure it set syncing=false but no dep flipped, so it's
  // dormant. Toggling offline→online flips isOnline and retriggers it.
  await page.unroute('**/api/backup');
  await context.setOffline(true);
  await page.waitForTimeout(150);
  await context.setOffline(false);

  // Wait for the drain to finish by polling the IDB pending count directly —
  // the chip-text transitions through several states and racing them is flaky.
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('panini');
        open.onsuccess = () => {
          const req = open.result
            .transaction('pending', 'readonly')
            .objectStore('pending')
            .count();
          req.onsuccess = () => resolve(req.result === 0);
          req.onerror = () => resolve(false);
        };
        open.onerror = () => resolve(false);
      }),
    null,
    { timeout: 20000 },
  );
  await page.screenshot({ path: join(TMP_DIR, '05-after-drain.png') });

  const finalServer = await page
    .evaluate(async (id) => (await fetch(`/api/profiles/${id}/stickers`)).json(), profileId)
    .then((rows) => rows.find((row) => row.code === TARGET_CODE)?.quantity ?? null);
  record('final-server-qty', { code: TARGET_CODE, qty: finalServer });

  const pendingAfterDrain = await readIdb(page, 'pending');
  record('pending-after-drain', pendingAfterDrain);

  // --- Assertions ---
  const expectedAfterBump = (initialServer ?? 0) + 1;
  const checks = [
    {
      name: 'offline click enqueued a pending mutation',
      pass: pendingAfterClick.length === 1 && pendingAfterClick[0].quantity === expectedAfterBump,
    },
    {
      name: 'offline-reload chip mentions cached pending changes',
      pass: /pendiente/i.test(offlineChip || ''),
    },
    {
      name: 'online-reload (drain blocked) preserved bumped qty in IDB cache (regression guard)',
      pass: cachedTarget?.quantity === expectedAfterBump,
    },
    {
      name: 'online-reload (drain blocked) chip mentions pendientes, not "Sincronizado con SQLite"',
      pass:
        /pendiente/i.test(chipAfterOnlineReload || '') &&
        !/^Sincronizado con SQLite$/.test((chipAfterOnlineReload || '').trim()),
    },
    {
      name: 'pending queue stayed intact while backup was blocked',
      pass: pendingAfterReload.length === 1,
    },
    {
      name: 'after unblocking backup, queue drained and server reflects bumped qty',
      pass: pendingAfterDrain.length === 0 && finalServer === expectedAfterBump,
    },
  ];

  for (const check of checks) {
    record(check.pass ? 'PASS' : 'FAIL', check.name);
    if (!check.pass) exitCode = 1;
  }

  writeFileSync(
    join(TMP_DIR, 'report.json'),
    JSON.stringify({ log, checks, serverLog: serverChunks.join('') }, null, 2),
  );
} catch (error) {
  exitCode = 2;
  record('exception', String(error?.stack || error));
  writeFileSync(
    join(TMP_DIR, 'report.json'),
    JSON.stringify({ log, error: String(error?.stack || error), serverLog: serverChunks.join('') }, null, 2),
  );
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
  setTimeout(() => server.kill('SIGKILL'), 2000).unref();
  try { rmSync(DB_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
}

process.exit(exitCode);
