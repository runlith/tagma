import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Deferred, Effect, Exit, Fiber, Scope } from 'effect';
import { fixtureHome } from '../../platform/testing/roots.js';
import type { PreparationBackend } from '../contract/service/backends.js';
import type { PreparedTreeRecord } from '../contract/wire/preparedTree.js';
import type { PreparedTreeStore } from '../store/preparedTrees.js';
import { makePreparedTrees } from './preparedTrees.js';

const unused = Effect.die('releasing a tree reads its record and closes its resources');
const preparation: PreparationBackend = {
  backend: 'docker',
  receipt: () => {
    throw new Error('this tree already carries its receipt');
  },
  target: () => unused,
  open: () => unused,
  unpack: () => unused,
  run: () => unused,
  revoke: () => unused,
  seal: () => unused,
  check: () => unused,
  close: () => Effect.void,
  receipts: () => unused,
};

it.live.each(['failure', 'interruption'] as const)(
  'a copy stopped by %s releases only its own hold while another copy keeps the tree',
  (mode) =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(fixtureHome(), 'prepared-copy-'))),
        (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
      );
      let row: PreparedTreeRecord = {
        id: 'tree',
        projectId: 5,
        ownerId: 'owner',
        state: 'ready',
        receipt: { backend: 'docker', container: 'tree', volume: 'tree', network: null, proxy: null, check: 'check' },
        manifest: {
          source: { kind: 'empty' },
          snapshotDigest: 'source',
          exclusions: [],
          image: { reference: 'fixture', digest: 'sha256:fixture', revision: 'fixture' },
          platform: 'linux/arm64',
          network: { kind: 'none' },
          setup: [],
          readiness: [],
          readinessResults: [],
          dependencies: [],
          dependencyDigest: 'inputs',
          limits: { pids: 64, memory: '1g', cpus: '1' },
          archiveDigest: 'archive',
          archiveBytes: 0,
          builtAt: '1970-01-01T00:00:00.000Z',
        },
        archivePath: join(root, 'tree.tar'),
        resourcesReleased: false,
        cleanupReason: null,
        failureReason: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      };
      let unavailable = false;
      const opened = yield* Deferred.make<void>();
      const store: PreparedTreeStore = {
        byId: () =>
          unavailable
            ? mode === 'failure'
              ? Effect.fail(new ThreadStorageFailed({ call: 'byId', cause: 'the registry is temporarily unavailable' }))
              : Deferred.succeed(opened, undefined).pipe(Effect.andThen(Effect.never))
            : Effect.succeed(row),
        open: () => unused,
        sealed: () => unused,
        ready: () => unused,
        failed: () => unused,
        cleaned: () =>
          Effect.sync(() => {
            row = { ...row, resourcesReleased: true };
            return true;
          }),
        cleanupFailed: () => unused,
        releasing: () =>
          Effect.sync(() => {
            row = { ...row, state: 'releasing' };
            return true;
          }),
        failedRelease: () => unused,
        released: () =>
          Effect.sync(() => {
            row = { ...row, state: 'released', archivePath: null };
            return true;
          }),
        standing: () => unused,
      };
      const trees = makePreparedTrees({ store, preparation, checkoutOf: () => unused, storageRoot: root });
      const retained = yield* Scope.fork(yield* Effect.scope);
      const copy = trees.acquire('tree', { projectId: 5, ownerId: 'owner' });
      yield* Scope.provide(copy, retained);
      unavailable = true;
      if (mode === 'failure') {
        const refused = yield* Effect.result(Effect.scoped(copy));
        expect(refused._tag).toBe('Failure');
        if (refused._tag === 'Failure') expect(refused.failure._tag).toBe('ThreadStorageFailed');
      } else {
        const running = yield* Effect.forkScoped(Effect.scoped(copy));
        yield* Deferred.await(opened);
        yield* Fiber.interrupt(running);
      }
      unavailable = false;
      const held = yield* Effect.result(trees.release('tree'));
      expect(held._tag).toBe('Failure');
      if (held._tag === 'Failure') expect(held.failure).toMatchObject({ _tag: 'PreparedTreeHeldConflict', copies: 1 });
      yield* Scope.close(retained, Exit.void);
      expect((yield* trees.release('tree')).state).toBe('released');
    }),
);
