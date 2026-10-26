import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { dockerSuite, dockerSaid } from '../../../sandbox/testing/doubles.js';
import { LIMITS, preparedTreeFixture, PreparedTreeFixture, REGISTRY } from '../preparedTreeFixture.js';

dockerSuite('prepared-tree release', () => {
  layer(preparedTreeFixture(), { excludeTestServices: true, timeout: '60 seconds' })('resources', (it) => {
    it.effect(
      'an artifact’s sandbox copy stays offline and survives the release that removes the artifact bytes',
      () =>
        PreparedTreeFixture.use((world) =>
          Effect.gen(function* () {
            const files = yield* FileSystem.FileSystem;
            const artifact = yield* world.artifactOf({ network: [REGISTRY], setup: ['true'] });
            const copy = yield* world.sandboxes.prepare({
              ownerId: 'operator',
              source: { kind: 'prepared', preparedTree: artifact },
              limits: LIMITS,
            });
            world.made.push(copy.runtime.container);
            yield* world.guests.start(copy.runtime);
            const configured = yield* dockerSaid(
              ['container', 'inspect', '--format', '{{.HostConfig.NetworkMode}}', copy.runtime.container],
              'read the copy’s network',
            );
            expect(configured.output.trim()).toBe('none');
            const reached = yield* world.inGuest(
              copy.id,
              `bun -e 'fetch("https://${REGISTRY}/typescript").then(() => console.log("REACHED")).catch((e) => console.log("REFUSED", e.message))'`,
            );
            expect(reached.output).toContain('REFUSED');
            const released = yield* world.preparedTrees.release(artifact);
            expect(released.state).toBe('released');
            expect(yield* files.exists(join(world.storageRoot, artifact))).toBe(false);
            expect((yield* world.inGuest(copy.id, 'cat src/answer.ts')).output).toContain('answer: number');
            const refused = yield* world.sandboxes
              .prepare({
                ownerId: 'operator',
                source: { kind: 'prepared', preparedTree: artifact },
                limits: LIMITS,
              })
              .pipe(Effect.flip);
            expect(refused.message).toContain('released');
          }).pipe(Effect.provide(world.context)),
        ),
      60_000,
    );
  });
});
