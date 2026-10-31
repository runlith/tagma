import { Context, Data, type Effect } from 'effect';
import type { Evidence } from '../keyed';
import type { ThreadContextReading, ThreadHistory, ThreadMetadataRow, ThreadRow } from '../rows';
import type { ThreadAtomicPatch, ThreadPatch } from '../storage/aggregate';
import type { ThreadEventInput } from '../events';
import type { ThreadSealedEvent, ThreadLogState } from '../ThreadEventDoor';
import type { ThreadBorderFailed, ThreadPortFailure } from '../ThreadBorder';
import type { ThreadChangePart, ThreadChangeRevision, ThreadStateChange } from '../state';

export class ThreadChangeCollector extends Context.Service<
  ThreadChangeCollector,
  {
    claimed(threadId: string, unit: object): boolean;
    note(threadId: string, unit: object, part: ThreadChangePart): void;
  }
>()('@runlith/agent/ThreadChangeCollector') {}

export type ThreadVersion = {
  readonly foldRev: number;
  readonly head: number;
  readonly inheritRev: number;
};

export type ThreadAt<TTx> = {
  readonly row: ThreadRow;
  readonly version: ThreadVersion;
  readonly tx: TTx;
};

export type ThreadHold<TTx> = {
  readonly row: ThreadMetadataRow;
  readonly version: ThreadVersion;
  readonly tx: TTx;
};

export type RecordReading =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly digest: string; readonly result: unknown }
  | { readonly kind: 'standing'; readonly digest: string }
  | { readonly kind: 'spent'; readonly digest: string; readonly at: Date }
  | { readonly kind: 'before-epoch' }
  | { readonly kind: 'decided' };

export type RecordWrite = {
  readonly digest: string;
  readonly result: unknown;
};

export type ThreadFoldWrite = {
  readonly fold: ThreadAtomicPatch;
  readonly standing: number;
  readonly head: number;
  readonly base?: ThreadHistory;
  readonly at: Date;
};

export interface ThreadTransitionStorage<TTx, TWrite extends TTx = TTx> {
  readAt<T, E>(
    threadId: string,
    work: (at: ThreadAt<TTx>) => Effect.Effect<T, E>,
    tx?: TTx,
  ): Effect.Effect<T | undefined, E | ThreadPortFailure>;
  writeAt<T, E>(
    threadId: string,
    work: (at: ThreadHold<TWrite>) => Effect.Effect<T, E>,
  ): Effect.Effect<T | undefined, E | ThreadPortFailure>;
  writeAtIn<T, E>(
    threadId: string,
    work: (at: ThreadHold<TWrite>) => Effect.Effect<T, E>,
    tx: TWrite,
  ): Effect.Effect<T | undefined, E | ThreadPortFailure>;
  programAt?<T, E>(
    threadId: string,
    prepared: Prepared,
    identity: string,
    work: (at: ThreadHold<TWrite>) => Effect.Effect<T, E>,
  ): Effect.Effect<T | null | undefined, E | ThreadPortFailure>;
  writeFold(threadId: string, write: ThreadFoldWrite, tx: TWrite): Effect.Effect<void, ThreadPortFailure>;
  readRecord(threadId: string, evidence: Evidence, tx?: TTx): Effect.Effect<RecordReading, ThreadPortFailure>;
  writeRecord(threadId: string, evidence: Evidence, write: RecordWrite, tx: TWrite): Effect.Effect<void, ThreadPortFailure>;
  appliedSeq(runId: string): Effect.Effect<number, ThreadPortFailure>;
  spend(threadIds: readonly string[], at: Date, tx: TWrite): Effect.Effect<void, ThreadPortFailure>;
  revision(threadId: string, tx?: TTx): Effect.Effect<number, ThreadPortFailure>;
  opened(threadIds: readonly string[], tx: TWrite): Effect.Effect<void, ThreadPortFailure>;
  revised(
    threadIds: readonly string[],
    tx: TWrite,
    after: (revisions: ReadonlyMap<string, ThreadChangeRevision>) => Effect.Effect<void>,
  ): Effect.Effect<void, ThreadPortFailure>;
}

