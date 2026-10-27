import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Assembled } from '@tagma/inspection/builtins';
import { Effect, Fiber, FileSystem, Option, Result, Tracer } from 'effect';
import type { JudgeLane } from './workers/asks.js';
import type { InspectionRequest } from './workers/asks.js';
import { inspections, pool } from './workers/inspectionLanes.js';

const ROOT = '/inspection-root';

const home = Effect.flatMap(FileSystem.FileSystem, (files) => files.makeTempDirectoryScoped({ prefix: 'tagma-inspection-lane-' }));

const worker = (here: string, name: string, body: string): URL => {
  const path = join(here, `${name}.ts`);
  writeFileSync(path, `declare const self: Worker;\nlet served = 0;\n${body}\n`);
  return pathToFileURL(path);
};

const poolOf = (here: string, name: string, body: string, options?: Parameters<typeof pool>[2]) =>
  Effect.acquireRelease(
    Effect.sync(() => pool(worker(here, name, body), ['test worker'], options)),
    (held) => Effect.sync(() => held.close()),
  );

const inspection: Assembled = {
  builtin: 'size',
  params: { base: 'src', files: { extensions: ['.ts'], exclude: [] }, thresholds: [{ glob: '**', metric: 'non-import', lines: 100 }] },
};

const ask = (kind: InspectionRequest['kind']): InspectionRequest =>
  kind === 'reach'
    ? { kind, root: ROOT, commit: 'HEAD', inspection, places: [] }
    : { kind, lane: 'landing', root: ROOT, base: 'HEAD', built: 'HEAD', paths: [], places: [], inspection, debt: [] };

const judgedAt = (lane: JudgeLane) => ({ lane, root: ROOT, base: 'HEAD', built: 'HEAD', paths: [], places: [], inspection, debt: [] });

const COUNTING = `self.addEventListener('message', (event) => {
  served += 1;
  self.postMessage({ id: event.data.id, answered: true, verdict: { violations: [], unjudged: [] }, read: [], ms: served });
});`;

const VERDICT = `{ violations: [], unjudged: [] }`;

const stateOf = (fields: string) =>
  `self.postMessage({ about: event.data.about, look: event.data.look, state: { moves: 0, spawned: [], phases: [], ${fields} } })`;

const LOST_EXIT = `{ pid: 99999999, command: 'git cat-file --batch', ms: 1, running: true, released: false, system: 'gone' }`;

