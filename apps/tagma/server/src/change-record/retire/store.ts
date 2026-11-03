import { and, eq, getTableColumns, inArray, isNotNull, isNull, ne, notExists, notInArray, sql } from 'drizzle-orm';
import { OPERATOR, holderKey } from '../../workspace/contract/wire/checkout.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { Clock, Effect } from 'effect';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { recordsAs } from '../../thread-record/facts.js';
import { changeLogWrites, held, standing, workspaceChange } from '../store/tables.js';
import { commandWindow } from '../store/commandTables.js';
import {
  changeDebt,
  changeLanded,
  changeLanding,
  checkoutSeen,
  debtWrites,
  landingWrites,
  releasedLine,
  retirementProof,
  retirementWrites,
} from '../store/retirement.js';
import { chunk } from '@runlith/utils/collection';
import { rowsPerStatement } from '../../platform/store/binds.js';
import type { DebtWindow } from '../lines/owed.js';
import type { DebtSource } from '../contract/wire/reshape.js';
import type { ReleasedSpan } from '../lines/released.js';
import type { StoreShape } from '../record/places.js';
import { releaseVersions } from '../record/versions.js';
import { hunksOf } from '../record/hunks.js';

export type Withdrawal = 'reverted' | 'overwritten' | 'formed' | 'thread-deleted' | 'checkout-gone' | 'outside';

export type Leaving = { readonly id: string; readonly after?: string | null } & (
  | { readonly state: 'committed'; readonly commit: string }
  | { readonly state: 'withdrawn'; readonly reason: Withdrawal; readonly span: ReleasedSpan | null }
);

export type StandingRow = typeof workspaceChange.$inferSelect;

const metadata = getTableColumns(workspaceChange);

const OPERATOR_KEY = holderKey(OPERATOR);

export type OwedPath = typeof changeDebt.$inferSelect;

export type Proof = typeof retirementProof.$inferSelect;

const PROOFS_PER_STATEMENT = rowsPerStatement(8);

export type Owing = {
  readonly checkout: string;
  readonly path: string;
  readonly commit: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly source: DebtSource;
  readonly reason: string;
  readonly windows: readonly DebtWindow[];
};

const leaving = writes('ChangeRecord.retire', [], changeLogWrites, retirementWrites);

const vacating = writes('ChangeRecord.vacate', [checkoutSeen, changeLanding, changeLanded, changeDebt, releasedLine, retirementProof]);

const openWindow = (store: StoreShape) =>
  notExists(
    store.db
      .select({ id: commandWindow.id })
      .from(commandWindow)
      .where(and(eq(commandWindow.checkout, workspaceChange.checkout), eq(commandWindow.threadId, workspaceChange.holder))),
  );

export type RetireStore = Effect.Success<typeof makeRetireStore>;

