import { type Context, Effect } from 'effect';
import type { SourceKind } from '../contract/wire/sources.js';
import { eq, inArray, isNull } from 'drizzle-orm';
import type { StoreDb } from '../../platform/contract/service/store.js';
import { source } from '../store/tables.js';
import type { BlockRows } from '../acts/rows.js';
import type { Act, BlockNames, BlockProjection, SourceRow } from '../contract/service/acts.js';
import type { Tags } from '../contract/service/vocabulary.js';
import type { Projects } from '../../projects/contract/service/registry.js';
import type { Sources } from '../contract/service/sources.js';
import type { GraphScopes } from '../contract/service/serving.js';
import { pagesOf } from '../../platform/store/binds.js';

export type SourceParts = {
  readonly db: StoreDb<'graph'>;
  readonly act: Act['Service'];
  readonly blockRows: BlockRows['Service'];
  readonly blockNames: BlockNames['Service'];
  readonly blockProjection: BlockProjection['Service'];
  readonly projects: Projects['Service'];
  readonly scopes: GraphScopes['Service'];
  readonly vocabulary: Context.Service.Shape<typeof Tags>;
  readonly tableOf: (row: { projectId: number }) => ReturnType<Context.Service.Shape<typeof Tags>['of']>;
};

export const sourceIdentity = (blockId: number, kind: SourceKind, ref: string, symbol: string | null) => [
  eq(source.blockId, blockId),
  eq(source.kind, kind),
  eq(source.ref, ref),
  symbol === null ? isNull(source.symbol) : eq(source.symbol, symbol),
];

export const sourceReads = (parts: SourceParts) => {
  const { db } = parts;

  const byBlock: Sources['Service']['byBlock'] = Effect.fn('Sources.byBlock')(function* (blockIds: readonly number[]) {
    const wanted = [...new Set(blockIds)];
    if (wanted.length === 0) return new Map<number, SourceRow[]>();
    const grouped = new Map<number, SourceRow[]>();
    for (const page of pagesOf(wanted, 1)) {
      for (const row of yield* db.select().from(source).where(inArray(source.blockId, page))) {
        const rows = grouped.get(row.blockId) ?? [];
        rows.push(row);
        grouped.set(row.blockId, rows);
      }
    }
    return grouped;
  });

  const of = (blockId: number) => Effect.map(byBlock([blockId]), (grouped) => grouped.get(blockId) ?? []);

  return { byBlock, of };
};
