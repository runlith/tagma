import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Effect, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Git } from '@runlith/git/Git';
import { config } from '../../../config/config.js';
import { checkoutFixture, withCheckout } from '../checkoutFixture.js';
import { declaration, FORMATTER, tool } from '../stepsFixture.js';
layer(Layer.merge(checkoutFixture, BunFileSystem.layer), { excludeTestServices: true })('checkout', (it) => {
  it.effect('a checkout answers whether HEAD holds tagma.config.ts without spawning git again until its HEAD moves', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        const fact = config.facts?.find((one) => one.id === 'config');
        if (fact === undefined) return yield* Effect.die(new Error('the config module declares no config fact'));
        let spawned = 0;
        const counting: Git['Service'] = { run: (args, options) => ((spawned += 1), world.git.run(args, options)) };
        const ask = () =>
          Effect.provide(Effect.provideService(fact.read({ projectId: world.projectId, root: world.root }), Git, counting), world.context);
        expect(yield* ask()).toBe(false);
        const reading = spawned;
        expect(reading).toBeGreaterThan(0);
        expect(yield* ask()).toBe(false);
        expect(spawned).toBe(reading);
        yield* tool(world.root, 'fmt.sh', FORMATTER);
        yield* declaration(world.root, [{ run: ['tools/fmt.sh'], files: ['src/**'] }]);
        yield* world.run(['add', '-A']);
        yield* world.run(['commit', '-q', '-m', 'declare the config']);
        expect(yield* ask()).toBe(true);
        const afterMove = spawned;
        expect(yield* ask()).toBe(true);
        expect(spawned).toBe(afterMove);
      })(),
    ),
  );
});
