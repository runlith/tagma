import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Exit, Fiber, Result, Scope } from 'effect';
import { HostAdmission, type RequestKind } from './HostAdmission';

const asked: ReadonlyArray<RequestKind> = ['read', 'stop', 'durable'];

const admits = Effect.gen(function* () {
  const admission = yield* HostAdmission;
  const outcomes = yield* Effect.all(asked.map((kind) => Effect.result(admission.admit(kind))));
  return asked.filter((_, index) => Result.isSuccess(outcomes[index]!));
});

describe('HostAdmission', () => {
  it.effect('a lost writer and a beginning shutdown refuse durable work alone; a finished one refuses every kind', () =>
    Effect.gen(function* () {
      const fenced = yield* Effect.flatMap(HostAdmission, (admission) => Effect.flatMap(admission.fence(), () => admits));
      const stopping = yield* Effect.flatMap(HostAdmission, (admission) => Effect.flatMap(admission.stopping(), () => admits));
      const [closed, refusal] = yield* Effect.gen(function* () {
        const admission = yield* HostAdmission;
        yield* admission.close();
        return [yield* admits, yield* Effect.flip(admission.admit('read'))] as const;
      });

      expect(fenced).toEqual(['read', 'stop']);
      expect(stopping).toEqual(['read', 'stop']);
      expect(closed).toEqual([]);
      expect(refusal.phase).toBe('closed');
      expect(refusal.kind).toBe('read');
    }).pipe(Effect.provide(HostAdmission.layer('open'))),
  );

  it.effect('a start already inside the gate holds a shutdown, and one arriving after it is refused', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.gen(function* () {
        const admission = yield* HostAdmission;
        const inside = yield* Scope.make();
        yield* Scope.provide(admission.admitStart(), inside);
        yield* admission.stopping();
        const refused = yield* Effect.flip(Effect.scoped(admission.admitStart()));
        const order: string[] = [];
        const waiting = yield* Effect.forkChild(
          Effect.andThen(
            admission.awaitStarts(),
            Effect.sync(() => order.push('waited')),
          ),
        );
        yield* Effect.yieldNow;
        order.push('finished');
        yield* Scope.close(inside, Exit.succeed(undefined));
        yield* Fiber.join(waiting);
        return { refused, order };
      });

      expect(outcome.refused.phase).toBe('stopping');
      expect(outcome.refused.kind).toBe('durable');
      expect(outcome.order).toEqual(['finished', 'waited']);
    }).pipe(Effect.provide(HostAdmission.layer('open'))),
  );

  it.effect('a live attempt holds no drain of starts, and the attempts wait answers when it leaves', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.gen(function* () {
        const admission = yield* HostAdmission;
        const inside = yield* Scope.make();
        yield* Scope.provide(admission.admitStart(), inside);
        const attempt = yield* Scope.make();
        yield* Scope.provide(admission.admitAttempt(), attempt);
        yield* Scope.close(inside, Exit.succeed(undefined));
        yield* admission.awaitStarts();
        const order: string[] = [];
        const waiting = yield* Effect.forkChild(
          Effect.andThen(
            admission.awaitAttempts(),
            Effect.sync(() => order.push('waited')),
          ),
        );
        yield* Effect.yieldNow;
        order.push('swept');
        yield* Scope.close(attempt, Exit.succeed(undefined));
        yield* Fiber.join(waiting);
        return order;
      });

      expect(outcome).toEqual(['swept', 'waited']);
    }).pipe(Effect.provide(HostAdmission.layer('open'))),
  );

  it.effect('admission narrows and never widens, whichever order the reasons arrive in', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.gen(function* () {
        const admission = yield* HostAdmission;
        const entered = yield* admission.phase();
        const shutting = yield* admission.stopping();
        const afterLoss = yield* admission.fence();
        const finished = yield* admission.close();
        return { entered, shutting, afterLoss, finished };
      });
      const seeded = yield* Effect.flatMap(HostAdmission, (admission) => admission.stopping()).pipe(
        Effect.provide(HostAdmission.layer('closed')),
      );

      expect(outcome.entered).toBe('open');
      expect(outcome.shutting).toBe('stopping');
      expect(outcome.afterLoss).toBe('stopping');
      expect(outcome.finished).toBe('closed');
      expect(seeded).toBe('closed');
    }).pipe(Effect.provide(HostAdmission.layer('open'))),
  );

  it.effect('the gate counts who is inside it, so a bounded wait names what outlasted it', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          const admission = yield* HostAdmission;
          const empty = yield* admission.populations();
          yield* admission.admitStart();
          yield* admission.admitAttempt();
          const holding = yield* admission.populations();
          return { empty, holding };
        }),
      );
      expect(outcome.empty).toEqual({ starts: 0, attempts: 0 });
      expect(outcome.holding).toEqual({ starts: 1, attempts: 1 });
    }).pipe(Effect.provide(HostAdmission.layer('open'))),
  );
});
