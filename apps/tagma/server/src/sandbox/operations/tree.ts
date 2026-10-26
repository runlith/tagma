import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { Effect } from 'effect';
import { ChangeScope } from '../../change-record/contract/service/scope.js';
import { routed } from '../../platform/contract/service/routed.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { GateRefusal, type Unblock } from '../../platform/contract/wire/refusal.js';
import { GraphDirectory } from '../../workspace/contract/service/checkouts.js';
import { GuestPreparation } from '../contract/service/preparation.js';
import { PreparedTrees, PreparedTreeHeldConflict, PreparedTreeUnavailable } from '../contract/service/preparedTrees.js';
import { SANDBOX_OPERATIONS as OPS } from '../contract/wire/operations/catalog.js';
import type { PreparedTreeRecord } from '../contract/wire/preparedTree.js';
import { DEFAULT_GUEST_LIMITS, principalOf, SELECTION_WAYS, sourceConflict } from './shared.js';

const PREPARED_TREE_WAYS: Unblock = [
  'read the prepared tree: its state and its reason say what stopped it',
  'build a fresh prepared tree and name the id it answers with',
];

const NO_SUCH_PREPARED_TREE: Unblock = [
  'read this project’s prepared trees to see what stands and what this owner built',
  'build a prepared tree and name the id it answers with',
];

const overTree = <A>(
  work: Effect.Effect<A, PreparedTreeUnavailable | ThreadStorageFailed>,
): Effect.Effect<A, GateRefusal<'prepared-tree-unavailable'>> =>
  Effect.mapError(work, (failure) => new GateRefusal('prepared-tree-unavailable', failure.message, PREPARED_TREE_WAYS));

const overTreeRelease = <A>(
  work: Effect.Effect<A, PreparedTreeUnavailable | PreparedTreeHeldConflict | ThreadStorageFailed>,
): Effect.Effect<A, GateRefusal<'prepared-tree-unavailable' | 'prepared-tree-busy'>> =>
  Effect.mapError(work, (failure) =>
    failure._tag === 'PreparedTreeHeldConflict'
      ? new GateRefusal('prepared-tree-busy', failure.message, PREPARED_TREE_WAYS)
      : new GateRefusal('prepared-tree-unavailable', failure.message, PREPARED_TREE_WAYS),
  );

export function preparedTreeSummary(row: PreparedTreeRecord) {
  return {
    preparedTree: row.id,
    id: row.id,
    projectId: row.projectId,
    state: row.state,
    receipt: row.receipt,
    manifest: row.manifest,
    resourcesReleased: row.resourcesReleased,
    cleanupReason: row.cleanupReason,
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    source: row.manifest?.source ?? null,
    image: row.manifest?.image.reference ?? null,
    platform: row.manifest?.platform ?? null,
    network: row.manifest?.network ?? null,
    setup: row.manifest?.setup ?? null,
    readiness: row.manifest?.readinessResults ?? null,
    exclusions: row.manifest?.exclusions ?? null,
    dependencies: row.manifest?.dependencies ?? null,
    dependencyDigest: row.manifest?.dependencyDigest ?? null,
    snapshotDigest: row.manifest?.snapshotDigest ?? null,
    archiveDigest: row.manifest?.archiveDigest ?? null,
    archiveBytes: row.manifest?.archiveBytes ?? null,
    limits: row.manifest?.limits ?? null,
    builtAt: row.manifest?.builtAt ?? null,
  };
}

const preparedTreeWord = (row: ReturnType<typeof preparedTreeSummary>) => ({
  preparedTree: row.preparedTree,
  state: row.state,
  source: row.source,
  image: row.image,
  platform: row.platform,
  network: row.network,
  setup: row.setup,
  readiness: row.readiness,
  exclusions: row.exclusions,
  dependencies: row.dependencies,
  dependencyDigest: row.dependencyDigest,
  snapshotDigest: row.snapshotDigest,
  archiveDigest: row.archiveDigest,
  archiveBytes: row.archiveBytes,
  limits: row.limits,
  resourcesReleased: row.resourcesReleased,
  cleanupReason: row.cleanupReason,
  failureReason: row.failureReason,
  builtAt: row.builtAt,
});

