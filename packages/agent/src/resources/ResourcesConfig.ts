import { Context, type Effect } from 'effect';
import type { ThreadBorderFailed } from '../thread/ThreadBorder';
import type { ThreadTx, ThreadWriteTx } from '../thread/ThreadPorts';
import type { ThreadResourceRow, ThreadResourceStorage, ThreadResourceSummary } from '../thread/storage/resources';

export type ThreadResourceKind<TWrite = ThreadWriteTx> = {
  readonly kind: string;
  end?(rows: readonly ThreadResourceRow[], tx: TWrite): Effect.Effect<void, ThreadBorderFailed>;
  release?(row: ThreadResourceRow): Effect.Effect<void, ThreadBorderFailed>;
  describe(row: ThreadResourceRow): ThreadResourceSummary;
};

export type ResourcesConfig<TTx = ThreadTx, TWrite extends TTx = TTx> = {
  readonly storage: ThreadResourceStorage<TTx, TWrite>;
  readonly kinds: readonly ThreadResourceKind<TWrite>[];
};

export class DeclaredResources extends Context.Service<DeclaredResources, ResourcesConfig<ThreadTx, ThreadWriteTx> | null>()(
  '@runlith/agent/DeclaredResources',
) {}
