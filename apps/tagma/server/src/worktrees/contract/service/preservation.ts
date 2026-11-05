import { Context, Data, type Effect } from 'effect';
import type { PreparedChange } from '../../../change-record/contract/service/prepared.js';
import type { RequestKey } from '../../../platform/contract/wire/ids.js';

export type PreservedWorktree = { readonly name: string; readonly holders: readonly string[] };

export type PreservationReceipt = {
  readonly key: RequestKey;
  readonly commit: string;
  readonly witness: string;
};

export class PreservationRefused extends Data.TaggedError('PreservationRefused')<{
  readonly key: RequestKey;
  readonly reason: 'no-base' | 'nothing-changed' | 'mid-operation' | 'moved' | 'unsigned';
  readonly detail: string;
}> {
  override get message(): string {
    return `the preservation of ${this.key} committed nothing (${this.reason}): ${this.detail}`;
  }
}

export class PreservationConflict extends Data.TaggedError('PreservationConflict')<{
  readonly key: RequestKey;
  readonly recorded: { readonly checkout: string; readonly base: string; readonly tree: string };
}> {
  override get message(): string {
    return `${this.key} already names the preservation of ${this.recorded.tree} onto ${this.recorded.base} in ${this.recorded.checkout}`;
  }
}

export class PreservationUnavailable extends Data.TaggedError('PreservationUnavailable')<{
  readonly key: RequestKey;
  readonly cause: 'store' | 'git' | 'index' | 'lane' | 'claimed';
  readonly detail: string;
}> {
  override get message(): string {
    return `the preservation of ${this.key} could not be read or written through the ${this.cause}: ${this.detail}`;
  }
}

export class PreservationLost extends Data.TaggedError('PreservationLost')<{
  readonly key: RequestKey;
  readonly commit: string | null;
  readonly detail: string;
}> {
  override get message(): string {
    return `the preservation of ${this.key} can be neither proved nor published: ${this.detail}`;
  }
}

export class PreservationFailed extends Data.TaggedError('PreservationFailed')<{
  readonly key: RequestKey;
  readonly detail: string;
}> {
  override get message(): string {
    return `git refused the preservation of ${this.key}: ${this.detail}`;
  }
}

export type PreservationFailure =
  | PreservationRefused
  | PreservationConflict
  | PreservationUnavailable
  | PreservationLost
  | PreservationFailed;

export class PreservationCommit extends Context.Service<
  PreservationCommit,
  {
    commit(key: RequestKey, prepared: PreparedChange<PreservedWorktree>): Effect.Effect<PreservationReceipt, PreservationFailure>;
    readReceipt(key: RequestKey): Effect.Effect<PreservationReceipt | null, PreservationFailure>;
  }
>()('tagma/worktrees/PreservationCommit') {}
