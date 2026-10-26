import type { Effect } from 'effect';
import type { ThreadPortFailure } from '../ThreadBorder';
export type ThreadResourceRow = {
  readonly id: string;
  readonly kind: string;
  readonly threadId: string | null;
  readonly heldAt: Date;
};

export type ThreadResourceValues = {
  readonly id: string;
  readonly kind: string;
  readonly threadId: string;
};

export type ThreadResourceSummary = {
  readonly kind: string;
  readonly id: string;
  readonly detail: string;
  readonly heldAt: string;
};

export interface ThreadResourceStorage<TTx, TWrite extends TTx = TTx> {
  hold(values: ThreadResourceValues, tx?: TWrite): Effect.Effect<ThreadResourceRow, ThreadPortFailure>;

  release(kind: string, ids: readonly string[], tx?: TWrite): Effect.Effect<number, ThreadPortFailure>;

  held(threadIds: readonly string[], tx?: TTx): Effect.Effect<readonly ThreadResourceRow[], ThreadPortFailure>;

  detached(tx?: TTx): Effect.Effect<readonly ThreadResourceRow[], ThreadPortFailure>;
}