export const makeRetireStore = Effect.gen(function* () {
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  return {
    checkouts: (): Effect.Effect<readonly string[], StoreFailure> =>
      units.read((unit) =>
        Effect.map(
          unit.run(store.db.selectDistinct({ checkout: workspaceChange.checkout }).from(workspaceChange).where(standing)),
          (rows) => rows.map((row) => row.checkout),
        ),
      ),

    hunks: (rows: readonly StandingRow[]) =>
      hunksOf(
        units,
        store,
        rows.map((row) => ({ ...row, newLines: row.lines })),
      ),

    standing: (checkout: string): Effect.Effect<readonly StandingRow[], StoreFailure> =>
      units.read((unit) =>
        unit.run(
          store.db
            .select(metadata)
            .from(workspaceChange)
            .where(and(eq(workspaceChange.checkout, checkout), standing))
            .orderBy(workspaceChange.path, workspaceChange.at, workspaceChange.id),
        ),
      ),

    ofThread: (projectId: number, threadId: string): Effect.Effect<readonly StandingRow[], StoreFailure> =>
      units.read((unit) =>
        unit.run(
          store.db
            .select(metadata)
            .from(workspaceChange)
            .where(and(eq(workspaceChange.holderProjectId, projectId), eq(workspaceChange.holder, threadId), held))
            .orderBy(workspaceChange.path, workspaceChange.at, workspaceChange.id),
        ),
      ),

    orphaned: (): Effect.Effect<readonly StandingRow[], StoreFailure> =>
      units.read((unit) =>
        unit.run(
          store.db
            .select(metadata)
            .from(workspaceChange)
            .where(
              and(
                held,
                ne(workspaceChange.holder, OPERATOR_KEY),
                sql`not exists (select 1 from ${recordsAs('r')} where r.id = ${workspaceChange.holder} and r.project_id = ${workspaceChange.holderProjectId})`,
              ),
            ),
        ),
      ),

    seen: (checkout: string): Effect.Effect<string | null, StoreFailure> =>
      units.read((unit) =>
        Effect.map(
          unit.run(store.db.select({ head: checkoutSeen.head }).from(checkoutSeen).where(eq(checkoutSeen.checkout, checkout))),
          (rows) => rows[0]?.head ?? null,
        ),
      ),

    headless: (checkout: string, head: string): Effect.Effect<void, StoreFailure> =>
      units.write(retirementWrites, (unit) =>
        unit.run(
          store.db
            .update(workspaceChange)
            .set({ head })
            .where(and(eq(workspaceChange.checkout, checkout), standing, isNull(workspaceChange.head))),
        ),
      ),

    advance: (
      checkout: string,
      head: string,
      last: ReadonlyMap<string, string>,
      kept: readonly string[],
      proofs: readonly Proof[] = [],
    ): Effect.Effect<void, StoreFailure> =>
      units.write(retirementWrites, (unit) =>
        Effect.gen(function* () {
          for (const part of chunk(proofs, PROOFS_PER_STATEMENT))
            yield* unit.run(
              store.db
                .insert(retirementProof)
                .values([...part])
                .onConflictDoNothing(),
            );
          for (const [path, commit] of last)
            yield* unit.run(
              store.db
                .update(retirementProof)
                .set({ span: null })
                .where(and(eq(retirementProof.checkout, checkout), eq(retirementProof.path, path), ne(retirementProof.commit, commit))),
            );
          const touched = [...last.keys()];
          if (touched.length > 0) {
            const posted = yield* unit.run(
              store.db
                .select({ path: changeDebt.path, commit: changeDebt.commit })
                .from(changeDebt)
                .where(and(eq(changeDebt.checkout, checkout), eq(changeDebt.source, 'post-commit'))),
            );
            for (const debt of posted) {
              const latest = last.get(debt.path);
              if (latest === undefined || latest === debt.commit) continue;
              yield* unit.run(
                store.db
                  .delete(changeDebt)
                  .where(
                    and(
                      eq(changeDebt.checkout, checkout),
                      eq(changeDebt.path, debt.path),
                      eq(changeDebt.commit, debt.commit),
                      eq(changeDebt.source, 'post-commit'),
                    ),
                  ),
              );
            }
          }
          if (touched.length > 0)
            yield* unit.run(
              store.db
                .delete(releasedLine)
                .where(
                  and(
                    eq(releasedLine.checkout, checkout),
                    inArray(releasedLine.path, [...touched]),
                    kept.length === 0 ? undefined : notInArray(releasedLine.row, [...kept]),
                  ),
                ),
            );
          yield* unit.run(
            store.db.insert(checkoutSeen).values({ checkout, head }).onConflictDoUpdate({ target: checkoutSeen.checkout, set: { head } }),
          );
        }),
      ),

    proofs: (checkout: string): Effect.Effect<readonly Proof[], StoreFailure> =>
      units.read((unit) => unit.run(store.db.select().from(retirementProof).where(eq(retirementProof.checkout, checkout)))),

    forget: (ids: readonly string[]): Effect.Effect<void, StoreFailure> =>
      units.write(retirementWrites, (unit) =>
        Effect.forEach(
          chunk(ids, rowsPerStatement(1)),
          (part) => unit.run(store.db.delete(retirementProof).where(inArray(retirementProof.row, [...part]))),
          { discard: true },
        ),
      ),

    landing: (checkout: string, commit: string, tree: string): Effect.Effect<void, StoreFailure> =>
      units.write(landingWrites, (unit) =>
        Effect.gen(function* () {
          yield* unit.run(store.db.insert(changeLanding).values({ checkout, commit, tree }).onConflictDoNothing());
          yield* unit.run(
            store.db.delete(changeLanded).where(
              and(
                eq(changeLanded.checkout, checkout),
                notExists(
                  store.db
                    .select({ id: workspaceChange.id })
                    .from(workspaceChange)
                    .where(and(eq(workspaceChange.checkout, changeLanded.checkout), eq(workspaceChange.path, changeLanded.path), standing)),
                ),
              ),
            ),
          );
        }),
      ),

    trees: (checkout: string, commits: readonly string[]): Effect.Effect<ReadonlyMap<string, string>, StoreFailure> =>
      commits.length === 0
        ? Effect.succeed(new Map())
        : units.read((unit) =>
            Effect.map(
              unit.run(
                store.db
                  .select({ commit: changeLanding.commit, tree: changeLanding.tree })
                  .from(changeLanding)
                  .where(and(eq(changeLanding.checkout, checkout), inArray(changeLanding.commit, [...commits]))),
              ),
              (rows) => new Map(rows.map((row) => [row.commit, row.tree] as const)),
            ),
          ),

    leave: (decisions: readonly Leaving[], guarded: boolean): Effect.Effect<readonly StandingRow[], StoreFailure> =>
      decisions.length === 0
        ? Effect.succeed([])
        : units.write(leaving, (unit) =>
            Effect.gen(function* () {
              const left: StandingRow[] = [];
              for (const decision of decisions) {
                const set =
                  decision.state === 'committed'
                    ? { state: 'committed' as const, commit: decision.commit, committedAt: new Date(yield* Clock.currentTimeMillis) }
                    : { state: 'withdrawn' as const, reason: decision.reason, withdrawnAt: new Date(yield* Clock.currentTimeMillis) };
                const rows = yield* unit.run(
                  store.db
                    .update(workspaceChange)
                    .set(set)
                    .where(
                      and(
                        eq(workspaceChange.id, decision.id),
                        held,
                        guarded ? openWindow(store) : undefined,
                        decision.after === undefined
                          ? undefined
                          : decision.after === null
                            ? isNull(workspaceChange.afterHash)
                            : eq(workspaceChange.afterHash, decision.after),
                      ),
                    )
                    .returning(metadata),
                );
                for (const row of rows) {
                  if (decision.state === 'withdrawn' && decision.span !== null)
                    yield* unit.run(
                      store.db
                        .insert(releasedLine)
                        .values({
                          row: row.id,
                          checkout: row.checkout,
                          path: row.path,
                          thread: row.holder,
                          reason: decision.reason,
                          span: decision.span,
                        })
                        .onConflictDoNothing(),
                    );
                  yield* unit.run(store.db.delete(retirementProof).where(eq(retirementProof.row, row.id)));
                  left.push(row);
                }
              }
              yield* releaseVersions(
                store.db,
                left.flatMap((row) => [row.beforeHash, row.afterHash]),
              );
              return left;
            }),
          ),

    vacate: (checkout: string): Effect.Effect<void, StoreFailure> =>
      units.write(vacating, (unit) =>
        Effect.gen(function* () {
          yield* unit.run(store.db.delete(changeDebt).where(eq(changeDebt.checkout, checkout)));
          yield* unit.run(store.db.delete(releasedLine).where(eq(releasedLine.checkout, checkout)));
          yield* unit.run(store.db.delete(changeLanding).where(eq(changeLanding.checkout, checkout)));
          yield* unit.run(store.db.delete(changeLanded).where(eq(changeLanded.checkout, checkout)));
          yield* unit.run(store.db.delete(retirementProof).where(eq(retirementProof.checkout, checkout)));
          yield* unit.run(store.db.delete(checkoutSeen).where(eq(checkoutSeen.checkout, checkout)));
        }),
      ),

    owe: (debt: Owing): Effect.Effect<void, StoreFailure> =>
      units.write(debtWrites, (unit) => unit.run(store.db.insert(changeDebt).values(debt).onConflictDoNothing())),

    owed: (checkout: string): Effect.Effect<readonly OwedPath[], StoreFailure> =>
      units.read((unit) =>
        unit.run(store.db.select().from(changeDebt).where(eq(changeDebt.checkout, checkout)).orderBy(changeDebt.at, changeDebt.commit)),
      ),

    paid: (debt: OwedPath): Effect.Effect<void, StoreFailure> =>
      units.write(debtWrites, (unit) =>
        unit.run(
          store.db
            .delete(changeDebt)
            .where(
              and(
                eq(changeDebt.checkout, debt.checkout),
                eq(changeDebt.path, debt.path),
                eq(changeDebt.commit, debt.commit),
                eq(changeDebt.source, debt.source),
              ),
            ),
        ),
      ),

    indebted: (): Effect.Effect<readonly string[], StoreFailure> =>
      units.read((unit) =>
        Effect.map(unit.run(store.db.selectDistinct({ checkout: changeDebt.checkout }).from(changeDebt)), (rows) =>
          rows.map((row) => row.checkout),
        ),
      ),

    running: (checkout: string): Effect.Effect<boolean, StoreFailure> =>
      units.read((unit) =>
        Effect.map(
          unit.run(store.db.select({ id: commandWindow.id }).from(commandWindow).where(eq(commandWindow.checkout, checkout)).limit(1)),
          (rows) => rows.length > 0,
        ),
      ),

    archived: (rows: readonly StandingRow[]): Effect.Effect<ReadonlySet<string>, StoreFailure> => {
      const asked = new Map(rows.filter((row) => row.holder !== OPERATOR_KEY).map((row) => [row.holder, row.holderProjectId] as const));
      if (asked.size === 0) return Effect.succeed(new Set());
      return units.read((unit) =>
        Effect.map(
          unit.run(
            store.db
              .select({ id: threadRecord.id, projectId: threadRecord.projectId })
              .from(threadRecord)
              .where(
                and(
                  inArray(threadRecord.id, [...asked.keys()]),
                  isNotNull(threadRecord.archivedAt),
                  sql`exists (
              select 1 from ${workspaceChange} where ${workspaceChange.holder} = ${threadRecord.id}
                and ${workspaceChange.holderProjectId} = ${threadRecord.projectId})`,
                ),
              ),
          ),
          (found) => new Set(found.flatMap((one) => (asked.get(one.id) === one.projectId ? [one.id] : []))),
        ),
      );
    },
  };
});