export type TransitionView = {
  readonly row: ThreadRow;
  readonly state: ThreadLogState;
  readonly version: ThreadVersion;
};

export type Decision<A, TWrite, E = ThreadBorderFailed> =
  | {
      readonly apply: true;
      readonly result: A;
      readonly events?: readonly ThreadEventInput[];
      readonly patch?: ThreadPatch & { readonly contextReading?: ThreadContextReading | null };
      readonly participants?: (tx: TWrite) => Effect.Effect<void, E>;
      readonly participantsUnseen?: true;
    }
  | { readonly redeclare: readonly ThreadSealedEvent[] }
  | { readonly refuse: A }
  | { readonly replayed: A };

export type OwnedRecord<TWrite, E = ThreadBorderFailed> = {
  read(tx: TWrite): Effect.Effect<RecordReading, E>;
  write(record: RecordWrite, tx: TWrite): Effect.Effect<void, E>;
};

export type TransitionPlan<A, TWrite, E = ThreadBorderFailed> = {
  readonly declared: readonly ThreadSealedEvent[];
  readonly owned?: OwnedRecord<TWrite, E>;
  readonly published?: (change: ThreadStateChange) => Effect.Effect<void>;
  decide(view: TransitionView, tx: TWrite): Effect.Effect<Decision<A, TWrite, E>, E>;
};

export type ControlPlan<A, TWrite, E = ThreadBorderFailed> = {
  readonly owned?: OwnedRecord<TWrite, E>;
  decide(row: ThreadMetadataRow, tx: TWrite): Effect.Effect<Decision<A, TWrite, E>, E>;
};

export type Prepared = {
  readonly threadId: string;
  readonly declared: readonly ThreadSealedEvent[];
  readonly row: ThreadRow;
  readonly state: ThreadLogState;
  readonly version: ThreadVersion;
};

export class ThreadActReusedError extends Data.TaggedError('ThreadActReused')<{
  readonly message: string;
  readonly threadId: string;
  readonly evidence: Evidence;
}> {
  constructor(input: { threadId: string; evidence: Evidence }) {
    super({
      message: `Thread ${input.threadId}: this key already names another act, so a changed request needs a new key.`,
      threadId: input.threadId,
      evidence: input.evidence,
    });
    this.name = 'ThreadActReusedError';
  }
}

export class ThreadActSpentError extends Data.TaggedError('ThreadActSpent')<{
  readonly message: string;
  readonly threadId: string;
  readonly at: Date | 'before-epoch';
}> {
  readonly code = 'act-spent' as const;

  constructor(input: { threadId: string; at: Date | 'before-epoch' }) {
    super({
      message: `Thread ${input.threadId}: the act under this key already happened and its result is no longer kept; read the current state, and send a new act under a new key.`,
      threadId: input.threadId,
      at: input.at,
    });
    this.name = 'ThreadActSpentError';
  }
}

export class SequenceUnavailable extends Data.TaggedError('SequenceUnavailable')<{
  readonly message: string;
  readonly runId: string;
  readonly seq: number;
  readonly reason: 'absent' | 'ended' | 'advanced';
}> {
  constructor(runId: string, seq: number, reason: 'absent' | 'ended' | 'advanced') {
    super({ message: `Run ${runId}: sequence ${seq} cannot act or replay because the run is ${reason}.`, runId, seq, reason });
    this.name = 'SequenceUnavailable';
  }
}

export class ThreadVersionStaleError extends Data.TaggedError('ThreadVersionStale')<{
  readonly message: string;
  readonly threadId: string;
}> {
  constructor(input: { threadId: string }) {
    super({ message: `Thread ${input.threadId} moved since this transition was prepared; prepare it again.`, threadId: input.threadId });
    this.name = 'ThreadVersionStaleError';
  }
}
