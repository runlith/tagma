import { Effect } from 'effect';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import { block } from '../store/tables.js';
import { STEALTH_PREFIX, anchorOf, inStealth } from '../contract/wire/storage.js';

const rootOf = Effect.fnUntraced(function* (db: StoreDb<'graph'>, projectId: number) {
  const root = yield* db
    .select({ id: block.id })
    .from(block)
    .where(and(eq(block.projectId, projectId), isNull(block.parentId), isNull(block.deletedAt)))
    .get();
  return root?.id ?? null;
});

export const standingAnchor = Effect.fnUntraced(function* (db: StoreDb<'graph'>, projectId: number, anchor: string) {
  const held = yield* db
    .select({ id: block.id })
    .from(block)
    .where(and(eq(block.projectId, projectId), eq(block.uuid, anchor), eq(block.stealth, false), isNull(block.deletedAt)))
    .get();
  return held?.id ?? null;
});

export type ForestPlace =
  | { readonly kind: 'nested' }
  | { readonly kind: 'top'; readonly parentId: number | null }
  | { readonly kind: 'loose' };

export const forestPlace = Effect.fnUntraced(function* (
  db: StoreDb<'graph'>,
  projectId: number,
  path: string,
  container: string,
): Effect.fn.Return<ForestPlace, StoreFailure> {
  if (!inStealth(path)) return { kind: 'nested' };
  const anchor = anchorOf(path);
  if (anchor === null) return { kind: 'loose' };
  if (container !== `${STEALTH_PREFIX}${anchor}`) return { kind: 'nested' };
  return { kind: 'top', parentId: (yield* standingAnchor(db, projectId, anchor)) ?? (yield* rootOf(db, projectId)) };
});

export const rehangFallen = Effect.fnUntraced(function* (db: StoreDb<'graph'>, projectId: number, fallen: readonly number[]) {
  if (fallen.length === 0) return;
  const root = yield* rootOf(db, projectId);
  if (root === null) return;
  yield* db
    .update(block)
    .set({ parentId: root })
    .where(and(inArray(block.parentId, [...fallen]), eq(block.stealth, true), isNull(block.deletedAt)));
});
