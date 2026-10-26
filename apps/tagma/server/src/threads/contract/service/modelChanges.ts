import { Context, type Effect } from 'effect';
import type { ThreadModelChoice } from '@runlith/agent/contracts';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { WriteUnit } from '../../../platform/contract/service/units.js';
import type { ThreadBorderFailed } from '@runlith/agent/thread/ThreadBorder';

export type ModelChoicePatch = {
  readonly provider?: string;
  readonly model?: string | null;
  readonly reasoning?: string | null;
};

export type ModelChange = {
  readonly id: string;
  readonly from: ThreadModelChoice;
  readonly to: ThreadModelChoice;
};

export class ModelChanges extends Context.Service<
  ModelChanges,
  {
    record<A, E>(
      unit: WriteUnit<'machine'>,
      threadId: string,
      to: ModelChoicePatch,
      write: Effect.Effect<A, E>,
    ): Effect.Effect<A, E | StoreFailure>;
    follow(heard: (threadId: string, change: ModelChange) => Effect.Effect<void, ThreadBorderFailed>): () => void;
  }
>()('tagma/threads/ModelChanges') {}
