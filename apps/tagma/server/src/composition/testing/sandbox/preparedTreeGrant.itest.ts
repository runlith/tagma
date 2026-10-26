import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { ByteSize, Effect, FileSystem } from 'effect';
import { dockerSuite, dockerSaid } from '../../../sandbox/testing/doubles.js';
import { LIMITS, preparedTreeFixture, PreparedTreeFixture, REGISTRY } from '../preparedTreeFixture.js';

dockerSuite('prepared-tree grants', () => {
  layer(preparedTreeFixture(), { excludeTestServices: true })('resources', (it) => {
    it.effect(
      'a granted build seals an offline toolchain whose sandbox copies diverge without changing the artifact or host checkout',
      () =>
        PreparedTreeFixture.use((world) =>
          Effect.gen(function* () {
            const files = yield* FileSystem.FileSystem;
            const record = yield* Effect.fromResult(
              yield* world.build({
                network: [REGISTRY],
                readiness: ['node_modules/.bin/tsc --noEmit src/answer.ts && node_modules/.bin/tsc --version'],
              }),
            );
            expect(record.state).toBe('ready');
            expect(record.manifest?.network).toEqual({ kind: 'https', hosts: [REGISTRY] });
            expect(record.manifest?.readinessResults[0]?.code).toBe(0);
            expect(record.manifest?.readinessResults[0]?.output).toContain('5.9.2');
            expect(record.manifest?.archiveDigest).toMatch(/^[0-9a-f]{64}$/);
            expect(record.resourcesReleased).toBe(true);
            const sealed = join(world.storageRoot, record.id, 'tree.tar');
            expect((yield* files.stat(sealed)).size).toBe(ByteSize.bytes(record.manifest!.archiveBytes));
            const standing = yield* dockerSaid(['ps', '--all', '--format', '{{.Names}}'], 'list every guest');
            expect(standing.output).not.toContain(record.receipt.container);
            expect(standing.output).not.toContain(record.receipt.proxy);
            const networks = yield* dockerSaid(['network', 'ls', '--format', '{{.Name}}'], 'list every network');
            expect(networks.output).not.toContain(record.receipt.network);
            const before = yield* world.store.byId(record.id);
            const first = yield* world.sandboxes.prepare({
              ownerId: 'operator',
              source: { kind: 'prepared', preparedTree: record.id },
              limits: LIMITS,
            });
            world.made.push(first.runtime.container);
            const second = yield* world.sandboxes.prepare({
              ownerId: 'operator',
              source: { kind: 'prepared', preparedTree: record.id },
              limits: LIMITS,
            });
            world.made.push(second.runtime.container);
            expect(first.manifest?.image).toEqual(before!.manifest!.image);
            expect(first.manifest?.snapshotDigest).toBe(before!.manifest!.archiveDigest);
            yield* world.guests.start(first.runtime);
            yield* world.guests.start(second.runtime);
            expect((yield* world.inGuest(first.id, 'node_modules/.bin/tsc --noEmit src/answer.ts && echo COMPILED')).output).toContain(
              'COMPILED',
            );
            yield* world.inGuest(first.id, 'echo "export const answer: string = 42;" > src/answer.ts');
            expect((yield* world.inGuest(first.id, 'node_modules/.bin/tsc --noEmit src/answer.ts || echo REFUSED')).output).toContain(
              'REFUSED',
            );
            expect((yield* world.inGuest(second.id, 'node_modules/.bin/tsc --noEmit src/answer.ts && cat src/answer.ts')).output).toContain(
              'answer: number',
            );
            expect((yield* world.store.byId(record.id))?.manifest?.archiveDigest).toBe(before!.manifest!.archiveDigest);
            expect((yield* files.stat(sealed)).size).toBe(ByteSize.bytes(before!.manifest!.archiveBytes));
            expect(yield* files.readFileString(join(world.checkout, 'package.json'))).toContain('"typescript": "5.9.2"');
            expect(yield* files.exists(join(world.checkout, 'node_modules'))).toBe(false);
          }).pipe(Effect.provide(world.context)),
        ),
    );
  });
});
