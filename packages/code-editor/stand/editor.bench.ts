import { cpus, release, totalmem, type as osType } from 'node:os';
import { fileURLToPath } from 'node:url';
import { session } from '@runlith/e2e/engines';
import { serveStand } from '@runlith/e2e/stand';
import { Effect } from 'effect';
import type { Browser, Page } from 'playwright-core';

type TraceFrame = { frame: string; processId: number };
type TraceEvent = {
  name: string;
  ph: string;
  pid: number;
  tid: number;
  dur?: number;
  args?: { name?: string; data?: { frames?: TraceFrame[] } };
};
type Spread = { count: number; p50: number; p95: number; p99: number; max: number };

function spread(values: number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (share: number): number => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
  const round = (value: number): number => Math.round(value * 100) / 100;
  return { count: sorted.length, p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(sorted.at(-1) ?? 0) };
}

const KEYS = 'abcdefghij'.repeat(20);
const configFile = fileURLToPath(new URL('./vite.config.ts', import.meta.url));

async function fresh(browser: Browser, url: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(0);
  page.setDefaultNavigationTimeout(0);
  await page.goto(url);
  await page.waitForFunction(() => (window as unknown as { probe?: { ready: boolean } }).probe?.ready === true);
  return page;
}

async function typed(browser: Browser, page: Page): Promise<{ input: unknown; tasks: Spread; over16: number }> {
  const cdp = await page.context().newCDPSession(page);
  const { frameTree } = await cdp.send('Page.getFrameTree');
  await cdp.detach();
  await page.evaluate('probe.watch()');
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'] });
  await page.keyboard.type(KEYS, { delay: 25 });
  const trace = JSON.parse((await browser.stopTracing()).toString()) as { traceEvents: TraceEvent[] };
  const input = await page.evaluate(`probe.stop(${KEYS.length})`);
  const renderer = trace.traceEvents
    .find((event) => event.name === 'TracingStartedInBrowser')
    ?.args?.data?.frames?.find((frame) => frame.frame === frameTree.frame.id)?.processId;
  const main = trace.traceEvents.find(
    (event) => event.name === 'thread_name' && event.args?.name === 'CrRendererMain' && event.pid === renderer,
  );
  if (main === undefined) throw new Error(`the trace did not identify the renderer of frame ${frameTree.frame.id}`);
  const tasks = trace.traceEvents
    .filter((event) => event.name === 'RunTask' && event.ph === 'X' && event.tid === main?.tid && event.pid === main?.pid)
    .map((event) => (event.dur ?? 0) / 1000);
  return { input, tasks: spread(tasks), over16: tasks.filter((ms) => ms > 16).length };
}

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const served = yield* serveStand(configFile, { own: 'the measuring program closes its stand when the samples finish' });
      const { browser, page: initial } = yield* session(
        'chromium',
        {},
        {
          own: 'the measuring program closes its browser when the samples finish',
        },
      );
      yield* Effect.promise(async () => {
        await initial.close();
        const url = served.url('/probe.html');
        const result: Record<string, unknown> = {
          machine: `${cpus()[0]?.model ?? 'unknown cpu'} × ${cpus().length}, ${Math.round(totalmem() / 2 ** 30)} GiB, ${osType()} ${release()}, headless Chrome ${browser.version()}`,
        };

        let page = await fresh(browser, url);
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
          page = await fresh(browser, url);
          await page.evaluate(script);
          await page.evaluate('probe.focusMiddle()');
          result[name] = await typed(browser, page);
          await page.close();
        }

        page = await fresh(browser, url);
        await page.evaluate('probe.plain()');
        result.typingTextarea = await typed(browser, page);
        await page.close();

        page = await fresh(browser, url);
        await page.evaluate('probe.open(100000)');
        result.remoteClean100k = await page.evaluate('probe.remote(50, 0)');
        result.remoteUnsaved2000Lines100k = await page.evaluate('probe.remote(50, 2000)');
        await page.close();

        console.log(JSON.stringify(result));
      });
    }),
  ),
);
