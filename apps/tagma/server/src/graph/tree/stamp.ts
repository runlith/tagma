import { Effect, Schema } from 'effect';
import { eq } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { TREE_BASIS } from '../contract/wire/storage.js';
import { meta } from '../store/tables.js';
import type { StoredBasis } from './freshness.js';

const stamping = writes('Tree.stamp', [meta]);

const TREE_HEAD = 'tree-head';

const storedMark = Schema.NullOr(Schema.Struct({ position: Schema.String, slot: Schema.Literals([0, 1, 2]), filed: Schema.Boolean }));

const storedBasis = Schema.fromJsonString(
  Schema.Struct({
    head: Schema.NullOr(Schema.String),
    dirty: Schema.Array(Schema.Struct({ status: Schema.String, path: Schema.String })),
    rules: Schema.NullOr(Schema.Struct({ files: Schema.Array(Schema.String), stamp: Schema.String })),
    mark: storedMark,
    fallback: storedMark,
  }),
);

export function treeHeadStamp(stealth = false): {
  readonly readStamp: Effect.Effect<string | null, StoreFailure, GraphStore>;
  readonly writeStamp: (sha: string) => Effect.Effect<void, StoreFailure, GraphStore>;
  readonly clearStamp: Effect.Effect<void, StoreFailure, GraphStore>;
  readonly readBasis: Effect.Effect<StoredBasis | null, StoreFailure, GraphStore>;
  readonly writeBasis: (basis: StoredBasis) => Effect.Effect<void, StoreFailure, GraphStore>;
} {
  const HEAD = stealth ? `${TREE_HEAD}:stealth` : TREE_HEAD;
  const BASIS = stealth ? `${TREE_BASIS}:stealth` : TREE_BASIS;
  return {
    readStamp: Effect.gen(function* () {
      const { db } = yield* GraphStore;
      const row = yield* db.select().from(meta).where(eq(meta.key, HEAD)).get();
      return row?.value ?? null;
    }),
    writeStamp: Effect.fnUntraced(function* (sha: string) {
      const store = yield* GraphStore;
      yield* store.transaction(stamping, () =>
        store.db
          .insert(meta)
          .values({ key: HEAD, value: sha })
          .onConflictDoUpdate({ target: meta.key, set: { value: sha } }),
      );
    }),
    clearStamp: Effect.gen(function* () {
      const store = yield* GraphStore;
      yield* store.transaction(stamping, () => store.db.delete(meta).where(eq(meta.key, HEAD)));
    }),
    readBasis: Effect.gen(function* () {
      const { db } = yield* GraphStore;
      const row = yield* db.select().from(meta).where(eq(meta.key, BASIS)).get();
      if (row === undefined) return null;
      return yield* Schema.decodeUnknownEffect(storedBasis)(row.value).pipe(Effect.catchTag('SchemaError', () => Effect.succeed(null)));
    }),
    writeBasis: Effect.fnUntraced(function* (basis: StoredBasis) {
      const store = yield* GraphStore;
      const value = JSON.stringify(basis);
      yield* store.transaction(stamping, () =>
        store.db.insert(meta).values({ key: BASIS, value }).onConflictDoUpdate({ target: meta.key, set: { value } }),
      );
    }),
  };
}
