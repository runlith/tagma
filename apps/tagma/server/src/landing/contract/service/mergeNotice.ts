import { Context, Data, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../../platform/contract/service/units.js';
import type { WriteSet } from '../../../platform/contract/service/writes.js';
import type { MergeReceipt } from '../wire/merge.js';

export class MergeNoticeConflict extends Data.TaggedError('MergeNoticeConflict')<{ readonly threadId: string }> {
  override get message(): string {
    return `thread ${this.threadId} moved while its merged note was prepared`;
  }
}

export class MergeNoticeFailed extends Data.TaggedError('MergeNoticeFailed')<{ readonly threadId: string; readonly reason: string }> {
  override get message(): string {
    return `the merged note of thread ${this.threadId} could not be written: ${this.reason}`;
  }
}

export type MergeNoticeFailure = MergeNoticeConflict | MergeNoticeFailed;

export type NoticeWrite = (unit: WriteUnit<'machine'>) => Effect.Effect<void, MergeNoticeFailure>;

export class MergeNotice extends Context.Service<
  MergeNotice,
  {
    readonly writes: WriteSet;
    readonly prepare: (
      threadId: string,
      receipt: MergeReceipt,
      recorded: (unit: Unit<'machine'>) => Effect.Effect<boolean, StoreFailure>,
    ) => Effect.Effect<NoticeWrite | null, MergeNoticeFailed>;
  }
>()('tagma/landing/MergeNotice') {}
