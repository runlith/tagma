import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Scheduler } from 'effect';
import { retirementOver } from '../../../change-record/testing/holdings.js';
import { fixture, layers } from './threadFilesWorld.js';

layer(layers, { excludeTestServices: true })('retirement following', (it) => {
  it.effect('two first follows of one checkout at once watch its HEAD once', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      let watches = 0;
      const root = yield* world.roots.read(world.rootId);
      const roots = { ...world.roots, read: () => Effect.succeed(root) };
      const retirement = yield* retirementOver(world.store, world.units, world.git, roots, {
        ...world.checkouts,
        headMoved: (checkout) => {
          watches += 1;
          return world.checkouts.headMoved(checkout);
        },
      });
      yield* Effect.all([retirement.follow(world.rootId), retirement.follow(world.rootId)], { concurrency: 2 }).pipe(
        Effect.provideService(Scheduler.MaxOpsBeforeYield, 3),
      );
      expect(watches).toBe(1);
    }),
  );
});
