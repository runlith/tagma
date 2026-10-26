import { Context, Data, type Effect } from 'effect';
import type { Landed, WorkspaceChanges } from '@runlith/agent-tools/WorkspaceChanges';
import type { ChangeTarget } from '@runlith/files/change';
import type { Git } from '@runlith/git/Git';
import type { CommandSession, CommandUnattributed } from './commands.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { PlacedPath, WorkOrigin, WorkingRoot } from '../../../workspace/contract/wire/place.js';
import type { CheckoutUnknown, PlaceUnread } from '../../../workspace/contract/service/checkoutPaths.js';
import type { IntakeFact } from './intake.js';
import type { IntakeRefused } from '@runlith/agent-tools/WorkspaceChanges';
import type { LinesReverted, RunFilePage, RunSelection } from '../wire/runFiles.js';
import type { TurnPath } from '../wire/changes.js';
import type { RunFilesFailure } from './runFiles.js';
import type { FileSystem } from 'effect';
import type { LineWrites } from './lineWrites.js';
import type { Reshaped, ReshapeHolder, ReshapeInput, ReshapeOutcome, ReshapeOwing } from '../wire/reshape.js';

export class OutcomeUnread extends Data.TaggedError('OutcomeUnread')<{ readonly message: string }> {}

export type ChangeWork = {
  readonly work: WorkOrigin;
  readonly runHint?: string;
};

export const CallerChangeWork = Context.Reference<ChangeWork | null>('tagma/change-record/CallerChangeWork', {
  defaultValue: () => null,
});

export type RecordPosition = { readonly at: Date; readonly id: string };

export type EvidenceContent =
  | { readonly _tag: 'absent' }
  | { readonly _tag: 'text'; readonly text: string }
  | { readonly _tag: 'unavailable' };

export type ChangeEvidence = {
  readonly id: string;
  readonly path: string;
  readonly threadId: string;
  readonly origin: 'edit' | 'write' | 'delete';
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
  readonly beforeContent?: EvidenceContent;
  readonly afterContent?: EvidenceContent;
  readonly oldText: string | null;
  readonly newText: string | null;
  readonly mode?: string | null;
};

export type OrderedEvidence = ChangeEvidence & {
  readonly ended: boolean;
  readonly unresolved: boolean;
  readonly at: number;
};

export type RunEvidence = OrderedEvidence & {
  readonly runId: string | null;
  readonly firstLine: number | null;
  readonly lines: number | null;
  readonly added: number | null;
  readonly removed: number | null;
  readonly commit: string | null;
  readonly committedAt: Date | null;
  readonly withdrawnAt: Date | null;
};

export type TurnAfter = { readonly at: number; readonly key: string };

export type Turns = { readonly rows: readonly (TurnPath & { readonly key: string })[]; readonly total: number };

export type KnownCommit = { readonly checkout: string; readonly commit: string; readonly at: number };
export type UnknownOutcome = { readonly checkout: string; readonly reason: string };
export type KnownOutcomes = { readonly commits: readonly KnownCommit[]; readonly unread: readonly UnknownOutcome[] };

export type ChangeTurns = {
  readonly projectId: number;
  readonly threadId: string;
  readonly limit: number;
  readonly after?: TurnAfter;
  readonly outcomes?: KnownOutcomes;
};

export type HeldChanges =
  | { readonly kind: 'thread'; readonly projectId: number; readonly threadId: string }
  | { readonly kind: 'path'; readonly projectId: number; readonly place: PlacedPath };

export type ChangePaths =
  | { readonly kind: 'thread'; readonly projectId: number; readonly threadId: string; readonly origin: WorkingRoot | null }
  | { readonly kind: 'project'; readonly projectId: number; readonly origin: WorkingRoot | null };

export type ThreadChangePath = { readonly path: string; readonly runId: string | null };

export type ChangeCheckout = {
  readonly git: Git['Service'];
  readonly root: string;
  readonly projectId: number;
  readonly origin: WorkingRoot | null;
};

export class ChangeRecord extends Context.Service<
  ChangeRecord,
  {
    changes(work: ChangeWork): WorkspaceChanges;
    land<E, R>(
      work: ChangeWork,
      facts: readonly IntakeFact[],
      write: Effect.Effect<boolean, E, R>,
    ): Effect.Effect<Landed, E | IntakeRefused, R>;
    turn<A, E, R>(
      projectId: number,
      paths: readonly string[],
      work: Effect.Effect<A, E, R>,
      target?: ChangeTarget,
    ): Effect.Effect<A, E | IntakeRefused, R>;
    report(work: ChangeWork, facts: readonly IntakeFact[]): Effect.Effect<readonly PlacedPath[], IntakeRefused>;
    versions(digests: readonly string[]): Effect.Effect<ReadonlyMap<string, string>, StoreFailure>;
    checkout(projectId: number, root: string): Effect.Effect<string, PlaceUnread | CheckoutUnknown>;
    turns(request: ChangeTurns): Effect.Effect<Turns, StoreFailure | OutcomeUnread>;
    held(request: Extract<HeldChanges, { readonly kind: 'thread' }>): Effect.Effect<readonly ChangeEvidence[], StoreFailure>;
    held(request: Extract<HeldChanges, { readonly kind: 'path' }>): Effect.Effect<readonly OrderedEvidence[], StoreFailure>;
    paths(
      request: Extract<ChangePaths, { readonly kind: 'thread' }>,
    ): Effect.Effect<readonly ThreadChangePath[], StoreFailure | PlaceUnread | CheckoutUnknown>;
    paths(
      request: Extract<ChangePaths, { readonly kind: 'project' }>,
    ): Effect.Effect<readonly string[], StoreFailure | PlaceUnread | CheckoutUnknown>;
    movedTo(from: PlacedPath): Effect.Effect<string | null, StoreFailure>;
    unattributed(session: CommandSession): readonly CommandUnattributed[];
    sweep(git: Git['Service'], root: string, checkout: string): Effect.Effect<void, StoreFailure>;
    runFiles(
      checkout: ChangeCheckout,
      selection: RunSelection,
      page: { readonly limit: number; readonly after?: string },
    ): Effect.Effect<RunFilePage, RunFilesFailure, FileSystem.FileSystem>;
    revertLines(
      checkout: ChangeCheckout,
      selection: RunSelection,
    ): Effect.Effect<LinesReverted, RunFilesFailure, FileSystem.FileSystem | LineWrites>;
    reshapeRead(
      checkout: ChangeCheckout,
      reshaped: readonly Reshaped[],
    ): Effect.Effect<readonly ReshapeInput[], RunFilesFailure, FileSystem.FileSystem>;
    reshape(
      checkout: ChangeCheckout,
      inputs: readonly ReshapeInput[],
      holder: ReshapeHolder,
      owing?: ReshapeOwing,
    ): Effect.Effect<readonly ReshapeOutcome[], RunFilesFailure, FileSystem.FileSystem | LineWrites>;
  }
>()('tagma/change-record/ChangeRecord') {}
