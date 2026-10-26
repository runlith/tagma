import { createHash } from 'node:crypto';
import { Clock, Duration, Effect, type Layer, Result } from 'effect';
import type { HttpClient } from 'effect/http';
import { declare } from '@runlith/held/Held';
import { HoldCut, HoldStalled } from '@runlith/held/failures';
import type { AccountKey } from '../models/authStatus.js';
import { SINGLE_ACCOUNT_KEY } from './accountKey.js';
import { makeCredentialFile } from '@runlith/credential-file/CredentialFile';
import { VENDOR_CALL_TIMEOUT_MS } from '../vendorCall.js';
import { type AccountRow, type HeldAccount, parseStoredCredential, type StoredCredential } from './credential.js';
import {
  type CredentialDocument,
  decodeDocument,
  emptyDocument,
  type ProviderRows,
  rowsOf,
  type StoredRow,
  withRows,
} from './credentialDocument.js';
import { type LockHold, proveHold, withFileLock } from '@runlith/file-lock/FileLock';
import { storeLockFailure, TokenStoreFailed, type TokenStoreFault } from './storeFailure.js';
import type { SubscriptionAccounts } from './vendor.js';

const OWN = { kind: 'own' as const };
const REFRESH_BUFFER_MS = 5 * 60 * 1_000;
const STORE_LOCK_WAIT_MS = VENDOR_CALL_TIMEOUT_MS + VENDOR_CALL_TIMEOUT_MS / 2;
const expiresSoon = (credential: StoredCredential, now: number) =>
  credential.expiresAt !== null && credential.expiresAt - now <= REFRESH_BUFFER_MS;
const grantIdentity = (credential: StoredCredential) => credential.refreshToken ?? credential.accessToken;

export type AccountSchemes = (provider: string) => SubscriptionAccounts | undefined;

export interface TokenStore {
  keeps(provider: string): boolean;
  heldProviders(): Effect.Effect<ReadonlyArray<string>, TokenStoreFault>;
  held(provider: string): Effect.Effect<ReadonlyArray<HeldAccount>, TokenStoreFault>;
  accounts(provider: string): Effect.Effect<ReadonlyArray<AccountRow>, TokenStoreFault>;
  get(provider: string, account: AccountKey): Effect.Effect<AccountRow | null, TokenStoreFault>;
  find(provider: string, credential: StoredCredential): Effect.Effect<AccountRow | null, TokenStoreFault>;
  owns(provider: string, account: AccountKey): Effect.Effect<boolean, TokenStoreFault>;
  add(provider: string, credential: unknown): Effect.Effect<AccountKey, TokenStoreFault>;
  remove(provider: string, account: AccountKey): Effect.Effect<void, TokenStoreFault>;
  relabel(provider: string, account: AccountKey, label: string): Effect.Effect<void, TokenStoreFault>;
  getAccessToken(provider: string, account: AccountKey): Effect.Effect<string, TokenStoreFault>;
  recoverAccessToken(provider: string, account: AccountKey, rejected: string): Effect.Effect<string, TokenStoreFault>;
}

export type FileTokenStoreOptions = {
  readonly path: string;
  readonly schemes: AccountSchemes;
  readonly wire: Layer.Layer<HttpClient.HttpClient>;
  readonly refreshing?: AccountSchemes;
};

