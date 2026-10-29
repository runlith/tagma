import { afterAll, expect } from 'bun:test';
import { watch } from 'node:fs';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer, Queue } from 'effect';
import { Pages } from '../contract/service/pages.js';
import { Hosts } from '../contract/service/hosts.js';
import { Profiles } from '../contract/service/profiles.js';
import type { PageId } from '../contract/wire/ids.js';
import { PAGE_PAIRS as PAGE } from '../operations.js';
import { TRACE_PAIRS as TRACE } from '../traces.js';
import { RunEnds } from './runs.js';
import type { EngineHost } from './scenarios.js';
import { agentIn, calling, refusalOf } from './world.js';

const BLOCKED_MS = 300;

const noise = (width: number, height: number): Uint8Array => {
  const row = Math.ceil((width * 3) / 4) * 4;
  const bytes = new Uint8Array(54 + row * height);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0x4d42, true);
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, row * height, true);
  for (let at = 54; at < bytes.length; at += 60_000) crypto.getRandomValues(bytes.subarray(at, Math.min(bytes.length, at + 60_000)));
  return bytes;
};

const PICTURE = noise(480, 320);

const PAGES: Readonly<Record<string, string>> = {
  '/late': `<!doctype html><title>Late</title><link rel="stylesheet" href="/slow.css"><p style="font-size:12px">A short line.</p>
    <script>addEventListener('DOMContentLoaded', () => { const img = new Image(480, 320); img.src = '/picture.bmp'; document.body.append(img); });</script>`,
  '/block': `<!doctype html><title>Block</title><button id="block" style="width:200px;height:60px" onclick="const end = performance.now() + ${BLOCKED_MS}; while (performance.now() < end) {} this.textContent = 'Blocked'">Block</button>`,
};

class TracePage extends Context.Service<TracePage, { current: PageId | undefined }>()('testing/TracePage') {}

