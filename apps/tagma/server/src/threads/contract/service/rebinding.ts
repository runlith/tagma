import { Context, Data, type Effect } from 'effect';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { WriteUnit } from '../../../platform/contract/service/units.js';
import type { WriteSet } from '../../../platform/contract/service/writes.js';
import type { KernelSeat } from '../wire/harness/seat.js';
import type { TransportRoad } from '../wire/harness/transportEntry.js';

export const JOURNAL_MOVED = 'journal-moved';

export const STALE_RETRIES = 2;

export class HarnessTurnStale extends Data.TaggedError('HarnessTurnStale')<{ readonly threadId: string }> {
  override get message(): string {
    return `thread ${this.threadId} moved while its harness turn entries were prepared`;
  }
}

export type HarnessTurnWrite = (unit: WriteUnit<'machine'>) => Effect.Effect<void, HarnessTurnStale | ThreadStorageFailed>;

export class ThreadRebinding extends Context.Service<
  ThreadRebinding,
  {
    readonly writes: WriteSet;
    readonly prepare: (
      threadId: string,
      from: TransportRoad | null,
      seat: KernelSeat,
    ) => Effect.Effect<HarnessTurnWrite | null, ThreadStorageFailed>;
  }
>()('tagma/threads/ThreadRebinding') {}
