import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { PageId, ProfileId } from '../contract/wire/ids.js';
import type { Removal } from '../contract/wire/profile.js';
import { browserPage, browserProfile } from './tables.js';

export type ProfileRow = typeof browserProfile.$inferSelect;
export type PageRow = typeof browserPage.$inferSelect;
export type PagePatch = Partial<Omit<PageRow, 'id' | 'projectId' | 'profile'>>;

export const CLOSED_KEPT = 20;

export type PageWalk = {
  readonly closed: boolean;
  readonly limit: number;
  readonly after: { readonly at: number; readonly id: string } | null;
};

export class Ledger extends Context.Service<
  Ledger,
  {
    readonly profiles: Effect.Effect<readonly ProfileRow[], StoreFailure>;
    profile(id: ProfileId): Effect.Effect<ProfileRow | undefined, StoreFailure>;
    seed(rows: readonly ProfileRow[]): Effect.Effect<void, StoreFailure>;
    putProfile(row: ProfileRow): Effect.Effect<void, StoreFailure>;
    changeProfile(
      id: ProfileId,
      patch: Partial<Pick<ProfileRow, 'name' | 'console' | 'input'>>,
    ): Effect.Effect<ProfileRow | undefined, StoreFailure>;
    markProfile(id: ProfileId, removal: Removal | null): Effect.Effect<void, StoreFailure>;
    dropProfile(id: ProfileId): Effect.Effect<void, StoreFailure>;
    readonly openPages: Effect.Effect<readonly PageRow[], StoreFailure>;
    page(id: PageId): Effect.Effect<PageRow | undefined, StoreFailure>;
    putPage(row: PageRow): Effect.Effect<void, StoreFailure>;
    changePage(id: PageId, patch: PagePatch): Effect.Effect<void, StoreFailure>;
    dropPage(id: PageId): Effect.Effect<void, StoreFailure>;
    closePages(ids: readonly PageId[], at: Date): Effect.Effect<void, StoreFailure>;
    walk(projectId: number, walk: PageWalk): Effect.Effect<{ readonly rows: readonly PageRow[]; readonly total: number }, StoreFailure>;
  }
>()('tagma/browser/Ledger') {}

export const makeLedger = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;

  const prune = (projectIds: ReadonlySet<number>) =>
    Effect.forEach(
      projectIds,
      (projectId) =>
        Effect.gen(function* () {
          const closed = yield* units.read((unit) =>
            unit.run(
              db
                .select({ id: browserPage.id })
                .from(browserPage)
                .where(and(eq(browserPage.projectId, projectId), isNotNull(browserPage.closedAt)))
                .orderBy(desc(browserPage.closedAt), desc(browserPage.id))
                .all(),
            ),
          );
          const dropped = closed.slice(CLOSED_KEPT);
          if (dropped.length === 0) return;
          yield* units.write(writes('Ledger.prune', [browserPage]), (unit) =>
            unit.run(
              db.delete(browserPage).where(
                inArray(
                  browserPage.id,
                  dropped.map((row) => row.id),
                ),
              ),
            ),
          );
        }),
      { discard: true },
    );

  return Ledger.of({
    profiles: units.read((unit) =>
      unit.run(db.select().from(browserProfile).orderBy(asc(browserProfile.createdAt), asc(browserProfile.id)).all()),
    ),
    profile: (id) => units.read((unit) => unit.run(db.select().from(browserProfile).where(eq(browserProfile.id, id)).get())),
    seed: (rows) =>
      rows.length === 0
        ? Effect.void
        : units.write(writes('Ledger.seed', [browserProfile]), (unit) =>
            unit.run(
              db
                .insert(browserProfile)
                .values([...rows])
                .onConflictDoNothing(),
            ),
          ),
    putProfile: (row) =>
      units.write(writes('Ledger.putProfile', [browserProfile]), (unit) => unit.run(db.insert(browserProfile).values(row))),
    changeProfile: (id, patch) =>
      units.write(writes('Ledger.changeProfile', [browserProfile]), (unit) =>
        unit.run(db.update(browserProfile).set(patch).where(eq(browserProfile.id, id)).returning().get()),
      ),
    markProfile: (id, removal) =>
      units.write(writes('Ledger.markProfile', [browserProfile]), (unit) =>
        unit.run(db.update(browserProfile).set({ removal }).where(eq(browserProfile.id, id))),
      ),
    dropProfile: (id) =>
      units.write(writes('Ledger.dropProfile', [browserProfile, browserPage]), (unit) =>
        Effect.andThen(
          unit.run(db.delete(browserPage).where(eq(browserPage.profile, id))),
          unit.run(db.delete(browserProfile).where(eq(browserProfile.id, id))),
        ),
      ),
    openPages: units.read((unit) => unit.run(db.select().from(browserPage).where(isNull(browserPage.closedAt)).all())),
    page: (id) => units.read((unit) => unit.run(db.select().from(browserPage).where(eq(browserPage.id, id)).get())),
    putPage: (row) => units.write(writes('Ledger.putPage', [browserPage]), (unit) => unit.run(db.insert(browserPage).values(row))),
    changePage: (id, patch) =>
      units.write(writes('Ledger.changePage', [browserPage]), (unit) =>
        unit.run(db.update(browserPage).set(patch).where(eq(browserPage.id, id))),
      ),
    dropPage: (id) =>
      units.write(writes('Ledger.dropPage', [browserPage]), (unit) => unit.run(db.delete(browserPage).where(eq(browserPage.id, id)))),
    closePages: Effect.fn('Ledger.closePages')(function* (ids, at) {
      if (ids.length === 0) return;
      const closed = yield* units.write(writes('Ledger.closePages', [browserPage]), (unit) =>
        unit.run(
          db
            .update(browserPage)
            .set({ closedAt: at })
            .where(and(inArray(browserPage.id, [...ids]), isNull(browserPage.closedAt)))
            .returning({ projectId: browserPage.projectId })
            .all(),
        ),
      );
      yield* prune(new Set(closed.map((row) => row.projectId)));
    }),
    walk: Effect.fn('Ledger.walk')(function* (projectId, walk) {
      const standing = and(
        eq(browserPage.projectId, projectId),
        walk.closed ? isNotNull(browserPage.closedAt) : isNull(browserPage.closedAt),
      );
      const order = walk.closed ? browserPage.closedAt : browserPage.activeAt;
      const past =
        walk.after === null
          ? standing
          : and(
              standing,
              or(lt(order, new Date(walk.after.at)), and(eq(order, new Date(walk.after.at)), lt(browserPage.id, walk.after.id as PageId))),
            );
      return yield* units.read((unit) =>
        Effect.gen(function* () {
          const rows = yield* unit.run(
            db.select().from(browserPage).where(past).orderBy(desc(order), desc(browserPage.id)).limit(walk.limit).all(),
          );
          const [total] = yield* unit.run(db.select({ total: count() }).from(browserPage).where(standing).all());
          return { rows, total: total?.total ?? 0 };
        }),
      );
    }),
  });
});

export const ledgerLayer = Layer.effect(Ledger, makeLedger);
