import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Cause, Clock, Deferred, Effect, Exit, Fiber } from 'effect';
import type { Git } from '@runlith/git/Git';
import { holdingsOver } from '../../../change-record/testing/holdings.js';
import { idleCommands, journalOf, WRITER_WINDOW } from '../../../change-record/testing/doubles.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { TEST_CHECKOUT } from '../../../workspace/testing/doubles.js';
import { MINE } from '../checkoutFixture.js';
import { lines, retirementFixture, withRetirement } from '../retirementFixture.js';
import { CommandWalks } from './commandWorld.js';
const CHECKOUT = RootId.make(TEST_CHECKOUT);
layer(retirementFixture, { excludeTestServices: true })('retirement leases', (it) => {
  it.effect('a publication lease keeps autonomous clean retirement outside the unfinished landing', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        const walks = yield* CommandWalks;
        const rig = yield* holdingsOver(s.w.store, s.w.units, s.w.git, s.w.root, walks);
        yield* rig.retirement.start;
        yield* s.w.wrote(MINE, lines([0, 'const one = 10;']));
        yield* rig.holdings.judged(CHECKOUT, ['src/a.ts']);
        yield* rig.retirement.lease(
          CHECKOUT,
          Effect.gen(function* () {
            const carrying = yield* s.commit('carry during publication', 'src/a.ts');
            yield* rig.holdings.judged(CHECKOUT, ['src/a.ts']);
            expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'held', commit: null, reason: null }]);
            const retired = yield* rig.retirement.pass(CHECKOUT);
            expect(retired.committed.length).toBe(1);
            expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'committed', commit: carrying, reason: null }]);
          }),
        );
        yield* rig.close;
      }),
    ),
  );
  it.effect('a command close after the explicit pass is drained when the publication lease ends', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        const walks = yield* CommandWalks;
        const journal = yield* journalOf(s.w.store, s.w.units, walks);
        const released = yield* Deferred.make<void>();
        const rig = yield* holdingsOver(
          s.w.store,
          s.w.units,
          s.w.git,
          s.w.root,
          walks,
          (change) => (change.outcomes === true ? Effect.void : Effect.asVoid(Deferred.succeed(released, undefined))),
          undefined,
          yield* idleCommands(journal),
        );
        yield* rig.retirement.start;
        yield* s.w.wrote(MINE, lines([4, 'const five = 50;']));
        const carrying = yield* rig.retirement.lease(
          CHECKOUT,
          Effect.gen(function* () {
            yield* journal.opened({
              id: 'late-close',
              projectId: s.w.projectId,
              threadId: MINE,
              runHint: null,
              checkout: TEST_CHECKOUT,
              spelling: s.w.root,
              openedAt: yield* Clock.currentTimeMillis,
              ...WRITER_WINDOW,
            });
            const carrying = yield* s.commit('carry before late close', 'src/a.ts');
            yield* rig.retirement.pass(CHECKOUT);
            expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'held', commit: null, reason: null }]);
            yield* journal.closed(['late-close']);
            return carrying;
          }),
        );
        yield* Deferred.await(released);
        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'committed', commit: carrying, reason: null }]);
        yield* rig.close;
      }),
    ),
  );
  it.effect('interrupting a publication lease releases its pending clean retirement', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        const walks = yield* CommandWalks;
        const released = yield* Deferred.make<void>();
        const rig = yield* holdingsOver(s.w.store, s.w.units, s.w.git, s.w.root, walks, (change) =>
          change.outcomes === true ? Effect.void : Effect.asVoid(Deferred.succeed(released, undefined)),
        );
        yield* rig.retirement.start;
        yield* s.w.wrote(MINE, lines([1, 'const two = 20;']));
        yield* rig.holdings.judged(CHECKOUT, ['src/a.ts']);
        let carrying = '';
        const interrupted = yield* Effect.exit(
          rig.retirement.lease(
            CHECKOUT,
            Effect.gen(function* () {
              carrying = yield* s.commit('carry before interruption', 'src/a.ts');
              yield* rig.holdings.judged(CHECKOUT, ['src/a.ts']);
              return yield* Effect.interrupt;
            }),
          ),
        );
        expect(Exit.isFailure(interrupted) && Cause.hasInterruptsOnly(interrupted.cause)).toBe(true);
        yield* Deferred.await(released);
        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'committed', commit: carrying, reason: null }]);
        yield* rig.close;
      }),
    ),
  );
  it.effect('a pass requested after the HEAD snapshot reads the later carrying commit', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        const walks = yield* CommandWalks;
        yield* s.w.wrote(MINE, lines([2, 'const three = 30;']));
        yield* s.pass();
        const read = yield* Deferred.make<void>();
        const resume = yield* Deferred.make<void>();
        let stopped = false;
        const git: Git['Service'] = {
          run: Effect.fnUntraced(function* (args, options) {
            const result = yield* s.w.git.run(args, options);
            if (!stopped && args.includes('HEAD^{commit}')) {
              stopped = true;
              yield* Deferred.succeed(read, undefined);
              yield* Deferred.await(resume);
            }
            return result;
          }),
        };
        const rig = yield* holdingsOver(s.w.store, s.w.units, git, s.w.root, walks);
        const first = yield* Effect.forkChild(rig.retirement.pass(CHECKOUT));
        yield* Deferred.await(read);
        const carrying = yield* s.commit('carry after the snapshot', 'src/a.ts');
        const later = yield* Effect.forkChild(rig.retirement.pass(CHECKOUT));
        yield* Deferred.succeed(resume, undefined);
        expect((yield* Fiber.join(first)).committed).toEqual([]);
        expect((yield* Fiber.join(later)).committed.length).toBe(1);
        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'committed', commit: carrying, reason: null }]);
        yield* rig.close;
      }),
    ),
  );
});
