import { and, asc, eq, gt, inArray, lt, or } from 'drizzle-orm';
import { Effect } from 'effect';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { Units } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { PreparedMerge } from '../../change-record/contract/service/prepared.js';
import { type IntentKind, type IntentPhase, landingIntent, landingReceipt, opened } from './tables.js';

export type Intent = {
  readonly key: string;
  readonly kind: IntentKind;
  readonly projectId: number;
  readonly phase: IntentPhase;
  readonly repository: string;
  readonly checkout: string;
  readonly ref: string;
  readonly base: string;
  readonly tree: string;
  readonly merge?: PreparedMerge | null;
  readonly commit: string | null;
  readonly witnessedAt: Date | null;
  readonly at: Date;
};

export type IntentReceipt = { readonly key: string; readonly commit: string; readonly at: Date };

export type IntentPosition = { readonly at: Date; readonly key: string };

export type IntentLifecycle = {
  readonly read: (key: string) => Effect.Effect<{ readonly intent: Intent; readonly receipt: IntentReceipt | null } | null, StoreFailure>;
  readonly intend: (intent: Intent) => Effect.Effect<void, StoreFailure>;
  readonly claim: (intent: Intent, abandoned: Date | null) => Effect.Effect<boolean, StoreFailure>;
  readonly witness: (key: string, commit: string, at: Date) => Effect.Effect<void, StoreFailure>;
  readonly receive: (key: string, commit: string, at: Date) => Effect.Effect<void, StoreFailure>;
  readonly settle: (key: string) => Effect.Effect<void, StoreFailure>;
  readonly lose: (key: string) => Effect.Effect<void, StoreFailure>;
  readonly forget: (key: string, at?: Date) => Effect.Effect<void, StoreFailure>;
  readonly land: (key: string, commit: string, at: Date) => Effect.Effect<boolean, StoreFailure>;
  readonly open: (
    kind: IntentKind,
    after: IntentPosition | null,
    limit: number,
    checkout?: string,
  ) => Effect.Effect<readonly Intent[], StoreFailure>;
  readonly prune: (kind: IntentKind, before: Date, limit: number) => Effect.Effect<number, StoreFailure>;
};

const intending = writes('landing.intend', [landingIntent]);
const claiming = writes('landing.claim', [landingIntent]);
const witnessing = writes('landing.witness', [landingIntent]);
const receiving = writes('landing.receive', [landingIntent, landingReceipt]);
const settling = writes('landing.settle', [landingIntent]);
const losing = writes('landing.lose', [landingIntent]);
const forgetting = writes('landing.forget', [landingIntent, landingReceipt]);
const landing = writes('landing.land', [landingIntent, landingReceipt]);
const pruning = writes('landing.prune', [landingIntent, landingReceipt]);

const intentOf = (row: typeof landingIntent.$inferSelect): Intent => ({
  key: row.key,
  kind: row.kind,
  projectId: row.projectId,
  phase: row.phase,
  repository: row.repository,
  checkout: row.checkout,
  ref: row.ref,
  base: row.base,
  tree: row.tree,
  merge: row.merge,
  commit: row.commit,
  witnessedAt: row.witnessedAt,
  at: row.at,
});

