import { AccountKey } from '@runlith/llm/models/authStatus';
import { QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import { and, eq } from 'drizzle-orm';
import { Effect, Option, Schema } from 'effect';
import { accountQuotaReading } from '../store/tables.js';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';

export type QuotaReading = {
  readonly provider: string;
  readonly account: AccountKey;
  readonly enrollment: string;
  readonly observation: QuotaObservation | null;
  readonly merged: readonly QuotaWindow[];
};

export type QuotaReadingChange =
  | { readonly _tag: 'save'; readonly reading: QuotaReading & { readonly observation: QuotaObservation } }
  | { readonly _tag: 'drop'; readonly provider: string; readonly account: AccountKey };

const observationJson = Schema.fromJsonString(Schema.toCodecJson(QuotaObservation));
const decodeObservation = Schema.decodeUnknownOption(observationJson);
const encodeObservation = Schema.encodeSync(observationJson);

const windowsJson = Schema.fromJsonString(Schema.toCodecJson(Schema.Array(QuotaWindow)));
const decodeWindows = Schema.decodeUnknownOption(windowsJson);
const encodeWindows = Schema.encodeSync(windowsJson);

export const makeQuotaReadings = (input: { readonly db: StoreDb<'machine'>; readonly units: MachineUnits['Service'] }) => {
  const { db, units } = input;

  const all = (): Effect.Effect<readonly QuotaReading[], StoreFailure> => {
    return units.read((unit) =>
      Effect.map(unit.run(db.select().from(accountQuotaReading).all()), (rows) =>
        rows.map((row) => ({
          provider: row.provider,
          account: AccountKey.make(row.account),
          enrollment: row.enrollment,
          observation: Option.getOrNull(decodeObservation(row.observation)),
          merged: row.merged === null ? [] : Option.getOrElse(decodeWindows(row.merged), () => []),
        })),
      ),
    );
  };
  const apply = (changes: readonly QuotaReadingChange[]): Effect.Effect<void, StoreFailure> => {
    const rows = changes.map((change) =>
      change._tag === 'drop'
        ? change
        : {
            _tag: 'save' as const,
            provider: change.reading.provider,
            account: change.reading.account,
            enrollment: change.reading.enrollment,
            observation: encodeObservation(change.reading.observation),
            merged: change.reading.merged.length === 0 ? null : encodeWindows(change.reading.merged),
          },
    );
    return units.write(writes('QuotaReadings.apply', [accountQuotaReading]), (unit) =>
      Effect.forEach(
        rows,
        (change) => {
          if (change._tag === 'drop') {
            return unit.run(
              db
                .delete(accountQuotaReading)
                .where(and(eq(accountQuotaReading.provider, change.provider), eq(accountQuotaReading.account, change.account))),
            );
          }
          const { provider, account, enrollment, observation, merged } = change;
          return unit.run(
            db
              .insert(accountQuotaReading)
              .values({ provider, account, enrollment, observation, merged })
              .onConflictDoUpdate({
                target: [accountQuotaReading.provider, accountQuotaReading.account],
                set: { enrollment, observation, merged },
              }),
          );
        },
        { discard: true },
      ),
    );
  };
  return { all, apply };
};
export type QuotaReadings = ReturnType<typeof makeQuotaReadings>;
