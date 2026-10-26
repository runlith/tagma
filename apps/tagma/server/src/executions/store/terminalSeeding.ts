import { gt, sql } from 'drizzle-orm';
import { Clock, Deferred, Effect, Ref } from 'effect';
import { freemem } from 'node:os';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { MachineUnits, WriteUnit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { TerminalUnavailable } from '../contract/wire/refusals.js';
import { openTerminal, openTerminalProgress, terminal } from './terminal.js';
import { queried } from './rows.js';

const SEED_PAGE_MS = 250;

export const seedRowBytes = (row: {
  readonly executionId: string;
  readonly incarnation: number;
  readonly dischargedAt: Date | null;
}): number => 8 + new TextEncoder().encode(row.executionId).length + 8 + 8;

export const seedPageSize = (freeBytes: number, rowBytes: number): number =>
  Math.max(1, Math.floor(freeBytes / 64 / Math.max(1, rowBytes)));

export const seedNextSize = (size: number, ms: number, freeBytes: number, rowBytes: number): number => {
  const memorySize = seedPageSize(freeBytes, rowBytes);
  if (ms > SEED_PAGE_MS) return Math.max(1, Math.floor(size / 2));
  if (ms < SEED_PAGE_MS / 4) return Math.min(memorySize, size * 2);
  return Math.min(memorySize, size);
};

export const seedPageDone = (rowsSeen: number, pageSize: number): boolean => rowsSeen < pageSize;

export type SeedReadiness = 'ready' | 'wait' | 'refuse';

export const seedReadiness = (done: boolean, seeding: boolean): SeedReadiness => (done ? 'ready' : seeding ? 'wait' : 'refuse');

export const seedPage = Effect.fnUntraced(function* (db: StoreDb<'machine'>, unit: WriteUnit<'machine'>, cursor: number, pageSize: number) {
  const rows = yield* queried(
    unit,
    db
      .select({
        rowid: sql<number>`rowid`,
        executionId: terminal.executionId,
        incarnation: terminal.incarnation,
        dischargedAt: terminal.dischargedAt,
      })
      .from(terminal)
      .where(gt(sql<number>`rowid`, cursor))
      .orderBy(sql`rowid`)
      .limit(pageSize)
      .all(),
  );
  const open = rows.filter((row) => row.dischargedAt === null);
  if (open.length > 0) {
    yield* queried(
      unit,
      db
        .insert(openTerminal)
        .values(
          open.map((row) => ({
            terminalId: row.executionId,
            incarnation: row.incarnation,
          })),
        )
        .onConflictDoNothing(),
    );
  }
  const finished = seedPageDone(rows.length, pageSize);
  const stepped = rows.length === 0 ? cursor : rows[rows.length - 1]!.rowid;
  const rowBytes = rows.reduce((widest, row) => Math.max(widest, seedRowBytes(row)), 0);
  const held = yield* queried(unit, db.select().from(openTerminalProgress).all());
  if (held.length === 0) {
    yield* queried(unit, db.insert(openTerminalProgress).values({ cursor: stepped, done: finished ? 1 : 0 }));
  } else {
    yield* queried(unit, db.update(openTerminalProgress).set({ cursor: stepped, done: finished ? 1 : 0 }));
  }
  return { cursor: stepped, finished, rowBytes };
});

export const seedAll = Effect.fnUntraced(
  function* (
    db: StoreDb<'machine'>,
    units: MachineUnits['Service'],
    gate: Deferred.Deferred<void, TerminalUnavailable>,
    seeding: Ref.Ref<boolean>,
  ) {
    yield* Ref.set(seeding, true);
    const held = yield* units.read((unit) => queried(unit, db.select().from(openTerminalProgress).all()));
    if (held[0]?.done === 1) {
      yield* Deferred.succeed(gate, undefined);
      return;
    }
    let cursor = held[0]?.cursor ?? 0;
    let envelope = 0;
    let size = 1;
    while (true) {
      const startedAt = yield* Clock.currentTimeMillis;
      const stepped = yield* units.write(writes('terminalSeeding.page', [terminal, openTerminal, openTerminalProgress]), (unit) =>
        seedPage(db, unit, cursor, size),
      );
      const ms = (yield* Clock.currentTimeMillis) - startedAt;
      cursor = stepped.cursor;
      envelope = Math.max(envelope, stepped.rowBytes);
      if (stepped.finished) break;
      size = seedNextSize(size, ms, freemem(), envelope);
      yield* Effect.yieldNow;
    }
    yield* Deferred.succeed(gate, undefined);
  },
  (effect) =>
    Effect.tapError(effect, (failure) =>
      Effect.logError('open-terminal seeding failed; the replaced-generation sweep does not run until a later boot resumes it', {
        reason: failure instanceof Error ? failure.message : 'unreadable-store-failure',
      }),
    ),
  (effect, _db, _units, gate, seeding) =>
    Effect.onError(effect, () =>
      Effect.andThen(
        Deferred.fail(
          gate,
          new TerminalUnavailable({
            owner: 'store',
            message:
              'open-terminal seeding stopped before the side table was complete; the replaced-generation sweep waits for a later boot to resume it',
          }),
        ),
        Ref.set(seeding, false),
      ),
    ),
);
