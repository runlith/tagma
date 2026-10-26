import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { dockerSuite, GUEST_TREE } from '../../../sandbox/testing/doubles.js';
import { sandboxFixture, SandboxFixture } from '../sandboxFixture.js';

dockerSuite('sandbox snapshots', () => {
  layer(sandboxFixture(), { excludeTestServices: true, timeout: '60 seconds' })('resources', (it) => {
    it.effect(
      'a prepared sandbox contains the named commit without history or the excluded graph',
      () =>
        SandboxFixture.use((world) =>
          Effect.gen(function* () {
            const { prepare, first, projectId, boundThread, readInGuest } = world;
            const record = yield* prepare(first);
            expect(record.state).toBe('prepared');
            expect(record.manifest?.source).toEqual({ kind: 'project', projectId, commit: first });
            expect(record.manifest?.snapshotDigest).toMatch(/^[0-9a-f]{64}$/);
            expect(record.manifest?.platform).toContain('linux');
            expect(record.manifest?.exclusions).toEqual([':(exclude).git', ':(exclude).tagma']);
            const thread = yield* boundThread(record.id);
            expect((yield* readInGuest(thread, `${GUEST_TREE()}/src/answer.txt`)).text).toContain('the first tree');
            expect((yield* readInGuest(thread, `${GUEST_TREE()}/.tagma`)).exists).toBe(false);
            expect((yield* readInGuest(thread, `${GUEST_TREE()}/.git`)).exists).toBe(false);
            expect((yield* readInGuest(thread, `${GUEST_TREE()}/src/uncommitted.txt`)).exists).toBe(false);
          }).pipe(Effect.provide(world.context)),
        ),
      60_000,
    );

    it.effect(
      'a snapshot keeps the graph when its caller excludes nothing',
      () =>
        SandboxFixture.use((world) =>
          Effect.gen(function* () {
            const record = yield* world.prepare(world.head, []);
            const thread = yield* world.boundThread(record.id);
            expect((yield* world.readInGuest(thread, `${GUEST_TREE()}/.tagma/block.md`)).text).toContain('graph content');
            expect((yield* world.readInGuest(thread, `${GUEST_TREE()}/.git`)).exists).toBe(false);
          }).pipe(Effect.provide(world.context)),
        ),
      60_000,
    );

    it.effect(
      'a commit the project does not carry refuses preparation and records why',
      () =>
        SandboxFixture.use((world) =>
          Effect.gen(function* () {
            const refused = yield* world.sandboxes
              .prepare({
                ownerId: 'operator',
                source: { kind: 'project', projectId: world.projectId, commit: 'f'.repeat(40) },
                limits: { pids: 128, memory: '512m', cpus: '1' },
              })
              .pipe(Effect.flip);
            expect(refused._tag).toBe('SandboxUnavailable');
            const failed = (yield* world.store.standing()).find((row) => row.state === 'failed');
            expect(failed?.failureReason).toContain('could not be read');
            if (failed !== undefined) world.made.push(failed.runtime.container);
          }).pipe(Effect.provide(world.context)),
        ),
      60_000,
    );
  });
});
