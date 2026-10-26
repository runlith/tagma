import { it } from '@runlith/effect-test';
import { afterAll, expect, mock } from 'bun:test';
import * as promises from 'node:fs/promises';
import { Context, Effect, Fiber, Queue, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { Git } from '@runlith/git/Git';
import { FileWatcher, type WatchHearing } from '../../platform/contract/service/watch.js';
import type { HeadMoved } from '../contract/service/checkouts.js';

const GIT_DIR = '/checkout/.git';

const held = new Map<string, WatchHearing>();

const watcher = Context.make(
  FileWatcher,
  FileWatcher.of({
    subscribe: (at, _options, hearing) =>
      Effect.sync(() => {
        held.set(at, hearing);
        return {
          close: Effect.sync(() => {
            if (held.get(at) === hearing) held.delete(at);
          }),
        };
      }),
    mark: () => Effect.die('heads mark no position'),
    settle: () => Effect.die('heads settle no delivery'),
    changedSince: () => Effect.die('heads read no journal'),
    marking: 'refresh',
    heardLateMs: 0,
  }),
);

const real = { ...promises };
mock.module('node:fs/promises', () => ({ ...real, access: async () => undefined }));
afterAll(() => {
  mock.module('node:fs/promises', () => real);
});

const { makeHeadWatches } = await import('./heads.js');

const atHead = (): WatchHearing => {
  const hearing = held.get(GIT_DIR);
  if (hearing === undefined) throw new Error('the HEAD resource is not held');
  return hearing;
};

const fails = (reason: string): void => {
  const hearing = atHead();
  held.delete(GIT_DIR);
  hearing.ended(reason);
};

const next = (events: Queue.Queue<HeadMoved>) => Effect.map(Queue.take(events), (event) => event.head);

it.effect('a live watcher error releases its group, recovery resumes HEAD events, and the last subscriber cancels another recovery', () =>
  Effect.gen(function* () {
    let head = 'a'.repeat(40);
    const git = Git.of({
      run: (args) =>
        Effect.succeed({
          status: 0,
          stdout: args.some((arg) => arg.startsWith('HEAD^')) ? `${head}\n` : `false\n\n${GIT_DIR}\n${GIT_DIR}\n/checkout\n`,
          stderr: '',
          overflow: false,
          messageOverflow: false,
        }),
    });
    const watches = yield* Effect.provideService(makeHeadWatches, Git, git);
    const events = yield* Queue.unbounded<HeadMoved>();
    const subscriber = yield* Stream.runForEach(watches.moved('/checkout'), (event) => Queue.offer(events, event)).pipe(Effect.forkScoped);
    expect(yield* next(events)).toBe(head);
    expect(held.size).toBe(3);
    fails('the watcher resource failed');
    yield* Effect.yieldNow;
    expect(held.size).toBe(0);
    head = 'b'.repeat(40);
    yield* TestClock.adjust(2_000);
    expect(yield* next(events)).toBe(head);
    expect(held.size).toBe(3);
    head = 'c'.repeat(40);
    atHead().heard([{ kind: 'create', path: 'HEAD' }]);
    expect(yield* next(events)).toBe(head);
    fails('the watcher resource failed again');
    yield* Fiber.interrupt(subscriber);
    yield* TestClock.adjust(60_000);
    expect(held.size).toBe(0);
    const returned = yield* Stream.runHead(watches.moved('/checkout'));
    expect(returned._tag === 'Some' && returned.value.head).toBe(head);
    expect(held.size).toBe(0);
  }).pipe(Effect.provide(watcher)),
);
