import { afterAll, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { pictureSize } from '@runlith/cdp/screencast';
import { ALL_FORMATS, FilePathSource, Input } from 'mediabunny';
import { existsSync, mkdtempSync, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Clock, Effect, Exit, Fiber, type Layer, Pull, Queue, type Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { Automation } from '../contract/service/automation.js';
import type { Clips } from '../contract/service/clips.js';
import { Pages } from '../contract/service/pages.js';
import { type HostAdapter, Hosts } from '../contract/service/hosts.js';
import { Profiles } from '../contract/service/profiles.js';
import { Screencast } from '../contract/service/screencast.js';
import type { PageId, ProfileId } from '../contract/wire/ids.js';
import { RECORDING_FPS } from '../contract/wire/recording.js';
import type { Budget, Frame, InputEvent, ScreencastEvent } from '../contract/wire/screencast.js';
import { PAGE_PAIRS as PAGE } from '../operations.js';
import { RECORD_PAIRS as RECORD } from '../recordings.js';
import { TRACE_PAIRS as TRACE } from '../traces.js';
import { amber, neutral, pixelOf } from './pixels.js';
import { RunEnds } from './runs.js';
import { agentIn, calling, OPERATOR, refusalOf, type Served } from './world.js';

const PAGES: Readonly<Record<string, string>> = {
  '/moving': `<title>Moving</title><p id="tick" style="font-size:48px">0</p>
    <script>let n = 0; const tick = () => { document.getElementById('tick').textContent = String(++n); document.body.style.background = n % 2 ? '#fff' : '#eee'; requestAnimationFrame(tick); }; tick();</script>`,
  '/still': '<title>Still</title><h1>Nothing moves here</h1>',
  '/count': `<title>Count</title>
    <button style="position:absolute;left:40px;top:60px;width:200px;height:80px;font-size:40px" onclick="this.textContent = String(Number(this.textContent) + 1)">0</button>`,
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
  readonly clips: Layer.Layer<Clips, never, Hosts>;
};

const sizeOf = (data: string): { readonly width: number; readonly height: number } => {
  const size = pictureSize(data);
  if (size === undefined) throw new Error('the frame is no JPEG with a size');
  return size;
};

const FRAME_MS = 1000 / RECORDING_FPS;

const clipOf = (path: string) =>
  Effect.promise(async () => {
    const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(path) });
    const track = await input.getPrimaryVideoTrack();
    if (track === null) throw new Error(`${path} holds no video track`);
    return {
      codec: track.codec,
      width: track.codedWidth,
      height: track.codedHeight,
      packets: (await track.computePacketStats()).packetCount,
      seconds: await input.computeDuration(),
    };
  });

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

  layer(input.fixture(), { excludeTestServices: true })(`the screencast on ${input.name}`, (it) => {
    it.effect(
      'viewers receive their viewport, share the smaller budget and recover the larger stream when a stalled viewer is evicted',
      () =>
        Effect.gen(function* () {
          const page = yield* open('/moving');
          const keeping = yield* watching(page, { width: 800, height: 600, scale: 1, layout: true });
          const frame = yield* frameWhere(keeping, (held) => held.width === 800);
          expect([frame.width, frame.height]).toEqual([800, 600]);
          expect(sizeOf(frame.data).width).toBeLessThanOrEqual(800);
          yield* frameWhere(keeping, (held) => sizeOf(held.data).width > 400);
          const stalled = yield* watching(page, { width: 200, height: 150, scale: 1 });
          const small = (held: Frame) => sizeOf(held.data).width <= 200;
          expect(small(yield* frameWhere(keeping, small))).toBe(true);
          expect(small(yield* frameWhere(stalled, small))).toBe(true);
          yield* keeping.frame;
          yield* keeping.frame;
          yield* keeping.frame;
          yield* TestClock.adjust('10 seconds');
          yield* frameWhere(keeping, (held) => sizeOf(held.data).width > 200);
          const ending = yield* Effect.exit(stalled.next);
          expect(Exit.isFailure(ending) && Pull.isDoneCause(ending.cause)).toBe(true);
        }).pipe(Effect.provide(TestClock.layer())),
    );

    it.effect('a still page takes viewer clicks, ordered text input, copy and a chosen file', () =>
      Effect.gen(function* () {
        const page = yield* open('/press');
        const viewing = yield* watching(page, { width: 400, height: 300, scale: 1, layout: true });
        expect(sizeOf((yield* frameWhere(viewing, (frame) => frame.width === 400)).data).width).toBeGreaterThan(0);
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
        const seen = Effect.fnUntraced(function* (wanted: boolean) {
          for (;;) {
            const frame = yield* viewing.frame;
            if (amber(yield* pixelOf(page, 'image/jpeg', frame.data, 204, 161)) === wanted) return;
          }
        });
        yield* Effect.gen(function* () {
          yield* screencast.input(page, viewing.viewer, 0, click(380 / 400, 280 / 300));
          const hover = { action: 'hover', x: 200, y: 150 } as const;
          const held = yield* refusalOf(calling(PAGE.act_on_page.body.execute({ page, steps: [hover] }, undefined, agent)));
          expect(held.code).toBe('operator-input');
          yield* TestClock.adjust('5 seconds');
          yield* calling(PAGE.act_on_page.body.execute({ page, steps: [hover] }, undefined, agent));
          yield* seen(true);
          const captured = yield* (yield* Automation).capture(page, 'viewport', undefined, 'agent');
          const scale = (captured.width ?? 400) / 400;
          const png = Buffer.from(captured.bytes).toString('base64');
          expect(neutral(yield* pixelOf(page, 'image/png', png, Math.round(204 * scale), Math.round(161 * scale)))).toBe(true);
          yield* seen(true);
          yield* TestClock.adjust('2 seconds');
          yield* seen(false);
        }).pipe(Effect.provide(TestClock.layer()));
      }),
    );

    const record = (page: PageId, action: 'start' | 'stop') =>
      calling(RECORD.record_page.body.execute({ page, action }, undefined, agent).pipe(Effect.provide(input.clips)));

    const recorded = Effect.fnUntraced(function* (page: PageId, act: Effect.Effect<void, unknown, Served>, controlled = false) {
      const before = yield* Clock.currentTimeMillis;
      const started = yield* record(page, 'start');
      const after = yield* Clock.currentTimeMillis;
      if (started.status !== 'recording') return yield* Effect.die(`the recording did not start: ${JSON.stringify(started)}`);
      const ending = Effect.gen(function* () {
        yield* act;
        const stopping = yield* Clock.currentTimeMillis;
        const stopped = yield* record(page, 'stop');
        return { stopping, stopped, end: yield* Clock.currentTimeMillis };
      });
      const { stopping, stopped, end } = yield* controlled
        ? Effect.andThen(TestClock.setTime(after), ending).pipe(Effect.provide(TestClock.layer()))
        : ending;
      if (stopped.status !== 'recorded') return yield* Effect.die(`the recording did not stop: ${JSON.stringify(stopped)}`);
      expect(stopped.path).toBe(started.path);
      expect(stopped.durationMs).toBeGreaterThanOrEqual(stopping - after - FRAME_MS);
      expect(stopped.durationMs).toBeLessThanOrEqual(end - before + FRAME_MS);
      const clip = yield* clipOf(stopped.path);
      expect(clip).toMatchObject({ codec: 'avc', width: stopped.width, height: stopped.height });
      expect(clip.packets).toBeGreaterThan(0);
      expect(clip.seconds).toBeCloseTo(stopped.durationMs / 1000, 2);
      return stopped;
    });

    it.effect('a recording beside a viewer lasts as long as it ran, at the size the shared stream sends', () =>
      Effect.gen(function* () {
        const page = yield* open('/count');
        const viewing = yield* watching(page, { width: 400, height: 300, scale: 1, layout: true });
        const flowing = sizeOf(
          (yield* frameWhere(viewing, (frame) => {
            const size = sizeOf(frame.data);
            return frame.width === 400 && frame.height === 300 && size.width === 400 && size.height === 300;
          })).data,
        );
        const press = { action: 'click', x: 140, y: 100 } as const;
        const clicks = Effect.forEach(
          [1, 2, 3],
          () =>
            calling(PAGE.act_on_page.body.execute({ page, steps: [press] }, undefined, agent)).pipe(
              Effect.andThen(Effect.sleep('1 second')),
              Effect.andThen(viewing.frame),
            ),
          { discard: true },
        );
        const stopped = yield* recorded(page, clicks);
        expect({ width: stopped.width, height: stopped.height }).toEqual({
          width: flowing.width - (flowing.width % 2),
          height: flowing.height - (flowing.height % 2),
        });
        expect(stopped.durationMs).toBeGreaterThanOrEqual(3000);
        expect((yield* clipOf(stopped.path)).packets).toBeGreaterThanOrEqual(4);
      }),
    );

    it.effect('a still page records as long as it ran, a page holds one recording, and one whose run ended is a whole file', () =>
      Effect.gen(function* () {
        const page = yield* open('/still');
        const still = yield* recorded(
          page,
          Effect.gen(function* () {
            expect((yield* refusalOf(record(page, 'start'))).code).toBe('recording-running');
            yield* TestClock.adjust('3 seconds');
          }),
          true,
        );
        expect(still.durationMs).toBeGreaterThanOrEqual(3000);
        expect((yield* refusalOf(record(page, 'stop'))).code).toBe('no-recording');

        const begun = yield* record(page, 'start');
        if (begun.status !== 'recording') return yield* Effect.die('the second recording did not start');
        const changes = yield* Queue.unbounded<void>();
        yield* Effect.acquireRelease(
          Effect.sync(() => watch(dirname(begun.path), () => Queue.offerUnsafe(changes, undefined))),
          (watcher) => Effect.sync(() => watcher.close()),
        );
        yield* (yield* RunEnds).end('agent');
        while (!existsSync(begun.path)) yield* Queue.take(changes);
        expect(yield* record(page, 'stop')).toMatchObject({
          status: 'recorded',
          path: begun.path,
          ending: { cause: 'run-ended', by: 'agent' },
        });
        expect((yield* refusalOf(record(page, 'stop'))).code).toBe('no-recording');
        const clip = yield* clipOf(begun.path);
        expect(clip.codec).toBe('avc');
        expect(clip.packets).toBeGreaterThan(0);
      }),
    );

    it.effect('a running trace and recording stand in the page’s live state with who started them, and the operator stops each', () =>
      Effect.gen(function* () {
        const page = yield* open('/still');
        const pages = yield* Pages;
        const before = yield* Clock.currentTimeMillis;
        yield* calling(TRACE.trace_page.body.execute({ page, action: 'start' }, undefined, agent));
        yield* record(page, 'start');
        const after = yield* Clock.currentTimeMillis;
        const live = pages.live(page);
        expect({ trace: live?.trace?.by, recording: live?.recording?.by }).toEqual({ trace: 'agent', recording: 'agent' });
        for (const started of [live?.trace?.at, live?.recording?.at]) {
          expect(Date.parse(started ?? '')).toBeGreaterThanOrEqual(before);
          expect(Date.parse(started ?? '')).toBeLessThanOrEqual(after);
        }
        const traced = yield* calling(TRACE.trace_page.body.execute({ page, action: 'stop' }, undefined, OPERATOR));
        expect(traced.status).toBe('traced');
        expect(pages.live(page)?.trace).toBeNull();
        expect(pages.live(page)?.recording?.by).toBe('agent');
        const stopped = yield* calling(
          RECORD.record_page.body.execute({ page, action: 'stop' }, undefined, OPERATOR).pipe(Effect.provide(input.clips)),
        );
        expect(stopped).toMatchObject({ status: 'recorded', ending: { cause: 'stopped', by: null } });
        expect(pages.live(page)?.recording).toBeNull();
        if (stopped.status !== 'recorded') return;
        expect(yield* record(page, 'stop')).toMatchObject({
          status: 'recorded',
          path: stopped.path,
          ending: { cause: 'stopped', by: null },
        });
        expect((yield* refusalOf(record(page, 'stop'))).code).toBe('no-recording');
      }),
    );

    it.effect('the operator stops a recording on a crashed page', () =>
      Effect.gen(function* () {
        const page = yield* open('/still');
        const pages = yield* Pages;
        const begun = yield* record(page, 'start');
        if (begun.status !== 'recording') return yield* Effect.die('the recording did not start');
        const moves = yield* pages.moves(page);
        const host = yield* pages.hold(page);
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* (yield* host.pages.session(page)).post('Page.crash');
            if (!pages.live(page)?.crashed) yield* Stream.runHead(Stream.filter(moves, (move) => move.live.crashed));
          }),
        );
        const stopped = yield* calling(
          RECORD.record_page.body.execute({ page, action: 'stop' }, undefined, OPERATOR).pipe(Effect.provide(input.clips)),
        );
        expect(stopped).toMatchObject({ status: 'recorded', path: begun.path, ending: { cause: 'stopped', by: null } });
      }),
    );

    it.effect('a recording ends with the engine session its page lost, and the restored page records anew', () =>
      Effect.gen(function* () {
        const profiles = yield* Profiles;
        const source = yield* profiles.record(input.profile);
        const profile = yield* profiles.create({
          name: 'Dropped recording',
          adapter: source.adapter,
          document: source.document,
          console: source.console,
        });
        yield* Effect.addFinalizer(() => profiles.remove(profile.id).pipe(Effect.orDie));
        const opened = yield* calling(PAGE.open_page.body.execute({ url: at('/still'), profile: profile.id }, undefined, agent));
        const page = opened.page.id;
        const pages = yield* Pages;
        yield* Effect.addFinalizer(() => (pages.live(page) === undefined ? Effect.void : pages.close(page).pipe(Effect.orDie)));
        const begun = yield* record(page, 'start');
        if (begun.status !== 'recording') return yield* Effect.die('the recording did not start');
        const changes = yield* Queue.unbounded<void>();
        yield* Effect.acquireRelease(
          Effect.sync(() => watch(dirname(begun.path), () => Queue.offerUnsafe(changes, undefined))),
          (watcher) => Effect.sync(() => watcher.close()),
        );
        yield* (yield* (yield* Hosts).reach(source.adapter)).profiles.remove(profile.id);
        while (!existsSync(begun.path)) yield* Queue.take(changes);
        expect((yield* clipOf(begun.path)).packets).toBeGreaterThan(0);
        expect(yield* record(page, 'stop')).toMatchObject({
          status: 'recorded',
          path: begun.path,
          ending: { cause: 'session-ended', by: null },
        });
        const again = yield* record(page, 'start');
        if (again.status !== 'recording') return yield* Effect.die('the restored page did not record');
        expect(pages.live(page)?.recording?.by).toBe('agent');
        yield* calling(PAGE.close_page.body.execute({ page }, undefined, agent));
        expect(yield* record(page, 'stop')).toMatchObject({
          status: 'recorded',
          path: again.path,
          ending: { cause: 'session-ended', by: null },
        });
        expect((yield* refusalOf(record(page, 'stop'))).code).toBe('page-unknown');
      }),
    );
  });

  const nativeHome = mkdtempSync(join(tmpdir(), 'browser-native-'));
  layer(input.fixture({ native: true }), { excludeTestServices: true })(
    `the screencast of a page with a native view on ${input.name}`,
    (it) => {
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
    },
  );
};
