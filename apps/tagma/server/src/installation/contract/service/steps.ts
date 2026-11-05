import { Context, type Effect } from 'effect';
import type { SnapshotFailed, SnapshotLoss } from '../../../platform/contract/service/snapshots.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { InstallFailed, McpDeclarationWrite } from '../wire/install.js';
import type { RestartHost } from '../wire/source.js';
import type { HostUnprepared } from './succession.js';

export class SetupSteps extends Context.Service<
  SetupSteps,
  {
    run(repoRoot: string): Effect.Effect<readonly McpDeclarationWrite[], InstallFailed>;
  }
>()('tagma/installation/SetupSteps') {}

export type HostVerdict =
  | { readonly _tag: 'Takes' }
  | { readonly _tag: 'Refuses'; readonly detail: string }
  | { readonly _tag: 'Unasked'; readonly detail: string };

export class SuccessionSteps extends Context.Service<
  SuccessionSteps,
  {
    readonly prepare: (restart: string, host: RestartHost) => Effect.Effect<void, HostUnprepared>;
    readonly withdraw: Effect.Effect<void>;
    readonly weigh: (bundle: string) => Effect.Effect<HostVerdict>;
  }
>()('tagma/installation/SuccessionSteps') {}

export class DowngradeSteps extends Context.Service<
  DowngradeSteps,
  {
    close(): Effect.Effect<void>;
    reopen(): Effect.Effect<void>;
    drained(): Effect.Effect<{ readonly waiting: number; readonly unread: number }>;
  }
>()('tagma/installation/DowngradeSteps') {}

type GraphMark = { readonly project: string; readonly step: string | null };

export type GraphMarks = {
  readonly owns: (step: string) => boolean;
  readonly marks: Effect.Effect<readonly GraphMark[], StoreFailure>;
};

export class ConsoleKeyRollback extends Context.Service<
  ConsoleKeyRollback,
  { copyToSnapshot(snapshot: string): Effect.Effect<readonly SnapshotLoss[], SnapshotFailed> }
>()('tagma/installation/ConsoleKeyRollback') {}
