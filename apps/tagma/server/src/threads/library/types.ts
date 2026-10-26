import type { ThreadBorderFailed } from '@runlith/agent/thread/ThreadBorder';
import type { ThreadTypeCaller } from '@runlith/agent/thread/agents/ThreadTypeCatalog';
import type { ThreadTypeOffer, ThreadTypeWithheld } from '@runlith/agent/collaboration/types';
import { Context, type Effect } from 'effect';
import type { OfferedType, RejectedType } from '../contract/service/library.js';

export type ThreadTypeOffers = {
  resolveIn(input: {
    readonly projectId: number;
    readonly caller: ThreadTypeCaller;
    readonly typeId: string;
  }): Effect.Effect<ThreadTypeOffer | ThreadTypeWithheld | null, ThreadBorderFailed>;
  offeredIn(input: {
    readonly projectId: number;
    readonly caller: ThreadTypeCaller;
  }): Effect.Effect<readonly OfferedType[], ThreadBorderFailed>;
  rejectedIn(projectId: number): Effect.Effect<readonly RejectedType[], ThreadBorderFailed>;
};

export class TypeOffers extends Context.Service<TypeOffers, ThreadTypeOffers>()('tagma/threads/TypeOffers') {}
