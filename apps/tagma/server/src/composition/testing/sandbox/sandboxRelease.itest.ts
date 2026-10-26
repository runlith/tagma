import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { dirname, join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { sandboxKind } from '../../../threads/testing/doubles.js';
import { archiveBytes, dockerSuite, dockerSaid, unpackArchive } from '../../../sandbox/testing/doubles.js';
import { sandboxFixture, SandboxFixture } from '../sandboxFixture.js';

const materialized = Effect.fnUntraced(function* (sealed: string) {
  const into = join(dirname(sealed), 'tree');
  yield* unpackArchive(archiveBytes(sealed), into);
  return into;
});

dockerSuite('sandbox release', () => {
  layer(sandboxFixture(), { excludeTestServices: true, timeout: '60 seconds' })('resources', (it) => {
    it.effect(
      'a held sandbox refuses release and its ending exports the tree before cleanup removes it',
      () =>
        SandboxFixture.use((world) =>
          Effect.gen(function* () {
            const files = yield* FileSystem.FileSystem;
            const record = yield* world.prepare();
            const thread = yield* world.boundThread(record.id);
            const busy = yield* world.sandboxes.release(record.id).pipe(Effect.flip);
            expect(busy.message).toContain('sandbox-busy');
            const held = (yield* world.ledger.held([thread.id]))[0]!;
            const units = yield* MachineUnits;
            yield* units.write('sandboxRelease', (tx) => sandboxKind(world.sandboxes).end!([held], tx));
            expect((yield* dockerSaid(['container', 'inspect', record.runtime.container], 'look for the guest')).code).toBe(0);
            expect(yield* world.sandboxes.cleanup()).toEqual([record.id]);
            const row = yield* world.store.byId(record.id);
            expect(row?.state).toBe('released');
            const tree = yield* materialized(row!.exportPath!);
            expect(yield* files.readFileString(join(tree, 'src', 'answer.txt'))).toContain('the second tree');
            expect((yield* dockerSaid(['container', 'inspect', record.runtime.container], 'look for the guest')).code).not.toBe(0);
            expect((yield* dockerSaid(['volume', 'inspect', record.runtime.volume], 'look for the data')).code).not.toBe(0);
          }).pipe(Effect.provide(world.context)),
        ),
      60_000,
    );

    it.effect(
      'an explicit release seals the tree before removing the guest',
      () =>
        SandboxFixture.use((world) =>
          Effect.gen(function* () {
            const files = yield* FileSystem.FileSystem;
            const record = yield* world.prepare();
            const exported = yield* world.sandboxes.release(record.id);
            const tree = yield* materialized(exported.path);
            expect(yield* files.readFileString(join(tree, 'src', 'answer.txt'))).toContain('the second tree');
            expect(yield* files.exists(join(tree, '.tagma'))).toBe(false);
            expect((yield* dockerSaid(['container', 'inspect', record.runtime.container], 'look for the guest')).code).not.toBe(0);
          }).pipe(Effect.provide(world.context)),
        ),
      60_000,
    );

    it.effect(
      'releasing a sandbox whose guest is already gone still removes its data',
      () =>
        SandboxFixture.use((world) =>
          Effect.gen(function* () {
            const record = yield* world.prepare();
            const gone = yield* dockerSaid(['rm', '--force', record.runtime.container], 'take the guest away');
            expect(gone.code, gone.output).toBe(0);
            expect((yield* dockerSaid(['volume', 'inspect', record.runtime.volume], 'look for the data')).code).toBe(0);
            yield* world.sandboxes.release(record.id);
            expect((yield* world.store.byId(record.id))?.state).toBe('released');
            expect((yield* dockerSaid(['volume', 'inspect', record.runtime.volume], 'look for the data')).code).not.toBe(0);
          }).pipe(Effect.provide(world.context)),
        ),
      60_000,
    );

    it.effect(
      'boot condemns unfinished preparations and removes only the installation’s marked orphan guests',
      () =>
        SandboxFixture.use((world) =>
          Effect.gen(function* () {
            const record = yield* world.prepare();
            const halfway = crypto.randomUUID();
            yield* world.store.open({
              id: halfway,
              projectId: world.projectId,
              ownerId: 'operator',
              runtime: world.backend.receipt(halfway),
            });
            const orphan = world.backend.receipt(`orphan-${crypto.randomUUID()}`);
            world.made.push(orphan.container);
            yield* dockerSaid(['volume', 'create', ...world.ownedLabels(orphan.container), orphan.volume], 'create an orphan volume');
            yield* dockerSaid(
              [
                'run',
                '--detach',
                '--name',
                orphan.container,
                ...world.ownedLabels(orphan.container),
                '--mount',
                `type=volume,src=${orphan.volume},dst=/work`,
                record.manifest!.image.reference,
                'sleep',
                '600',
              ],
              'start an orphan guest',
            );
            const stranger = `${orphan.container}-stranger`;
            world.made.push(stranger);
            yield* dockerSaid(
              ['run', '--detach', '--name', stranger, record.manifest!.image.reference, 'sleep', '600'],
              'start an unmarked look-alike',
            );
            expect(yield* world.sandboxes.condemnUnfinished()).toContain(halfway);
            const reconciled = yield* world.sandboxes.reconcile();
            expect(reconciled.engine).toBe('read');
            expect(reconciled.removed).toContain(orphan.container);
            expect(reconciled.removed).not.toContain(stranger);
            expect((yield* dockerSaid(['container', 'inspect', stranger], 'look for the look-alike')).code).toBe(0);
            expect((yield* world.store.byId(halfway))?.failureReason).toContain('did not finish');
            expect((yield* dockerSaid(['container', 'inspect', orphan.container], 'look for the orphan')).code).not.toBe(0);
            expect((yield* world.store.byId(record.id))?.state).toBe('prepared');
            expect((yield* dockerSaid(['container', 'inspect', record.runtime.container], 'look for the prepared guest')).code).toBe(0);
          }).pipe(Effect.provide(world.context)),
        ),
      60_000,
    );
  });
});
