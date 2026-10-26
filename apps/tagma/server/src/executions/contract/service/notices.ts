import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { WriteUnit } from '../../../platform/contract/service/units.js';
import type { WriteSet } from '../../../platform/contract/service/writes.js';
import type { ThreadId } from '../../../platform/contract/wire/thread.js';
import type { ExecutionStoreFailure } from '../../store/rows.js';

export type CallDebt = { readonly thread: ThreadId; readonly run: string; readonly toolCall: string };

export type CallDebts = {
  readonly calls: WriteSet;
  release(unit: WriteUnit<'machine'>, debt: CallDebt): Effect.Effect<void, StoreFailure>;
};

export class NoticeTakeBack extends Context.Service<
  NoticeTakeBack,
  CallDebts & {
    retract(
      thread: ThreadId,
      signalId: string,
      within: (unit: WriteUnit<'machine'>) => Effect.Effect<void, ExecutionStoreFailure | StoreFailure>,
    ): Effect.Effect<void, ExecutionStoreFailure | StoreFailure>;
  }
>()('tagma/executions/NoticeTakeBack') {}