layer(BunFileSystem.layer, { excludeTestServices: true })('inspection lanes', (it) => {
  it.effect('an ask whose caller is interrupted stops the worker, and the next ask is answered by a fresh one', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const here = yield* home;
      const received = join(here, 'received');
      const held = yield* poolOf(
        here,
        'silent-on-reach',
        `import { writeFileSync } from 'node:fs';
      self.addEventListener('message', (event) => {
        served += 1;
        if (event.data.kind === 'reach') return void writeFileSync(${JSON.stringify(received)}, '');
        self.postMessage({ id: event.data.id, answered: true, verdict: { violations: [], unjudged: [] }, read: [], ms: served });
      });`,
      );
      const hung = yield* Effect.forkChild(held.ask(ask('reach')));
      yield* Effect.repeat(Effect.andThen(Effect.sleep(10), files.exists(received)), { until: (exists) => exists });
      yield* Fiber.interrupt(hung);
      expect((yield* held.ask(ask('judge'))).ms).toBe(1);
    }),
  );

  it.effect('a worker that dies mid-ask fails that ask, and a fresh worker answers the next', () =>
    Effect.gen(function* () {
      const here = yield* home;
      const marker = join(here, 'died-once');
      const held = yield* poolOf(
        here,
        'dies-once',
        `import { existsSync, writeFileSync } from 'node:fs';
      self.addEventListener('message', (event) => {
        if (!existsSync(${JSON.stringify(marker)})) {
          writeFileSync(${JSON.stringify(marker)}, '');
          throw new Error('the worker dies');
        }
        self.postMessage({ id: event.data.id, answered: true, verdict: { violations: [], unjudged: [] }, read: [], ms: 1 });
      });`,
      );
      const dead = yield* Effect.result(held.ask(ask('judge')));
      expect(Result.isFailure(dead) && dead.failure.cause).toBe('worker');
      expect((yield* held.ask(ask('judge'))).ms).toBe(1);
    }),
  );

  it.effect('a worker is reused while wanted, keeps its state before retiring, and is replaced for the next ask', () =>
    Effect.gen(function* () {
      const stopped = Promise.withResolvers<void>();
      const listener = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.listen({
            hostname: '127.0.0.1',
            port: 0,
            socket: { data() {}, close: () => stopped.resolve() },
          }),
        ),
        (opened) => Effect.sync(() => opened.stop(true)),
      );
      const here = yield* home;
      const marker = join(here, 'rested');
      const held = yield* poolOf(
        here,
        'resting',
        `import { writeFileSync } from 'node:fs';
      const connected = Bun.connect({ hostname: '127.0.0.1', port: ${listener.port}, socket: { data() {} } });
      self.addEventListener('message', async (event) => {
        await connected;
        served += 1;
        if (event.data.kind === 'rest') writeFileSync(${JSON.stringify(marker)}, String(served));
        self.postMessage({ id: event.data.id, answered: true, verdict: { violations: [], unjudged: [] }, read: [], ms: served });
      });`,
        { idleMs: 20 },
      );
      const burst = yield* Effect.all([held.ask(ask('judge')), held.ask(ask('judge'))], { concurrency: 2 });
      expect(burst.map((one) => one.ms).sort()).toEqual([1, 2]);
      yield* Effect.promise(() => stopped.promise);
      expect(readFileSync(marker, 'utf8')).toBe('3');
      expect((yield* held.ask(ask('judge'))).ms).toBe(1);
    }),
  );

  it.effect('an ask the worker never received is posted again once the worker says so, and answered', () =>
    Effect.gen(function* () {
      const held = yield* poolOf(
        yield* home,
        'drops-first-ask',
        `let dropped = false;
      self.addEventListener('message', (event) => {
        if (event.data.kind === 'state') return ${stateOf('received: served')};
        if (!dropped) return void (dropped = true);
        served = event.data.id;
        self.postMessage({ id: event.data.id, answered: true, verdict: ${VERDICT}, read: [], ms: 1 });
      });`,
        { lookMs: 10 },
      );
      expect((yield* held.ask(ask('judge'))).ms).toBe(1);
    }),
  );

  it.effect('an answer the lane never received is taken from the state the worker reports', () =>
    Effect.gen(function* () {
      const held = yield* poolOf(
        yield* home,
        'loses-answer',
        `let given;
      self.addEventListener('message', (event) => {
        if (event.data.kind === 'state') return ${stateOf('received: event.data.about, answer: given')};
        given = { id: event.data.id, answered: true, verdict: ${VERDICT}, read: [], ms: 7 };
      });`,
        { lookMs: 10 },
      );
      expect((yield* held.ask(ask('judge'))).ms).toBe(7);
    }),
  );

  it.effect('a worker waiting on a process exit it never saw is replaced, and the fresh worker answers the ask', () =>
    Effect.gen(function* () {
      const here = yield* home;
      const marker = join(here, 'stuck-once');
      const held = yield* poolOf(
        here,
        'stuck-once',
        `import { existsSync, writeFileSync } from 'node:fs';
      const stuck = !existsSync(${JSON.stringify(marker)});
      if (stuck) writeFileSync(${JSON.stringify(marker)}, '');
      self.addEventListener('message', (event) => {
        if (event.data.kind === 'state') return ${stateOf(`received: served, spawned: [${LOST_EXIT}]`)};
        served = event.data.id;
        if (!stuck) self.postMessage({ id: event.data.id, answered: true, verdict: ${VERDICT}, read: [], ms: 2 });
      });`,
        { lookMs: 10 },
      );
      expect((yield* held.ask(ask('judge'))).ms).toBe(2);
    }),
  );

  it.effect('an ask whose fresh worker is stuck on a lost exit too fails as a worker failure', () =>
    Effect.gen(function* () {
      const held = yield* poolOf(
        yield* home,
        'always-stuck',
        `self.addEventListener('message', (event) => {
        if (event.data.kind === 'state') return ${stateOf(`received: served, spawned: [${LOST_EXIT}]`)};
        served = event.data.id;
      });`,
        { lookMs: 10 },
      );
      const failed = yield* Effect.result(held.ask(ask('judge')));
      expect(Result.isFailure(failed) && failed.failure.cause).toBe('worker');
    }),
  );

  it.effect('a worker whose recorded work keeps moving is waited on, whatever its processes look like', () =>
    Effect.gen(function* () {
      const held = yield* poolOf(
        yield* home,
        'slow-but-moving',
        `let looks = 0;
      self.addEventListener('message', (event) => {
        if (event.data.kind !== 'state') return void (served = event.data.id);
        looks += 1;
        if (looks === 5) self.postMessage({ id: served, answered: true, verdict: ${VERDICT}, read: [], ms: 5 });
        else self.postMessage({ about: event.data.about, look: event.data.look, state: { received: served, moves: looks, spawned: [${LOST_EXIT}], phases: [] } });
      });`,
        { lookMs: 10 },
      );
      expect((yield* held.ask(ask('judge'))).ms).toBe(5);
    }),
  );

  it.effect('the phases a worker reports stand as spans under the ask that waited on them, nested as the worker nested them', () =>
    Effect.gen(function* () {
      const spans: Tracer.NativeSpan[] = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      const held = yield* poolOf(
        yield* home,
        'reports-phases',
        `self.addEventListener('message', (event) => {
        const about = event.data.id;
        self.postMessage({ phase: 'open', about, id: 1, parent: null, name: 'inspecting.change' });
        self.postMessage({ phase: 'open', about, id: 2, parent: 1, name: 'inspecting.compute' });
        self.postMessage({ phase: 'close', about, id: 2, ended: 'ok', attributes: { files: 3 } });
        self.postMessage({ phase: 'close', about, id: 1, ended: 'ok', attributes: {} });
        self.postMessage({ id: about, answered: true, verdict: ${VERDICT}, read: [], ms: 1 });
      });`,
      );
      yield* held.ask(ask('judge')).pipe(Effect.withTracer(tracer));
      const named = (name: string) => spans.find((span) => span.name === name)!;
      const parentOf = (span: Tracer.NativeSpan) => Option.getOrUndefined(span.parent);
      expect(parentOf(named('inspection.worker'))).toBe(named('inspection.ask'));
      expect(parentOf(named('inspecting.change'))).toBe(named('inspection.worker'));
      expect(parentOf(named('inspecting.compute'))).toBe(named('inspecting.change'));
      expect(named('inspecting.compute').attributes.get('files')).toBe(3);
      expect(spans.every((span) => span.status._tag === 'Ended')).toBe(true);
    }),
  );

  it.effect(
    'a rule judged again goes back to the landing worker that judged it while that worker is no busier, where its readings are warm',
    () =>
      Effect.gen(function* () {
        const workers = yield* Effect.acquireRelease(
          Effect.map(home, (here) => inspections({ judging: worker(here, 'counting-landings', COUNTING) })),
          (opened) => Effect.sync(() => opened.close()),
        );
        const first = yield* workers.judge(judgedAt('landing'));
        const again = yield* workers.judge(judgedAt('landing'));
        expect([first.ms, again.ms]).toEqual([1, 2]);
      }),
  );

  it.effect('a landing is answered while a merge judgement still holds its own worker', () =>
    Effect.gen(function* () {
      const workers = yield* Effect.acquireRelease(
        Effect.map(home, (here) =>
          inspections({
            judging: worker(
              here,
              'silent-on-merge',
              `self.addEventListener('message', (event) => {
        if (event.data.lane === 'merge') return;
        self.postMessage({ id: event.data.id, answered: true, verdict: { violations: [], unjudged: [] }, read: [], ms: 1 });
      });`,
            ),
          }),
        ),
        (opened) => Effect.sync(() => opened.close()),
      );
      yield* Effect.forkChild(workers.judge(judgedAt('merge')));
      const landing = yield* Effect.result(workers.judge(judgedAt('landing')));
      expect(Result.isSuccess(landing) && landing.success.ms).toBe(1);
    }),
  );
});
