import { and, asc, eq, gt, or } from 'drizzle-orm';
import { Data, Effect, Schema } from 'effect';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import type { RequestKey } from '../../platform/contract/wire/ids.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import { worktreeDeletion, type DeletionPhase } from './tables.js';

export type DeletionIntent = {
  readonly key: RequestKey;
  readonly projectId: number;
  readonly rootId: RootId;
  readonly phase: DeletionPhase;
  readonly paths: readonly string[];
  readonly holders: readonly string[];
  readonly at: Date;
};

export class DeletionUnreadable extends Data.TaggedError('DeletionUnreadable')<{
  readonly key: RequestKey;
  readonly at: Date;
  readonly column: 'paths' | 'holders';
}> {
  override get message(): string {
    return `the deletion intent ${this.key} holds a ${this.column} column that is not a list of paths`;
  }
}

const holdsList = Schema.is(Schema.Array(Schema.String));

const listOf = (text: string): readonly string[] | null => {
  try {
    const parsed: unknown = JSON.parse(text);
    return holdsList(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const intentOf = (row: typeof worktreeDeletion.$inferSelect): DeletionIntent | DeletionUnreadable => {
  const key = row.key as RequestKey;
  const paths = listOf(row.paths);
  if (paths === null) return new DeletionUnreadable({ key, at: row.at, column: 'paths' });
  const holders = listOf(row.holders);
  if (holders === null) return new DeletionUnreadable({ key, at: row.at, column: 'holders' });
  return { key, projectId: row.projectId, rootId: row.rootId as RootId, phase: row.phase, paths, holders, at: row.at };
};

export type DeletionIntents = {
  readonly byRoot: (rootId: RootId, unit: Unit<'machine'>) => Effect.Effect<DeletionIntent | null, StoreFailure | DeletionUnreadable>;
  readonly intend: (intent: DeletionIntent, unit: WriteUnit<'machine'>) => Effect.Effect<boolean, StoreFailure>;
  readonly enter: (
    key: RequestKey,
    phase: DeletionPhase,
    unit: WriteUnit<'machine'>,
    detail?: { readonly paths: readonly string[]; readonly holders: readonly string[] },
  ) => Effect.Effect<void, StoreFailure>;
  readonly close: (key: RequestKey, unit: WriteUnit<'machine'>) => Effect.Effect<void, StoreFailure>;
  readonly open: (
    after: { readonly at: Date; readonly key: RequestKey } | null,
    limit: number,
    unit: Unit<'machine'>,
  ) => Effect.Effect<readonly (DeletionIntent | DeletionUnreadable)[], StoreFailure>;
};

export const makeDeletionIntents = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const intents: DeletionIntents = {
    byRoot: (rootId, unit) =>
      Effect.flatMap(unit.run(db.select().from(worktreeDeletion).where(eq(worktreeDeletion.rootId, rootId)).get()), (row) => {
        if (row === undefined) return Effect.succeed(null);
        const intent = intentOf(row);
        return intent instanceof DeletionUnreadable ? Effect.fail(intent) : Effect.succeed(intent);
      }),
    intend: (intent, unit) =>
      Effect.map(
        unit.run(
          db
            .insert(worktreeDeletion)
            .values({
              ...intent,
              paths: JSON.stringify(intent.paths),
              holders: JSON.stringify(intent.holders),
            })
            .onConflictDoNothing()
            .returning({ key: worktreeDeletion.key })
            .all(),
        ),
        (rows) => rows.length > 0,
      ),
    enter: (key, phase, unit, detail) =>
      Effect.asVoid(
        unit.run(
          db
            .update(worktreeDeletion)
            .set({
              phase,
              paths: detail === undefined ? undefined : JSON.stringify(detail.paths),
              holders: detail === undefined ? undefined : JSON.stringify(detail.holders),
            })
            .where(eq(worktreeDeletion.key, key)),
        ),
      ),
    close: (key, unit) => Effect.asVoid(unit.run(db.delete(worktreeDeletion).where(eq(worktreeDeletion.key, key)))),
    open: (after, limit, unit) =>
      Effect.map(
        unit.run(
          db
            .select()
            .from(worktreeDeletion)
            .where(
              after === null
                ? undefined
                : or(gt(worktreeDeletion.at, after.at), and(eq(worktreeDeletion.at, after.at), gt(worktreeDeletion.key, after.key))),
            )
            .orderBy(asc(worktreeDeletion.at), asc(worktreeDeletion.key))
            .limit(limit)
            .all(),
        ),
        (rows) => rows.map(intentOf),
      ),
  };
  return intents;
});
