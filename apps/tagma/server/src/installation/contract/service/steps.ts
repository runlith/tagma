import { Context, type Effect } from 'effect';
import type { SnapshotFailed, SnapshotLoss } from '../../../platform/contract/service/snapshots.js';
import type { McpDeclarationWrite } from '../wire/install.js';
import type { HostUnprepared } from './succession.js';

export class SetupSteps extends Context.Service<
  SetupSteps,
  {
    run(repoRoot: string): Effect.Effect<readonly McpDeclarationWrite[]>;
  }
>()('tagma/installation/SetupSteps') {}

export class SuccessionSteps extends Context.Service<
  SuccessionSteps,
  {
    readonly prepare: (restart: string) => Effect.Effect<void, HostUnprepared>;
    readonly withdraw: Effect.Effect<void>;
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

export class ConsoleKeyRollback extends Context.Service<
  ConsoleKeyRollback,
  { copyToSnapshot(snapshot: string): Effect.Effect<readonly SnapshotLoss[], SnapshotFailed> }
>()('tagma/installation/ConsoleKeyRollback') {}
