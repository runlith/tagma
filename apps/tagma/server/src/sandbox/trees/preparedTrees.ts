import { createHash } from 'node:crypto';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Clock, Effect, FileSystem, Layer } from 'effect';
import { uuidv7 } from 'uuidv7';
import type { PreparedTreeRecipe, PreparedTreeRecord } from '../contract/wire/preparedTree.js';
import { PreparedTreeHeldConflict, PreparedTreeUnavailable, PreparedTrees } from '../contract/service/preparedTrees.js';
import { archiveBytes } from './archive.js';
import type { PreparationBackend, PreparationPlan } from '../contract/service/backends.js';
import type { PreparedTreeStore } from '../store/preparedTrees.js';
import { ALWAYS_EXCLUDED, snapshotInto } from './snapshot.js';

const hostFiles = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

export const makePreparedTrees = (input: {
  readonly store: PreparedTreeStore;
  readonly preparation: PreparationBackend;
  readonly checkoutOf: (projectId: number) => Effect.Effect<string, Error>;
  readonly storageRoot: string;
}): PreparedTrees['Service'] => {
  const { store, preparation, checkoutOf, storageRoot } = input;
  const copying = new Map<string, number>();

  const refuseCopy = (id: string, reason: string) => new PreparedTreeUnavailable({ preparedTree: id, reason });

  const drop = (id: string): void => {
    const held = (copying.get(id) ?? 1) - 1;
    if (held <= 0) copying.delete(id);
    else copying.set(id, held);
  };

  const checkout = (named: string, projectId: number) =>
    checkoutOf(projectId).pipe(
      Effect.mapError(
        (failure) =>
          new PreparedTreeUnavailable({
            preparedTree: named,
            reason: `its project could not be read: ${failure.message}`,
          }),
      ),
    );

  const snapshot = Effect.fnUntraced(function* (row: PreparedTreeRecord, recipe: PreparedTreeRecipe, exclusions: readonly string[]) {
    const source = recipe.source;
    if (source.kind === 'empty') return EMPTY_TREE_DIGEST;

    const sourceRoot = yield* checkout(row.id, source.projectId);
    return yield* snapshotInto({ checkout: sourceRoot, commit: source.commit, exclusions }, (archive) =>
      preparation.unpack(row.receipt, archive),
    ).pipe(
      Effect.catch((failure) =>
        failure._tag === 'PreparedTreeUnavailable'
          ? Effect.fail(failure)
          : Effect.fail(new PreparedTreeUnavailable({ preparedTree: row.id, reason: failure.message })),
      ),
    );
  });

  const dependencyDigest = Effect.fnUntraced(function* (
    row: PreparedTreeRecord,
    dependencies: readonly string[],
    setup: readonly (readonly string[])[],
  ) {
    const digest = createHash('sha256').update(JSON.stringify(setup));
    if (dependencies.length === 0) return digest.digest('hex');
    const said = yield* preparation.run(row.receipt, ['sha256sum', '--', ...dependencies]);
    if (said.code !== 0) {
      return yield* new PreparedTreeUnavailable({
        preparedTree: row.id,
        reason: `its declared dependency inputs are not in the built tree: ${said.output.trim()}`,
      });
    }
    return digest.update(said.output).digest('hex');
  });

  const placeArchive = (row: PreparedTreeRecord) => {
    const home = `${storageRoot}/${row.id}`;
    return Effect.flatMap(FileSystem.FileSystem, (files) => files.makeDirectory(home, { recursive: true })).pipe(
      Effect.provide(hostFiles),
      Effect.mapError(
        (cause) =>
          new PreparedTreeUnavailable({
            preparedTree: row.id,
            reason: `its archive could not be given a place: ${cause.message}`,
          }),
      ),
      Effect.as({ partial: `${home}/tree.tar.partial`, sealed: `${home}/tree.tar` }),
    );
  };

  const publish = (row: PreparedTreeRecord, at: { partial: string; sealed: string }) =>
    Effect.flatMap(FileSystem.FileSystem, (files) => files.rename(at.partial, at.sealed)).pipe(
      Effect.provide(hostFiles),
      Effect.mapError(
        (cause) =>
          new PreparedTreeUnavailable({
            preparedTree: row.id,
            reason: `its sealed tree could not be published: ${cause.message}`,
          }),
      ),
    );

  const make = Effect.fnUntraced(function* (row: PreparedTreeRecord, recipe: PreparedTreeRecipe) {
    const target = yield* preparation.target(recipe.target);
    const plan: PreparationPlan = {
      build: row.id,
      limits: recipe.limits,
      network: recipe.network,
      image: target.image,
    };
    yield* preparation.open(row.receipt, plan);
    const exclusions = [...ALWAYS_EXCLUDED, ...(recipe.exclude ?? [])];
    const snapshotDigest = yield* snapshot(row, recipe, exclusions);
    const setup = recipe.setup ?? [];
    for (const command of setup) {
      const ran = yield* preparation.run(row.receipt, command);
      if (ran.code !== 0) {
        return yield* new PreparedTreeUnavailable({
          preparedTree: row.id,
          reason: `the setup command ${command.join(' ')} failed: ${ran.output.trim()}`,
        });
      }
    }
    const dependencies = recipe.dependencies ?? [];
    const inputsDigest = yield* dependencyDigest(row, dependencies, setup);
    yield* preparation.revoke(row.receipt);
    const archivePath = yield* placeArchive(row);
    const seal = yield* preparation.seal(row.receipt, archivePath.partial);
    yield* publish(row, archivePath);
    yield* store.sealed(row.id, archivePath.sealed);
    const readiness = recipe.readiness ?? [];
    const readinessResults =
      readiness.length === 0 ? [] : yield* preparation.check(row.receipt, plan, archiveBytes(archivePath.sealed), readiness);
    const refused = readinessResults.find((result) => result.code !== 0);
    if (refused !== undefined) {
      return yield* new PreparedTreeUnavailable({
        preparedTree: row.id,
        reason: `the readiness command ${refused.command.join(' ')} failed in an offline copy: ${refused.output}`,
      });
    }
    return {
      source: recipe.source,
      snapshotDigest,
      exclusions,
      image: target.image,
      platform: target.platform,
      network: recipe.network,
      setup,
      readiness,
      readinessResults,
      dependencies,
      dependencyDigest: inputsDigest,
      limits: recipe.limits,
      archiveDigest: seal.digest,
      archiveBytes: seal.bytes,
      builtAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    };
  });

  const finishRelease = Effect.fn('PreparedTrees.finishRelease')(function* (row: PreparedTreeRecord) {
    const copies = copying.get(row.id) ?? 0;
    if (copies > 0) return yield* new PreparedTreeHeldConflict({ preparedTree: row.id, copies });
    yield* Effect.flatMap(FileSystem.FileSystem, (files) =>
      files.remove(`${storageRoot}/${row.id}`, { recursive: true, force: true }),
    ).pipe(
      Effect.provide(hostFiles),
      Effect.mapError(
        (cause) =>
          new PreparedTreeUnavailable({
            preparedTree: row.id,
            reason: `its sealed tree could not be removed: ${cause.message}`,
          }),
      ),
    );
    yield* preparation.close(row.receipt);
    yield* store.cleaned(row.id);
    yield* store.released(row.id);
    return yield* Effect.map(store.byId(row.id), (fresh) => fresh ?? row);
  });

  const sweep = (row: PreparedTreeRecord) =>
    preparation.close(row.receipt).pipe(
      Effect.flatMap(() => Effect.as(store.cleaned(row.id), null)),
      Effect.tapError((failure) => Effect.logWarning(`the build ${row.id} left resources standing`, failure)),
      Effect.catch((failure) =>
        failure._tag === 'ThreadStorageFailed'
          ? Effect.fail(failure)
          : Effect.as(store.cleanupFailed(row.id, failure.message), failure.message),
      ),
    );

  return PreparedTrees.of({
    build: Effect.fn('PreparedTrees.build')(function* (request) {
      const id = uuidv7();
      const receipt = preparation.receipt(id);
      const opened = yield* store.open({
        id,
        projectId: request.source.kind === 'project' ? request.source.projectId : null,
        ownerId: request.ownerId,
        receipt,
      });
      const manifest = yield* make(opened, request).pipe(
        Effect.tapError((failure) => store.failed(id, failure.message).pipe(Effect.andThen(sweep(opened)))),
      );
      const published = yield* store.ready(id, manifest);
      if (!published) {
        return yield* new PreparedTreeUnavailable({
          preparedTree: id,
          reason: 'it was released or failed while its build was finishing, so nothing was published',
        });
      }
      yield* sweep(opened);
      return yield* Effect.map(store.byId(id), (row) => row ?? opened);
    }),

    byId: store.byId,

    records: store.standing,

    acquire: Effect.fn('PreparedTrees.acquire')(function* (id, owner) {
      let held = false;
      const relinquish = Effect.sync(() => {
        if (!held) return;
        held = false;
        drop(id);
      });
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          copying.set(id, (copying.get(id) ?? 0) + 1);
          held = true;
        }),
        () => relinquish,
      );
      return yield* Effect.gen(function* () {
        const row = yield* store.byId(id);
        if (row === null) return yield* refuseCopy(id, 'no such prepared tree');
        if (row.ownerId !== owner.ownerId) return yield* refuseCopy(id, 'it was built by another owner');
        if (row.projectId !== null && row.projectId !== owner.projectId) {
          return yield* refuseCopy(id, `it was built for project ${row.projectId}`);
        }
        if (row.state !== 'ready') {
          return yield* refuseCopy(id, `it is ${row.state}${row.failureReason ? `: ${row.failureReason}` : ''}`);
        }
        const { manifest, archivePath } = row;
        if (manifest === null || archivePath === null) {
          return yield* refuseCopy(id, 'it carries no sealed tree');
        }
        return { record: row, manifest, archive: archiveBytes(archivePath) };
      }).pipe(Effect.onError(() => relinquish));
    }),

    release: Effect.fn('PreparedTrees.release')(function* (id) {
      const row = yield* store.byId(id);
      if (!row) return yield* new PreparedTreeUnavailable({ preparedTree: id, reason: 'no such prepared tree' });
      if (row.state === 'released') return row;
      const took = yield* store.releasing(id);
      if (!took) {
        return yield* new PreparedTreeUnavailable({
          preparedTree: id,
          reason: 'it was released while this release was being written',
        });
      }
      return yield* finishRelease({ ...row, state: 'releasing' });
    }),

    condemnUnfinished: Effect.fn('PreparedTrees.condemnUnfinished')(function* () {
      const failed: string[] = [];
      for (const row of yield* store.standing()) {
        if (row.state !== 'building') continue;
        yield* store.failed(row.id, 'its build did not finish before this process ended');
        failed.push(row.id);
      }
      return failed;
    }),

    reconcile: Effect.fn('PreparedTrees.reconcile')(function* () {
      const rows = yield* store.standing();
      if (rows.length === 0) {
        return { engine: 'unasked' as const, checked: 0, cleaned: [], retained: [], released: [] };
      }
      const inventory = yield* preparation.receipts().pipe(
        Effect.match({
          onFailure: () => ({ engine: 'unreachable' as const, standing: null }),
          onSuccess: (standing) => ({ engine: standing === null ? ('unreachable' as const) : ('read' as const), standing }),
        }),
      );
      const standing = inventory.standing;
      if (standing === null) {
        return {
          engine: inventory.engine,
          checked: rows.length,
          cleaned: [],
          retained: [],
          released: [],
        };
      }
      const cleaned: string[] = [];
      const retained: { preparedTree: string; reason: string }[] = [];
      const released: string[] = [];
      for (const row of rows) {
        if (row.state === 'releasing') {
          const done = yield* finishRelease(row).pipe(
            Effect.map(() => true),
            Effect.catch((failure) =>
              failure._tag === 'ThreadStorageFailed'
                ? Effect.fail(failure)
                : store.failedRelease(row.id, failure.message).pipe(Effect.as(false)),
            ),
          );
          if (done) released.push(row.id);
          continue;
        }
        if (!row.resourcesReleased) {
          const refused = yield* sweep(row);
          if (refused === null) cleaned.push(row.id);
          else retained.push({ preparedTree: row.id, reason: refused });
        }
      }
      const known = new Set(rows.map((row) => row.receipt.container));
      for (const receipt of standing) {
        if (known.has(receipt.container)) continue;
        yield* preparation.close(receipt).pipe(
          Effect.match({
            onSuccess: () => {
              cleaned.push(receipt.container);
            },
            onFailure: (failure) => {
              retained.push({ preparedTree: receipt.container, reason: failure.message });
            },
          }),
        );
      }
      return { engine: 'read' as const, checked: rows.length, cleaned, retained, released };
    }),
  });
};

const EMPTY_TREE_DIGEST = createHash('sha256').digest('hex');
