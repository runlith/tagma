import { createHash } from 'node:crypto';
import { CredentialFileFailed, type CredentialFileFault } from '@runlith/credential-file/failure';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import { consoleKey } from '../store/tables.js';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { type ConsoleKeyFile, keepDurably, withKey } from './consoleKeyFile.js';

export function consoleAccountOf(keyValue: string): string {
  return createHash('sha256').update(keyValue).digest('hex').slice(0, 12);
}

type StandingKey = { readonly provider: string; readonly account: string; readonly keyValue: string };

const accountOfRow = (row: Pick<StandingKey, 'account' | 'keyValue'>): string =>
  row.account === '' ? consoleAccountOf(row.keyValue) : row.account;

export type ConsoleKeyRow = {
  readonly provider: string;
  readonly account: string;
  readonly updatedAt: Date;
};

type HeldRow = ConsoleKeyRow & { readonly stored: string; readonly keyValue: string };

export const heldRows = (
  rows: readonly { readonly provider: string; readonly account: string; readonly keyValue: string; readonly updatedAt: Date }[],
): readonly HeldRow[] => {
  const held = new Map<string, HeldRow>();
  for (const row of rows) {
    const account = accountOfRow(row);
    const standing = held.get(account);
    if (standing !== undefined && (standing.keyValue !== '' || row.keyValue === '')) continue;
    held.set(account, { provider: row.provider, account, stored: row.account, keyValue: row.keyValue, updatedAt: row.updatedAt });
  }
  return [...held.values()];
};

export const storedAccounts = (
  rows: readonly { readonly account: string; readonly keyValue: string }[],
  account: string,
): readonly string[] => [...new Set([account, ...rows.filter((row) => accountOfRow(row) === account).map((row) => row.account)])];

export const heldKey = (filed: string | undefined, row: HeldRow): string | null => filed ?? (row.keyValue === '' ? null : row.keyValue);

export type ConsoleKeyFailure = StoreFailure | CredentialFileFault;

