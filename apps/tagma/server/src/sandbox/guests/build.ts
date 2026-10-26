import { createHash } from 'node:crypto';
import { Clock, Effect } from 'effect';
import type {
  EmptyTree,
  ProjectSnapshot,
  SandboxManifest,
  SandboxPreparation,
  SandboxRecord,
  SandboxSource,
} from '../contract/wire/sandbox.js';
import type { GuestBackend } from '../contract/service/backends.js';
import type { PreparedTrees } from '../contract/service/preparedTrees.js';
import { SandboxUnavailable } from '../contract/service/sandboxes.js';
import { ALWAYS_EXCLUDED, snapshotInto } from '../trees/snapshot.js';

const EMPTY_TREE_DIGEST = createHash('sha256').digest('hex');
const NO_PROJECT = -1;

export const buildGuest = Effect.fn('sandbox.buildGuest')(function* (
  row: SandboxRecord,
  request: SandboxPreparation,
  runtime: GuestBackend,
  preparedTrees: PreparedTrees['Service'],
  checkoutOf: (projectId: number) => Effect.Effect<string, Error>,
) {
  if (request.source.kind === 'prepared') return yield* copyGuest(row, request, request.source.preparedTree, runtime, preparedTrees);
  const source = request.source;
  const identity = yield* runtime.identity();
  yield* runtime.create(row.runtime, { sandbox: row.id, limits: request.limits }, identity.image);
  const exclusions = [...ALWAYS_EXCLUDED, ...(request.exclude ?? [])];
  const snapshotDigest = yield* snapshotGuest(row, source, exclusions, runtime, checkoutOf);
  return yield* settleGuest(row, request, runtime, {
    source,
    snapshotDigest,
    exclusions,
    image: identity.image,
    platform: identity.platform,
  });
});

const copyGuest = Effect.fn('sandbox.copyGuest')(function* (
  row: SandboxRecord,
  request: SandboxPreparation,
  artifact: string,
  runtime: GuestBackend,
  preparedTrees: PreparedTrees['Service'],
) {
  const seed = yield* preparedTrees
    .acquire(artifact, { ownerId: row.ownerId, projectId: row.projectId ?? NO_PROJECT })
    .pipe(
      Effect.mapError((failure) =>
        failure._tag === 'PreparedTreeUnavailable' ? new SandboxUnavailable({ sandbox: row.id, reason: failure.message }) : failure,
      ),
    );
  yield* runtime.create(row.runtime, { sandbox: row.id, limits: request.limits }, seed.manifest.image);
  yield* runtime.unpack(row.runtime, seed.archive);
  return yield* settleGuest(row, request, runtime, {
    source: { kind: 'prepared', preparedTree: artifact },
    snapshotDigest: seed.manifest.archiveDigest,
    exclusions: seed.manifest.exclusions,
    image: seed.manifest.image,
    platform: seed.manifest.platform,
  });
}, Effect.scoped);

const settleGuest = Effect.fn('sandbox.settleGuest')(function* (
  row: SandboxRecord,
  request: SandboxPreparation,
  runtime: GuestBackend,
  tree: {
    readonly source: SandboxSource;
    readonly snapshotDigest: string;
    readonly exclusions: readonly string[];
    readonly image: SandboxManifest['image'];
    readonly platform: string;
  },
): Effect.fn.Return<SandboxManifest, SandboxUnavailable> {
  const setup = request.setup ?? [];
  for (const transform of setup) {
    const ran = yield* runtime.run(row.runtime, transform);
    if (ran.code !== 0) {
      return yield* new SandboxUnavailable({
        sandbox: row.id,
        reason: `the preparation transform ${transform.join(' ')} failed: ${ran.output.trim()}`,
      });
    }
  }
  const dependencies = request.dependencies ?? [];
  const dependencyDigest = yield* digestInputs(row, dependencies, setup, runtime);
  yield* runtime.stop(row.runtime);
  return {
    source: tree.source,
    snapshotDigest: tree.snapshotDigest,
    exclusions: tree.exclusions,
    image: tree.image,
    platform: tree.platform,
    dependencyDigest,
    dependencies,
    setup,
    limits: request.limits,
    preparedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
  };
});

const snapshotGuest = Effect.fnUntraced(function* (
  row: SandboxRecord,
  source: ProjectSnapshot | EmptyTree,
  exclusions: readonly string[],
  runtime: GuestBackend,
  checkoutOf: (projectId: number) => Effect.Effect<string, Error>,
) {
  if (source.kind === 'empty') return EMPTY_TREE_DIGEST;
  const checkout = yield* checkoutOf(source.projectId).pipe(
    Effect.mapError((failure) => new SandboxUnavailable({ sandbox: row.id, reason: `its project could not be read: ${failure.message}` })),
  );
  return yield* snapshotInto({ checkout, commit: source.commit, exclusions }, (archive) => runtime.unpack(row.runtime, archive)).pipe(
    Effect.mapError((failure) =>
      failure._tag === 'SandboxUnavailable' ? failure : new SandboxUnavailable({ sandbox: row.id, reason: failure.message }),
    ),
  );
});

const digestInputs = Effect.fnUntraced(function* (
  row: SandboxRecord,
  dependencies: readonly string[],
  setup: readonly (readonly string[])[],
  runtime: GuestBackend,
) {
  const digest = createHash('sha256').update(JSON.stringify(setup));
  if (dependencies.length === 0) return digest.digest('hex');
  const said = yield* runtime.run(row.runtime, ['sha256sum', '--', ...dependencies]);
  if (said.code !== 0) {
    return yield* new SandboxUnavailable({
      sandbox: row.id,
      reason: `its declared dependency inputs are not in the prepared tree: ${said.output.trim()}`,
    });
  }
  return digest.update(said.output).digest('hex');
});
