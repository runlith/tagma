import { it } from '@runlith/effect-test';
import { expect, test } from 'bun:test';
import { Cause, Deferred, Effect, Exit, Fiber } from 'effect';
import { HoldCut, HoldStalled, LockOrderViolated, ResourceInvalid } from './failures.js';
import { declare, type ResourceDeclaration } from './Held.js';
import { HeldFor, type StallRecord, StallRecords } from './holding.js';

const resource = (name: string, rank: number, overrides: Partial<ResourceDeclaration<string>> = {}) =>
  declare<string>({
    name,
    owner: 'test',
    rank,
    key: (key) => key,
    concurrency: 1,
    threshold: 200,
    ceilings: { hold: 400, wait: 300, leaves: 'nothing' },
    external: 'none',
    ...overrides,
  });

const stalls: StallRecord[] = [];
const run = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.exit(effect.pipe(Effect.provideService(StallRecords, (record) => Effect.sync(() => void stalls.push(record)))));

const defect = (exit: Exit.Exit<unknown, unknown>) => (Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined);

it.live('a rank at or below one held refuses before it waits, naming both holds', () =>
  Effect.gen(function* () {
    const tree = resource('tree', 420);
    const entry = resource('entry', 400);
    const exit = yield* run(tree.hold('a', entry.hold('a', Effect.void)));
    const refused = defect(exit);
    expect(refused).toBeInstanceOf(LockOrderViolated);
    expect((refused as LockOrderViolated).held.resource).toBe('tree');
    expect((refused as LockOrderViolated).wanted.resource).toBe('entry');
    expect(tree.standing()).toEqual([]);
  }),
);

it.live('re-taking a key the fiber already holds refuses: a hold is not reentrant', () =>
  Effect.gen(function* () {
    const tree = resource('tree', 420);
    expect(defect(yield* run(tree.hold('a', tree.hold('a', Effect.void))))).toBeInstanceOf(LockOrderViolated);
    expect(defect(yield* run(tree.hold('a', tree.hold('b', Effect.void))))).toBeInstanceOf(LockOrderViolated);
  }),
);

it.live('ranks taken in increasing order nest, and a fiber forked inside a hold inherits its tokens', () =>
  Effect.gen(function* () {
    const entry = resource('entry', 400);
    const tree = resource('tree', 420);
    expect(Exit.isSuccess(yield* run(entry.hold('a', tree.hold('a', Effect.succeed(1)))))).toBe(true);
    const inherited = yield* run(tree.hold('a', Effect.flatMap(Effect.forkChild(entry.hold('a', Effect.void)), Fiber.join)));
    expect(defect(inherited)).toBeInstanceOf(LockOrderViolated);
  }),
);

it.live('a token released stays out of every check, even in a fiber that outlived the hold', () =>
  Effect.gen(function* () {
    const entry = resource('entry', 400);
    const tree = resource('tree', 420);
    const exit = yield* run(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const outlived = yield* tree.hold(
          'a',
          Effect.forkDetach(Effect.andThen(Deferred.await(gate), entry.hold('a', Effect.succeed('taken')))),
        );
        yield* Deferred.succeed(gate, undefined);
        return yield* Fiber.join(outlived);
      }),
    );
    expect(exit).toEqual(Exit.succeed('taken'));
  }),
);

it.live('several keys of one rank are taken as one sorted set, so two opposite orders do not deadlock', () =>
  Effect.gen(function* () {
    const files = resource('files', 261);
    const exit = yield* run(
      Effect.all([files.holdAll(['b', 'a'], Effect.sleep(5)), files.holdAll(['a', 'b'], Effect.sleep(5))], { concurrency: 2 }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(files.standing()).toEqual([]);
  }),
);

it.live('a lease is listed with the work it is held for until its scope closes, and its threshold record names that work', () =>
  Effect.gen(function* () {
    const writer = resource('writer', 500, { threshold: 5 });
    stalls.length = 0;
    const exit = yield* run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* writer.lease('db');
          yield* Effect.sleep(20);
          return writer.holders('db');
        }),
      ).pipe(Effect.provideService(HeldFor, 'project.birth')),
    );
    expect(Exit.isSuccess(exit) ? exit.value.map((holder) => holder.heldFor) : exit).toEqual(['project.birth']);
    expect(stalls.find((record) => record.kind === 'hold-threshold')?.heldFor).toBe('project.birth');
    expect(writer.holders('db')).toEqual([]);
  }),
);

