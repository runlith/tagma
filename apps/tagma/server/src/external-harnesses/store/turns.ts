import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lt, notInArray, sql, type SQL } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { Effect, Schema } from 'effect';
import { threadRecord } from '../../thread-record/store/table.js';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits, Unit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { HarnessSession } from '../../threads/contract/wire/harness/session.js';

export const vendorTurn = sqliteTable(
  'vendor_turn',
  {
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    runId: text('run_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    address: text('address'),
    last: text('last'),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.runId] }), index('vendor_turn_order').on(table.threadId, table.ordinal)],
);

export const vendorSession = sqliteTable('vendor_session', {
  threadId: text('thread_id')
    .primaryKey()
    .references(() => threadRecord.id, { onDelete: 'cascade' }),
  account: text('account'),
  replaced: text('replaced', { mode: 'json' }).$type<unknown>(),
  origin: text('origin', { mode: 'json' }).$type<unknown>(),
  owed: text('owed'),
});

export type VendorAddress = { readonly run: string; readonly address: string | null; readonly last: string | null };

export type LaunchedCut = NonNullable<HarnessSession['cut']>;

export const accountKey = (account: HarnessSession['account']): string | null => account?.key ?? null;

export const VendorTurnRow = Schema.Struct({
  run: Schema.String,
  ordinal: Schema.Int,
  address: Schema.NullOr(Schema.String),
  last: Schema.optional(Schema.NullOr(Schema.String)),
});
export type VendorTurnRow = typeof VendorTurnRow.Type;

export const ReplacedRoot = Schema.Struct({ root: Schema.String, cut: Schema.Array(Schema.String), turns: Schema.Array(VendorTurnRow) });
export type ReplacedRoot = typeof ReplacedRoot.Type;

export const VendorOrigin = Schema.Struct({ root: Schema.String, address: Schema.NullOr(Schema.String) });
export type VendorOrigin = typeof VendorOrigin.Type;

export type VendorSessionRow = {
  readonly account: string | null;
  readonly replaced: ReplacedRoot | null;
  readonly origin: VendorOrigin | null;
};

export type CutPoint =
  | { readonly _tag: 'None' }
  | { readonly _tag: 'Fresh' }
  | { readonly _tag: 'Cut'; readonly run: string; readonly address: string; readonly ordinal: number };

const NONE: CutPoint = { _tag: 'None' };
const FRESH: CutPoint = { _tag: 'Fresh' };

const decodeReplaced = Schema.decodeUnknownResult(Schema.NullOr(ReplacedRoot));
const decodeOrigin = Schema.decodeUnknownResult(Schema.NullOr(VendorOrigin));

export class VendorTurns {
  readonly writes = writes('VendorTurns.write', [vendorTurn, vendorSession]);

  constructor(
    private readonly db: StoreDb<'machine'>,
    private readonly units: MachineUnits['Service'],
  ) {}

  turn(threadId: string, run: string, unit?: Unit<'machine'>): Effect.Effect<VendorTurnRow | undefined, StoreFailure> {
    const read = (held: Unit<'machine'>) =>
      Effect.map(
        held.run(
          this.db
            .select({ run: vendorTurn.runId, ordinal: vendorTurn.ordinal, address: vendorTurn.address, last: vendorTurn.last })
            .from(vendorTurn)
            .where(and(eq(vendorTurn.threadId, threadId), eq(vendorTurn.runId, run)))
            .get(),
        ),
        (row): VendorTurnRow | undefined => row,
      );
    return unit === undefined ? this.units.read(read) : read(unit);
  }

  turns(unit: Unit<'machine'>, threadId: string): Effect.Effect<readonly VendorTurnRow[], StoreFailure> {
    return unit.run(
      this.db
        .select({ run: vendorTurn.runId, ordinal: vendorTurn.ordinal, address: vendorTurn.address, last: vendorTurn.last })
        .from(vendorTurn)
        .where(eq(vendorTurn.threadId, threadId))
        .orderBy(asc(vendorTurn.ordinal))
        .all(),
    );
  }

