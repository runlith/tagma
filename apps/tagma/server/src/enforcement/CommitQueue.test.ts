import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Result } from 'effect';
import { commitQueue, type QueuedCommit } from './commits/queue.js';

const queued = (commit: string): QueuedCommit => ({
  op: 'git_commit',
  projectId: 1,
  root: '/checkout',
  commit,
  holder: 'operator',
  caller: { kind: 'operator' },
});

it.effect(
  'a close racing admissions loses none: every commit it answered as queued is counted waiting, and every later one is refused',
  () =>
    Effect.gen(function* () {
      const queue = yield* commitQueue({ path: null, judge: () => Effect.never });
      const admitted = Effect.forEach(
        Array.from({ length: 40 }, (_, at) => `c${at}`),
        (commit) => Effect.result(queue.admit(queued(commit))),
        { concurrency: 'unbounded' },
      );
      const [answers] = yield* Effect.all([admitted, Effect.andThen(Effect.yieldNow, queue.close())], { concurrency: 'unbounded' });
      const late = yield* Effect.result(queue.admit(queued('late')));
      expect(yield* queue.drained()).toEqual({ waiting: answers.filter(Result.isSuccess).length, unread: 0 });
      expect(Result.isFailure(late) && late.failure._tag).toBe('CommitAdmissionRefused');
    }),
);

it.effect('a closed queue still records what it holds, and reports nothing waiting once the last is recorded', () =>
  Effect.gen(function* () {
    const release = yield* Deferred.make<void>();
    const seen: string[] = [];
    const queue = yield* commitQueue({
      path: null,
      judge: (one) =>
        Effect.andThen(
          Deferred.await(release),
          Effect.sync(() => seen.push(one.commit)),
        ),
    });
    yield* queue.admit(queued('a'));
    yield* queue.admit(queued('b'));
    yield* queue.close();
    expect(yield* queue.drained()).toEqual({ waiting: 2, unread: 0 });
    yield* Deferred.succeed(release, undefined);
    yield* Effect.repeat(Effect.andThen(Effect.yieldNow, queue.drained()), { until: (drained) => drained.waiting === 0 });
    expect(yield* queue.drained()).toEqual({ waiting: 0, unread: 0 });
    expect(seen).toEqual(['a', 'b']);
  }),
);

it.effect('a refused downgrade preflight can reopen admission', () =>
  Effect.gen(function* () {
    const queue = yield* commitQueue({ path: null, judge: () => Effect.void });
    yield* queue.close();
    const closed = yield* Effect.result(queue.admit(queued('closed')));
    yield* queue.reopen();
    const admitted = yield* Effect.result(queue.admit(queued('admitted')));
    expect(Result.isFailure(closed) && closed.failure._tag).toBe('CommitAdmissionRefused');
    expect(Result.isSuccess(admitted)).toBe(true);
  }),
);
