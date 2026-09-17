/**
 * End-to-end smoke run against the built Chrome extension (`bun run build` first).
 *
 *   node apps/extension/e2e/run.ts [dictionary.ace ...]
 *
 * Loads `.output/chrome-mv3` into Playwright's Chromium, imports the given `.ace` files (default:
 * every file in example-dictionaries/ace) through the options page, verifies the import survives
 * a reload, runs a search, then Shift-hovers a test page and inspects the popup. Screenshots and a
 * JSON report land in `e2e/out/`.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Frame, type Page } from 'playwright';

// Extension-page global used inside `page.evaluate` callbacks.
declare const chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, '../.output/chrome-mv3');
const aceDir = resolve(here, '../../../example-dictionaries/ace');
const outDir = resolve(here, 'out');
const profileDir = resolve(outDir, 'profile');

const files =
  process.argv.length > 2
    ? process.argv.slice(2).map((p) => resolve(p))
    : readdirSync(aceDir)
        .filter((f) => f.endsWith('.ace'))
        .map((f) => resolve(aceDir, f));

rmSync(profileDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const report: Record<string, unknown> = { files: files.map((f) => f.split(/[\\/]/).pop()) };
const log = (...args: unknown[]) => console.log('[e2e]', ...args);

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
  log('extension id', extensionId);

  // ---- import ---------------------------------------------------------------------------------
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#dictionaries`);
  await options.waitForSelector('[data-testid=file-input]', { state: 'attached' });
  const importStart = Date.now();
  await options.setInputFiles('[data-testid=file-input]', files);
  await options.waitForFunction(
    (n) =>
      document.querySelectorAll('[data-testid=import-jobs] [data-status=done]').length === n ||
      document.querySelectorAll('[data-testid=import-jobs] [data-status=error]').length > 0,
    files.length,
    { timeout: 20 * 60_000, polling: 500 },
  );
  const importMs = Date.now() - importStart;
  const jobs = await options.$$eval('[data-testid=import-jobs] [data-status]', (els) =>
    els.map((el) => ({
      status: el.getAttribute('data-status'),
      text: el.textContent?.replace(/\s+/g, ' ').trim(),
    })),
  );
  report.import = { ms: importMs, jobs };
  log(`imported ${files.length} file(s) in ${(importMs / 1000).toFixed(1)} s`);
  for (const job of jobs) log(' ', job.status, job.text);
  if (jobs.some((j) => j.status === 'error')) throw new Error('an import failed');
  await options.screenshot({ path: resolve(outDir, '1-dictionaries.png'), fullPage: true });

  // ---- persistence across reload ---------------------------------------------------------------
  await options.reload();
  await options.waitForFunction(
    (n) => document.querySelectorAll('[data-testid=dictionary-list] li').length === n,
    files.length,
    { timeout: 30_000 },
  );
  const installed = await options.$$eval('[data-testid=dictionary-list] li', (els) =>
    els.map((el) => ({
      id: el.getAttribute('data-dictionary'),
      enabled: el.getAttribute('data-enabled'),
      text: el.textContent?.replace(/\s+/g, ' ').trim(),
    })),
  );
  const storage = await options.$eval('[data-testid=storage]', (el) =>
    el.textContent?.replace(/\s+/g, ' ').trim(),
  );
  report.installed = installed;
  report.storage = storage;
  log('after reload:', installed.length, 'dictionaries;', storage);

  // ---- lookup timings through the background ----------------------------------------------------
  const timings = await options.evaluate(async () => {
    const terms = ['读书', '讀', '中华人民共和国成立', '一整天的書', '不', '𥥷', 'hello'];
    const out: unknown[] = [];
    for (const pass of [1, 2]) {
      for (const text of terms) {
        const started = performance.now();
        const r = (await chrome.runtime.sendMessage({ type: 'lookup', text })) as {
          elapsed: number;
          groups: { matched: string; entries: unknown[] }[];
          matchLength: number;
          cached: boolean;
        };
        out.push({
          pass,
          text,
          roundTripMs: +(performance.now() - started).toFixed(1),
          serviceMs: +r.elapsed.toFixed(1),
          cached: r.cached,
          matchLength: r.matchLength,
          groups: r.groups.map((g) => `${g.matched}×${g.entries.length}`),
        });
      }
    }
    return out;
  });
  report.timings = timings;
  log('lookup timings:');
  for (const t of timings) log(' ', JSON.stringify(t));

  // ---- search page -----------------------------------------------------------------------------
  await options.goto(`chrome-extension://${extensionId}/options.html#search`);
  await options.fill('[data-testid=search-input]', '读');
  await options.waitForSelector('[data-testid=search-results] .ace-headword', { timeout: 30_000 });
  await options.waitForTimeout(500);
  report.search = await describeResults(options);
  await options.screenshot({ path: resolve(outDir, '2-search.png'), fullPage: true });
  log('search 读 →', JSON.stringify(report.search));

  // ---- hover on a web page ---------------------------------------------------------------------
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForTimeout(800); // content script + settings
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
  const hoverStart = Date.now();
  await page.waitForSelector('#acetylcholine-popup', { state: 'visible', timeout: 15_000 });
  const frame = await waitForFrame(page, /lookup\.html/);
  await frame.waitForSelector('.ace-headword', { timeout: 15_000 });
  const hoverMs = Date.now() - hoverStart;
  await page.waitForTimeout(600); // let images / shadow roots settle
  await page.keyboard.up('Shift');
  report.hover = { ms: hoverMs, ...(await describeResults(frame)) };
  const frameBox = await page.$eval('#acetylcholine-popup', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  report.hoverFrame = frameBox;
  log(`hover 读书 → popup in ${hoverMs} ms`, JSON.stringify(report.hover));
  await page.screenshot({ path: resolve(outDir, '3-hover.png') });

  // Nested lookup: click the first internal link inside the popup, if any.
  const link = await frame.$('.ace-dictionary-content');
  if (link) {
    const nested = await frame.evaluate(() => {
      const hosts = document.querySelectorAll('.ace-dictionary-content');
      for (const host of hosts) {
        const a = host.shadowRoot?.querySelector('a[data-ace-lookup]') as HTMLAnchorElement | null;
        if (a) {
          const term = a.getAttribute('data-ace-lookup');
          a.click();
          return term;
        }
      }
      return null;
    });
    if (nested) {
      await frame.waitForFunction(
        () => document.querySelector('button[title^="Back"]:not([disabled])') !== null,
        undefined,
        { timeout: 10_000 },
      );
      await frame.waitForTimeout(400);
      report.nested = { term: nested, ...(await describeResults(frame)) };
      log('nested lookup', nested, '→', JSON.stringify(report.nested));
      await page.screenshot({ path: resolve(outDir, '4-nested.png') });
    }
  }

  // Escape closes the popup.
  await page.mouse.click(10, 10);
  await page.waitForSelector('#acetylcholine-popup', { state: 'hidden', timeout: 5_000 });
  report.closedOnClick = true;

  // Second hover on traditional text inside inline elements.
  const point2 = await page.evaluate(() => {
    const i = document.querySelector('#t2 i')!.firstChild as Text;
    const range = document.createRange();
    range.setStart(i, 0);
    range.setEnd(i, 1);
    const r = range.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.keyboard.down('Shift');
  await page.mouse.move(point2.x, point2.y, { steps: 3 });
  await page.waitForSelector('#acetylcholine-popup', { state: 'visible', timeout: 15_000 });
  const frame2 = await waitForFrame(page, /lookup\.html/);
  await frame2.waitForFunction(
    () => document.querySelector('.ace-headword')?.textContent?.includes('讀') === true,
    undefined,
    { timeout: 15_000 },
  );
  await page.keyboard.up('Shift');
  await page.waitForTimeout(400);
  report.hoverTraditional = await describeResults(frame2);
  log('hover 讀 →', JSON.stringify(report.hoverTraditional));
  await page.screenshot({ path: resolve(outDir, '5-hover-traditional.png') });

  writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));
  log('done; report in', resolve(outDir, 'report.json'));
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
  throw new Error('popup frame not found');
}

async function describeResults(target: Page | Frame) {
  const status = await target
    .$eval('[data-testid=search-results] > div, .flex-1.truncate', (el) =>
      el.textContent?.replace(/\s+/g, ' ').trim(),
    )
    .catch(() => null);
  const groups = await target.$$eval('.ace-group', (els) =>
    els.map((g) => ({
      headword: g.querySelector('.ace-headword')?.textContent,
      variants: [...g.querySelectorAll('.ace-variant')].map((v) => v.textContent),
      readings: [...g.querySelectorAll('.ace-reading')].map((r) => r.textContent),
      secondary: [...g.querySelectorAll('.ace-reading-secondary')].map((r) => r.textContent),
      dictionaries: [...g.querySelectorAll('.ace-dictionary-title')].map((d) => d.textContent),
      renderedChars: [...g.querySelectorAll('.ace-dictionary-content')].map(
        (h) => h.shadowRoot?.textContent?.length ?? 0,
      ),
      images: [...g.querySelectorAll('.ace-dictionary-content')].reduce(
        (n, h) => n + (h.shadowRoot?.querySelectorAll('img[src^="blob:"]').length ?? 0),
        0,
      ),
    })),
  );
  return { status, groups };
}