  tail(unit: Unit<'machine'>, threadId: string): Effect.Effect<string | null, StoreFailure> {
    return Effect.map(
      unit.run(
        this.db
          .select({ last: vendorTurn.last })
          .from(vendorTurn)
          .where(and(eq(vendorTurn.threadId, threadId), isNotNull(vendorTurn.last)))
          .orderBy(desc(vendorTurn.ordinal))
          .limit(1)
          .get(),
      ),
      (row) => row?.last ?? null,
    );
  }

  record(unit: Unit<'machine'>, threadId: string, marks: readonly VendorAddress[]): Effect.Effect<void, StoreFailure> {
    return Effect.asVoid(
      Effect.forEach(marks, (mark) =>
        unit.run(
          this.db
            .insert(vendorTurn)
            .values({
              threadId,
              runId: mark.run,
              address: mark.address,
              last: mark.last,
              ordinal: sql`(select coalesce(max(ordinal), -1) + 1 from vendor_turn where thread_id = ${threadId})`,
            })
            .onConflictDoUpdate({
              target: [vendorTurn.threadId, vendorTurn.runId],
              set: {
                address: sql`coalesce(excluded.address, ${vendorTurn.address})`,
                last: sql`coalesce(excluded.last, ${vendorTurn.last})`,
              },
            }),
        ),
      ),
    );
  }

  copy(unit: Unit<'machine'>, source: string, child: string, before: number | null): Effect.Effect<void, StoreFailure> {
    return Effect.asVoid(
      unit.run(
        this.db.run(sql`insert into vendor_turn (thread_id, run_id, ordinal, address, last)
      select ${child}, run_id, ordinal, address, last from vendor_turn where thread_id = ${source}
      ${before === null ? sql`` : sql`and ordinal < ${before}`}`),
      ),
    );
  }

  point(threadId: string, cut: readonly string[], before: number | null, unit?: Unit<'machine'>): Effect.Effect<CutPoint, StoreFailure> {
    if (cut.length === 0) return Effect.succeed(NONE);
    return unit === undefined
      ? this.units.read((held) => this.pointIn(held, threadId, cut, before))
      : this.pointIn(unit, threadId, cut, before);
  }

  private readonly pointIn = Effect.fnUntraced(function* (
    this: VendorTurns,
    unit: Unit<'machine'>,
    threadId: string,
    cut: readonly string[],
    before: number | null,
  ) {
    const { db } = this;
    const within = (more: SQL | undefined) =>
      and(eq(vendorTurn.threadId, threadId), before === null ? undefined : lt(vendorTurn.ordinal, before), more);
    const first = yield* unit.run(
      db
        .select()
        .from(vendorTurn)
        .where(within(inArray(vendorTurn.runId, [...cut])))
        .orderBy(asc(vendorTurn.ordinal))
        .limit(1)
        .get(),
    );
    if (first === undefined) return NONE;
    if (first.address === null) return FRESH;
    const earlier = yield* unit.run(
      db
        .select({ run: vendorTurn.runId })
        .from(vendorTurn)
        .where(within(lt(vendorTurn.ordinal, first.ordinal)))
        .limit(1)
        .get(),
    );
    const kept = yield* unit.run(
      db
        .select({ run: vendorTurn.runId })
        .from(vendorTurn)
        .where(within(and(gt(vendorTurn.ordinal, first.ordinal), notInArray(vendorTurn.runId, [...cut]))))
        .limit(1)
        .get(),
    );
    if (earlier === undefined || kept !== undefined) return FRESH;
    const point: CutPoint = { _tag: 'Cut', run: first.runId, address: first.address, ordinal: first.ordinal };
    return point;
  });

  readonly holds = Effect.fnUntraced(function* (this: VendorTurns, unit: Unit<'machine'>, threadId: string, runs: readonly string[]) {
    if (runs.length === 0) return true;
    const held = yield* unit.run(
      this.db
        .select({ held: sql<number>`count(*)` })
        .from(vendorTurn)
        .where(and(eq(vendorTurn.threadId, threadId), inArray(vendorTurn.runId, [...runs])))
        .get(),
    );
    return (held?.held ?? 0) === new Set(runs).size;
  });

