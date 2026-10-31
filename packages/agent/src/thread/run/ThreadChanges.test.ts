import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Deferred, Effect, Exit, Fiber } from 'effect';
import type { ThreadEventRecord } from '../events';
import type { ThreadStateChange } from '../state';
import { ThreadChanges, threadChangesLayer } from './ThreadChanges';
const pending = Effect.fnUntraced(function* (work: Effect.Effect<unknown>) {
  const fiber = yield* Effect.forkScoped(work, { startImmediately: true });
  yield* Fiber.interrupt(fiber);
  return Exit.hasInterrupts(yield* Fiber.await(fiber));
});
layer(threadChangesLayer)('ThreadChanges registrations', (it) => {
  it.effect(
    'a publication between registration and awaiting remains observable',
    Effect.fnUntraced(function* () {
      const changes = yield* ThreadChanges;
      const changed = yield* changes.watch(['recipient', 'target']);
      yield* changes.publish('target');
      expect(yield* changed).toEqual(['target']);
    }),
  );
  it.effect(
    'a different thread cannot release the registration',
    Effect.fnUntraced(function* () {
      const changes = yield* ThreadChanges;
      const changed = yield* changes.watch(['target']);
      yield* changes.publish('unrelated');
      expect(yield* pending(changed)).toBe(true);
    }),
  );
  it.effect(
    'normal scope completion releases an unconsumed registration',
    Effect.fnUntraced(function* () {
      const changes = yield* ThreadChanges;
      const changed = yield* Effect.scoped(changes.watch(['target']));
      yield* changes.publish('target');
      expect(yield* pending(changed)).toBe(true);
    }),
  );
  it.effect(
    'interruption releases its registration without removing a sibling watch',
    Effect.fnUntraced(function* () {
      const changes = yield* ThreadChanges;
      const exposed = yield* Deferred.make<Effect.Effect<readonly string[]>>();
      const child = yield* Effect.scoped(
        Effect.gen(function* () {
          const changed = yield* changes.watch(['target']);
          yield* Deferred.succeed(exposed, changed);
          yield* Effect.never;
        }),
      ).pipe(Effect.forkScoped);
      const cancelled = yield* Deferred.await(exposed);
      const standing = yield* changes.watch(['target']);
      yield* Fiber.interrupt(child);
      yield* changes.publish('target');
      expect(yield* pending(cancelled)).toBe(true);
      expect(yield* standing).toEqual(['target']);
    }),
  );
  it.effect(
    'a claimed unit hands one change merging its journal facts and run patches, and moved once any part is unseen',
    Effect.fnUntraced(function* () {
      const changes = yield* ThreadChanges;
      const handed: ThreadStateChange[] = [];
      changes.project((change) => Effect.sync(() => void handed.push(change)));
      const at = new Date(7_000);
      const fact: ThreadEventRecord = { threadId: 't', position: 4, id: 'event:4', kind: 'message', payload: {} };
      const step = {};
      changes.claim('t', step);
      changes.note('t', step, { kind: 'appended', from: 3, records: [fact], thread: { updatedAt: at } });
      changes.note('t', step, { kind: 'run', run: { id: 'run-1', streamTail: null, heartbeatAt: at } });
      changes.note('t', step, { kind: 'run', run: { id: 'run-1', updatedAt: at } });
      changes.note('other', step, { kind: 'unseen' });
      yield* changes.settle('t', step, { from: 1, to: 2 });
      const broken = {};
      changes.claim('t', broken);
      changes.note('t', broken, { kind: 'appended', from: 4, records: [], thread: {} });
      changes.note('t', broken, { kind: 'unseen' });
      yield* changes.settle('t', broken, { from: 2, to: 3 });
      const gapped = {};
      changes.claim('t', gapped);
      changes.note('t', gapped, { kind: 'appended', from: 4, records: [fact], thread: {} });
      changes.note('t', gapped, { kind: 'appended', from: 9, records: [], thread: {} });
      yield* changes.settle('t', gapped, { from: 3, to: 4 });
      expect(handed).toEqual([
        {
          kind: 'appended',
          threadId: 't',
          revision: { from: 1, to: 2 },
          from: 3,
          records: [fact],
          thread: { updatedAt: at },
          runs: [{ id: 'run-1', streamTail: null, heartbeatAt: at, updatedAt: at }],
        },
        { kind: 'moved', threadId: 't' },
        { kind: 'moved', threadId: 't' },
      ]);
    }),
  );
});
