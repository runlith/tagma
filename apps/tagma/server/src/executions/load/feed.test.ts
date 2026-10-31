import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import type { LoadSubscription } from '@runlith/executions/ExecutionEvidence';
import type { DeclaredPart, LoadInterest } from '@runlith/executions/protocol/evidence';
import { Deferred, Effect, Queue, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import type { Background } from '../../platform/contract/service/background.js';
import type { LoadReader } from '../contract/wire/load.js';
import { makeHostLoad, makeMachineLoad } from './feed.js';
import { makeWindowDeclarations } from './windows.js';
import type { WorkNames } from './work.js';

const names: WorkNames = { read: () => Effect.die('no reading arrives in this test') };
const background: Background['Service'] = { run: () => Effect.die('no background work runs here'), standing: Effect.succeed([]) };

const renderer = (pid: number) => ({ pid, createdMs: 1_000 + pid, kind: 'renderer' as const, documents: [{ _tag: 'Interface' as const }] });

const pids = (parts: readonly DeclaredPart[]) => parts.map((part) => part.pid);

it.effect(
  'the host subscription takes declared parts as whole replacements, holds the union of every reader’s demand for other programs, and opens again with both',
  () =>
    Effect.gen(function* () {
      const windows = yield* makeWindowDeclarations;
      const opened = yield* Queue.unbounded<readonly DeclaredPart[]>();
      const replaced = yield* Queue.unbounded<readonly DeclaredPart[]>();
      const interests = yield* Queue.unbounded<LoadInterest>();
      const ended = yield* Deferred.make<void>();
      let lives = 0;
      const host = yield* makeHostLoad((parts) => {
        lives += 1;
        const first = lives === 1;
        return Queue.offer(opened, parts).pipe(
          Effect.as({
            readings: first ? Stream.drain(Stream.fromEffect(Deferred.await(ended))) : Stream.never,
            setParts: (next) => Effect.asVoid(Queue.offer(replaced, next)),
            setInterest: (interest) => Effect.asVoid(Queue.offer(interests, interest)),
          } satisfies LoadSubscription),
        );
      }, windows);
      const feed = yield* makeMachineLoad(host, names, background, { row: () => undefined, apps: () => [] });

      yield* windows.declare('window', 1, { precisionMs: 5, processes: [renderer(10)] });
      const reader = Effect.gen(function* () {
        const mine = yield* Queue.unbounded<LoadReader>();
        yield* Effect.forkScoped(
          Stream.runForEach(feed.machine(), (frame) =>
            frame._tag === 'Snapshot' ? Queue.offer(mine, frame.snapshot.reader) : Effect.void,
          ),
        );
        return yield* Queue.take(mine);
      });
      const first = yield* reader;
      expect(pids(yield* Queue.take(opened))).toEqual([10]);
      expect(pids(yield* Queue.take(replaced))).toEqual([10]);
      expect(yield* Queue.take(interests)).toEqual({ interested: false, others: false });

      yield* windows.declare('window', 1, { precisionMs: 5, processes: [renderer(10), renderer(11)] });
      expect(pids(yield* Queue.take(replaced))).toEqual([10, 11]);
      yield* windows.declare('other', 1, { precisionMs: 5, processes: [renderer(20)] });
      expect(pids(yield* Queue.take(replaced))).toEqual([10, 11, 20]);
      yield* windows.end('window', 1);
      expect(pids(yield* Queue.take(replaced))).toEqual([20]);

      yield* feed.interest(first, { interested: true, others: false });
      expect(yield* Queue.take(interests)).toEqual({ interested: true, others: false });
      const second = yield* reader;
      yield* feed.interest(second, { interested: false, others: true });
      expect(yield* Queue.take(interests)).toEqual({ interested: true, others: true });

      yield* Deferred.succeed(ended, undefined);
      yield* Effect.yieldNow;
      yield* TestClock.adjust('5 seconds');
      expect(pids(yield* Queue.take(opened))).toEqual([20]);
      expect(yield* Queue.take(interests)).toEqual({ interested: true, others: true });

      yield* feed.interest(second, { interested: false, others: false });
      expect(yield* Queue.take(interests)).toEqual({ interested: true, others: false });
    }),
);
