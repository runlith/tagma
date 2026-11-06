import { and, count, desc, eq, gt, isNull, lt, lte, or } from 'drizzle-orm';
import { Clock, Context, Effect, Layer } from 'effect';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { DevicePlace } from '../contract/service/devices.js';
import { device, pairing, remoteOrigin, remoteTerminal } from './tables.js';

export type DeviceRow = typeof device.$inferSelect;

export class Ledger extends Context.Service<
  Ledger,
  {
    byId(id: string): Effect.Effect<DeviceRow | undefined, StoreFailure>;
    seen(id: string, at: Date, until: Date): Effect.Effect<void, StoreFailure>;
    readonly origin: Effect.Effect<string | null, StoreFailure>;
    settle(origin: string): Effect.Effect<void, StoreFailure>;
    readonly terminal: Effect.Effect<number | null, StoreFailure>;
    keepTerminal(port: number): Effect.Effect<void, StoreFailure>;
    issue(codeDigest: string, expiresAt: Date): Effect.Effect<void, StoreFailure>;
    exchange(codeDigest: string, now: Date, paired: DeviceRow): Effect.Effect<boolean, StoreFailure>;
    revoke(id: string, now: Date): Effect.Effect<boolean, StoreFailure>;
    list(
      now: Date,
      after: DevicePlace | null,
      limit: number,
    ): Effect.Effect<{ readonly rows: readonly DeviceRow[]; readonly total: number }, StoreFailure>;
  }
>()('tagma/remote/Ledger') {}

export const makeLedger = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;

  return Ledger.of({
    byId: (id) => units.read((unit) => unit.run(db.select().from(device).where(eq(device.id, id)).get())),
    seen: (id, at, until) =>
      units.write(writes('Ledger.seen', [device]), (unit) =>
        unit.run(db.update(device).set({ lastSeenAt: at, expiresAt: until }).where(eq(device.id, id))),
      ),
    origin: Effect.map(
      units.read((unit) => unit.run(db.select({ origin: remoteOrigin.origin }).from(remoteOrigin).get())),
      (row) => row?.origin ?? null,
    ),
    settle: Effect.fn('Ledger.settle')(function* (origin) {
      const settledAt = new Date(yield* Clock.currentTimeMillis);
      yield* units.write(writes('Ledger.settle', [remoteOrigin]), (unit) =>
        Effect.andThen(unit.run(db.delete(remoteOrigin)), unit.run(db.insert(remoteOrigin).values({ origin, settledAt }))),
      );
    }),
    terminal: Effect.map(
      units.read((unit) => unit.run(db.select().from(remoteTerminal).get())),
      (row) => row?.port ?? null,
    ),
    keepTerminal: Effect.fn('Ledger.keepTerminal')(function* (port) {
      yield* units.write(writes('Ledger.keepTerminal', [remoteTerminal]), (unit) =>
        Effect.andThen(unit.run(db.delete(remoteTerminal)), unit.run(db.insert(remoteTerminal).values({ port }))),
      );
    }),
    issue: Effect.fn('Ledger.issue')(function* (codeDigest, expiresAt) {
      yield* units.write(writes('Ledger.issue', [pairing]), (unit) =>
        Effect.andThen(unit.run(db.delete(pairing)), unit.run(db.insert(pairing).values({ codeDigest, expiresAt }))),
      );
    }),
    exchange: Effect.fn('Ledger.exchange')(function* (codeDigest, now, paired) {
      return yield* units.write(writes('Ledger.exchange', [pairing, device]), (unit) =>
        Effect.gen(function* () {
          yield* unit.run(db.delete(pairing).where(lte(pairing.expiresAt, now)));
          const taken = yield* unit.run(
            db.delete(pairing).where(eq(pairing.codeDigest, codeDigest)).returning({ codeDigest: pairing.codeDigest }).all(),
          );
          if (taken.length === 0) return false;
          yield* unit.run(db.delete(device).where(lte(device.expiresAt, now)));
          yield* unit.run(db.insert(device).values(paired));
          return true;
        }),
      );
    }),
    revoke: (id, now) =>
      Effect.map(
        units.write(writes('Ledger.revoke', [device]), (unit) =>
          unit.run(
            db
              .update(device)
              .set({ revokedAt: now })
              .where(and(eq(device.id, id), isNull(device.revokedAt), gt(device.expiresAt, now)))
              .returning({ id: device.id })
              .all(),
          ),
        ),
        (revoked) => revoked.length > 0,
      ),
    list: Effect.fn('Ledger.list')(function* (now, after, limit) {
      const standing = and(isNull(device.revokedAt), gt(device.expiresAt, now));
      const past =
        after === null
          ? standing
          : and(
              standing,
              or(
                lt(device.pairedAt, new Date(after.pairedAt)),
                and(eq(device.pairedAt, new Date(after.pairedAt)), lt(device.id, after.id)),
              ),
            );
      return yield* units.read((unit) =>
        Effect.gen(function* () {
          const rows = yield* unit.run(
            db.select().from(device).where(past).orderBy(desc(device.pairedAt), desc(device.id)).limit(limit).all(),
          );
          const [total] = yield* unit.run(db.select({ total: count() }).from(device).where(standing).all());
          return { rows, total: total?.total ?? 0 };
        }),
      );
    }),
  });
});

export const ledgerLayer = Layer.effect(Ledger, makeLedger);