  based(unit: Unit<'machine'>, threadId: string, standing: readonly string[]): Effect.Effect<void, StoreFailure> {
    return Effect.all(
      [
        this.rowsGone(unit, threadId),
        this.inserted(
          unit,
          threadId,
          standing.map((run) => ({ run, address: null, last: null })),
        ),
        this.heard(unit, threadId),
      ],
      { discard: true },
    );
  }

  owed(threadId: string, unit?: Unit<'machine'>): Effect.Effect<string | null, StoreFailure> {
    const read = (held: Unit<'machine'>) =>
      Effect.map(
        held.run(this.db.select({ owed: vendorSession.owed }).from(vendorSession).where(eq(vendorSession.threadId, threadId)).get()),
        (row) => row?.owed ?? null,
      );
    return unit === undefined ? this.units.read(read) : read(unit);
  }

  readonly owe = Effect.fn('VendorTurns.owe')(function* (this: VendorTurns, unit: Unit<'machine'>, threadId: string, told: string) {
    if (told === '') return;
    const standing = yield* this.owed(threadId, unit);
    const owed = standing === null ? told : `${standing}\n\n${told}`;
    yield* unit.run(
      this.db
        .insert(vendorSession)
        .values({ threadId, account: null, replaced: null, origin: null, owed })
        .onConflictDoUpdate({ target: vendorSession.threadId, set: { owed } }),
    );
  });

  heard(unit: Unit<'machine'>, threadId: string): Effect.Effect<void, StoreFailure> {
    return Effect.asVoid(unit.run(this.db.update(vendorSession).set({ owed: null }).where(eq(vendorSession.threadId, threadId))));
  }

  readonly cut = Effect.fnUntraced(function* (
    this: VendorTurns,
    unit: Unit<'machine'>,
    threadId: string,
    root: string | null,
    run: string,
  ) {
    const turns = yield* this.turns(unit, threadId);
    const at = turns.find((turn) => turn.run === run);
    if (at === undefined) return;
    if (root !== null)
      yield* this.generation(unit, threadId, {
        root,
        cut: turns.flatMap((turn) => (turn.ordinal >= at.ordinal ? [turn.run] : [])),
        turns,
      });
    yield* unit.run(this.db.delete(vendorTurn).where(and(eq(vendorTurn.threadId, threadId), gte(vendorTurn.ordinal, at.ordinal))));
  });

  readonly replace = Effect.fnUntraced(function* (
    this: VendorTurns,
    unit: Unit<'machine'>,
    threadId: string,
    root: string,
    cut: readonly string[],
  ) {
    const turns = yield* this.turns(unit, threadId);
    const taken = new Set(cut);
    const replaced: ReplacedRoot = { root, cut: turns.flatMap((turn) => (taken.has(turn.run) ? [turn.run] : [])), turns };
    yield* this.generation(unit, threadId, replaced);
  });

  readonly addressed = Effect.fnUntraced(function* (
    this: VendorTurns,
    unit: Unit<'machine'>,
    threadId: string,
    addresses: readonly (string | null)[] | null,
  ) {
    const turns = yield* this.turns(unit, threadId);
    const paired = addresses !== null && addresses.length === turns.length;
    yield* Effect.forEach(
      turns,
      (turn, at) =>
        unit.run(
          this.db
            .update(vendorTurn)
            .set({ address: paired ? (addresses[at] ?? null) : null, last: null })
            .where(and(eq(vendorTurn.threadId, threadId), eq(vendorTurn.runId, turn.run))),
        ),
      { discard: true },
    );
  });

  readonly session = Effect.fnUntraced(function* (
    this: VendorTurns,
    threadId: string,
    unit?: Unit<'machine'>,
  ): Effect.fn.Return<VendorSessionRow | null, StoreFailure | GateRefusal> {
    const read = (held: Unit<'machine'>) =>
      held.run(
        this.db
          .select({ account: vendorSession.account, replaced: vendorSession.replaced, origin: vendorSession.origin })
          .from(vendorSession)
          .where(eq(vendorSession.threadId, threadId))
          .get(),
      );
    const stored = unit === undefined ? yield* this.units.read(read) : yield* read(unit);
    if (stored === undefined) return null;
    const replaced = decodeReplaced(stored.replaced ?? null);
    const origin = decodeOrigin(stored.origin ?? null);
    if (replaced._tag === 'Failure' || origin._tag === 'Failure') {
      return yield* new GateRefusal('session-unreadable', `The vendor session header of ${threadId} cannot be read.`, [
        'inspect the stored vendor session',
      ]);
    }
    return { account: stored.account, replaced: replaced.success, origin: origin.success };
  });