it.live('a waiter past the wait ceiling is withdrawn unstarted with outcome none and a stall record', () =>
  Effect.gen(function* () {
    const tree = resource('tree', 420, { ceilings: { hold: 400, wait: 20, leaves: 'nothing' } });
    stalls.length = 0;
    const exit = yield* run(
      Effect.gen(function* () {
        const holding = yield* Effect.forkChild(tree.hold('a', Effect.sleep(200)));
        yield* Effect.sleep(5);
        const waited = yield* Effect.exit(tree.hold('a', Effect.void));
        yield* Fiber.interrupt(holding);
        return waited;
      }),
    );
    const waited = Exit.isSuccess(exit) ? exit.value : exit;
    expect(defect(waited as Exit.Exit<unknown, unknown>)).toBeInstanceOf(HoldStalled);
    expect(stalls.map((record) => record.kind)).toContain('wait-ceiling');
    expect(tree.standing()).toEqual([]);
  }),
);

it.live('a hold past its ceiling is cut: its body and the children it forked are interrupted before the key is free', () =>
  Effect.gen(function* () {
    const tree = resource('tree', 420, { threshold: 5, ceilings: { hold: 30, wait: 300, leaves: 'the act stays unpublished' } });
    let childEnded = false;
    const exit = yield* run(
      tree.hold(
        'a',
        Effect.gen(function* () {
          yield* Effect.forkChild(Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => (childEnded = true)))));
          yield* Effect.never;
        }),
      ),
    );
    const cut = defect(exit);
    expect(cut).toBeInstanceOf(HoldCut);
    expect((cut as HoldCut).leaves).toBe('the act stays unpublished');
    expect(childEnded).toBe(true);
    expect(tree.standing()).toEqual([]);
  }),
);

it.live('waiters are served in arrival order up to the declared concurrency', () =>
  Effect.gen(function* () {
    const lane = resource('lane', 280, { concurrency: 2 });
    const order: number[] = [];
    const exit = yield* run(
      Effect.forEach(
        [1, 2, 3, 4],
        (n) =>
          lane.hold(
            'checkout',
            Effect.andThen(
              Effect.sleep(10),
              Effect.sync(() => order.push(n)),
            ),
          ),
        { concurrency: 'unbounded' },
      ),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(order.slice(0, 2).sort()).toEqual([1, 2]);
    expect(order.slice(2).sort()).toEqual([3, 4]);
  }),
);

it.live('a scoped lease refuses a lower rank while another resource is held', () =>
  Effect.gen(function* () {
    const outer = resource('outer', 420);
    const inner = resource('inner', 400);
    const exit = yield* run(outer.hold('a', Effect.scoped(inner.lease('a'))));
    expect(defect(exit)).toBeInstanceOf(LockOrderViolated);
    expect(inner.standing()).toEqual([]);
  }),
);

it.live('a scoped lease remains ranked through later acquisitions in the same scope', () =>
  Effect.gen(function* () {
    const outer = resource('outer', 420);
    const inner = resource('inner', 400);
    const exit = yield* run(Effect.scoped(Effect.andThen(outer.lease('a'), inner.hold('b', Effect.void))));
    expect(defect(exit)).toBeInstanceOf(LockOrderViolated);
    const forked = yield* run(
      Effect.scoped(Effect.andThen(outer.lease('a'), Effect.flatMap(Effect.forkChild(inner.hold('b', Effect.void)), Fiber.join))),
    );
    expect(defect(forked)).toBeInstanceOf(LockOrderViolated);
    expect(outer.standing()).toEqual([]);
  }),
);

it.live('a scoped lease releases when its scope closes', () =>
  Effect.gen(function* () {
    const lane = resource('lane', 420);
    const exit = yield* run(
      Effect.scoped(
        Effect.andThen(
          lane.lease('a'),
          Effect.sync(() => ({ all: lane.standing(), key: lane.standing('a'), absent: lane.standing('b') })),
        ),
      ),
    );
    expect(exit).toEqual(
      Exit.succeed({ all: [{ key: 'a', holders: 1, waiters: 0 }], key: [{ key: 'a', holders: 1, waiters: 0 }], absent: [] }),
    );
    expect(lane.standing()).toEqual([]);
    expect(lane.standing('a')).toEqual([]);
  }),
);

it.live('interrupting a scoped holder releases its permit to the next waiter', () =>
  Effect.gen(function* () {
    const lane = resource('lane', 420);
    const exit = yield* run(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const holder = yield* Effect.forkChild(
          Effect.scoped(Effect.andThen(lane.lease('a'), Effect.andThen(Deferred.succeed(entered, undefined), Effect.never))),
        );
        yield* Deferred.await(entered);
        const waiter = yield* Effect.forkChild(Effect.scoped(Effect.as(lane.lease('a'), 'next')));
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(holder);
        return yield* Fiber.join(waiter);
      }),
    );
    expect(exit).toEqual(Exit.succeed('next'));
    expect(lane.standing()).toEqual([]);
  }),
);

