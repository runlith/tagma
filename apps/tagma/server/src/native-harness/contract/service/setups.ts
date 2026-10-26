import { Context, type Effect } from 'effect';
import type { HoldStalled, ReentrantCall } from '@runlith/held/failures';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';

export type SetupRecord = {
  readonly name: string;
  readonly setup: string;
  readonly setupDetail: {
    readonly step: string | null;
    readonly reason: string | null;
    readonly execution: { readonly execution: string; readonly incarnation: number } | null;
  } | null;
};

export class SetupReadings extends Context.Service<
  SetupReadings,
  {
    reading(rootId: RootId): Effect.Effect<SetupRecord | null, StoreFailure>;
    ready(rootId: RootId): Effect.Effect<SetupRecord | null, StoreFailure | HoldStalled | ReentrantCall>;
  }
>()('tagma/native-harness/SetupReadings') {}
