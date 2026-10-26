import { directoryStamp } from '@runlith/credential-file/CredentialFile';
import { Clock, Effect, Hash, Semaphore } from 'effect';
import type { AccountRows, ConnectedProviders } from '../contract/service/accounts.js';
import type { ProviderCatalog, ProviderRegistry } from '../contract/service/registry.js';
import { LISTED_MS } from './defaultLogins.js';

const SETTLED_MS = 2_000;

type Standing = {
  readonly stamp: number | null;
  readonly checkedAt: number;
  readonly catalog: ProviderCatalog;
  readonly answer: ConnectedProviders;
};

export const makeConnectedProviders = Effect.fnUntraced(function* (input: {
  readonly rows: AccountRows;
  readonly registry: ProviderRegistry['Service'];
  readonly directory: string;
}) {
  const { rows, registry, directory } = input;
  const gate = yield* Semaphore.make(1);
  let standing: Standing | null = null;

  const read = Effect.fn('ProviderAccounts.connected')(function* () {
    const at = yield* directoryStamp(directory);
    const now = yield* Clock.currentTimeMillis;
    const catalog = registry.current();
    if (standing !== null && standing.stamp === at && standing.catalog === catalog && now - standing.checkedAt < LISTED_MS) {
      return standing.answer;
    }
    const held = yield* Effect.forEach(
      catalog.models.providers,
      (provider) =>
        Effect.map(rows.of(provider.id), (accounts) => (accounts.some((account) => account.problem === null) ? [provider.id] : [])),
      { concurrency: 3 },
    );
    const ids = held.flat().sort();
    const revision = Hash.string(ids.join('\n'));
    const last = standing?.answer;
    standing = {
      stamp: now - at >= SETTLED_MS ? at : null,
      checkedAt: now,
      catalog,
      answer: last?.revision === revision ? last : { revision, providers: new Set(ids) },
    };
    return standing.answer;
  });

  return gate.withPermits(1)(Effect.suspend(read));
});
