import { afterAll, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Exit, Fiber, type Layer, Pull, type Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { Automation } from '../contract/service/automation.js';
import { Pages } from '../contract/service/pages.js';
import type { HostAdapter, Hosts } from '../contract/service/hosts.js';
import { Screencast } from '../contract/service/screencast.js';
import type { PageId, ProfileId } from '../contract/wire/ids.js';
import type { Budget, Frame, InputEvent, ScreencastEvent } from '../contract/wire/screencast.js';
import { PAGE_PAIRS as PAGE } from '../operations.js';
import { amber, neutral, pixelOf } from './pixels.js';
import { agentIn, calling, OPERATOR, refusalOf, type Served } from './world.js';

const PAGES: Readonly<Record<string, string>> = {
  '/moving': `<title>Moving</title><p id="tick" style="font-size:48px">0</p>
    <script>let n = 0; const tick = () => { document.getElementById('tick').textContent = String(++n); document.body.style.background = n % 2 ? '#fff' : '#eee'; requestAnimationFrame(tick); }; tick();</script>`,
  '/still': '<title>Still</title><h1>Nothing moves here</h1>',
  '/press': `<title>Press</title>
    <button style="position:absolute;left:40px;top:60px;width:200px;height:80px" onclick="document.title = 'pressed'; window.pressed?.()">Press</button>
    <input id="field" oninput="window.changed?.(this.value)" style="position:absolute;left:20px;top:20px;width:300px;height:30px">
    <input id="file" type="file" style="position:absolute;left:20px;top:150px;width:300px;height:40px">`,
};

export type CastHost = {
  readonly name: string;
  readonly adapter: HostAdapter;
  readonly profile: ProfileId;
  readonly fixture: (params?: { readonly native?: true }) => Layer.Layer<Served | Hosts>;
};

export const pictureSize = (data: string): { readonly width: number; readonly height: number } => {
  const bytes = Buffer.from(data, 'base64');
  for (let at = 2; at + 9 < bytes.length; at += 2 + bytes.readUInt16BE(at + 2)) {
    const marker = bytes[at + 1]!;
    if (marker >= 0xc0 && marker <= 0xc2) return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
  }
  throw new Error('the frame is no JPEG with a size');
};

type Viewing = {
  readonly viewer: string;
  readonly next: Effect.Effect<ScreencastEvent, unknown>;
  readonly frame: Effect.Effect<Frame, unknown>;
};

const watching = Effect.fnUntraced(function* (page: PageId, budget: Budget): Effect.fn.Return<Viewing, unknown, Served | Scope.Scope> {
  const pull = yield* Stream.toPull((yield* Screencast).watch(page, budget));
  const held: ScreencastEvent[] = [];
  const next = Effect.suspend(() => {
    const first = held.shift();
    return first !== undefined
      ? Effect.succeed(first)
      : Effect.map(pull, (chunk) => {
          held.push(...chunk.slice(1));
          return chunk[0];
        });
  });
  const frame: Effect.Effect<Frame, unknown> = Effect.flatMap(next, (event) => (event.type === 'frame' ? Effect.succeed(event) : frame));
  const named = yield* next;
  return { viewer: named.type === 'viewer' ? named.viewer : '', next, frame };
});

const frameWhere = Effect.fnUntraced(function* (viewing: Viewing, test: (frame: Frame) => boolean) {
  for (;;) {
    const frame = yield* viewing.frame;
    if (test(frame)) return frame;
  }
});

const click = (x: number, y: number): readonly InputEvent[] => [
  { kind: 'mouse', type: 'move', x, y, button: 'none', clicks: 0, modifiers: 0 },
  { kind: 'mouse', type: 'down', x, y, button: 'left', clicks: 1, modifiers: 0 },
  { kind: 'mouse', type: 'up', x, y, button: 'left', clicks: 1, modifiers: 0 },
];

export const screencastScenarios = (input: CastHost): void => {
  const server: Bun.Server<undefined> = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request): Response => {
      const html = PAGES[new URL(request.url).pathname];
      return html === undefined
        ? new Response('missing', { status: 404 })
        : new Response(`<!doctype html>${html}`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    },
  });
  afterAll(() => server.stop(true));
  const at = (path: string) => `http://127.0.0.1:${server.port}${path}`;
  const home = mkdtempSync(join(tmpdir(), 'browser-screencast-'));
  const agent = agentIn(home);
  const open = Effect.fnUntraced(function* (path: string) {
    const opened = yield* calling(PAGE.open_page.body.execute({ url: at(path), profile: input.profile }, undefined, agent));
    const pages = yield* Pages;
    yield* Effect.addFinalizer(() => pages.close(opened.page.id).pipe(Effect.orDie));
    return opened.page.id;
  });
  const evaluate = (page: PageId, expression: string) =>
    calling(PAGE.evaluate_in_page.body.execute({ page, expression }, undefined, OPERATOR)).pipe(
      Effect.map((answer) => ('value' in answer ? (JSON.parse(answer.value) as unknown) : answer.exception)),
    );

  layer(input.fixture(), { excludeTestServices: true, timeout: '60 seconds' })(`the screencast on ${input.name}`, (it) => {
    it.effect(
      'viewers receive their viewport, share the smaller budget and recover the larger stream when a stalled viewer is evicted',
      () =>
        Effect.gen(function* () {
          const page = yield* open('/moving');
          const keeping = yield* watching(page, { width: 800, height: 600, scale: 1, layout: true });
          const frame = yield* frameWhere(keeping, (held) => held.width === 800);
          expect([frame.width, frame.height]).toEqual([800, 600]);
          expect(pictureSize(frame.data).width).toBeLessThanOrEqual(800);
          yield* frameWhere(keeping, (held) => pictureSize(held.data).width > 400);
          const stalled = yield* watching(page, { width: 200, height: 150, scale: 1 });
          const small = (held: Frame) => pictureSize(held.data).width <= 200;
          expect(small(yield* frameWhere(keeping, small))).toBe(true);
          expect(small(yield* frameWhere(stalled, small))).toBe(true);
          yield* keeping.frame;
          yield* keeping.frame;
          yield* keeping.frame;
          yield* TestClock.adjust('10 seconds');
          yield* frameWhere(keeping, (held) => pictureSize(held.data).width > 200);
          const ending = yield* Effect.exit(stalled.next);
          expect(Exit.isFailure(ending) && Pull.isDoneCause(ending.cause)).toBe(true);
        }).pipe(Effect.provide(TestClock.layer())),
      30_000,
    );

    it.effect('a still page takes viewer clicks, ordered text input, copy and a chosen file', () =>
      Effect.gen(function* () {
        const page = yield* open('/press');
        const viewing = yield* watching(page, { width: 400, height: 300, scale: 1, layout: true });
        expect(pictureSize((yield* frameWhere(viewing, (frame) => frame.width === 400)).data).width).toBeGreaterThan(0);
        yield* evaluate(page, 'window.clicked = new Promise((done) => { window.pressed = done; }); true');
        yield* (yield* Screencast).input(page, viewing.viewer, 0, click(140 / 400, 80 / 300));
        expect(yield* evaluate(page, 'window.clicked.then(() => document.title)')).toBe('pressed');
        const screencast = yield* Screencast;
        yield* evaluate(
          page,
          'window.entered = new Promise((done) => { window.changed = (value) => { if (value === "привет мир") done(value); }; }); true',
        );
        const later = yield* Effect.forkChild(screencast.input(page, viewing.viewer, 3, [{ kind: 'text', text: ' мир' }]), {
          startImmediately: true,
        });
        const earlier = yield* Effect.forkChild(screencast.input(page, viewing.viewer, 2, [{ kind: 'text', text: 'привет' }]), {
          startImmediately: true,
        });
        yield* screencast.input(page, viewing.viewer, 1, click(170 / 400, 35 / 300));
        yield* Fiber.join(earlier);
        yield* Fiber.join(later);
        expect(yield* evaluate(page, 'window.entered')).toBe('привет мир');
        const copied = yield* screencast.input(page, viewing.viewer, 4, [
          { kind: 'key', type: 'down', key: 'a', code: 'KeyA', modifiers: 4 },
          { kind: 'key', type: 'up', key: 'a', code: 'KeyA', modifiers: 4 },
          { kind: 'copy' },
        ]);
        expect(copied.copied).toBe('привет мир');
        yield* screencast.input(page, viewing.viewer, 5, click(170 / 400, 170 / 300));
        let asked = yield* viewing.next;
        while (asked.type !== 'chooser') asked = yield* viewing.next;
        expect(asked.multiple).toBe(false);
        expect(yield* screencast.choose(page, [{ name: 'note.txt', bytes: new TextEncoder().encode('chosen bytes') }])).toBe(1);
        expect(
          yield* evaluate(
            page,
            'document.getElementById("file").files[0].text().then((text) => [document.getElementById("file").files[0].name, text])',
          ),
        ).toEqual(['note.txt', 'chosen bytes']);
      }),
    );

    it.effect('viewer input holds agent steps until it is quiet, and the agent cursor reaches viewers but no capture', () =>
      Effect.gen(function* () {
        const page = yield* open('/still');
        const screencast = yield* Screencast;
        const viewing = yield* watching(page, { width: 400, height: 300, scale: 1, layout: true });
        yield* frameWhere(viewing, (frame) => frame.width === 400);
        yield* screencast.input(page, viewing.viewer, 0, click(380 / 400, 280 / 300));
        const hover = { action: 'hover', x: 200, y: 150 } as const;
        const held = yield* refusalOf(calling(PAGE.act_on_page.body.execute({ page, steps: [hover] }, undefined, agent)));
        expect(held.code).toBe('operator-input');
        yield* TestClock.adjust('5 seconds');
        yield* calling(PAGE.act_on_page.body.execute({ page, steps: [hover] }, undefined, agent));
        const seen = Effect.fnUntraced(function* (wanted: boolean) {
          for (;;) {
            const frame = yield* viewing.frame;
            if (amber(yield* pixelOf(page, 'image/jpeg', frame.data, 204, 161)) === wanted) return;
          }
        });
        yield* seen(true);
        const captured = yield* (yield* Automation).capture(page, 'viewport', undefined, 'agent');
        const scale = (captured.width ?? 400) / 400;
        const png = Buffer.from(captured.bytes).toString('base64');
        expect(neutral(yield* pixelOf(page, 'image/png', png, Math.round(204 * scale), Math.round(161 * scale)))).toBe(true);
        yield* seen(true);
        yield* TestClock.adjust('2 seconds');
        yield* seen(false);
      }).pipe(Effect.provide(TestClock.layer())),
    );
  });

  const nativeHome = mkdtempSync(join(tmpdir(), 'browser-native-'));
  layer(input.fixture({ native: true }), {
    excludeTestServices: true,
    timeout: '60 seconds',
  })(`the screencast of a page with a native view on ${input.name}`, (it) => {
    it.effect('a viewer asking for its own layout leaves the size of the page alone', () =>
      Effect.gen(function* () {
        const page = yield* calling(
          PAGE.open_page.body.execute({ url: at('/still'), profile: input.profile }, undefined, agentIn(nativeHome)),
        ).pipe(Effect.map((opened) => opened.page.id));
        const pages = yield* Pages;
        yield* Effect.addFinalizer(() => pages.close(page).pipe(Effect.orDie));
        const before = (yield* calling(
          PAGE.evaluate_in_page.body.execute({ page, expression: 'innerWidth' }, undefined, agentIn(nativeHome)),
        )) as {
          readonly value: string;
        };
        const viewing = yield* watching(page, { width: 500, height: 400, scale: 1, layout: true });
        const frame = yield* viewing.frame;
        expect(frame.width).toBe(Number(before.value));
        expect(frame.width).not.toBe(500);
      }),
    );
  });
};
