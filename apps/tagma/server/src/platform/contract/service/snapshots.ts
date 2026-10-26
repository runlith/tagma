import { Context, Data, type Effect } from 'effect';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import type { MigrationLoad } from '../wire/migrationLoad.js';
import type { Words } from '../wire/refusal.js';

export class SnapshotFailed extends Data.TaggedError('SnapshotFailed')<{
  readonly path: string;
  readonly reason: string;
  readonly words?: Words;
}> {
  override get message(): string {
    return `${this.path}: ${this.reason}`;
  }
}

export type SnapshotStore = {
  readonly path: string;
  readonly db: EffectSQLiteBunDatabase;
};

export type SnapshotScope = SnapshotStore & {
  readonly tables: readonly string[];
};

export type SnapshotCapture = SnapshotScope & {
  readonly snapshot: string;
  readonly directory: string;
};

export type SnapshotRestore = SnapshotScope & {
  readonly snapshot: string;
  readonly directory: string;
  readonly quarantine: string;
  readonly record: unknown;
  readonly report: (loss: { readonly table: string; readonly key: string; readonly reason: string }) => void;
  readonly acceptedLosses: readonly string[];
  readonly registerPublication: (work: Effect.Effect<void, SnapshotFailed>) => void;
};

export type SnapshotParticipant = {
  readonly tables: readonly string[];
  readonly estimate?: (
    store: SnapshotScope,
  ) => Effect.Effect<{ readonly bytes: number | null; readonly hashPasses: number | null }, SnapshotFailed>;
  readonly witness?: (store: SnapshotScope) => Effect.Effect<string, SnapshotFailed>;
  readonly prepare?: (store: SnapshotScope) => Effect.Effect<void, SnapshotFailed>;
  readonly record?: (store: SnapshotCapture) => Effect.Effect<unknown, SnapshotFailed>;
  readonly scrub?: (store: SnapshotScope) => Effect.Effect<void, SnapshotFailed>;
  readonly restore?: (store: SnapshotRestore) => Effect.Effect<void, SnapshotFailed>;
};

export type SnapshotHome = { readonly machine: string; readonly credentials: string };

export type SnapshotMigration = { readonly name: string; readonly hash: string; readonly sql: readonly string[] };
export type SnapshotLoss = { readonly owner: string; readonly table: string; readonly key: string; readonly reason: string };
export type SnapshotAnswer = { readonly snapshot: string; readonly quarantine: string; readonly losses: readonly SnapshotLoss[] };

export class StoreSnapshots extends Context.Service<
  StoreSnapshots,
  {
    readonly estimate: (
      store: SnapshotStore,
      pending: readonly SnapshotMigration[],
      folder: string,
    ) => Effect.Effect<MigrationLoad | null, SnapshotFailed>;
    readonly take: (store: SnapshotStore, pending: readonly SnapshotMigration[]) => Effect.Effect<void, SnapshotFailed>;
    readonly restore: (
      path: string,
      options?: { readonly acceptLoss?: readonly string[] },
    ) => Effect.Effect<SnapshotAnswer, SnapshotFailed>;
    readonly standing: (path: string) => Effect.Effect<boolean, SnapshotFailed>;
    readonly covers: (path: string, table: string) => Effect.Effect<boolean, SnapshotFailed>;
    readonly release: (path: string, migrations?: readonly string[]) => Effect.Effect<readonly string[], SnapshotFailed>;
    readonly sweep: (path: string) => Effect.Effect<void, SnapshotFailed>;
    readonly opened: (store: SnapshotStore) => Effect.Effect<void, SnapshotFailed>;
    readonly ready: Effect.Effect<void, SnapshotFailed>;
  }
>()('tagma/platform/StoreSnapshots') {}
