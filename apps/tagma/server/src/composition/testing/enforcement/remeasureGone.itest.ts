import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Context, Deferred, Effect, Queue } from 'effect';
import { MeasuredCheckout } from '../../../graph/contract/service/serving.js';
import { driverOver, journalOver, withLanes } from '../../../enforcement/testing/wiring.js';
import type { LandingJournal } from '../../../enforcement/contract/service/remeasure.js';
import { gitEffect } from '../graphFixture.js';
import { Enforcements, enforceFixture, withEnforcement } from './enforceFixture.js';

layer(enforceFixture(), { excludeTestServices: true })('remeasurement of a gone checkout', (it) => {
  it.effect('a landing owed by a linked worktree removed from disk is settled instead of parked', () =>
    withEnforcement((fixture) =>
      Effect.gen(function* () {
        const { demo } = fixture;
        const { workers } = yield* Enforcements;
        const journal = journalOver(demo.graph.store.db, demo.graph.units);
        const settled = yield* Queue.unbounded<'removed' | 'parked'>();
        const observed: LandingJournal = {
          ...journal,
          park: (key, reason) => journal.park(key, reason).pipe(Effect.tap(() => Queue.offer(settled, 'parked'))),
          remove: (key) => journal.remove(key).pipe(Effect.tap(() => Queue.offer(settled, 'removed'))),
        };
        const linked = join(demo.fixture.root, 'linked');
        yield* gitEffect(demo.demoRoot, ['worktree', 'add', '-q', '--detach', linked]);
        const opened = yield* Deferred.make<void>();
        const driver = yield* driverOver({
          graphOf: (_, root) =>
            Deferred.await(opened).pipe(
              Effect.as(
                withLanes(demo.context, workers).pipe(
                  Context.add(MeasuredCheckout, { projectId: demo.projectId, path: root ?? demo.demoRoot }),
                ),
              ),
            ),
          delayMs: 0,
          journal: observed,
        });
        yield* driver.landed('submit_work', {
          kind: 'tree',
          projectId: demo.projectId,
          root: linked,
          commit: yield* fixture.head(),
          paths: ['src/core/model.ts'],
        });
        expect(yield* journal.page(null, 10)).toHaveLength(1);
        yield* gitEffect(demo.demoRoot, ['worktree', 'remove', '--force', linked]);
        yield* Deferred.succeed(opened, undefined);
        expect(yield* Queue.take(settled)).toBe('removed');
        expect(yield* journal.page(null, 10)).toEqual([]);
      }),
    ),
  );
});
