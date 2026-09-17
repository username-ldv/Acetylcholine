/**
 * Smoke test for the WXT *dev* output (`bun run ext:dev` must be running in another terminal).
 *
 *   node apps/extension/e2e/dev-smoke.ts [dictionary.ace]
 *
 * Loads `.output/chrome-mv3-dev` into Playwright's Chromium, checks that the options page renders
 * from the dev server, imports one dictionary (default: guifan.ace) and Shift-hovers the test page.
 * Console errors and failed requests from the extension pages are reported.
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, '../.output/chrome-mv3-dev');
const file = resolve(
  process.argv[2] ?? resolve(here, '../../../example-dictionaries/ace/guifan.ace'),
);
const profileDir = resolve(here, 'out/profile-dev');
const log = (...args: unknown[]) => console.log('[dev-smoke]', ...args);

rmSync(profileDir, { recursive: true, force: true });
mkdirSync(profileDir, { recursive: true });

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
  ],
});
const problems: string[] = [];
const watch = (page: Page, label: string) => {
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      problems.push(`${label} console.${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => problems.push(`${label} pageerror: ${err.message}`));
  page.on('requestfailed', (req) =>
    problems.push(`${label} request failed: ${req.url()} (${req.failure()?.errorText})`),
  );
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`${label} HTTP ${res.status()}: ${res.url()}`);
  });
};
let options: Page | null = null;

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  log('extension id', extensionId);

  options = await context.newPage();
  watch(options, 'options');
  await options.goto(`chrome-extension://${extensionId}/options.html#dictionaries`);
  await options.waitForSelector('[data-testid=file-input]', { state: 'attached', timeout: 30_000 });
  const scripts = await options.$$eval('script[src]', (els) =>
    els.map((e) => (e as HTMLScriptElement).src),
  );
  log('options page scripts:', scripts.join(', '));
  await options.setInputFiles('[data-testid=file-input]', [file]);
  await options.waitForFunction(
    () =>
      document.querySelectorAll('[data-testid=import-jobs] [data-status=done]').length === 1 ||
      document.querySelectorAll('[data-testid=import-jobs] [data-status=error]').length > 0,
    undefined,
    { timeout: 5 * 60_000, polling: 500 },
  );
  const job = await options.$eval('[data-testid=import-jobs] [data-status]', (el) => ({
    status: el.getAttribute('data-status'),
    text: el.textContent?.replace(/\s+/g, ' ').trim(),
  }));
  log('import:', JSON.stringify(job));
  if (job.status !== 'done') throw new Error('import failed');

  const page = await context.newPage();
  watch(page, 'page');
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
  let frame = page.frames().find((f) => /lookup\.html/.test(f.url()));
  for (let i = 0; !frame && i < 50; i++) {
    await page.waitForTimeout(100);
    frame = page.frames().find((f) => /lookup\.html/.test(f.url()));
  }
  if (!frame) throw new Error('popup frame not found');
  await frame.waitForSelector('.ace-headword', { timeout: 15_000 });
  await page.keyboard.up('Shift');
  const groups = await frame.$$eval('.ace-group', (els) =>
    els.map((g) => ({
      headword: g.querySelector('.ace-headword')?.textContent,
      readings: [...g.querySelectorAll('.ace-reading')].map((r) => r.textContent),
      dictionaries: [...g.querySelectorAll('.ace-dictionary-title')].map((d) => d.textContent),
    })),
  );
  log('hover 读书 →', JSON.stringify(groups));
  await page.screenshot({ path: resolve(here, 'out/dev-hover.png') });
  log('done');
} catch (err) {
  log('FAILED:', err instanceof Error ? err.message.split('\n')[0] : String(err));
  if (options) {
    const body = await options
      .evaluate(() => document.body.innerHTML.replace(/\s+/g, ' ').slice(0, 600))
      .catch(() => '(no body)');
    log('options body:', body);
    await options.screenshot({ path: resolve(here, 'out/dev-failure.png') }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  if (problems.length > 0) log(`problems:\n  ${problems.join('\n  ')}`);
  else log('no console errors or failed requests');
  await context.close();
  server.close();
}
