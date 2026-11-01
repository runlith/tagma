import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { expect } from 'bun:test';
import { Context, Effect, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { UNCHECKED } from '../../../enforcement/contract/wire/checks.js';
import { indexCommitOver } from '../../../landing/testing/doubles.js';
import { CommitTrees } from '../../../workspace/contract/service/commitTrees.js';
import { checkoutFixture, FILE, MINE, withCheckout } from '../checkoutFixture.js';
import { landingServices, provedOrigins } from '../landingServices.js';
import { declaration, FORMATTER, steppedOver, tool } from '../stepsFixture.js';

layer(Layer.merge(checkoutFixture, BunFileSystem.layer), { excludeTestServices: true })('checkout', (it) => {
  it.effect('a commit_checkout judgement over steps meets the step’s form already in the working file', () =>
    withCheckout((world) =>
      Effect.fnUntraced(function* () {
        yield* tool(world.root, 'fmt.sh', FORMATTER);
        yield* declaration(world.root, [{ run: ['tools/fmt.sh'], files: ['src/**'] }]);
        yield* world.run(['add', '-A']);
        yield* world.run(['commit', '-q', '-m', 'declare the steps']);
        yield* world.wrote(MINE, [...FILE.slice(0, 4), 'const five = 5; // mine   ']);
        yield* world.run(['add', '--', 'src/a.ts']);
        const services = yield* landingServices;
        const origin = yield* provedOrigins.rootOf(world.root);
        const seen: string[] = [];
        const judge = () => Effect.sync(() => (seen.push(readFileSync(join(world.root, 'src', 'a.ts'), 'utf8')), UNCHECKED));
        const formed = `${[...FILE.slice(0, 4), 'const five = 5; // mine'].join('\n')}\n`;
        const done = yield* Effect.provide(
          indexCommitOver(
            world.git,
            Context.get(services, CommitTrees),
            (yield* steppedOver(world.store)).shape,
            { git: world.git, root: world.root, projectId: world.projectId, origin },
            judge,
            'shaped by its steps',
          ),
          services,
        );
        expect(seen).toEqual([formed]);
        expect(done.paths).toEqual(['src/a.ts']);
        expect(yield* world.run(['show', 'HEAD:src/a.ts'])).toBe(formed.trimEnd());
      })(),
    ),
  );
});
