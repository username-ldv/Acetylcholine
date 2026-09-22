/**
 * End-to-end check of the Anki integration against a running Anki with AnkiConnect
 * (`bun run ext:build` first):
 *
 *   node apps/extension/e2e/anki.ts
 *
 * Fresh Chromium profile, three sample dictionaries imported, Anki configured for the deck
 * "Acetylcholine Test" and the note type "CN Mining", then Shift+hover on 读书 in the test page,
 * a click on "+ Anki", and the note read back through AnkiConnect. Notes this script tagged in an
 * earlier run (tag `acetylcholine-e2e`, that deck only) are deleted first so the run repeats.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Frame, type Page } from 'playwright';

declare const chrome: {
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  storage: { local: { set(items: Record<string, unknown>): Promise<void> } };
  permissions: { contains(p: { origins: string[] }): Promise<boolean> };
};

const ANKI_URL = 'http://127.0.0.1:8765';
const DECK = 'Acetylcholine Test';
const MODEL = 'CN Mining';
const TAG = 'acetylcholine-e2e';
const SUBSET = ['moe-concised.ace', 'hanyu7-mdx.ace', 'guifan.ace'];

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, '../.output/chrome-mv3');
const aceDir = resolve(here, '../../../example-dictionaries/ace');
const outDir = resolve(here, 'out');
const profileDir = resolve(outDir, 'profile-anki');
rmSync(profileDir, { recursive: true, force: true });
mkdirSync(profileDir, { recursive: true });
const log = (...args: unknown[]) => console.log('[anki]', ...args);
const report: Record<string, unknown> = {};

async function anki<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(ANKI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params }),
  });
  const json = (await res.json()) as { result: T; error: string | null };
  if (json.error) throw new Error(`${action}: ${json.error}`);
  return json.result;
}

// Clean up notes from earlier runs (only ours: that deck, that tag).
const stale = await anki<number[]>('findNotes', { query: `"deck:${DECK}" tag:${TAG}` });
if (stale.length > 0) {
  await anki('deleteNotes', { notes: stale });
  log(`deleted ${stale.length} note(s) from an earlier run`);
}

const html = readFileSync(resolve(here, 'page.html'));
const server = createServer((_req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(html);
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const port = (server.address() as AddressInfo).port;

const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chromium',
  headless: false,
  viewport: { width: 1280, height: 900 },
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-first-run',
    '--lang=en-US',
  ],
});

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;

  // ---- import ---------------------------------------------------------------------------------
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#dictionaries`);
  await options.waitForSelector('[data-testid=file-input]', { state: 'attached' });
  const files = SUBSET.map((f) => resolve(aceDir, f));
  await options.setInputFiles('[data-testid=file-input]', files);
  await options.waitForFunction(
    (n) =>
      document.querySelectorAll('[data-testid=import-jobs] [data-status=done]').length === n ||
      document.querySelectorAll('[data-testid=import-jobs] [data-status=error]').length > 0,
    files.length,
    { timeout: 20 * 60_000, polling: 500 },
  );
  log(`imported ${files.length} dictionaries`);

  // ---- configure Anki (straight into storage; the settings page would ask for the permission) --
  await options.evaluate(
    async ({ deck, model, tag }) => {
      const settings = (await chrome.runtime.sendMessage({ type: 'getSettings' })) as {
        anki: Record<string, unknown>;
      };
      settings.anki = {
        ...settings.anki,
        enabled: true,
        deck,
        model,
        fields: {
          Word: '{expression}',
          Reading: '{reading:zhuyin}',
          'Sentence-Traditional': '{cloze-prefix}<b>{cloze-body}</b>{cloze-suffix}',
          Definition: '{glossary}',
          'Context/Hints': '{document-title} · {url}',
        },
        tags: ['acetylcholine', tag],
      };
      await chrome.storage.local.set({ settings });
    },
    { deck: DECK, model: MODEL, tag: TAG },
  );
  await options.waitForTimeout(300);
  report.hostPermission = await options.evaluate(() =>
    chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }),
  );
  report.status = await options.evaluate(() => chrome.runtime.sendMessage({ type: 'anki:status' }));
  log('host permission:', report.hostPermission, 'status:', JSON.stringify(report.status));
  report.decks = await options.evaluate(() => chrome.runtime.sendMessage({ type: 'anki:decks' }));
  report.fields = await options.evaluate(
    (m) => chrome.runtime.sendMessage({ type: 'anki:modelFields', model: m }),
    MODEL,
  );
  log('decks:', JSON.stringify(report.decks), 'fields:', JSON.stringify(report.fields));

  await options.goto(`chrome-extension://${extensionId}/options.html#anki`);
  await options.waitForSelector('[data-testid=anki-status] [data-connected=true]', {
    timeout: 15_000,
  });
  await options.waitForSelector('[data-testid=anki-fields]', { timeout: 15_000 });
  await options.waitForTimeout(400);
  await options.screenshot({ path: resolve(outDir, 'anki-1-settings.png'), fullPage: true });

  // ---- hover on the page -----------------------------------------------------------------------
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForTimeout(800);
  const point = await page.evaluate(() => {
    const text = document.getElementById('t1')!.firstChild as Text;
    const idx = text.data.indexOf('读书');
    const range = document.createRange();
    range.setStart(text, idx);
    range.setEnd(text, idx + 1);
    const r = range.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(point.x - 40, point.y - 40);
  await page.keyboard.down('Shift');
  await page.mouse.move(point.x, point.y, { steps: 4 });
  await page.waitForSelector('#acetylcholine-popup', { state: 'visible', timeout: 15_000 });
  const frame = await waitForFrame(page, /lookup\.html/);
  await frame.waitForSelector('.ace-anki', { timeout: 15_000 });
  await page.keyboard.up('Shift');
  await frame.waitForFunction(
    () =>
      [...document.querySelectorAll('.ace-anki')].every(
        (el) => el.getAttribute('data-status') !== 'checking',
      ),
    undefined,
    { timeout: 15_000 },
  );
  const describe = () =>
    frame.$$eval('.ace-group, .ace-word', (els) =>
      els.map((g) => ({
        headword: g.querySelector('.ace-headword')?.textContent,
        anki: g.querySelector('.ace-anki')?.getAttribute('data-status'),
        text: g.querySelector('.ace-anki')?.textContent?.replace(/\s+/g, ' ').trim(),
      })),
    );
  report.beforeAdd = await describe();
  log('before add:', JSON.stringify(report.beforeAdd));
  await page.screenshot({ path: resolve(outDir, 'anki-2-popup.png') });

  // ---- add the first card ----------------------------------------------------------------------
  const addStart = Date.now();
  await frame.click(
    '.ace-group:first-child .ace-anki-button, .ace-word:first-child .ace-anki-button',
  );
  await frame.waitForSelector('.ace-anki[data-status=added], .ace-anki[data-status=error]', {
    timeout: 30_000,
  });
  report.addMs = Date.now() - addStart;
  report.afterAdd = await describe();
  log(`after add (${report.addMs} ms):`, JSON.stringify(report.afterAdd));
  await page.screenshot({ path: resolve(outDir, 'anki-3-added.png') });
  const first = (report.afterAdd as { anki: string; text: string }[])[0]!;
  if (first.anki === 'error') throw new Error(`add failed: ${first.text}`);

  // ---- read the note back ----------------------------------------------------------------------
  const ids = await anki<number[]>('findNotes', { query: `"deck:${DECK}" tag:${TAG}` });
  const [info] = await anki<{ fields: Record<string, { value: string }>; tags: string[] }[]>(
    'notesInfo',
    { notes: ids },
  );
  const fields = Object.fromEntries(
    Object.entries(info!.fields).map(([k, v]) => [k, v.value.slice(0, 300)]),
  );
  const images = [...(info!.fields.Definition?.value.matchAll(/src="([^"]+)"/g) ?? [])].map(
    (m) => m[1],
  );
  const media = await anki<string[]>('getMediaFilesNames', { pattern: 'ace-*' });
  report.note = { ids, tags: info!.tags, fields, images, mediaStored: media.length };
  log('note', ids, 'tags', info!.tags);
  for (const [k, v] of Object.entries(fields)) log(`  ${k} => ${v}`);
  log('images in Definition:', images.length, '/ ace-* media files in Anki:', media.length);

  // ---- duplicate detection on a fresh hover ----------------------------------------------------
  await page.mouse.click(10, 10);
  await page.waitForSelector('#acetylcholine-popup', { state: 'hidden', timeout: 5_000 });
  await page.keyboard.down('Shift');
  await page.mouse.move(point.x + 30, point.y + 30);
  await page.mouse.move(point.x, point.y, { steps: 3 });
  await page.waitForSelector('#acetylcholine-popup', { state: 'visible', timeout: 15_000 });
  const frame2 = await waitForFrame(page, /lookup\.html/);
  await frame2.waitForFunction(
    () =>
      document.querySelectorAll('.ace-anki').length > 0 &&
      [...document.querySelectorAll('.ace-anki')].every(
        (el) => el.getAttribute('data-status') !== 'checking',
      ),
    undefined,
    { timeout: 15_000 },
  );
  await page.keyboard.up('Shift');
  report.secondHover = await frame2.$$eval('.ace-group, .ace-word', (els) =>
    els.map((g) => ({
      headword: g.querySelector('.ace-headword')?.textContent,
      anki: g.querySelector('.ace-anki')?.getAttribute('data-status'),
    })),
  );
  log('second hover:', JSON.stringify(report.secondHover));
  await page.screenshot({ path: resolve(outDir, 'anki-4-duplicate.png') });

  // ---- a word with a picture (现汉 has one for these), from the search page: media upload ------
  // Candidates in turn: the user's collection may already hold one (then the card says "in Anki"
  // and only offers "view", which would open the Anki browser).
  const PICTURED = ['剑', '俎', '匜', '卣', '冕'];
  let pictured: string | null = null;
  for (const word of PICTURED) {
    await options.goto(
      `chrome-extension://${extensionId}/options.html#search?q=${encodeURIComponent(word)}`,
    );
    await options.reload();
    await options.waitForSelector('[data-testid=search-results] .ace-anki', { timeout: 30_000 });
    await options.waitForFunction(
      () =>
        [...document.querySelectorAll('.ace-anki')].every(
          (el) => el.getAttribute('data-status') !== 'checking',
        ),
      undefined,
      { timeout: 15_000 },
    );
    const status = await options.$eval('[data-testid=search-results] .ace-anki', (el) =>
      el.getAttribute('data-status'),
    );
    log(`${word}: ${status}`);
    if (status === 'ready') {
      pictured = word;
      break;
    }
  }
  if (!pictured) throw new Error('every pictured candidate is already in the collection');
  const consoleLines: string[] = [];
  options.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
  options.on('pageerror', (e) => consoleLines.push(`pageerror: ${e.message}`));
  await options.click('[data-testid=search-results] .ace-anki[data-status=ready] .ace-anki-button');
  try {
    await options.waitForSelector(
      '[data-testid=search-results] .ace-anki[data-status=added], [data-testid=search-results] .ace-anki[data-status=error]',
      { timeout: 30_000 },
    );
  } catch (err) {
    const states = await options.$$eval('[data-testid=search-results] .ace-anki', (els) =>
      els.map((el) => `${el.getAttribute('data-status')}: ${el.textContent?.trim()}`),
    );
    log('剑 add did not finish; states:', JSON.stringify(states));
    log('console:', consoleLines.join('\n  '));
    throw err;
  }
  const swordState = await options.$eval('[data-testid=search-results] .ace-anki', (el) => ({
    status: el.getAttribute('data-status'),
    text: el.textContent?.trim(),
  }));
  if (swordState.status === 'error') {
    throw new Error(`add ${pictured} failed: ${swordState.text}`);
  }
  const swordIds = await anki<number[]>('findNotes', {
    query: `"deck:${DECK}" tag:${TAG} Word:${pictured}`,
  });
  const [sword] = await anki<{ fields: Record<string, { value: string }> }[]>('notesInfo', {
    notes: swordIds,
  });
  const swordImages = [
    ...(sword!.fields.Definition?.value.matchAll(/<img[^>]*src="([^"]+)"/g) ?? []),
  ].map((m) => m[1] ?? '');
  const stored = await anki<string[]>('getMediaFilesNames', { pattern: 'ace-*' });
  const stylesheets = await anki<string[]>('getMediaFilesNames', { pattern: '_ace-*' });
  const missing = swordImages.filter((f) => !stored.includes(f));
  const links = [
    ...(sword!.fields.Definition?.value.matchAll(/<link rel="stylesheet" href="([^"]+)"/g) ?? []),
  ].map((m) => m[1] ?? '');
  const missingStylesheets = links.filter((f) => !stylesheets.includes(f));
  report.sword = {
    ids: swordIds,
    images: swordImages,
    storedMedia: stored.length,
    missing,
    stylesheets: links,
    missingStylesheets,
    word: sword!.fields.Word?.value,
    reading: sword!.fields.Reading?.value,
    sentence: sword!.fields['Sentence-Traditional']?.value,
  };
  log(`${pictured} note`, swordIds, 'images', swordImages, 'missing in media', missing);
  log('  stylesheets linked', links, 'missing in media', missingStylesheets);
  await options.screenshot({ path: resolve(outDir, 'anki-5-search-added.png'), fullPage: true });

  writeFileSync(resolve(outDir, 'anki-report.json'), JSON.stringify(report, null, 2));
  log('done; report in', resolve(outDir, 'anki-report.json'));
} finally {
  await context.close();
  server.close();
}

async function waitForFrame(page: Page, pattern: RegExp): Promise<Frame> {
  for (let i = 0; i < 100; i++) {
    const frame = page.frames().find((f) => pattern.test(f.url()));
    if (frame) return frame;
    await page.waitForTimeout(100);
  }
  throw new Error(`frame ${pattern} not found`);
}