export const makeConsoleKeyStore = (input: {
  readonly db: StoreDb<'machine'>;
  readonly units: MachineUnits['Service'];
  readonly file: ConsoleKeyFile;
}) => {
  const { db, units, file } = input;
  let moved = false;

  const accounts = (provider: string): Effect.Effect<readonly ConsoleKeyRow[], ConsoleKeyFailure> => {
    return Effect.map(held(provider), (rows) => rows.map(({ provider, account, updatedAt }) => ({ provider, account, updatedAt })));
  };
  const stored = (unit: Parameters<Parameters<MachineUnits['Service']['read']>[0]>[0], provider: string, account: string) => {
    return Effect.map(
      unit.run(
        db
          .select({ account: consoleKey.account, keyValue: consoleKey.keyValue })
          .from(consoleKey)
          .where(eq(consoleKey.provider, provider))
          .all(),
      ),
      (rows) => storedAccounts(rows, account),
    );
  };
  const held = (provider: string): Effect.Effect<readonly HeldRow[], ConsoleKeyFailure> => {
    return Effect.flatMap(moveKeys(), () =>
      units.read((unit) =>
        Effect.map(
          unit.run(
            db
              .select({
                provider: consoleKey.provider,
                account: consoleKey.account,
                keyValue: consoleKey.keyValue,
                updatedAt: consoleKey.updatedAt,
              })
              .from(consoleKey)
              .where(eq(consoleKey.provider, provider))
              .all(),
          ),
          heldRows,
        ),
      ),
    );
  };
  const has = (provider: string): Effect.Effect<boolean, ConsoleKeyFailure> => {
    return Effect.map(accounts(provider), (rows) => rows.length > 0);
  };
  const key = Effect.fnUntraced(function* (provider: string, account?: string) {
    const rows = yield* held(provider);
    const chosen = account ?? (rows.length === 1 ? rows[0]!.account : undefined);
    const row = rows.find((candidate) => candidate.account === chosen);
    if (chosen === undefined || row === undefined) return null;
    if (row.keyValue !== '') {
      const filed = yield* Effect.orElseSucceed(file.read(), () => null);
      return heldKey(filed?.keys[provider]?.[chosen], row);
    }
    return heldKey((yield* file.read()).keys[provider]?.[chosen], row);
  });
  const values = (providers: readonly string[]): Effect.Effect<Readonly<Record<string, string>>, ConsoleKeyFailure> => {
    if (providers.length === 0) return Effect.succeed({});
    return Effect.gen(function* () {
      yield* moveKeys();
      const stored = yield* units.read((unit) =>
        unit.run(
          db
            .select()
            .from(consoleKey)
            .where(inArray(consoleKey.provider, [...providers]))
            .all(),
        ),
      );
      const filed = (yield* file.read()).keys;
      const grouped = new Map<string, typeof stored>();
      for (const row of stored) {
        const group = grouped.get(row.provider) ?? [];
        group.push(row);
        grouped.set(row.provider, group);
      }
      const values: Record<string, string> = {};
      for (const provider of providers) {
        const candidates = new Set([
          ...Object.values(filed[provider] ?? {}),
          ...(grouped.get(provider) ?? []).flatMap((row) => (row.keyValue === '' ? [] : [row.keyValue])),
        ]);
        if (candidates.size > 1)
          return yield* new CredentialFileFailed({
            kind: 'read',
            reason: `The instance ${provider} holds several distinct console keys; choose its key before moving its settings.`,
          });
        const value = candidates.values().next().value;
        if (value !== undefined) values[provider] = value;
      }
      return values;
    });
  };
  const removeProviders = (providers: readonly string[]): Effect.Effect<void, ConsoleKeyFailure> => {
    if (providers.length === 0) return Effect.void;
    const removed = new Set(providers);
    return Effect.gen(function* () {
      yield* moveKeys();
      yield* units.write(writes('ConsoleKeyStore.removeProviders', [consoleKey]), (unit) =>
        Effect.asVoid(unit.run(db.delete(consoleKey).where(inArray(consoleKey.provider, [...providers])))),
      );
      yield* file.update((current) =>
        Effect.succeed(
          providers.some((provider) => current.keys[provider] !== undefined)
            ? { ...current, keys: Object.fromEntries(Object.entries(current.keys).filter(([provider]) => !removed.has(provider))) }
            : current,
        ),
      );
    });
  };
  const save = (provider: string, keyValue: string, replaces?: string): Effect.Effect<string, ConsoleKeyFailure> => {
    const account = consoleAccountOf(keyValue);
    return Effect.gen(function* () {
      yield* moveKeys();
      yield* file.update((current) => {
        const kept = withKey(current, provider, account, keyValue);
        return Effect.succeed(replaces !== undefined && replaces !== account ? withKey(kept, provider, replaces, null) : kept);
      });
      yield* units.write(
        writes('ConsoleKeyStore.save', [consoleKey]),
        Effect.fnUntraced(function* (unit) {
          if (replaces !== undefined && replaces !== account) {
            const replaced = yield* stored(unit, provider, replaces);
            yield* unit.run(
              db.delete(consoleKey).where(and(eq(consoleKey.provider, provider), inArray(consoleKey.account, [...replaced]))),
            );
          }
          yield* unit.run(
            db
              .insert(consoleKey)
              .values({ provider, account, keyValue: '', updatedAt: new Date(yield* Clock.currentTimeMillis) })
              .onConflictDoUpdate({
                target: [consoleKey.provider, consoleKey.account],
                set: { keyValue: '', updatedAt: new Date(yield* Clock.currentTimeMillis) },
              }),
          );
        }),
      );
      return account;
    });
  };
  const remove = Effect.fnUntraced(function* (provider: string, account: string) {
    yield* moveKeys();
    yield* units.write(writes('ConsoleKeyStore.remove', [consoleKey]), (unit) =>
      Effect.flatMap(stored(unit, provider, account), (stored) =>
        unit.run(db.delete(consoleKey).where(and(eq(consoleKey.provider, provider), inArray(consoleKey.account, [...stored])))),
      ),
    );
    yield* file.update((current) => Effect.succeed(withKey(current, provider, account, null)));
  });
  const moveKeys = (): Effect.Effect<void, ConsoleKeyFailure> => {
    return Effect.suspend(() => {
      if (moved) return Effect.void;
      return Effect.gen(function* () {
        const standing = yield* units.read((unit) =>
          unit.run(
            db
              .select({ provider: consoleKey.provider, account: consoleKey.account, keyValue: consoleKey.keyValue })
              .from(consoleKey)
              .where(ne(consoleKey.keyValue, ''))
              .all(),
          ),
        );
        if (standing.length > 0) {
          const kept = yield* Effect.result(
            keepDurably(
              file,
              standing.map((row) => ({ ...row, account: accountOfRow(row) })),
            ),
          );
          if (kept._tag === 'Failure') {
            console.warn('[tagma] console keys stay in the store: their file could not be kept durably', kept.failure.message);
            moved = true;
            return;
          }
          yield* units.write(
            writes('ConsoleKeyStore.moveKeys', [consoleKey]),
            Effect.fnUntraced(function* (unit) {
              const [before] = yield* unit.run(db.all<{ secure_delete: number }>(sql`PRAGMA secure_delete`));
              yield* unit.run(db.run(sql`PRAGMA secure_delete = ON`));
              for (const row of standing) {
                if (row.account === '') {
                  yield* unit.run(
                    db.delete(consoleKey).where(and(eq(consoleKey.provider, row.provider), eq(consoleKey.account, accountOfRow(row)))),
                  );
                }
                yield* unit.run(
                  db
                    .update(consoleKey)
                    .set({ keyValue: '', account: accountOfRow(row) })
                    .where(and(eq(consoleKey.provider, row.provider), eq(consoleKey.account, row.account))),
                );
              }
              yield* unit.run(db.run(sql.raw(`PRAGMA secure_delete = ${before?.secure_delete ?? 0}`)));
            }),
          );
          yield* db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
        }
        moved = true;
      });
    });
  };
  return { accounts, has, key, values, removeProviders, save, remove, moveKeys };
};
export type ConsoleKeyStore = ReturnType<typeof makeConsoleKeyStore>;
