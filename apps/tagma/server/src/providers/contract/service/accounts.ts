import type { AccountKey, CredentialOrigin } from '@runlith/llm/models/authStatus';
import type { TokenStoreFault } from '@runlith/llm/oauth/storeFailure';
import { Context, Effect, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../../platform/contract/service/units.js';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { NotInstalled } from './registry.js';
import type { AccountProblem } from '../wire/accounts.js';

export type AccountSecret = 'subscription' | 'console';

export type StoredAccount = {
  readonly key: AccountKey;
  readonly aliases?: readonly AccountKey[];
  readonly label: string;
  readonly origin: CredentialOrigin;
  readonly secret: AccountSecret;
  readonly fingerprint: string;
  readonly enrollment: string;
  readonly durable: boolean;
  readonly bearer?: string;
  readonly expiresAt?: number;
  readonly problem: AccountProblem | null;
};

export type AccountRows = {
  of(provider: string): Effect.Effect<readonly StoredAccount[], StoreFailure | TokenStoreFault | NotInstalled>;
};

export type ConnectedProviders = { readonly revision: number; readonly providers: ReadonlySet<string> };

export class ProviderAccounts extends Context.Service<
  ProviderAccounts,
  AccountRows & {
    readonly connected: Effect.Effect<ConnectedProviders, StoreFailure | TokenStoreFault | NotInstalled>;
  }
>()('tagma/providers/ProviderAccounts') {}

export type DefaultAccount = { readonly account: AccountKey | null; readonly revision: number };

export class DefaultAccounts extends Context.Service<
  DefaultAccounts,
  {
    defaultAccount(provider: string, unit?: Unit<'machine'>, runId?: string): Effect.Effect<DefaultAccount, StoreFailure | GateRefusal>;
    heldAccount(provider: string): Effect.Effect<DefaultAccount, StoreFailure>;
    saveDefaultAccount(
      provider: string,
      account: string | null,
      expectedRevision?: number,
    ): Effect.Effect<DefaultAccount, StoreFailure | TokenStoreFault | NotInstalled | GateRefusal<'unknown-account' | 'stale-revision'>>;
    settleDefaultAccount(
      unit: WriteUnit<'machine'>,
      provider: string,
      account: string | null,
      stored: readonly string[],
      expectedRevision?: number,
    ): Effect.Effect<DefaultAccount, StoreFailure | NotInstalled | GateRefusal<'unknown-account' | 'stale-revision'>>;
    forgetAccount(provider: string, account: AccountKey): Effect.Effect<DefaultAccount, StoreFailure>;
    adoptDefaultAccount(provider: string, account: AccountKey): Effect.Effect<void, StoreFailure | TokenStoreFault | NotInstalled>;
    readonly defaultAccountMoved: Stream.Stream<string>;
  }
>()('tagma/providers/DefaultAccounts') {}

export const storedKeys = (
  accounts: AccountRows,
  provider: string,
): Effect.Effect<readonly string[], StoreFailure | TokenStoreFault | NotInstalled> =>
  Effect.map(accounts.of(provider), (stored) => stored.map((row) => String(row.key)).sort());

export const unknownAccount = (provider: string, account: string, keys: readonly string[]): GateRefusal<'unknown-account'> =>
  new GateRefusal(
    'unknown-account',
    `Account "${account}" is not stored for ${provider}.`,
    keys.length === 0 ? [`sign in to ${provider} first`] : [`choose one of: ${keys.join(', ')}`],
  );