export const traceScenarios = (input: EngineHost): void => {
  const server: Bun.Server<undefined> = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (request): Promise<Response> => {
      const path = new URL(request.url).pathname;
      if (path === '/slow.css') {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return new Response('p { color: #333 }', { headers: { 'content-type': 'text/css' } });
      }
      if (path === '/picture.bmp') return new Response(PICTURE, { headers: { 'content-type': 'image/bmp' } });
      const html = PAGES[path];
      return html === undefined
        ? new Response(null, { status: 404 })
        : new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    },
  });
  afterAll(() => server.stop(true));
  const at = (path: string) => `http://127.0.0.1:${server.port}${path}`;
  const agent = agentIn(dirname(import.meta.path));
  const world = Layer.effect(
    TracePage,
    Effect.gen(function* () {
      const record = yield* (yield* Profiles).record(input.profile);
      yield* (yield* (yield* Hosts).reach(record.adapter)).profiles.prepare(record);
      const pages = yield* Pages;
      const held = TracePage.of({ current: undefined });
      yield* Effect.addFinalizer(() =>
        held.current === undefined || pages.live(held.current) === undefined ? Effect.void : pages.close(held.current).pipe(Effect.orDie),
      );
      return held;
    }),
  ).pipe(Layer.provideMerge(input.fixture()), Layer.provideMerge(BunFileSystem.layer));

  const open = Effect.fnUntraced(function* (path: string) {
    const held = yield* TracePage;
    const pages = yield* Pages;
    if (held.current !== undefined && pages.live(held.current) !== undefined) {
      yield* calling(PAGE.navigate_page.body.execute({ page: held.current, url: at(path) }, undefined, agent));
      yield* calling(PAGE.wait_for_page.body.execute({ page: held.current, until: 'load', timeoutMs: 10_000 }, undefined, agent));
      return held.current;
    }
    const opened = yield* calling(PAGE.open_page.body.execute({ url: at(path), profile: input.profile }, undefined, agent));
    held.current = opened.page.id;
    yield* calling(PAGE.wait_for_page.body.execute({ page: opened.page.id, until: 'load', timeoutMs: 10_000 }, undefined, agent));
    return opened.page.id;
  });
  const trace = (page: PageId, action: 'load' | 'start' | 'stop', extra: { readonly cold?: boolean } = {}) =>
    calling(TRACE.trace_page.body.execute({ page, action, ...extra }, undefined, agent));
  const traced = (page: PageId, action: 'load' | 'stop') =>
    Effect.flatMap(trace(page, action, action === 'load' ? { cold: true } : {}), (answer) =>
      answer.status === 'traced' ? Effect.succeed(answer) : Effect.die(`trace_page ${action} answered ${answer.status}`),
    );
  const started = (page: PageId) =>
    Effect.flatMap(trace(page, 'start'), (answer) =>
      answer.status === 'started' ? Effect.succeed(answer) : Effect.die(`trace_page start answered ${answer.status}`),
    );
  const read = (input: Parameters<typeof TRACE.read_page_trace.body.execute>[0]) =>
    calling(TRACE.read_page_trace.body.execute(input, undefined, agent));
  const blockClick = Effect.fnUntraced(function* (page: PageId) {
    const shot = yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent));
    const ref = /button "Block" \[ref=(e\d+)\]/u.exec(shot.text)?.[1];
    if (ref === undefined) return yield* Effect.die(`no Block button in:\n${shot.text}`);
    yield* calling(PAGE.act_on_page.body.execute({ page, steps: [{ action: 'click', ref }] }, undefined, agent));
    yield* calling(
      PAGE.evaluate_in_page.body.execute(
        { page, expression: 'new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true))))' },
        undefined,
        agent,
      ),
    );
  });

  layer(world, { excludeTestServices: true })(`traces on ${input.name}`, (it) => {
    it.effect('a load names the late image as LCP and the delayed stylesheet as render-blocking, in a gzip trace', () =>
      Effect.gen(function* () {
        const page = yield* open('/late');
        const answer = yield* traced(page, 'load');
        expect(answer.settled).toBe(true);
        const set = answer.sets.find((held) => held.lcp !== null);
        expect(set?.lcp?.url).toBe(at('/picture.bmp'));
        if (set === undefined) return;
        const blocking = yield* read({ trace: answer.trace, set: set.id, insight: 'RenderBlocking' });
        expect(blocking.status).toBe('insight');
        if (blocking.status !== 'insight') return;
        expect(blocking.line).toContain(at('/slow.css'));
        const phases = set.lcp?.phases;
        const summed = phases == null ? 0 : phases.ttfb + (phases.loadDelay ?? 0) + (phases.loadDuration ?? 0) + phases.renderDelay;
        expect(Math.abs(summed - (set.lcp?.ms ?? 0))).toBeLessThanOrEqual(1);
        expect(phases?.loadDuration).toBeGreaterThan(0);
        const breakdown = yield* read({ trace: answer.trace, set: set.id, insight: 'LCPBreakdown' });
        expect(breakdown).toMatchObject({ status: 'insight', insight: 'LCPBreakdown', set: set.id });
        const unzipped = gunzipSync(yield* (yield* FileSystem.FileSystem).readFile(answer.path));
        const events = (JSON.parse(new TextDecoder().decode(unzipped)) as { readonly traceEvents?: unknown }).traceEvents;
        expect(Array.isArray(events) && events.length > 0).toBe(true);
      }),
    );

    it.effect('an interaction blocked 300 ms reads as INP of at least 300 ms, and a page holds one trace at a time', () =>
      Effect.gen(function* () {
        const page = yield* open('/block');
        const begun = yield* started(page);
        expect((yield* refusalOf(trace(page, 'start'))).code).toBe('trace-running');
        yield* blockClick(page);
        const answer = yield* traced(page, 'stop');
        expect(answer.trace).toBe(begun.trace);
        expect(Math.max(...answer.sets.map((held) => held.inpMs ?? 0))).toBeGreaterThanOrEqual(BLOCKED_MS);
        const set = answer.sets.find((held) => (held.inpMs ?? 0) >= BLOCKED_MS)!;
        const inp = yield* read({ trace: answer.trace, set: set.id, insight: 'INPBreakdown' });
        expect(inp.status === 'insight' ? inp.line : '').toMatch(/^INP \d+ ms on a (click|pointerup|pointerdown|mousedown|mouseup)/u);
        const hot = yield* read({ trace: answer.trace, set: set.id, hot: true, limit: 5 });
        const hottest = hot.status === 'hot' ? hot.functions[0] : undefined;
        expect(hottest?.url).toBe(at('/block'));
        expect((yield* refusalOf(read({ trace: `${page}@1` }))).code).toBe('no-trace');
      }),
    );

    it.effect('a trace under a CPU slowdown names it, and a trace whose run ended is stopped and readable', () =>
      Effect.gen(function* () {
        const page = yield* open('/block');
        yield* calling(PAGE.emulate_page.body.execute({ page, cpu: 4 }, undefined, agent));
        yield* started(page);
        const slowed = yield* traced(page, 'stop');
        yield* calling(PAGE.emulate_page.body.execute({ page, cpu: 1 }, undefined, agent));
        expect(slowed.conditions).toContain('cpu 4×');
        const begun = yield* started(page);
        const changes = yield* Queue.unbounded<void>();
        yield* Effect.acquireRelease(
          Effect.sync(() => watch(dirname(begun.path), () => Queue.offerUnsafe(changes, undefined))),
          (watcher) => Effect.sync(() => watcher.close()),
        );
        yield* (yield* RunEnds).end('agent');
        const summary = yield* Effect.gen(function* () {
          for (;;) {
            const result = yield* Effect.result(read({ trace: begun.trace }));
            if (result._tag === 'Success') return result.success;
            yield* Queue.take(changes);
          }
        });
        expect(summary).toMatchObject({ status: 'summary', trace: begun.trace, path: begun.path });
      }),
    );
  });
};
