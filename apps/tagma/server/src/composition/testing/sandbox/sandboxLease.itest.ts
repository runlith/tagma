import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { Effect, FileSystem } from 'effect';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { dockerSuite, dockerSaid, sandbox, GUEST_TREE } from '../../../sandbox/testing/doubles.js';
import { sandboxFixture, SandboxFixture } from '../sandboxFixture.js';

dockerSuite('sandbox leases', () => {
  layer(sandboxFixture(), { excludeTestServices: true })('resources', (it) => {
    it.effect('an interruption takes the guest and resuming finds the workload sentinel', () =>
      SandboxFixture.use((world) =>
        Effect.gen(function* () {
          const record = yield* world.prepare();
          const thread = yield* world.boundThread(record.id);
          const sentinel = `still here ${crypto.randomUUID()}`;
          yield* Effect.scoped(
            Effect.gen(function* () {
              const { world: tree } = yield* world.worlds.world(thread);
              if (tree.files === undefined) return yield* Effect.die('the guest world has no files');
              yield* FileSystem.FileSystem.use((files) => files.writeFileString(`${GUEST_TREE()}/sentinel.txt`, `${sentinel}\n`)).pipe(
                Effect.provide(tree.files),
              );
            }),
          );
          const stopped = yield* dockerSaid(['stop', record.runtime.container], 'interrupt the sandbox guest');
          expect(stopped.code, stopped.output).toBe(0);
          expect((yield* world.readInGuest(thread, `${GUEST_TREE()}/sentinel.txt`)).text).toContain(sentinel);
        }).pipe(Effect.provide(world.context)),
      ),
    );

    it.effect('a sandbox prepared against another helper revision refuses acquisition', () =>
      SandboxFixture.use((world) =>
        Effect.gen(function* () {
          const record = yield* world.prepare();
          const thread = yield* world.boundThread(record.id);
          const { db } = yield* MachineStore;
          const units = yield* MachineUnits;
          yield* units.write('sandboxLease', (tx) =>
            tx.run(
              db
                .update(sandbox())
                .set({
                  manifest: { ...record.manifest!, image: { ...record.manifest!.image, revision: 'f'.repeat(16) } },
                })
                .where(eq(sandbox().id, record.id)),
            ),
          );
          const refused = yield* world.sandboxes.acquire(thread).pipe(Effect.flip);
          expect(refused._tag).toBe('SandboxUnavailable');
        }).pipe(Effect.provide(world.context)),
      ),
    );

    it.effect('a guest recreated outside its prepared boundary is not admitted', () =>
      SandboxFixture.use((world) =>
        Effect.gen(function* () {
          const record = yield* world.prepare();
          const thread = yield* world.boundThread(record.id);
          yield* dockerSaid(['rm', '--force', record.runtime.container], 'take the guest away');
          const loosened = yield* dockerSaid(
            [
              'run',
              '--detach',
              '--name',
              record.runtime.container,
              '--mount',
              `type=volume,src=${record.runtime.volume},dst=${GUEST_TREE()}`,
              record.manifest!.image.reference,
              'sleep',
              '600',
            ],
            'start a guest outside the boundary',
          );
          expect(loosened.code, loosened.output).toBe(0);
          const refused = yield* world.sandboxes.acquire(thread).pipe(Effect.flip);
          expect(refused.message).toContain('no longer stands at the boundary');
        }).pipe(Effect.provide(world.context)),
      ),
    );
  });
});
