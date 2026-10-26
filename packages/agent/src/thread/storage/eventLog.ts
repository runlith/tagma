import type { Effect } from 'effect';
import type { ThreadPortFailure } from '../ThreadBorder';
export type ThreadEventPayloadValue = { readonly [key: string]: unknown };

export type ThreadEventInsert = {
  readonly threadId: string;
  readonly id: string;
  readonly kind: string;
  readonly payload: ThreadEventPayloadValue;
};

export type ThreadEventRow = {
  readonly threadId: string;
  readonly position: number;
  readonly id: string;
  readonly kind: string;
  readonly payload: ThreadEventPayloadValue;
};

export type ThreadEventRevision = ThreadEventRow & { readonly identity: string };

export type ThreadRecordWindow = {
  readonly head: number;
  readonly afterPosition: number;
  readonly limit: number;
  readonly kinds?: readonly string[];
};

export interface ThreadEventLogStorage<TTx, TWrite extends TTx = TTx> {
  append(event: ThreadEventInsert, tx: TWrite): Effect.Effect<ThreadEventRow, ThreadPortFailure>;

  recordsAsOf(threadId: string, window: ThreadRecordWindow, tx?: TTx): Effect.Effect<readonly ThreadEventRow[], ThreadPortFailure>;

  revisionsAsOf(threadId: string, window: ThreadRecordWindow, tx?: TTx): Effect.Effect<readonly ThreadEventRevision[], ThreadPortFailure>;

  eventsAfter(
    threadId: string,
    afterPosition: number,
    limit: number,
    tx?: TTx,
  ): Effect.Effect<readonly ThreadEventRow[], ThreadPortFailure>;

  headPosition(threadId: string, tx?: TTx): Effect.Effect<number, ThreadPortFailure>;

  positionOf(threadId: string, recordId: string, tx?: TTx): Effect.Effect<number | null, ThreadPortFailure>;
}
