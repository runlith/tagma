import { Effect, Exit, Layer } from 'effect';
import { ThreadCallBroke, threadCauseOf, type ThreadBorderFailed } from '../thread/ThreadBorder';
import { ThreadResourceLedger, type ThreadTx, type ThreadWriteTx } from '../thread/ThreadPorts';
import type { ThreadResourceRow } from '../thread/storage/resources';
import { DeclaredResources, type ResourcesConfig, type ThreadResourceKind } from './ResourcesConfig';

export const resourceLedgerLayer: Layer.Layer<ThreadResourceLedger, never, DeclaredResources> = Layer.effect(
  ThreadResourceLedger,
  Effect.gen(function* () {
    const declared = yield* DeclaredResources;
    if (!declared) return emptyLedger;
    return ledgerOf(declared);
  }),
);

const emptyLedger = {
  end: () => Effect.void,
  letGo: () => Effect.void,
  held: () => Effect.succeed([]),
};

export function letGoDetached<TTx, TWrite extends TTx>(declared: ResourcesConfig<TTx, TWrite>): Effect.Effect<void, ThreadBorderFailed> {
  const kinds = kindsOf(declared);
  return Effect.gen(function* () {
    const rows = (yield* declared.storage.detached()).filter((row) => kinds.has(row.kind));
    if (rows.length === 0) return;
    const outcomes = yield* Effect.forEach(rows, (row) => Effect.exit(kinds.get(row.kind)?.release?.(row) ?? Effect.void), {
      concurrency: 'unbounded',
    });
    const kept = rows.filter((_, at) => Exit.isFailure(outcomes[at]!));
    const gone = rows.filter((_, at) => Exit.isSuccess(outcomes[at]!));
    for (const [kind, released] of Map.groupBy(gone, (row) => row.kind)) {
      yield* declared.storage.release(
        kind,
        released.map((row) => row.id),
      );
    }
    if (kept.length > 0) {
      yield* Effect.logWarning(
        `${kept.length} released resource(s) still hold their bytes and stay in the ledger for the next pass: ${kept
          .map((row) => `${row.kind} ${row.id}`)
          .join(', ')}`,
      );
    }
  });
}

function ledgerOf(declared: ResourcesConfig<ThreadTx, ThreadWriteTx>) {
  const kinds = kindsOf(declared);
  const { storage } = declared;
  return {
    end: Effect.fnUntraced(function* (threadIds: readonly string[], tx: ThreadWriteTx) {
      const rows = yield* storage.held(threadIds, tx);
      const undeclared = rows.find((row) => !kinds.has(row.kind));
      if (undeclared) return yield* unreleasable(undeclared);
      for (const [name, owned] of Map.groupBy(rows, (row) => row.kind)) {
        const kind = kinds.get(name)!;
        if (kind.end) yield* ended(kind, owned, tx);
      }
    }),
    letGo: () => letGoDetached(declared),
    held: (threadId: string) =>
      Effect.map(storage.held([threadId]), (rows) => rows.map((row) => kinds.get(row.kind)?.describe(row) ?? undeclared(row))),
  };
}

function kindsOf<TTx, TWrite extends TTx>(declared: ResourcesConfig<TTx, TWrite>): ReadonlyMap<string, ThreadResourceKind<TWrite>> {
  return new Map(declared.kinds.map((kind) => [kind.kind, kind]));
}

function ended(kind: ThreadResourceKind, rows: readonly ThreadResourceRow[], tx: ThreadWriteTx) {
  return Effect.catch(
    kind.end!(rows, tx),
    (failure) =>
      new ThreadCallBroke({
        cause: new Error(`The ending threads still hold their ${kind.kind}: ${message(threadCauseOf(failure))}`),
      }),
  );
}

function unreleasable(row: ThreadResourceRow) {
  return new ThreadCallBroke({
    cause: new Error(`The thread holds a ${row.kind} (${row.id}) and this host declares no such resource kind, so nothing can release it.`),
  });
}

function undeclared(row: ThreadResourceRow) {
  return {
    kind: row.kind,
    id: row.id,
    detail: 'held by a resource kind this host no longer declares',
    heldAt: row.heldAt.toISOString(),
  };
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
