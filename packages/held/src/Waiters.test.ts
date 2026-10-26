import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Effect, Exit, Fiber, Scope } from 'effect';
import { waiters } from './Waiters.js';

const replies = { name: 'replies', owner: 'test', key: (key: string) => key };

it.live('a reply completes every waiter under its key and leaves no entry behind', () =>
  Effect.gen(function* () {
    const answered = yield* Effect.scoped(
      Effect.gen(function* () {
        const table = yield* waiters<string, number, string>(replies);
        const first = yield* Effect.forkChild(table.wait('a'));
        const second = yield* Effect.forkChild(table.wait('a'));
        const other = yield* Effect.forkChild(table.wait('b'));
        yield* Effect.yieldNow;
        const woken = table.complete('a', Exit.succeed(7));
        const values = [yield* Fiber.join(first), yield* Fiber.join(second)];
        const failed = table.complete('b', Exit.fail('gone'));
        return {
          woken,
          values,
          failed,
          other: yield* Fiber.await(other),
          standing: table.standing(),
          late: table.complete('a', Exit.succeed(8)),
        };
      }),
    );
    expect(answered).toEqual({ woken: 2, values: [7, 7], failed: 1, other: Exit.fail('gone'), standing: [], late: 0 });
  }),
);

it.live('an interrupted waiter or a failed start leaves no entry, and an interrupted watch no longer answers its keys', () =>
  Effect.gen(function* () {
    const left = yield* Effect.scoped(
      Effect.gen(function* () {
        const table = yield* waiters<string, void, never>(replies);
        const waiter = yield* Effect.forkChild(table.wait('a'), { startImmediately: true });
        yield* Fiber.interrupt(waiter);
        const interrupted = yield* Fiber.await(waiter);
        const refused = yield* Effect.exit(table.wait('b', Effect.fail('unsent')));
        const changed = yield* table.watch(['c', 'd']);
        const watching = table.standing();
        const watcher = yield* Effect.forkChild(changed);
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(watcher);
        return { interrupted, refused, watching, standing: table.standing(), woken: table.complete('c', Exit.void) };
      }),
    );
    expect(Exit.hasInterrupts(left.interrupted)).toBe(true);
    expect(left.refused).toEqual(Exit.fail('unsent'));
    expect(left.watching).toEqual([
      { key: 'c', waiters: 1 },
      { key: 'd', waiters: 1 },
    ]);
    expect(left.standing).toEqual([]);
    expect(left.woken).toBe(0);
  }),
);

it.live('closing the owning scope interrupts every standing waiter and refuses later ones', () =>
  Effect.gen(function* () {
    const ended = yield* Effect.gen(function* () {
      const owner = yield* Scope.make();
      const table = yield* Scope.provide(waiters<string, void, never>(replies), owner);
      const waiter = yield* Effect.forkChild(table.wait('a'));
      yield* Effect.yieldNow;
      yield* Scope.close(owner, Exit.void);
      let sent = false;
      const late = yield* Effect.exit(
        table.wait(
          'a',
          Effect.sync(() => (sent = true)),
        ),
      );
      return { waiter: Exit.hasInterrupts(yield* Fiber.await(waiter)), standing: table.standing(), late: Exit.hasInterrupts(late), sent };
    });
    expect(ended).toEqual({ waiter: true, standing: [], late: true, sent: false });
  }),
);
