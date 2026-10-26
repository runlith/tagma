import { Schema } from 'effect';

export const GuestLimits = Schema.Struct({
  pids: Schema.Int,
  memory: Schema.String,
  cpus: Schema.String,
});
export type GuestLimits = typeof GuestLimits.Type;

export const SandboxImage = Schema.Struct({
  reference: Schema.String,
  digest: Schema.String,
  revision: Schema.String,
});
export type SandboxImage = typeof SandboxImage.Type;

export const ProjectSnapshot = Schema.Struct({
  kind: Schema.Literal('project'),
  projectId: Schema.Int,
  commit: Schema.String,
});
export type ProjectSnapshot = typeof ProjectSnapshot.Type;

export const EmptyTree = Schema.Struct({ kind: Schema.Literal('empty') });
export type EmptyTree = typeof EmptyTree.Type;

export const PreparedSeed = Schema.Struct({ kind: Schema.Literal('prepared'), preparedTree: Schema.String });
export type PreparedSeed = typeof PreparedSeed.Type;

export const SandboxSource = Schema.Union([ProjectSnapshot, EmptyTree, PreparedSeed]);
export type SandboxSource = typeof SandboxSource.Type;

export const GuestReceipt = Schema.Union([
  Schema.Struct({ backend: Schema.Literal('docker'), container: Schema.String, volume: Schema.String }),
]);
export type GuestReceipt = typeof GuestReceipt.Type;

export const SandboxManifest = Schema.Struct({
  source: SandboxSource,
  snapshotDigest: Schema.String,
  exclusions: Schema.Array(Schema.String),
  image: SandboxImage,
  platform: Schema.String,
  dependencyDigest: Schema.String,
  dependencies: Schema.Array(Schema.String),
  setup: Schema.Array(Schema.Array(Schema.String)),
  limits: GuestLimits,
  preparedAt: Schema.String,
});
export type SandboxManifest = typeof SandboxManifest.Type;

export const SANDBOX_STATES = ['preparing', 'prepared', 'releasing', 'failed', 'released'] as const;
export type SandboxState = (typeof SANDBOX_STATES)[number];

export type SandboxRecord = {
  readonly id: string;
  readonly projectId: number | null;
  readonly ownerId: string;
  readonly state: SandboxState;
  readonly boundThreadId: string | null;
  readonly runtime: GuestReceipt;
  readonly manifest: SandboxManifest | null;
  readonly failureReason: string | null;
  readonly exportPath: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export const SandboxPreparation = Schema.Struct({
  source: SandboxSource,
  limits: GuestLimits,
  exclude: Schema.optional(Schema.Array(Schema.String)),
  setup: Schema.optional(Schema.Array(Schema.Array(Schema.String))),
  dependencies: Schema.optional(Schema.Array(Schema.String)),
});
export type SandboxPreparation = typeof SandboxPreparation.Type;

export type SandboxExport = {
  readonly sandbox: string;
  readonly path: string;
};

export type SandboxReconciliation = {
  readonly engine: 'read' | 'unreachable' | 'unasked';
  readonly checked: number;
  readonly failed: readonly string[];
  readonly removed: readonly string[];
};
