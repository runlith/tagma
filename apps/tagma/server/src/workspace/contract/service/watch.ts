import { Context, type Effect, type Stream } from 'effect';
import type { TreeMovement, TreeRescan } from '../../../platform/watch/tree.js';
import type { RootId } from '../wire/ids.js';
import type { RootResolutionFailure } from '../wire/roots.js';

export type PathMove = 'rename' | 'change';

export type ShiftRescan = Exclude<TreeRescan, 'rename' | 'opened'> | 'overflow' | 'reopened';

export type CheckoutShift = {
  readonly movements: readonly TreeMovement[];
  readonly paths: ReadonlyMap<string, PathMove>;
  readonly rescan: ShiftRescan | null;
};

export type Following = {
  readonly shifts: Stream.Stream<CheckoutShift>;
  watching(): boolean;
  release(): void;
};

export class CheckoutWatch extends Context.Service<
  CheckoutWatch,
  {
    follow(rootId: RootId): Effect.Effect<Following, RootResolutionFailure>;
  }
>()('tagma/workspace/CheckoutWatch') {}