export function makeFileTokenStore({ path, schemes, wire, refreshing = schemes }: FileTokenStoreOptions): TokenStore {
  const file = makeCredentialFile({ path, codec: { empty: emptyDocument, decode: decodeDocument }, lockWaitMs: STORE_LOCK_WAIT_MS });
  const refreshes = declare<string>({
    name: 'llm-token-refresh',
    owner: 'llm',
    rank: 221,
    key: (key) => key,
    concurrency: 1,
    threshold: Duration.seconds(30),
    ceilings: {
      hold: Duration.minutes(15),
      wait: Duration.minutes(15),
      leaves: 'the remote grant may have rotated and the stored row may have changed; read both before retrying',
    },
    external: { named: 'token refresh exchange', callsBack: false },
  });

  const schemeOf = (provider: string): Effect.Effect<SubscriptionAccounts, TokenStoreFailed> => {
    const scheme = schemes(provider);
    return scheme === undefined
      ? Effect.fail(new TokenStoreFailed({ kind: 'read', provider, reason: `No installed adapter keeps ${provider} accounts` }))
      : Effect.succeed(scheme);
  };
  const decodedCredential = (
    provider: string,
    scheme: SubscriptionAccounts,
    value: unknown,
  ): Effect.Effect<StoredCredential, TokenStoreFailed> =>
    parseStoredCredential(provider, scheme.credential, value).pipe(
      Effect.mapError((error) => new TokenStoreFailed({ kind: 'read', provider, reason: error.message })),
    );
  const decodedRow = (provider: string, scheme: SubscriptionAccounts, stored: StoredRow): Effect.Effect<AccountRow, TokenStoreFailed> =>
    Effect.map(decodedCredential(provider, scheme, stored.credential), (credential) => ({
      key: stored.key,
      label: stored.label === stored.key ? scheme.label(credential, stored.addedAt) : stored.label,
      origin: OWN,
      addedAt: stored.addedAt,
      credential,
    }));
  const decodedAccount = Effect.fnUntraced(function* (document: CredentialDocument, provider: string, account: AccountKey) {
    const scheme = yield* schemeOf(provider);
    const rows = rowsOf(document, provider);
    if (!Object.hasOwn(rows, account)) return null;
    return yield* decodedRow(provider, scheme, rows[account]!);
  });
  const rowOrMissing = (document: CredentialDocument, provider: string, account: AccountKey): Effect.Effect<AccountRow, TokenStoreFailed> =>
    Effect.flatMap(decodedAccount(document, provider, account), (row) =>
      row
        ? Effect.succeed(row)
        : Effect.fail(
            new TokenStoreFailed({
              kind: 'missing',
              provider,
              account,
              reason: `No stored subscription credential for ${provider} account ${account}`,
            }),
          ),
    );
  const readAccount = (provider: string, account: AccountKey) =>
    file.read().pipe(Effect.flatMap((document) => rowOrMissing(document, provider, account)));
  const change = (update: (current: CredentialDocument) => CredentialDocument) => file.update((current) => Effect.succeed(update(current)));
  const rebind = Effect.fnUntraced(function* (
    current: CredentialDocument,
    provider: string,
    scheme: SubscriptionAccounts,
    account: AccountKey,
    startedFrom: string,
    credential: StoredCredential,
  ) {
    const rows: ProviderRows = rowsOf(current, provider);
    const existing = rows[account];
    if (!existing)
      return yield* new TokenStoreFailed({
        kind: 'missing',
        provider,
        account,
        reason: `${provider} account ${account} was removed while its token refreshed`,
      });
    const held = yield* decodedCredential(provider, scheme, existing.credential);
    if (grantIdentity(held) !== startedFrom) return current;
    return withRows(current, provider, { ...rows, [account]: { ...existing, credential } });
  });
  const commit = (
    provider: string,
    scheme: SubscriptionAccounts,
    account: AccountKey,
    startedFrom: string,
    credential: StoredCredential,
  ): Effect.Effect<void, TokenStoreFault> => {
    const rebound = scheme.key(credential);
    if (rebound !== account)
      return Effect.fail(
        new TokenStoreFailed({
          kind: 'reconnect',
          provider,
          account,
          reason: `Refreshing ${provider} account ${account} answered for account ${rebound}; the row is unchanged and this account must reconnect`,
        }),
      );
    return file.update((current) => rebind(current, provider, scheme, account, startedFrom, credential));
  };
  const refresh = Effect.fn('FileTokenStore.refresh')(function* (provider: string, account: AccountKey, hold: LockHold, rejected?: string) {
    const scheme = refreshing(provider) ?? (yield* schemeOf(provider));
    const document = yield* file.readFresh();
    const found = yield* rowOrMissing(document, provider, account);
    if (rejected === undefined ? !expiresSoon(found.credential, yield* Clock.currentTimeMillis) : found.credential.accessToken !== rejected)
      return;
    const refreshToken = found.credential.refreshToken;
    if (refreshToken === null)
      return yield* new TokenStoreFailed({
        kind: 'reconnect',
        provider,
        account,
        reason: `The persistent ${provider} credential was rejected and must reconnect`,
      });
    if (scheme.refresh === undefined)
      return yield* new TokenStoreFailed({ kind: 'refresh', provider, account, reason: `${provider} declares no token refresh` });
    const credential = yield* scheme.refresh(refreshToken, found.credential).pipe(
      Effect.provide(wire),
      Effect.mapError((error) => new TokenStoreFailed({ kind: 'refresh', provider, account, reason: error.message })),
    );
    yield* proveHold(hold).pipe(Effect.mapError(storeLockFailure<never>));
    yield* commit(provider, scheme, account, grantIdentity(found.credential), credential);
  });
  const refreshLockPath = (provider: string, account: AccountKey) =>
    `${path}.${createHash('sha256').update(providerAccountKey(provider, account)).digest('hex')}.refresh.lock`;
  const refreshOnce = (provider: string, account: AccountKey, rejected?: string): Effect.Effect<void, TokenStoreFault> =>
    refreshes
      .hold(
        providerAccountKey(provider, account),
        withFileLock(refreshLockPath(provider, account), STORE_LOCK_WAIT_MS, (hold) => refresh(provider, account, hold, rejected)).pipe(
          Effect.mapError(storeLockFailure<TokenStoreFault>),
        ),
      )
      .pipe(Effect.mapError((failure) => refreshHoldFailure(provider, account, failure)));

  const get = (provider: string, account: AccountKey) =>
    file.read().pipe(Effect.flatMap((document) => decodedAccount(document, provider, account)));
  const store: TokenStore = {
    keeps: (provider) => schemes(provider) !== undefined,
    heldProviders: () =>
      Effect.map(file.read(), (document) =>
        Object.entries(document.providers).flatMap(([provider, rows]) => (Object.keys(rows).length === 0 ? [] : [provider])),
      ),
    held: (provider) => {
      const scheme = schemes(provider);
      return Effect.flatMap(file.read(), (document) =>
        Effect.forEach(Object.values(rowsOf(document, provider)), (stored) => {
          const plain = { key: stored.key, label: stored.label, origin: OWN, addedAt: stored.addedAt, credential: null, unreadable: null };
          if (scheme === undefined) return Effect.succeed<HeldAccount>(plain);
          return Effect.map(Effect.result(decodedRow(provider, scheme, stored)), (read): HeldAccount =>
            Result.isSuccess(read) ? { ...read.success, unreadable: null } : { ...plain, unreadable: read.failure.reason },
          );
        }),
      );
    },
    accounts: Effect.fnUntraced(function* (provider) {
      const document = yield* file.read();
      const scheme = yield* schemeOf(provider);
      const rows: AccountRow[] = [];
      for (const stored of Object.values(rowsOf(document, provider))) {
        const read = yield* Effect.result(decodedRow(provider, scheme, stored));
        if (Result.isSuccess(read)) rows.push(read.success);
        else
          yield* Effect.logWarning('The account list leaves an unreadable credential in its held listing', {
            provider,
            account: stored.key,
            failure: read.failure._tag,
            kind: read.failure.kind,
          });
      }
      return rows;
    }),
    get,
    find: (provider, credential) => Effect.flatMap(schemeOf(provider), (scheme) => get(provider, scheme.key(credential))),
    owns: (provider, account) => Effect.map(file.read(), (document) => Object.hasOwn(rowsOf(document, provider), account)),
    add: Effect.fnUntraced(function* (provider, credential) {
      const scheme = yield* schemeOf(provider);
      const parsed = yield* parseStoredCredential(provider, scheme.credential, credential).pipe(
        Effect.mapError((error) => new TokenStoreFailed({ kind: 'write', provider, reason: error.message })),
      );
      const key = scheme.key(parsed);
      yield* file.update((current) =>
        Effect.map(Clock.currentTimeMillis, (now) => {
          const rows = rowsOf(current, provider);
          const existing = key === SINGLE_ACCOUNT_KEY ? undefined : rows[key];
          const addedAt = existing?.addedAt ?? now;
          const row = { key, label: existing?.label ?? scheme.label(parsed, addedAt), addedAt, credential: parsed };
          return withRows(current, provider, key === SINGLE_ACCOUNT_KEY ? { [key]: row } : { ...rows, [key]: row });
        }),
      );
      return key;
    }),
    remove: (provider, account) =>
      change((current) => {
        const rows = { ...rowsOf(current, provider) };
        delete rows[account];
        return withRows(current, provider, rows);
      }),
    relabel: (provider, account, label) =>
      change((current) => {
        const rows = rowsOf(current, provider);
        const existing = rows[account];
        return existing ? withRows(current, provider, { ...rows, [account]: { ...existing, label } }) : current;
      }),
    getAccessToken: Effect.fnUntraced(function* (provider, account) {
      const found = yield* readAccount(provider, account);
      if (expiresSoon(found.credential, yield* Clock.currentTimeMillis)) yield* refreshOnce(provider, account);
      return (yield* readAccount(provider, account)).credential.accessToken;
    }),
    recoverAccessToken: Effect.fnUntraced(function* (provider, account, rejected) {
      yield* refreshOnce(provider, account, rejected);
      const current = (yield* readAccount(provider, account)).credential.accessToken;
      if (current === rejected)
        return yield* new TokenStoreFailed({
          kind: 'reconnect',
          provider,
          account,
          reason: 'Credential recovery returned the rejected bearer',
        });
      return current;
    }),
  };
  return store;
}

function providerAccountKey(provider: string, account: AccountKey): string {
  return `${provider}/${account}`;
}

function refreshHoldFailure(provider: string, account: AccountKey, failure: TokenStoreFault | HoldStalled | HoldCut): TokenStoreFault {
  if (failure instanceof HoldStalled)
    return new TokenStoreFailed({
      kind: 'locked',
      provider,
      account,
      reason: `Token renewal for ${provider} account ${account} admitted no renewal within ${failure.waitedMs}ms; this renewal did not start`,
    });
  if (failure instanceof HoldCut)
    return new TokenStoreFailed({
      kind: 'locked',
      provider,
      account,
      reason: `Token renewal for ${provider} account ${account} stayed held for ${failure.heldMs}ms; ${failure.leaves}`,
    });
  return failure;
}
