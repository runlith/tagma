import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Exit, Queue, Scope } from 'effect';
import { driverOver, journalOver, withLanes } from '../../../enforcement/testing/wiring.js';
import type { JournaledLanding, LandingJournal } from '../../../enforcement/contract/service/remeasure.js';
import { Enforcements, enforceFixture, withEnforcement } from './enforceFixture.js';

type Graphing = 'hang' | 'broken' | 'served';
layer(enforceFixture(), { excludeTestServices: true })('remeasurement journal', (it) => {
  it.effect('a durable landing survives a cut and a failed startup, then leaves its journal after a successful replay', () =>
    withEnforcement((fixture) =>
      Effect.gen(function* () {
        const { demo } = fixture;
        const { workers } = yield* Enforcements;
        const journal = journalOver(demo.graph.store.db, demo.graph.units);
        const parked = yield* Queue.unbounded<void>();
        const removed = yield* Queue.unbounded<void>();
        const observed: LandingJournal = {
          ...journal,
          park: (key, reason) => journal.park(key, reason).pipe(Effect.tap(() => Queue.offer(parked, undefined))),
          remove: (key) => journal.remove(key).pipe(Effect.tap(() => Queue.offer(removed, undefined))),
        };
        const driven = Effect.fnUntraced(function* (graphing: Graphing) {
          const scope = yield* Scope.fork(yield* Effect.scope);
          const driver = yield* Scope.provide(
            driverOver({
              graphOf: () =>
                graphing === 'hang'
                  ? Effect.never
                  : graphing === 'broken'
                    ? Effect.fail({ message: 'the graph could not be opened' })
                    : Effect.succeed(withLanes(demo.context, workers)),
              delayMs: 0,
              journal: observed,
            }),
            scope,
          );
          return { driver, close: Scope.close(scope, Exit.void) };
        });
        const first = yield* driven('hang');
        yield* first.driver.landed('submit_work', {
          kind: 'tree',
          projectId: demo.projectId,
          root: demo.demoRoot,
          commit: yield* fixture.head(),
          paths: ['src/core/model.ts'],
        });
        yield* first.close;
        expect(yield* journal.page(null, 10)).toHaveLength(1);
        const failing = yield* driven('broken');
        yield* Queue.take(parked);
        const kept = yield* journal.page(null, 10);
        expect(kept).toHaveLength(1);
        expect(kept[0]?.landing?.paths).toEqual(['src/core/model.ts']);
        expect(kept[0]?.parked).toContain('could not be read');
        yield* failing.close;
        yield* driven('served');
        yield* Queue.take(removed);
        expect(yield* journal.page(null, 10)).toEqual([]);
      }),
    ),
  );

  it.effect('a landing journaled before crossings carried their norm and fix still replays with its carried crossing', () =>
    withEnforcement((fixture) =>
      Effect.gen(function* () {
        const { demo } = fixture;
        const journal = journalOver(demo.graph.store.db, demo.graph.units);
        const landing: JournaledLanding = {
          kind: 'tree',
          projectId: demo.projectId,
          root: demo.demoRoot,
          commit: yield* fixture.head(),
          paths: ['src/core/model.ts'],
          op: 'submit_work',
        };
        const carried = {
          rule: 'aaaaaaaa',
          fingerprint: 'app order core/model.ts -> app/',
          file: 'src/core/model.ts',
          line: 1,
          holders: ['t'],
        };
        yield* journal.put({ key: 'before-norm', landing, payload: JSON.stringify({ ...landing, carried: [carried] }) });
        const [row] = yield* journal.page(null, 10);
        expect(row?.landing?.carried).toEqual([{ ...carried, title: '', message: '', generalFix: '' }]);
        yield* journal.remove('before-norm');
      }),
    ),
  );
});
