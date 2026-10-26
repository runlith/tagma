import { Effect } from 'effect';
import type { AccountRows, StoredAccount } from '../contract/service/accounts.js';
import type { NotInstalled, ProviderRegistry } from '../contract/service/registry.js';
import type { AccountProblem } from '../contract/wire/accounts.js';
import type { DefaultLoginBook } from './defaultLogins.js';
import type { HarnessDirectoryStore } from './harnessRows.js';
import { requestedAccount } from '../contract/wire/harnessAccounts.js';

export const harnessStored = (
  ordinary: AccountRows,
  directories: HarnessDirectoryStore,
  registry: ProviderRegistry['Service'],
  logins: DefaultLoginBook,
  consoles: () => readonly string[],
): AccountRows => {
  const directoryRows = (provider: string, problem: AccountProblem | null, unset: AccountProblem | null = null) =>
    Effect.map(directories.of(provider), (rows) =>
      rows
        .filter((row) => requestedAccount(row) && (!row.pending || row.signed))
        .map((row): StoredAccount => {
          const standing = problem ?? (row.directory === null ? unset : null);
          return {
            key: row.key,
            label: row.label,
            origin: { kind: 'cli', place: row.directory ?? 'default' },
            secret: 'subscription',
            fingerprint: JSON.stringify([row.machine, row.directory]),
            enrollment: String(row.addedAt),
            durable: standing === null && row.signed,
            problem: standing ?? (row.signed ? null : { kind: 'signed-out' }),
          };
        }),
    );
  const uninstalled = Effect.fnUntraced(function* (provider: string, refusal: NotInstalled) {
    const held = [...(yield* ordinary.of(provider)), ...(yield* directoryRows(provider, { kind: 'not-installed' }))];
    if (held.length === 0) return yield* Effect.fail(refusal);
    return held;
  });
  return {
    of: Effect.fn('ProviderAccounts.of')(function* (provider) {
      if (consoles().includes(provider)) return yield* ordinary.of(provider);
      const found = yield* Effect.result(registry.registration(provider));
      if (found._tag === 'Failure') return yield* uninstalled(provider, found.failure);
      const registration = found.success;
      if (registration.kind !== 'harness' || registration.auth !== 'cli' || registration.accounts === undefined)
        return yield* ordinary.of(provider);
      const read = yield* Effect.result(logins.listed(registration));
      return yield* directoryRows(provider, null, read._tag === 'Failure' ? { kind: 'unreadable', reason: read.failure.reason } : null);
    }),
  };
};
