import { rm } from 'node:fs/promises';
import { cpus, release, totalmem, type as osType } from 'node:os';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page } from 'playwright-core';
import { build, preview } from 'vite';

type TraceEvent = { name: string; ph: string; pid: number; tid: number; dur?: number; args?: { name?: string } };
type Spread = { count: number; p50: number; p95: number; p99: number; max: number };

function spread(values: number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (share: number): number => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
  const round = (value: number): number => Math.round(value * 100) / 100;
  return { count: sorted.length, p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(sorted.at(-1) ?? 0) };
}

const KEYS = 'abcdefghij'.repeat(20);

const configFile = fileURLToPath(new URL('./vite.config.ts', import.meta.url));
await build({ configFile, logLevel: 'error' });
const server = await preview({ configFile, logLevel: 'error' });
const url = server.resolvedUrls?.local[0];
if (url === undefined) throw new Error('the stand server did not report a local url');

async function fresh(browser: Browser): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${url}probe.html`);
  await page.waitForFunction(() => (window as unknown as { probe?: { ready: boolean } }).probe?.ready === true);
  return page;
}

async function typed(browser: Browser, page: Page): Promise<{ input: unknown; tasks: Spread; over16: number }> {
  await page.evaluate('probe.watch()');
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'] });
  await page.keyboard.type(KEYS, { delay: 25 });
  const trace = JSON.parse((await browser.stopTracing()).toString()) as { traceEvents: TraceEvent[] };
  const input = await page.evaluate(`probe.stop(${KEYS.length})`);
  const main = trace.traceEvents.find((event) => event.name === 'thread_name' && event.args?.name === 'CrRendererMain');
  const tasks = trace.traceEvents
    .filter((event) => event.name === 'RunTask' && event.ph === 'X' && event.tid === main?.tid && event.pid === main?.pid)
    .map((event) => (event.dur ?? 0) / 1000);
  return { input, tasks: spread(tasks), over16: tasks.filter((ms) => ms > 16).length };
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: (process.env.CHROME_ARGS ?? '').split(' ').filter(Boolean),
});
try {
  const result: Record<string, unknown> = {
    machine: `${cpus()[0]?.model ?? 'unknown cpu'} × ${cpus().length}, ${Math.round(totalmem() / 2 ** 30)} GiB, ${osType()} ${release()}, headless Chrome ${browser.version()}`,
  };

  let page = await fresh(browser);
  result.open30kCold = await page.evaluate('probe.open(30000)');
  const warm = [];
  for (let run = 0; run < 3; run += 1) warm.push(await page.evaluate('probe.open(30000)'));
  result.open30kWarm = warm;
  await page.close();

  for (const [name, script] of [
    ['typing1k', 'probe.open(1000)'],
    ['typing100k', 'probe.open(100000)'],
    ['typing100kMarks', "probe.open(100000, { strips: 10000, find: 'total' })"],
  ] as const) {
    page = await fresh(browser);
    await page.evaluate(script);
    await page.evaluate('probe.focusMiddle()');
    result[name] = await typed(browser, page);
    await page.close();
  }

  page = await fresh(browser);
  await page.evaluate('probe.plain()');
  result.typingTextarea = await typed(browser, page);
  await page.close();

  page = await fresh(browser);
  await page.evaluate('probe.open(100000)');
  result.remoteClean100k = await page.evaluate('probe.remote(50, 0)');
  result.remoteUnsaved2000Lines100k = await page.evaluate('probe.remote(50, 2000)');
  await page.close();

  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await server.close();
  await rm(fileURLToPath(new URL('./dist', import.meta.url)), { recursive: true, force: true });
}