  readonly returned = Effect.fnUntraced(function* (
    this: VendorTurns,
    unit: Unit<'machine'>,
    threadId: string,
    runIds: readonly string[],
  ): Effect.fn.Return<ReplacedRoot | null, StoreFailure | GateRefusal> {
    const replaced = (yield* this.session(threadId, unit))?.replaced ?? null;
    const asked = new Set(runIds);
    if (replaced === null || replaced.cut.length !== asked.size || replaced.cut.some((run) => !asked.has(run))) return null;
    yield* this.rowsGone(unit, threadId);
    if (replaced.turns.length > 0)
      yield* unit.run(
        this.db.insert(vendorTurn).values(
          replaced.turns.map((turn) => ({
            threadId,
            runId: turn.run,
            ordinal: turn.ordinal,
            address: turn.address,
            last: turn.last ?? null,
          })),
        ),
      );
    yield* this.generation(unit, threadId, null);
    return replaced;
  });

  readonly committed = Effect.fnUntraced(function* (
    this: VendorTurns,
    unit: Unit<'machine'>,
    threadId: string,
    cut: LaunchedCut,
    account: string | null,
  ) {
    if (cut.at !== null) yield* this.cut(unit, threadId, cut.own ? cut.root : null, cut.at);
    if (cut.rows === 'unaddressed') yield* this.addressed(unit, threadId, null);
    yield* this.established(unit, threadId, account);
  });

  established(unit: Unit<'machine'>, threadId: string, account: string | null): Effect.Effect<void, StoreFailure> {
    return Effect.asVoid(
      unit.run(
        this.db
          .insert(vendorSession)
          .values({ threadId, account, replaced: null, origin: null })
          .onConflictDoUpdate({ target: vendorSession.threadId, set: { account, origin: null } }),
      ),
    );
  }

  forked(unit: Unit<'machine'>, child: string, origin: VendorOrigin, account: string | null): Effect.Effect<void, StoreFailure> {
    return Effect.asVoid(
      unit.run(
        this.db
          .insert(vendorSession)
          .values({ threadId: child, account, replaced: null, origin })
          .onConflictDoUpdate({ target: vendorSession.threadId, set: { account, replaced: null, origin } }),
      ),
    );
  }

  launched(unit: Unit<'machine'>, threadId: string, account: string | null): Effect.Effect<void, StoreFailure> {
    return Effect.asVoid(unit.run(this.db.update(vendorSession).set({ account }).where(eq(vendorSession.threadId, threadId))));
  }

  forget(unit: Unit<'machine'>, threadId: string): Effect.Effect<void, StoreFailure> {
    return Effect.andThen(
      this.rowsGone(unit, threadId),
      Effect.asVoid(unit.run(this.db.delete(vendorSession).where(eq(vendorSession.threadId, threadId)))),
    );
  }

  private rowsGone(unit: Unit<'machine'>, threadId: string): Effect.Effect<void, StoreFailure> {
    return Effect.asVoid(unit.run(this.db.delete(vendorTurn).where(eq(vendorTurn.threadId, threadId))));
  }

  private inserted(unit: Unit<'machine'>, threadId: string, marks: readonly VendorAddress[]): Effect.Effect<void, StoreFailure> {
    return marks.length === 0
      ? Effect.void
      : Effect.asVoid(
          unit.run(
            this.db
              .insert(vendorTurn)
              .values(marks.map((mark, ordinal) => ({ threadId, runId: mark.run, ordinal, address: mark.address, last: mark.last }))),
          ),
        );
  }

  private generation(unit: Unit<'machine'>, threadId: string, replaced: ReplacedRoot | null): Effect.Effect<void, StoreFailure> {
    return Effect.asVoid(
      unit.run(
        this.db
          .insert(vendorSession)
          .values({ threadId, account: null, replaced, origin: null })
          .onConflictDoUpdate({ target: vendorSession.threadId, set: { replaced } }),
      ),
    );
  }
}