it.live('a scoped lease past its wait ceiling fails typed and leaves no waiter', () =>
  Effect.gen(function* () {
    const lane = resource('lane', 420, { ceilings: { hold: 400, wait: 20, leaves: 'the request has not started' } });
    const timed = yield* run(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const holder = yield* Effect.forkChild(
          Effect.scoped(Effect.andThen(lane.lease('a'), Effect.andThen(Deferred.succeed(entered, undefined), Effect.never))),
        );
        yield* Deferred.await(entered);
        const waited = yield* Effect.exit(Effect.scoped(lane.lease('a')));
        yield* Fiber.interrupt(holder);
        return waited;
      }),
    );
    expect(defect(Exit.isSuccess(timed) ? timed.value : timed)).toBeInstanceOf(HoldStalled);
    expect(lane.standing()).toEqual([]);
  }),
);

test('a resource that cannot say what a cut leaves, or waits past 15 minutes, cannot be declared', () => {
  expect(() => resource('bad', 1, { ceilings: { hold: 400, wait: 300, leaves: ' ' } })).toThrow(ResourceInvalid);
  expect(() => resource('bad', 1, { ceilings: { hold: '16 minutes', wait: 300, leaves: 'x' } })).toThrow(ResourceInvalid);
});

const index = () =>
  declare<string>({
    name: 'index',
    owner: 'test',
    rank: 300,
    key: (key) => key,
    concurrency: 1,
    threshold: 5,
    ceilings: {
      hold: { base: 10, bySize: (bytes, disks) => (disks.includes('slow') ? bytes * 2 : bytes) },
      wait: 300,
      leaves: 'the paths stay unsettled',
    },
    external: 'none',
  });

it.live('a sized hold is cut at its base plus what its stated size adds for its key, derived per hold', () =>
  Effect.gen(function* () {
    const section = index();
    const small = yield* run(section.hold('git', 0, Effect.sleep(40)));
    const large = yield* run(section.holdAll(['git'], 200, Effect.as(Effect.sleep(40), 'written')));
    const fast = yield* run(section.hold('fast', 20, Effect.sleep(60)));
    const slow = yield* run(section.hold('slow', 20, Effect.as(Effect.sleep(40), 'written')));
    expect(defect(small)).toBeInstanceOf(HoldCut);
    expect(large).toEqual(Exit.succeed('written'));
    expect(defect(fast)).toBeInstanceOf(HoldCut);
    expect(slow).toEqual(Exit.succeed('written'));
    expect(section.standing()).toEqual([]);
  }),
);

it.live('a sized hold without a finite nonnegative size, or past 15 minutes, is refused before it waits', () =>
  Effect.gen(function* () {
    const section = index();
    const unsized = section.hold as unknown as (key: string, use: Effect.Effect<void>) => Effect.Effect<void>;
    for (const refused of [
      unsized('git', Effect.void),
      section.hold('git', Number.NaN, Effect.void),
      section.hold('git', -1, Effect.void),
      section.hold('git', 16 * 60_000, Effect.void),
    ]) {
      expect(defect(yield* run(refused))).toBeInstanceOf(ResourceInvalid);
    }
    expect(section.standing()).toEqual([]);
  }),
);
