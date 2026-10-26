import { Schema } from 'effect';
import { EmptyTree, GuestLimits, ProjectSnapshot, SandboxImage } from './sandbox.js';

export const PreparationNetwork = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('none') }),
  Schema.Struct({
    kind: Schema.Literal('https'),
    hosts: Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMinLength(1)),
  }),
]);
export type PreparationNetwork = typeof PreparationNetwork.Type;

export const PreparedTreeSource = Schema.Union([ProjectSnapshot, EmptyTree]);
export type PreparedTreeSource = typeof PreparedTreeSource.Type;

export const PreparedTarget = Schema.Struct({
  image: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  platform: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
});
export type PreparedTarget = typeof PreparedTarget.Type;

export const PreparedTreeRecipe = Schema.Struct({
  source: PreparedTreeSource,
  limits: GuestLimits,
  target: PreparedTarget,
  network: PreparationNetwork,
  exclude: Schema.optional(Schema.Array(Schema.String)),
  setup: Schema.optional(Schema.Array(Schema.Array(Schema.String))),
  readiness: Schema.optional(Schema.Array(Schema.Array(Schema.String))),
  dependencies: Schema.optional(Schema.Array(Schema.String)),
});
export type PreparedTreeRecipe = typeof PreparedTreeRecipe.Type;

export const ReadinessAnswer = Schema.Struct({
  command: Schema.Array(Schema.String),
  code: Schema.Int,
  output: Schema.String,
});
export type ReadinessAnswer = typeof ReadinessAnswer.Type;

export const PreparedTreeManifest = Schema.Struct({
  source: PreparedTreeSource,
  snapshotDigest: Schema.String,
  exclusions: Schema.Array(Schema.String),
  image: SandboxImage,
  platform: Schema.String,
  network: PreparationNetwork,
  setup: Schema.Array(Schema.Array(Schema.String)),
  readiness: Schema.Array(Schema.Array(Schema.String)),
  readinessResults: Schema.Array(ReadinessAnswer),
  dependencies: Schema.Array(Schema.String),
  dependencyDigest: Schema.String,
  limits: GuestLimits,
  archiveDigest: Schema.String,
  archiveBytes: Schema.Int,
  builtAt: Schema.String,
});
export type PreparedTreeManifest = typeof PreparedTreeManifest.Type;

export const PreparationReceipt = Schema.Union([
  Schema.Struct({
    backend: Schema.Literal('docker'),
    container: Schema.String,
    volume: Schema.String,
    network: Schema.NullOr(Schema.String),
    proxy: Schema.NullOr(Schema.String),
    check: Schema.String,
  }),
]);
export type PreparationReceipt = typeof PreparationReceipt.Type;

export const PREPARED_TREE_STATES = ['building', 'ready', 'failed', 'releasing', 'released'] as const;
export type PreparedTreeState = (typeof PREPARED_TREE_STATES)[number];

export type PreparedTreeRecord = {
  readonly id: string;
  readonly projectId: number | null;
  readonly ownerId: string;
  readonly state: PreparedTreeState;
  readonly receipt: PreparationReceipt;
  readonly manifest: PreparedTreeManifest | null;
  readonly archivePath: string | null;
  readonly resourcesReleased: boolean;
  readonly cleanupReason: string | null;
  readonly failureReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type PreparedTreeReconciliation = {
  readonly engine: 'read' | 'unreachable' | 'unasked';
  readonly checked: number;
  readonly cleaned: readonly string[];
  readonly retained: readonly { readonly preparedTree: string; readonly reason: string }[];
  readonly released: readonly string[];
};
