import { Data, type Effect } from 'effect';

export class TwinFailed extends Data.TaggedError('TwinFailed')<{ readonly message: string }> {}

export type BranchTwins = <A, E>(
  place: { readonly projectId: number; readonly checkout: string; readonly from: string; readonly to: string },
  rename: Effect.Effect<A, E>,
) => Effect.Effect<A, E | TwinFailed>;
