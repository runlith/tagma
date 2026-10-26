import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Cause, Clock, Duration, Effect, Exit, Fiber, Layer, Sink, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { ChildProcessSpawner, ExitCode, ProcessId, make as makeSpawner, makeHandle } from 'effect/process/ChildProcessSpawner';
import { STOP_LADDER, STOP_LADDER_MS } from '@runlith/executions/protocol/call';
import { resolveRipgrepPath } from './index';
import { listFiles, searchContent, type SearchRun } from './run';

//! A child raised and then silent for ever — no output, no exit code, a kill that answers — which is the shape a search hung on for over an hour and no real ripgrep produces on demand.
const silent = makeHandle({
  pid: ProcessId(1),
  exitCode: Effect.never,
  isRunning: Effect.succeed(true),
  kill: () => Effect.void,
  stdin: Sink.drain,
  stdout: Stream.never,
  stderr: Stream.never,
  all: Stream.never,
  getInputFd: () => Sink.drain,
  getOutputFd: () => Stream.empty,
  unref: Effect.succeed(Effect.void),
});

const spawnStuck = Layer.succeed(
  ChildProcessSpawner,
  makeSpawner(() => Effect.never),
);

const saying = (stdout: string, exitCode: number, stderr = '') =>
  makeHandle({
    ...silent,
    exitCode: Effect.succeed(ExitCode(exitCode)),
    stdout: Stream.make(new TextEncoder().encode(stdout)),
    stderr: Stream.make(new TextEncoder().encode(stderr)),
  });

const run = (extra: Partial<SearchRun> = {}): SearchRun => ({
  binary: '/bin/rg',
  cwd: '/tmp',
  platform: 'darwin',
  ceilingMs: 600_000,
  ...extra,
});

const fakeSpawner = (handle: typeof silent) =>
  Layer.succeed(
    ChildProcessSpawner,
    makeSpawner(() => Effect.succeed(handle)),
  );

const searching = Effect.fnUntraced(
  function* (handle: typeof silent, minutes: number) {
    const running = yield* Effect.forkChild(Effect.exit(Stream.runCollect(searchContent(run(), { pattern: 'needle' }))));
    for (let minute = 0; minute < minutes; minute += 1) {
      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.minutes(1));
    }
    return yield* Fiber.join(running);
  },
  (effect, handle) => Effect.provide(effect, fakeSpawner(handle)),
);

const said = (exit: Exit.Exit<unknown, unknown>): string => (Exit.isFailure(exit) ? Cause.pretty(exit.cause) : '');

it.effect('a search whose child never ends is ended at the ceiling, naming the bound and what was searched', () =>
  Effect.gen(function* () {
    const exit = yield* searching(silent, 11);

    expect(Exit.isFailure(exit)).toBe(true);
    expect(said(exit)).toContain('600000');
    expect(said(exit)).toContain('needle');
  }),
);

const collected = <A, E>(stream: Stream.Stream<A, E, ChildProcessSpawner>, handle: typeof silent) =>
  Effect.exit(Stream.runCollect(stream).pipe(Effect.provide(fakeSpawner(handle))));

it.effect('a search whose child answers keeps its answer, and the ceiling takes nothing from it', () =>
  Effect.gen(function* () {
    const exit = yield* searching(saying('{"type":"summary","data":{}}\n', 0), 11);

    expect(exit).toEqual(Exit.succeed([{ _tag: 'Summary', partial: false }]));
  }),
);

it.live('matches and finished files stream out of --json, and a complaint with a summary is a partial walk', () =>
  Effect.gen(function* () {
    const json = [
      { type: 'begin', data: { path: { text: 'a.ts' } } },
      { type: 'match', data: { path: { text: 'a.ts' }, line_number: 3, absolute_offset: 8, lines: { text: 'needle here\n' } } },
      { type: 'end', data: { path: { text: 'a.ts' } } },
      { type: 'summary', data: {} },
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n');

    const exit = yield* collected(searchContent(run(), { pattern: 'needle' }), saying(json, 2, 'rg: denied: error'));

    expect(exit).toEqual(
      Exit.succeed([
        { _tag: 'Match', path: 'a.ts', line: 3, offset: 8, text: 'needle here', ranges: [] },
        { _tag: 'FileDone', path: 'a.ts' },
        { _tag: 'Summary', partial: true },
      ]),
    );
  }),
);

it.effect('unreadable stdout records are skipped without losing matches or the final summary', () =>
  Effect.gen(function* () {
    const match = { type: 'match', data: { path: { text: 'a.ts' }, line_number: 3, absolute_offset: 8, lines: { text: 'needle\n' } } };
    const records = [
      null,
      { ...match, data: { ...match.data, lines: { text: 42 } } },
      { ...match, data: { ...match.data, submatches: [null] } },
      match,
    ];
    const stdout = ['{', ...records.map((record) => JSON.stringify(record))].join('\n');
    const exit = yield* collected(searchContent(run(), { pattern: 'needle' }), saying(stdout, 0));
    expect(exit).toEqual(
      Exit.succeed([
        { _tag: 'Match', path: 'a.ts', line: 3, offset: 8, text: 'needle', ranges: [] },
        { _tag: 'Summary', partial: false },
      ]),
    );
  }),
);

it.live('a complaint before any summary fails with what ripgrep said', () =>
  Effect.gen(function* () {
    const exit = yield* collected(
      searchContent(run(), { pattern: '(' }),
      saying('', 2, 'rg: regex parse error:\n(\n^\nerror: unclosed group'),
    );

    expect(said(exit)).toContain('ripgrep failed (exit 2)');
    expect(said(exit)).toContain('regex parse error');
    expect(said(exit)).toContain('unclosed group');
  }),
);

it.live('a file listing streams its paths and fails only when nothing was listed under a complaint', () =>
  Effect.gen(function* () {
    const listed = yield* collected(listFiles(run(), '*.ts'), saying('a.ts\nb/c.ts\n', 0));
    expect(listed).toEqual(
      Exit.succeed([
        { _tag: 'Listed', path: 'a.ts' },
        { _tag: 'Listed', path: 'b/c.ts' },
        { _tag: 'Summary', partial: false },
      ]),
    );

    const failed = yield* collected(listFiles(run(), '*.ts'), saying('', 2, 'rg: error: bad glob'));
    expect(said(failed)).toContain('bad glob');
  }),
);

const platformSpawner = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));