export const intentLifecycle = (db: StoreDb<'machine'>, units: Units<'machine'>): IntentLifecycle => {
  return {
    read: (key) =>
      units.read((unit) =>
        Effect.map(
          unit.run(
            db
              .select({ intent: landingIntent, receipt: landingReceipt })
              .from(landingIntent)
              .leftJoin(landingReceipt, eq(landingReceipt.key, landingIntent.key))
              .where(eq(landingIntent.key, key))
              .get(),
          ),
          (row) => (row === undefined ? null : { intent: intentOf(row.intent), receipt: row.receipt }),
        ),
      ),
    intend: (intent) => units.write(intending, (unit) => Effect.asVoid(unit.run(db.insert(landingIntent).values(intent)))),
    claim: (intent, abandoned) =>
      units.write(claiming, (unit) =>
        Effect.gen(function* () {
          if (abandoned !== null) {
            yield* unit.run(
              db
                .delete(landingIntent)
                .where(and(eq(landingIntent.key, intent.key), eq(landingIntent.at, abandoned), eq(landingIntent.phase, 'intended'))),
            );
          }
          const taken = yield* unit.run(
            db.insert(landingIntent).values(intent).onConflictDoNothing().returning({ key: landingIntent.key }).all(),
          );
          return taken.length > 0;
        }),
      ),
    witness: (key, commit, at) =>
      units.write(witnessing, (unit) =>
        Effect.asVoid(
          unit.run(
            db
              .update(landingIntent)
              .set({ phase: 'publishing', commit, witnessedAt: at })
              .where(and(eq(landingIntent.key, key), eq(landingIntent.phase, 'intended'))),
          ),
        ),
      ),
    receive: (key, commit, at) =>
      units.write(receiving, (unit) =>
        Effect.andThen(
          unit.run(db.insert(landingReceipt).values({ key, commit, at }).onConflictDoNothing()),
          unit.run(
            db
              .update(landingIntent)
              .set({ phase: 'published' })
              .where(and(eq(landingIntent.key, key), eq(landingIntent.phase, 'publishing'))),
          ),
        ).pipe(Effect.asVoid),
      ),
    settle: (key) =>
      units.write(settling, (unit) =>
        Effect.asVoid(
          unit.run(
            db
              .update(landingIntent)
              .set({ phase: 'settled' })
              .where(and(eq(landingIntent.key, key), eq(landingIntent.phase, 'published'))),
          ),
        ),
      ),
    lose: (key) =>
      units.write(losing, (unit) =>
        Effect.asVoid(
          unit.run(
            db
              .update(landingIntent)
              .set({ phase: 'lost' })
              .where(and(eq(landingIntent.key, key), eq(landingIntent.phase, 'publishing'))),
          ),
        ),
      ),
    forget: (key, at) =>
      units.write(forgetting, (unit) =>
        Effect.asVoid(
          unit.run(
            db
              .delete(landingIntent)
              .where(
                and(
                  eq(landingIntent.key, key),
                  or(eq(landingIntent.phase, 'intended'), eq(landingIntent.phase, 'publishing')),
                  at === undefined ? undefined : eq(landingIntent.at, at),
                ),
              ),
          ),
        ),
      ),
    land: (key, commit, at) =>
      units.write(landing, (unit) =>
        Effect.gen(function* () {
          const moved = yield* unit.run(
            db
              .update(landingIntent)
              .set({ phase: 'settled', commit, witnessedAt: at })
              .where(and(eq(landingIntent.key, key), eq(landingIntent.phase, 'intended')))
              .returning({ key: landingIntent.key })
              .all(),
          );
          if (moved.length === 0) return false;
          yield* unit.run(db.insert(landingReceipt).values({ key, commit, at }));
          return true;
        }),
      ),
    prune: (kind, before, limit) =>
      units.write(pruning, (unit) =>
        Effect.map(
          unit.run(
            db
              .delete(landingIntent)
              .where(
                inArray(
                  landingIntent.key,
                  db
                    .select({ key: landingIntent.key })
                    .from(landingIntent)
                    .where(
                      and(eq(landingIntent.kind, kind), inArray(landingIntent.phase, ['settled', 'lost']), lt(landingIntent.at, before)),
                    )
                    .orderBy(asc(landingIntent.at))
                    .limit(limit),
                ),
              )
              .returning({ key: landingIntent.key })
              .all(),
          ),
          (gone) => gone.length,
        ),
      ),
    open: (kind, after, limit, checkout) =>
      units.read((unit) =>
        Effect.map(
          unit.run(
            db
              .select()
              .from(landingIntent)
              .where(
                and(
                  opened,
                  eq(landingIntent.kind, kind),
                  checkout === undefined ? undefined : eq(landingIntent.checkout, checkout),
                  after === null
                    ? undefined
                    : or(gt(landingIntent.at, after.at), and(eq(landingIntent.at, after.at), gt(landingIntent.key, after.key))),
                ),
              )
              .orderBy(asc(landingIntent.at), asc(landingIntent.key))
              .limit(limit)
              .all(),
          ),
          (rows) => rows.map(intentOf),
        ),
      ),
  };
};
