import { AccountKey } from '@runlith/llm/models/authStatus';
import type { HeldAccount } from '@runlith/llm/oauth/credential';
import type { TokenStore } from '@runlith/llm/oauth/FileTokenStore';
import { Effect } from 'effect';
import { type AccountProblem, consoleKeyLabel } from '../contract/wire/accounts.js';
import type { AccountRows, StoredAccount } from '../contract/service/accounts.js';
import type { ConsoleKeyStore } from '../credentials/consoleKeys.js';

const heldRow = (row: HeldAccount, installed: boolean): StoredAccount => {
  const credential = row.credential;
  const problem: AccountProblem | null = !installed
    ? { kind: 'not-installed' }
    : credential === null
      ? { kind: 'unreadable', reason: row.unreadable ?? 'the stored credential cannot be read' }
      : null;
  return {
    key: row.key,
    aliases: row.aliases,
    label: row.label,
    origin: row.origin,
    secret: 'subscription',
    fingerprint: JSON.stringify(
      credential === null ? [row.key, row.addedAt] : [credential.accessToken, credential.refreshToken, credential.expiresAt],
    ),
    enrollment: String(row.addedAt),
    durable: problem === null,
    bearer: credential?.accessToken,
    expiresAt: credential?.expiresAt ?? undefined,
    problem,
  };
};

export const subscriptionAccounts = (tokens: TokenStore): AccountRows => ({
  of: (provider) => Effect.map(tokens.held(provider), (rows) => rows.map((row) => heldRow(row, tokens.keeps(provider)))),
});

export const providerAccounts = (tokens: TokenStore, keys: ConsoleKeyStore): AccountRows => {
  const subscriptions = subscriptionAccounts(tokens);
  const consoleRows = (provider: string) =>
    Effect.map(keys.accounts(provider), (rows) =>
      rows.map((row): StoredAccount => ({
        key: AccountKey.make(row.account),
        label: consoleKeyLabel(row.account),
        origin: { kind: 'own' },
        secret: 'console',
        fingerprint: row.account,
        enrollment: row.account,
        durable: true,
        problem: null,
      })),
    );
  return {
    of: (provider) =>
      tokens.keeps(provider)
        ? subscriptions.of(provider)
        : Effect.flatMap(subscriptions.of(provider), (held) => (held.length > 0 ? Effect.succeed(held) : consoleRows(provider))),
  };
};