it.live('the real ripgrep finds matches in a directory and lists its files', () =>
  Effect.gen(function* () {
    const dir = mkdtempSync(join(tmpdir(), 'rg-run-'));
    writeFileSync(join(dir, 'a.txt'), 'one\nneedle\n');
    writeFileSync(join(dir, 'b.md'), 'nothing\n');
    const binary = yield* Effect.promise(() => resolveRipgrepPath());

    const found = yield* Stream.runCollect(searchContent(run({ binary, cwd: dir }), { pattern: 'needle' })).pipe(
      Effect.provide(platformSpawner),
    );
    expect(found).toEqual([
      { _tag: 'Match', path: 'a.txt', line: 2, offset: 4, text: 'needle', ranges: [{ start: 0, end: 6 }] },
      { _tag: 'FileDone', path: 'a.txt' },
      { _tag: 'Summary', partial: false },
    ]);

    const files = yield* Stream.runCollect(listFiles(run({ binary, cwd: dir }), '*.md')).pipe(Effect.provide(platformSpawner));
    expect(files).toEqual([
      { _tag: 'Listed', path: 'b.md' },
      { _tag: 'Summary', partial: false },
    ]);
  }),
);

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

it.live(
  'an interrupted search answers within the stop ladder and leaves no child behind, even one that ignores the interrupt and the terminate',
  () =>
    Effect.gen(function* () {
      const dir = mkdtempSync(join(tmpdir(), 'search-stubborn-'));
      const ready = join(dir, 'ready');
      const stubborn = join(dir, 'rg');
      writeFileSync(stubborn, `#!/bin/sh\ntrap '' INT TERM\necho $$ > ${ready}.tmp && mv ${ready}.tmp ${ready}\nexec sleep 60\n`);
      chmodSync(stubborn, 0o755);
      const searching = yield* Effect.forkScoped(
        Stream.runCollect(searchContent(run({ binary: stubborn, cwd: dir }), { pattern: 'needle' })).pipe(Effect.provide(platformSpawner)),
      );
      while (!existsSync(ready)) yield* Effect.sleep(10);
      const pid = Number(readFileSync(ready, 'utf8').trim());
      const interruptedAt = yield* Clock.currentTimeMillis;
      yield* Fiber.interrupt(searching);
      const exit = yield* Fiber.await(searching);
      const answeredAfter = (yield* Clock.currentTimeMillis) - interruptedAt;

      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      expect(answeredAfter).toBeGreaterThanOrEqual(STOP_LADDER.killAtMs);
      expect(answeredAfter).toBeLessThan(STOP_LADDER_MS + 1_000);
      expect(pid).toBeGreaterThan(0);
      expect(alive(pid)).toBe(false);
    }),
  30_000,
);

it.live('match ranges are UTF-16 indices of the shown text, and a column cut keeps only what is still shown', () =>
  Effect.gen(function* () {
    const dir = mkdtempSync(join(tmpdir(), 'rg-ranges-'));
    writeFileSync(join(dir, 'a.txt'), 'é😀 needle ........ needle\n');
    const binary = yield* Effect.promise(() => resolveRipgrepPath());
    const matches = (maxColumns?: number) =>
      Stream.runCollect(searchContent(run({ binary, cwd: dir }), { pattern: 'needle', maxColumns })).pipe(
        Effect.provide(platformSpawner),
        Effect.map((events) => events.flatMap((event) => (event._tag === 'Match' ? [event] : []))),
      );

    const [whole] = yield* matches();
    expect(whole?.ranges).toEqual([
      { start: 4, end: 10 },
      { start: 20, end: 26 },
    ]);
    const [cut] = yield* matches(11);
    expect(cut?.text).toBe('é😀 needle ');
    expect(cut?.ranges).toEqual([{ start: 4, end: 10 }]);
  }),
);

it.effect('a spawn that never completes is cut at the ceiling like any other wait', () =>
  Effect.gen(function* () {
    const exit = yield* Effect.gen(function* () {
      const running = yield* Effect.forkChild(Effect.exit(Stream.runCollect(searchContent(run(), { pattern: 'needle' }))));
      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.minutes(11));
      return yield* Fiber.join(running);
    }).pipe(Effect.provide(spawnStuck));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(said(exit)).toContain('did not end within 600000 ms');
  }),
);
