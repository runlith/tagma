import type { Effect, PlatformError, Scope, Stream } from 'effect';
import type { PreparationNetwork, PreparationReceipt, PreparedTarget, ReadinessAnswer } from '../wire/preparedTree.js';
import type { GuestLimits, SandboxImage, GuestReceipt as Receipt } from '../wire/sandbox.js';
import type { SandboxWorld } from './guests.js';
import type { PreparedTreeUnavailable } from './preparedTrees.js';
import type { SandboxUnavailable } from './sandboxes.js';

export type TreeArchive = Stream.Stream<Uint8Array, PlatformError.PlatformError>;

export type ArchiveSeal = {
  readonly digest: string;
  readonly bytes: number;
};

export type GuestPlan = {
  readonly sandbox: string;
  readonly limits: GuestLimits;
};

export type GuestIdentity = {
  readonly image: SandboxImage;
  readonly platform: string;
};

export type GuestState = {
  readonly status: 'running' | 'stopped' | 'gone';
  readonly image: string | null;
  readonly mismatch: string | null;
};

export type GuestExpectation = {
  readonly limits: GuestLimits;
  readonly image: SandboxImage;
};

export type GuestBackend = {
  readonly backend: Receipt['backend'];
  receipt(sandbox: string): Receipt;
  identity(): Effect.Effect<GuestIdentity, SandboxUnavailable>;
  create(receipt: Receipt, plan: GuestPlan, image: SandboxImage): Effect.Effect<void, SandboxUnavailable>;
  unpack(receipt: Receipt, archive: TreeArchive): Effect.Effect<void, SandboxUnavailable>;
  run(receipt: Receipt, argv: readonly string[]): Effect.Effect<{ code: number; output: string }, SandboxUnavailable>;
  stop(receipt: Receipt): Effect.Effect<void, SandboxUnavailable>;
  inspect(receipt: Receipt, expected?: GuestExpectation): Effect.Effect<GuestState, SandboxUnavailable>;
  start(receipt: Receipt): Effect.Effect<void, SandboxUnavailable>;
  world(receipt: Receipt): Effect.Effect<SandboxWorld, SandboxUnavailable, Scope.Scope>;
  sealedWorld(receipt: Receipt, image: SandboxImage): Effect.Effect<SandboxWorld, SandboxUnavailable, Scope.Scope>;
  export(receipt: Receipt, into: string): Effect.Effect<void, SandboxUnavailable>;
  remove(receipt: Receipt): Effect.Effect<void, SandboxUnavailable>;
  receipts(): Effect.Effect<readonly Receipt[] | null, SandboxUnavailable>;
};

export type PreparationPlan = {
  readonly build: string;
  readonly limits: GuestLimits;
  readonly network: PreparationNetwork;
  readonly image: SandboxImage;
};

export type PreparationBackend = {
  readonly backend: PreparationReceipt['backend'];
  receipt(build: string): PreparationReceipt;
  target(wanted: PreparedTarget): Effect.Effect<GuestIdentity, PreparedTreeUnavailable>;
  open(receipt: PreparationReceipt, plan: PreparationPlan): Effect.Effect<void, PreparedTreeUnavailable>;
  unpack(receipt: PreparationReceipt, archive: TreeArchive): Effect.Effect<void, PreparedTreeUnavailable>;
  run(receipt: PreparationReceipt, argv: readonly string[]): Effect.Effect<{ code: number; output: string }, PreparedTreeUnavailable>;
  revoke(receipt: PreparationReceipt): Effect.Effect<void, PreparedTreeUnavailable>;
  seal(receipt: PreparationReceipt, into: string): Effect.Effect<ArchiveSeal, PreparedTreeUnavailable>;
  check(
    receipt: PreparationReceipt,
    plan: PreparationPlan,
    archive: TreeArchive,
    commands: readonly (readonly string[])[],
  ): Effect.Effect<readonly ReadinessAnswer[], PreparedTreeUnavailable>;
  close(receipt: PreparationReceipt): Effect.Effect<void, PreparedTreeUnavailable>;
  receipts(): Effect.Effect<readonly PreparationReceipt[] | null, PreparedTreeUnavailable>;
};
