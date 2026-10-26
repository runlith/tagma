import { AccountKey } from '@runlith/llm/models/authStatus';
import type { AccountRow } from '@runlith/llm/oauth/credential';
import type { TokenStore } from '@runlith/llm/oauth/FileTokenStore';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import { Effect } from 'effect';
import type { DefaultAccounts } from '../contract/service/accounts.js';
import type { ConsoleKeyStore } from './consoleKeys.js';
import { chooseAccount } from '../accounts/choice.js';
import { credentialMissing } from './missing.js';

export type OperatorCredentials = ModelCredentials & {
  readonly accountKey: (provider: string, selected?: string) => Effect.Effect<AccountKey, ReturnType<typeof credentialMissing>>;
  readonly selectedAccount: string | undefined;
};

export const makeOperatorCredentials = ({
  tokens,
  defaultAccount,
  onAccess,
  keys,
}: {
  readonly tokens: TokenStore;
  readonly defaultAccount: DefaultAccounts['Service']['defaultAccount'];
  readonly onAccess?: (use: { readonly provider: string; readonly account: AccountKey; readonly accessToken: string }) => void;
  readonly keys?: ConsoleKeyStore;
}): OperatorCredentials => {
  const resolved = new Map<string, { row: Promise<AccountRow>; bearer?: string }>();
  const consoleRows = new Map<string, Promise<string>>();
  let selected: string | undefined;

  const named = (provider: string, row: AccountRow | null, account: AccountKey): AccountRow => {
    if (!row) throw credentialMissing(`No stored subscription credential for ${provider} account ${account}`);
    selected = String(row.key);
    return row;
  };

  const readRow = async (provider: string, wanted?: string): Promise<AccountRow> => {
    if (wanted !== undefined) {
      const key = AccountKey.make(wanted);
      return named(provider, await Effect.runPromise(tokens.get(provider, key)), key);
    }

    const stored = await Effect.runPromise(tokens.held(provider));
    const choice = chooseAccount(
      (await Effect.runPromise(defaultAccount(provider))).account,
      stored.map((row) => row.key),
    );
    if (choice.kind === 'unsigned') throw credentialMissing(`No stored subscription credential for ${provider}`);
    if (choice.kind === 'ambiguous') {
      throw credentialMissing(`Several ${provider} accounts are stored and no default is selected — choose one: ${choice.keys.join(', ')}`);
    }
    return named(provider, await Effect.runPromise(tokens.get(provider, choice.account)), choice.account);
  };

  const rowFor = (provider: string, wanted?: string): Promise<AccountRow> => {
    const memo = `${provider}\u0000${wanted ?? ''}`;
    const held = resolved.get(memo);
    if (held !== undefined) return held.row;
    const reading = readRow(provider, wanted);
    reading.catch(() => undefined);
    resolved.set(memo, { row: reading });
    return reading;
  };

  const readConsoleAccount = async (provider: string, account?: string): Promise<string> => {
    if (keys === undefined) {
      throw credentialMissing(`Tagma holds no console keys, so "${provider}" cannot be signed here.`);
    }
    if (account !== undefined) {
      selected = account;
      return account;
    }
    const stored = await Effect.runPromise(keys.accounts(provider));
    const choice = chooseAccount(
      (await Effect.runPromise(defaultAccount(provider))).account,
      stored.map((row) => AccountKey.make(row.account)),
    );
    if (choice.kind === 'unsigned') {
      throw credentialMissing(`No console key is stored for ${provider}; paste one in Settings.`);
    }
    if (choice.kind === 'ambiguous') {
      throw credentialMissing(`Several ${provider} console keys are stored and none is chosen — choose one: ${choice.keys.join(', ')}`);
    }
    selected = String(choice.account);
    return selected;
  };

  const consoleAccount = (provider: string, account?: string): Promise<string> => {
    const memo = `console\u0000${provider}\u0000${account ?? ''}`;
    const held = consoleRows.get(memo);
    if (held !== undefined) return held;
    const reading = readConsoleAccount(provider, account);
    reading.catch(() => undefined);
    consoleRows.set(memo, reading);
    return reading;
  };

  return {
    apiKey: async (_ownerId, provider, account) => {
      const chosen = await consoleAccount(provider, account);
      const key = await Effect.runPromise(keys!.key(provider, chosen));
      if (key === null) throw credentialMissing(`No ${provider} console key is stored for account ${chosen}.`);
      return key;
    },

    accessToken: async (_ownerId, provider, account) => {
      const row = await rowFor(provider, account);
      const bearer = await Effect.runPromise(tokens.getAccessToken(provider, row.key));
      resolved.get(`${provider}\u0000${account ?? ''}`)!.bearer = bearer;
      onAccess?.({ provider, account: row.key, accessToken: bearer });
      return bearer;
    },

    recoverAccessToken: async (_ownerId, provider, account) => {
      const row = await rowFor(provider, account);
      const held = resolved.get(`${provider}\u0000${account ?? ''}`)!;
      const rejected = held.bearer;
      if (rejected === undefined) throw credentialMissing('This request has no rejected bearer to recover.');
      const bearer = await Effect.runPromise(tokens.recoverAccessToken(provider, row.key, rejected));
      held.bearer = bearer;
      onAccess?.({ provider, account: row.key, accessToken: bearer });
      return bearer;
    },

    credential: async (_ownerId, provider, account) => (await rowFor(provider, account)).credential,

    accountKey: (provider, wanted) =>
      Effect.tryPromise({
        try: async () =>
          tokens.keeps(provider) ? (await rowFor(provider, wanted)).key : AccountKey.make(await consoleAccount(provider, wanted)),
        catch: (error) => credentialMissing(error instanceof Error ? error.message : String(error)),
      }),

    get selectedAccount(): string | undefined {
      return selected;
    },
  };
};