export const recipeOf = (
  input: {
    readonly empty?: boolean | undefined;
    readonly exclude?: readonly string[] | undefined;
    readonly setup?: readonly (readonly string[])[] | undefined;
    readonly readiness?: readonly (readonly string[])[] | undefined;
    readonly dependencies?: readonly string[] | undefined;
    readonly network?: readonly string[] | undefined;
    readonly image?: string | undefined;
    readonly platform?: string | undefined;
    readonly limits?: { readonly pids: number; readonly memory: string; readonly cpus: string } | undefined;
  },
  graphDirectory: string,
) => ({
  limits: input.limits ?? DEFAULT_GUEST_LIMITS,
  network:
    input.network === undefined || input.network.length === 0
      ? ({ kind: 'none' } as const)
      : ({ kind: 'https', hosts: input.network } as const),
  target: {
    image: input.image,
    platform: input.platform,
  },
  exclude: (input.exclude ?? [graphDirectory]).map((path) => `:(exclude)${path}`),
  setup: input.setup,
  readiness: input.readiness,
  dependencies: input.dependencies,
});

const ownedPreparedTree = Effect.fn('preparedTree.owned')(function* (id: string, projectId: number, principal: string) {
  const row = yield* overTree((yield* PreparedTrees).byId(id));
  if (row === null || row.ownerId !== principal || (row.projectId !== null && row.projectId !== projectId)) {
    return yield* new GateRefusal('not-found', `no prepared tree ${id} stands in this project`, NO_SUCH_PREPARED_TREE);
  }
  return row;
});

export const TREE_ROUTED = {
  build_prepared_tree: routed(OPS.build_prepared_tree, {
    execute: Effect.fnUntraced(function* (input: (typeof OPS.build_prepared_tree)['input']['Type'], _prepared: undefined, caller: Caller) {
      const projectId = yield* (yield* ChangeScope).projectId;
      const conflict = sourceConflict(input);
      if (conflict !== null) return yield* new GateRefusal('selection-shape', conflict, SELECTION_WAYS);
      const preparedTrees = yield* PreparedTrees;
      const source = input.empty
        ? ({ kind: 'empty' } as const)
        : ({
            kind: 'project',
            projectId,
            commit: yield* overTree(
              (yield* GuestPreparation)
                .commitOf(projectId, input.commit ?? 'HEAD')
                .pipe(Effect.mapError((failure) => new PreparedTreeUnavailable({ preparedTree: failure.commit, reason: failure.reason }))),
            ),
          } as const);
      const record = yield* overTree(
        preparedTrees.build({ ...recipeOf(input, yield* GraphDirectory), source, ownerId: principalOf(caller) }),
      );
      return { status: 'built' as const, ...preparedTreeSummary(record) };
    }),
    answer: (value: { readonly status: 'built' } & ReturnType<typeof preparedTreeSummary>) => ({
      status: value.status,
      ...preparedTreeWord(value),
    }),
  }),

  read_prepared_tree: routed(OPS.read_prepared_tree, {
    execute: Effect.fnUntraced(function* (input: (typeof OPS.read_prepared_tree)['input']['Type'], _prepared: undefined, caller: Caller) {
      const projectId = yield* (yield* ChangeScope).projectId;
      const principal = principalOf(caller);
      if (input.id === undefined) {
        const rows = yield* overTree((yield* PreparedTrees).records());
        return {
          status: 'ok' as const,
          preparedTrees: rows
            .filter((row) => row.ownerId === principal && (row.projectId === null || row.projectId === projectId))
            .map(preparedTreeSummary),
        };
      }
      return {
        status: 'ok' as const,
        ...preparedTreeSummary(yield* ownedPreparedTree(input.id, projectId, principal)),
      };
    }),
    answer: (
      value:
        | { readonly status: 'ok'; readonly preparedTrees: readonly ReturnType<typeof preparedTreeSummary>[] }
        | ({ readonly status: 'ok'; readonly preparedTrees?: undefined } & ReturnType<typeof preparedTreeSummary>),
    ) =>
      value.preparedTrees === undefined
        ? { status: value.status, ...preparedTreeWord(value) }
        : { status: value.status, preparedTrees: value.preparedTrees.map(preparedTreeWord) },
  }),

  release_prepared_tree: routed(OPS.release_prepared_tree, {
    execute: Effect.fnUntraced(function* (
      input: (typeof OPS.release_prepared_tree)['input']['Type'],
      _prepared: undefined,
      caller: Caller,
    ) {
      const projectId = yield* (yield* ChangeScope).projectId;
      const row = yield* ownedPreparedTree(input.id, projectId, principalOf(caller));
      const released = yield* overTreeRelease((yield* PreparedTrees).release(row.id));
      return { status: 'released' as const, ...preparedTreeSummary(released) };
    }),
    answer: (value: { readonly status: 'released' } & ReturnType<typeof preparedTreeSummary>) => ({
      status: value.status,
      ...preparedTreeWord(value),
    }),
  }),
};
