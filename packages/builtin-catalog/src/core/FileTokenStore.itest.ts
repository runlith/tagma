import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, open, readdir, readFile, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { lockExclusive } from '@runlith/file-lock/flock';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Schema, Scope } from 'effect';
import type { CredentialSchema, StoredCredential } from '@runlith/llm/oauth/credential';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { ROTATING_GRANT } from '@runlith/llm/models/grant';
import { type SubscriptionCredential, subscriptionAccounts as shippedSubscription } from '../subscription/provider';
import type { OpenAISubscriptionCredential } from '@runlith/adapter-openai/models/openai';
import { SINGLE_ACCOUNT_KEY } from '@runlith/llm/oauth/accountKey';
import { makeFileTokenStore } from '@runlith/llm/oauth/FileTokenStore';
import { TestClock } from 'effect/testing';
import { OAuthFlowFailed } from '@runlith/llm/oauth/flows/vendorPayload';
import { CredentialFileFailed, CredentialFileInvalid } from '@runlith/credential-file/failure';
import { TokenStoreFailed } from '@runlith/llm/oauth/storeFailure';
import { type SubscriptionAccounts, subscriptionAccounts } from '@runlith/llm/oauth/vendor';
import { vendorWire } from '@runlith/llm/oauth/vendorCall';
import { openaiAccounts, openaiTokensToStored } from '@runlith/adapter-openai/oauth/vendors/openai';

const GrantCredential = Schema.Struct({ ...ROTATING_GRANT, scope: Schema.String });
type GrantCredential = typeof GrantCredential.Type;
const PersistentCredential = Schema.Struct({ accessToken: Schema.String, refreshToken: Schema.Null, expiresAt: Schema.Null });
type PersistentCredential = typeof PersistentCredential.Type;

const singleAccount = <C extends StoredCredential>(credential: CredentialSchema<C>, label: string) =>
  subscriptionAccounts<C>({ credential, signIns: [], key: () => SINGLE_ACCOUNT_KEY, label: () => label });

const SCHEMES: Readonly<Record<string, SubscriptionAccounts>> = {
  subscription: subscriptionAccounts(shippedSubscription),
  'openai-oauth': subscriptionAccounts(openaiAccounts),
  'grant-oauth': singleAccount(GrantCredential, 'Grant'),
  'persistent-oauth': singleAccount(PersistentCredential, 'Persistent'),
};

type Refresh = NonNullable<SubscriptionAccounts['refresh']>;
type Refresher<C> = (refreshToken: string, existing: C) => Effect.Effect<C, { readonly message: string }>;
type RegisteredRefresh = Refresher<SubscriptionCredential> | Refresher<OpenAISubscriptionCredential> | Refresher<GrantCredential>;

function testStore(path: string) {
  const refreshers: Record<string, Refresh> = {};
  const store = makeFileTokenStore({
    path,
    wire: vendorWire,
    schemes: (provider) => {
      const scheme = SCHEMES[provider];
      return scheme === undefined ? undefined : { ...scheme, refresh: refreshers[provider] ?? scheme.refresh };
    },
  });
  function registerRefresher(provider: 'subscription', refresh: Refresher<SubscriptionCredential>): void;
  function registerRefresher(provider: 'openai-oauth', refresh: Refresher<OpenAISubscriptionCredential>): void;
  function registerRefresher(provider: 'grant-oauth', refresh: Refresher<GrantCredential>): void;
  function registerRefresher(provider: string, refresh: RegisteredRefresh): void {
    refreshers[provider] = refresh as unknown as Refresh;
  }
  return { ...store, registerRefresher };
}

const accountKeyOf = (provider: string, credential: StoredCredential) => SCHEMES[provider]!.key(credential);
const future = Date.now() + 60 * 60 * 1_000;
function grantCredential(accessToken: string, expiresAt = future): GrantCredential {
  return { accessToken, refreshToken: `refresh-${accessToken}`, expiresAt, scope: 'openid' };
}
function openAICredential(accountId: string | undefined, accessToken = 'openai-access'): OpenAISubscriptionCredential {
  return { accessToken, refreshToken: 'openai-refresh', expiresAt: future, accountId: accountId || undefined };
}
function anthropicCredential(account = 'anthropic-account'): SubscriptionCredential {
  return {
    accessToken: 'anthropic-access',
    refreshToken: 'anthropic-refresh',
    expiresAt: future,
    scope: 'user:inference',
    account: { uuid: account, email: 'operator@example.com' },
    organization: { uuid: 'anthropic-org', name: 'Operator Org' },
  };
}
function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}
const tokenPath = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), 'runlith-token-store-'))),
  (home) => Effect.promise(() => rm(home, { recursive: true, force: true })),
).pipe(Effect.map((home) => join(home, 'tokens.json')));
function refreshLockPath(path: string, provider: string, account: string): string {
  const digest = createHash('sha256').update(`${provider}/${account}`).digest('hex');
  return `${path}.${digest}.refresh.lock`;
}
function persistentCredential(accessToken: string): PersistentCredential {
  return { accessToken, refreshToken: null, expiresAt: null };
}

describe('the shipped account keys', () => {
  test('uses durable vendor identity and one constant key otherwise', () => {
    expect(String(accountKeyOf('subscription', anthropicCredential()))).toBe('anthropic-account');
    expect(String(accountKeyOf('openai-oauth', openAICredential('openai-account')))).toBe('openai-account');
    expect(String(accountKeyOf('openai-oauth', openAICredential(undefined, jwt({ sub: 'jwt-account' }))))).toBe('jwt-account');
    expect(accountKeyOf('openai-oauth', openAICredential(undefined))).toBe(SINGLE_ACCOUNT_KEY);
  });
});

describe('FileTokenStore accounts', () => {
  it.live('keeps identity rows separate and replaces a provider with no identity', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const store = testStore(path);
      const first = yield* store.add('subscription', anthropicCredential('first'));
      const second = yield* store.add('subscription', anthropicCredential('second'));
      const firstRow = yield* store.get('subscription', first);
      const secondRow = yield* store.get('subscription', second);
      if (firstRow === null || secondRow === null) return yield* Effect.die('the newly stored accounts are missing');
      const firstAdded = firstRow.addedAt;
      const secondAdded = secondRow.addedAt;
      yield* store.relabel('subscription', first, 'Primary');
      yield* store.add('subscription', { ...anthropicCredential('first'), accessToken: 'replaced' });
      const accounts = [...(yield* store.accounts('subscription'))].sort((left, right) =>
        String(left.key).localeCompare(String(right.key)),
      );
      expect(accounts).toEqual([
        {
          key: first,
          label: 'Primary',
          credential: { ...anthropicCredential('first'), accessToken: 'replaced' },
          origin: { kind: 'own' },
          addedAt: firstAdded,
        },
        {
          key: second,
          label: 'operator@example.com',
          credential: anthropicCredential('second'),
          origin: { kind: 'own' },
          addedAt: secondAdded,
        },
      ]);
      expect((yield* store.get('subscription', second))?.credential).toMatchObject({ account: { uuid: 'second' } });
      yield* store.remove('subscription', first);
      expect((yield* store.accounts('subscription')).map((row) => row.key)).toEqual([second]);
      expect(yield* store.add('grant-oauth', grantCredential('first'))).toBe(SINGLE_ACCOUNT_KEY);
      expect(yield* store.add('grant-oauth', grantCredential('second'))).toBe(SINGLE_ACCOUNT_KEY);
      expect(yield* store.accounts('grant-oauth')).toMatchObject([{ key: SINGLE_ACCOUNT_KEY, credential: { accessToken: 'second' } }]);
    }),
  );

  it.live('writes owner-only files and refuses invalid account rows', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const store = testStore(path);
      yield* store.add('openai-oauth', openAICredential('operator'));
      expect((yield* Effect.promise(() => stat(path))).mode & 0o777).toBe(0o600);
      const addedAt = yield* Clock.currentTimeMillis;
      yield* Effect.promise(() =>
        writeFile(
          path,
          JSON.stringify({
            providers: {
              'openai-oauth': {
                broken: {
                  key: 'different',
                  label: 'Broken',
                  credential: { accessToken: 'only-one-field' },
                  origin: { kind: 'own' },
                  addedAt,
                },
              },
            },
          }),
        ),
      );
      yield* Effect.promise(() => chmod(path, 0o600));
      expect(yield* Effect.flip(testStore(path).accounts('openai-oauth'))).toBeInstanceOf(CredentialFileInvalid);
    }),
  );

  it.live('two store instances serialize replacement of one identity-less account', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const first = testStore(path);
      const second = testStore(path);
      const keys = yield* Effect.all([first.add('grant-oauth', grantCredential('a')), second.add('grant-oauth', grantCredential('b'))], {
        concurrency: 2,
      });
      expect(keys).toEqual([SINGLE_ACCOUNT_KEY, SINGLE_ACCOUNT_KEY]);
      const rows = yield* testStore(path).accounts('grant-oauth');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.key).toBe(SINGLE_ACCOUNT_KEY);
      expect(['a', 'b']).toContain(rows[0]!.credential.accessToken);
    }),
  );

  it.live('a lock file left by a holder that is gone blocks neither the store nor a refresh', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      yield* Effect.promise(() => writeFile(`${path}.lock`, '', { mode: 0o600 }));
      const now = yield* Clock.currentTimeMillis;
      const store = testStore(path);
      const account = yield* store.add('grant-oauth', grantCredential('stale', now + 1_000));
      yield* Effect.promise(() => writeFile(refreshLockPath(path, 'grant-oauth', account), '', { mode: 0o600 }));
      store.registerRefresher('grant-oauth', (_refreshToken, existing) =>
        Effect.succeed({ ...existing, accessToken: 'fresh', expiresAt: now + 3_600_000 }),
      );
      expect(yield* store.getAccessToken('grant-oauth', account)).toBe('fresh');
    }),
  );

  it.live('a lock another holder keeps blocks the store until that holder lets go', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const lockScope = yield* Scope.fork(yield* Effect.scope);
      const holder = yield* Scope.provide(
        Effect.acquireRelease(
          Effect.promise(() => open(`${path}.lock`, 'a', 0o600)),
          (handle) => Effect.promise(() => handle.close()),
        ),
        lockScope,
      );
      expect(lockExclusive(holder.fd)).toBe('locked');
      const adding = yield* Effect.forkScoped(testStore(path).add('grant-oauth', grantCredential('waiting')));
      yield* Effect.sleep(25);
      expect(adding.pollUnsafe()).toBeUndefined();
      yield* Scope.close(lockScope, Exit.void);
      expect(yield* Fiber.join(adding)).toBe(SINGLE_ACCOUNT_KEY);
    }),
  );

  it.live('an owner that resumes after a takeover refuses to write', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const now = yield* Clock.currentTimeMillis;
      const store = testStore(path);
      const began = yield* Deferred.make<void>();
      const exchange = yield* Deferred.make<void>();
      store.registerRefresher('grant-oauth', (_refreshToken, existing) =>
        Deferred.succeed(began, undefined).pipe(
          Effect.andThen(Deferred.await(exchange)),
          Effect.as({ ...existing, accessToken: 'from-the-loser', expiresAt: now + 3_600_000 }),
        ),
      );
      const account = yield* store.add('grant-oauth', grantCredential('stale', now + 1_000));
      const refreshing = yield* Effect.forkScoped(Effect.result(store.getAccessToken('grant-oauth', account)));
      yield* Deferred.await(began);
      const lockPath = refreshLockPath(path, 'grant-oauth', account);
      yield* Effect.promise(() => unlink(lockPath));
      yield* Effect.promise(() => writeFile(lockPath, '', { mode: 0o600 }));
      yield* Deferred.succeed(exchange, undefined);
      expect(yield* Fiber.join(refreshing)).toMatchObject({ _tag: 'Failure', failure: { _tag: 'TokenStoreFailed', kind: 'locked' } });
      expect((yield* testStore(path).get('grant-oauth', account))?.credential.accessToken).toBe('stale');
    }),
  );

  it.live('a temporary newer than the live file is adopted, and one older than it is dropped', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const account = yield* testStore(path).add('grant-oauth', grantCredential('landed'));
      const live = yield* Effect.promise(() => stat(path));
      const temporaryOf = (accessToken: string, at: number) => ({
        providers: {
          'grant-oauth': {
            [SINGLE_ACCOUNT_KEY]: {
              key: SINGLE_ACCOUNT_KEY,
              label: 'Stranded',
              origin: { kind: 'own' },
              addedAt: at,
              credential: grantCredential(accessToken),
            },
          },
        },
      });
      const superseded = `${path}.1.tmp`;
      yield* Effect.promise(() => writeFile(superseded, JSON.stringify(temporaryOf('superseded', 100)), { mode: 0o600 }));
      const before = new Date(live.mtimeMs - 1_000);
      yield* Effect.promise(() => utimes(superseded, before, before));
      const stranded = `${path}.2.tmp`;
      yield* Effect.promise(() => writeFile(stranded, JSON.stringify(temporaryOf('stranded', 200)), { mode: 0o600 }));
      const after = new Date(live.mtimeMs + 1_000);
      yield* Effect.promise(() => utimes(stranded, after, after));
      const rows = yield* testStore(path).accounts('grant-oauth');
      expect(rows).toMatchObject([{ key: account, credential: { accessToken: 'stranded' } }]);
      expect((yield* Effect.promise(() => readdir(dirname(path)))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
      const persisted = JSON.parse(yield* Effect.promise(() => readFile(path, 'utf8'))) as {
        providers: Record<string, Record<string, { credential: { accessToken: string } }>>;
      };
      expect(persisted.providers['grant-oauth']?.[SINGLE_ACCOUNT_KEY]?.credential.accessToken).toBe('stranded');
    }),
  );

  it.live('a temporary that does not parse is debris and leaves no readable copy behind', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      yield* testStore(path).add('grant-oauth', grantCredential('landed'));
      const live = yield* Effect.promise(() => stat(path));
      const debris = `${path}.3.tmp`;
      yield* Effect.promise(() => writeFile(debris, '{"providers": ', { mode: 0o600 }));
      const after = new Date(live.mtimeMs + 1_000);
      yield* Effect.promise(() => utimes(debris, after, after));
      expect(yield* testStore(path).accounts('grant-oauth')).toMatchObject([{ credential: { accessToken: 'landed' } }]);
      expect((yield* Effect.promise(() => readdir(dirname(path)))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    }),
  );

  it.live('the first read of a store that never landed adopts the write that was in flight', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const document = {
        providers: {
          'grant-oauth': {
            [SINGLE_ACCOUNT_KEY]: {
              key: SINGLE_ACCOUNT_KEY,
              label: 'In flight',
              origin: { kind: 'own' },
              addedAt: 200,
              credential: grantCredential('in-flight'),
            },
          },
        },
      };
      yield* Effect.promise(() => writeFile(`${path}.9.tmp`, JSON.stringify(document), { mode: 0o600 }));
      expect(yield* testStore(path).accounts('grant-oauth')).toMatchObject([{ credential: { accessToken: 'in-flight' } }]);
      expect((yield* Effect.promise(() => readdir(dirname(path)))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    }),
  );

  it.live("a removed provider's rows survive another provider's write, and its return reads the same account", () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const gone = {
        'acme-oauth': {
          acct: {
            key: 'acct',
            label: 'Acme',
            addedAt: 100,
            credential: { accessToken: 'acme', refreshToken: null, expiresAt: null, custom: 1 },
          },
        },
      };
      yield* Effect.promise(() => writeFile(path, `${JSON.stringify({ providers: gone })}\n`, { mode: 0o600 }));
      yield* testStore(path).add('grant-oauth', grantCredential('written'));
      const persisted = JSON.parse(yield* Effect.promise(() => readFile(path, 'utf8'))) as { providers: Record<string, unknown> };
      expect(persisted.providers['acme-oauth']).toEqual(gone['acme-oauth']);
      const acme = subscriptionAccounts({
        credential: Schema.Struct({
          accessToken: Schema.String,
          refreshToken: Schema.NullOr(Schema.String),
          expiresAt: Schema.NullOr(Schema.Number),
        }),
        signIns: [],
        key: () => AccountKey.make('acct'),
        label: () => 'Acme',
      });
      const returned = makeFileTokenStore({
        path,
        schemes: (provider) => (provider === 'acme-oauth' ? acme : undefined),
        wire: vendorWire,
      });
      expect((yield* returned.accounts('acme-oauth')).map((row) => String(row.key))).toEqual(['acct']);
    }),
  );

  it.live('one unreadable row is refused alone: its siblings still read, and the listing names it with its reason', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      yield* testStore(path).add('grant-oauth', grantCredential('good'));
      const stored = JSON.parse(yield* Effect.promise(() => readFile(path, 'utf8'))) as {
        providers: Record<string, Record<string, unknown>>;
      };
      stored.providers['grant-oauth']!.broken = {
        key: 'broken',
        label: 'Broken',
        origin: { kind: 'own' },
        addedAt: 1,
        credential: { accessToken: 7 },
      };
      yield* Effect.promise(() => writeFile(path, `${JSON.stringify(stored)}\n`, { mode: 0o600 }));
      const store = testStore(path);
      expect((yield* store.accounts('grant-oauth')).map((row) => row.credential.accessToken)).toEqual(['good']);
      expect(yield* store.held('grant-oauth')).toMatchObject([
        { key: 'only', unreadable: null },
        { key: 'broken', credential: null, unreadable: expect.any(String) },
      ]);
      expect(yield* Effect.flip(store.getAccessToken('grant-oauth', AccountKey.make('broken')))).toMatchObject({ kind: 'read' });
      expect(yield* store.getAccessToken('grant-oauth', AccountKey.make('only'))).toBe('good');
    }),
  );

  it.live('a row named by its own key reads with the label its credential gives, and a chosen name is kept', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const claims = Buffer.from(JSON.stringify({ 'https://api.openai.com/profile': { email: 'person@example.com' } })).toString(
        'base64url',
      );
      const providers = {
        'openai-oauth': {
          'account-a': {
            key: 'account-a',
            label: 'account-a',
            origin: { kind: 'own' },
            addedAt: 100,
            credential: openAICredential('account-a', `h.${claims}.s`),
          },
          'account-c': {
            key: 'account-c',
            label: 'Work',
            origin: { kind: 'own' },
            addedAt: 100,
            credential: openAICredential('account-c'),
          },
        },
      };
      yield* Effect.promise(() => writeFile(path, `${JSON.stringify({ providers })}\n`, { mode: 0o600 }));
      const rows = yield* testStore(path).accounts('openai-oauth');
      const named = Object.fromEntries(rows.map((row) => [row.key, row.label]));
      expect(named['account-a']).toBe('person@example.com');
      expect(named['account-c']).toBe('Work');
    }),
  );
});

describe('the failure channel carries the failure, not a wrapper around it', () => {
  it.live('a reconnect leaves recoverAccessToken as the tagged value a surface can branch on', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const store = testStore(path);
      const account = yield* store.add('persistent-oauth', persistentCredential('rejected'));
      const failure = yield* Effect.flip(store.recoverAccessToken('persistent-oauth', account, 'rejected'));
      expect(failure).toBeInstanceOf(TokenStoreFailed);
      expect(failure).toMatchObject({ _tag: 'TokenStoreFailed', kind: 'reconnect', provider: 'persistent-oauth', account });
    }),
  );

  it.live('an invalid file leaves accounts and get as CredentialFileInvalid', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      yield* Effect.promise(() =>
        writeFile(path, JSON.stringify({ providers: { 'openai-oauth': { broken: { key: 'other' } } } }), { mode: 0o600 }),
      );
      const listed = yield* Effect.flip(testStore(path).accounts('openai-oauth'));
      const read = yield* Effect.flip(testStore(path).get('openai-oauth', SINGLE_ACCOUNT_KEY));
      expect(listed).toBeInstanceOf(CredentialFileInvalid);
      expect(read).toBeInstanceOf(CredentialFileInvalid);
      expect(listed).toMatchObject({ _tag: 'CredentialFileInvalid', path });
    }),
  );

  it.live('a write failure leaves remove and relabel', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const store = testStore(path);
      const account = yield* store.add('openai-oauth', openAICredential('operator'));
      yield* Effect.acquireRelease(
        Effect.promise(() => chmod(dirname(path), 0o500)),
        () => Effect.promise(() => chmod(dirname(path), 0o700)),
      );
      const removed = yield* Effect.flip(store.remove('openai-oauth', account));
      const relabelled = yield* Effect.flip(store.relabel('openai-oauth', account, 'Renamed'));
      expect(removed).toBeInstanceOf(CredentialFileFailed);
      expect(relabelled).toBeInstanceOf(CredentialFileFailed);
      expect(removed).toMatchObject({ _tag: 'CredentialFileFailed', kind: 'write' });
    }),
  );

  it.live('a defect raised inside a refresher stays undressed, with no tag to mistake it for a refusal', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const now = yield* Clock.currentTimeMillis;
      const store = testStore(path);
      store.registerRefresher('grant-oauth', () => {
        throw new TypeError('someBug is not a function');
      });
      const account = yield* store.add('grant-oauth', grantCredential('stale', now + 1_000));
      const exit = yield* Effect.exit(store.getAccessToken('grant-oauth', account));
      const defect = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
      expect(defect).toBeInstanceOf(TypeError);
      expect(defect).not.toBeInstanceOf(TokenStoreFailed);
      expect(defect).toMatchObject({ message: 'someBug is not a function' });
    }),
  );
});

it.effect('credential creation and renewal use the runtime clock', () =>
  Effect.gen(function* () {
    const path = yield* tokenPath;
    const store = testStore(path);
    const now = yield* Clock.currentTimeMillis;
    store.registerRefresher('grant-oauth', (_token, existing) =>
      Effect.map(Clock.currentTimeMillis, (at) => ({ ...existing, accessToken: 'renewed', expiresAt: at + 3_600_000 })),
    );
    const account = yield* store.add('grant-oauth', grantCredential('initial', now + 360_000));
    expect((yield* store.get('grant-oauth', account))?.addedAt).toBe(now);
    expect(yield* store.getAccessToken('grant-oauth', account)).toBe('initial');
    yield* TestClock.adjust(60_001);
    expect(yield* store.getAccessToken('grant-oauth', account)).toBe('renewed');
    expect((yield* store.get('grant-oauth', account))?.credential.expiresAt).toBe(now + 60_001 + 3_600_000);
  }),
);

describe('FileTokenStore refresh', () => {
  it.live('recovery of a rejected fresh bearer is single-flight and preserves a newer token', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const first = testStore(path);
      const second = testStore(path);
      const account = yield* first.add('subscription', anthropicCredential());
      let renewals = 0;
      const refresh = (_token: string, current: SubscriptionCredential) =>
        Effect.sync(() => {
          renewals += 1;
          return { ...current, accessToken: 'renewed', refreshToken: 'rotated', expiresAt: future };
        });
      first.registerRefresher('subscription', refresh);
      second.registerRefresher('subscription', refresh);
      expect(
        yield* Effect.all(
          [
            first.recoverAccessToken('subscription', account, 'anthropic-access'),
            second.recoverAccessToken('subscription', account, 'anthropic-access'),
          ],
          { concurrency: 2 },
        ),
      ).toEqual(['renewed', 'renewed']);
      expect(renewals).toBe(1);
      expect(yield* first.recoverAccessToken('subscription', account, 'anthropic-access')).toBe('renewed');
      expect(renewals).toBe(1);
    }),
  );

  it.live('failed rejected-bearer renewal preserves the credential and its account', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const store = testStore(path);
      const original = anthropicCredential('account-a');
      const a = yield* store.add('subscription', original);
      const b = yield* store.add('subscription', anthropicCredential('account-b'));
      store.registerRefresher('subscription', (_token, current) =>
        Effect.succeed({ ...current, account: { ...current.account, uuid: 'account-b' } }),
      );
      expect(yield* Effect.flip(store.recoverAccessToken('subscription', a, original.accessToken))).toMatchObject({
        kind: 'reconnect',
        account: a,
      });
      expect((yield* store.get('subscription', a))?.credential).toEqual(original);
      expect((yield* store.get('subscription', b))?.credential).toEqual(anthropicCredential('account-b'));
    }),
  );

  it.live('waits on a live refresh lock across store instances and exchanges once', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const now = yield* Clock.currentTimeMillis;
      const first = testStore(path);
      const second = testStore(path);
      let refreshes = 0;
      const began = yield* Deferred.make<void>();
      const exchange = yield* Deferred.make<void>();
      const refresh = (_refreshToken: string, existing: GrantCredential) =>
        Effect.sync(() => {
          refreshes += 1;
        }).pipe(
          Effect.andThen(Deferred.succeed(began, undefined)),
          Effect.andThen(Deferred.await(exchange)),
          Effect.as({ ...existing, accessToken: 'fresh', refreshToken: 'rotated', expiresAt: now + 3_600_000 }),
        );
      first.registerRefresher('grant-oauth', refresh);
      second.registerRefresher('grant-oauth', refresh);
      const account = yield* first.add('grant-oauth', grantCredential('stale', now + 1_000));
      const firstRead = yield* Effect.forkScoped(first.getAccessToken('grant-oauth', account));
      yield* Deferred.await(began);
      const waitingRead = yield* Effect.forkScoped(second.getAccessToken('grant-oauth', account));
      yield* Effect.yieldNow;
      yield* Deferred.succeed(exchange, undefined);
      expect(yield* Effect.all([Fiber.join(firstRead), Fiber.join(waitingRead)], { concurrency: 2 })).toEqual(['fresh', 'fresh']);
      expect(refreshes).toBe(1);
      expect((yield* first.get('grant-oauth', account))?.credential.refreshToken).toBe('rotated');
    }),
  );

  it.live('refresh gates and lock names are scoped by provider as well as account key', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const now = yield* Clock.currentTimeMillis;
      const store = testStore(path);
      const openAIBegan = yield* Deferred.make<void>();
      const anthropicBegan = yield* Deferred.make<void>();
      const exchange = yield* Deferred.make<void>();
      store.registerRefresher('openai-oauth', (_refreshToken, existing) =>
        Deferred.succeed(openAIBegan, undefined).pipe(
          Effect.andThen(Deferred.await(exchange)),
          Effect.as({ ...existing, accessToken: 'fresh-openai', expiresAt: now + 3_600_000 }),
        ),
      );
      store.registerRefresher('subscription', (_refreshToken, existing) =>
        Deferred.succeed(anthropicBegan, undefined).pipe(
          Effect.andThen(Deferred.await(exchange)),
          Effect.as({ ...existing, accessToken: 'fresh-anthropic', expiresAt: now + 3_600_000 }),
        ),
      );
      const openAI = yield* store.add('openai-oauth', { ...openAICredential('shared'), expiresAt: now + 1_000 });
      const anthropic = yield* store.add('subscription', { ...anthropicCredential('shared'), expiresAt: now + 1_000 });
      const a = yield* Effect.forkScoped(store.getAccessToken('openai-oauth', openAI));
      const b = yield* Effect.forkScoped(store.getAccessToken('subscription', anthropic));
      yield* Deferred.await(openAIBegan);
      yield* Deferred.await(anthropicBegan);
      yield* Deferred.succeed(exchange, undefined);
      expect(yield* Effect.all([Fiber.join(a), Fiber.join(b)], { concurrency: 2 })).toEqual(['fresh-openai', 'fresh-anthropic']);
    }),
  );

  it.live('remove during refresh makes the exchange refuse instead of reviving the row', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const now = yield* Clock.currentTimeMillis;
      const store = testStore(path);
      const began = yield* Deferred.make<void>();
      const exchange = yield* Deferred.make<void>();
      store.registerRefresher('grant-oauth', (_refreshToken, existing) =>
        Deferred.succeed(began, undefined).pipe(
          Effect.andThen(Deferred.await(exchange)),
          Effect.as({ ...existing, accessToken: 'fresh', expiresAt: now + 3_600_000 }),
        ),
      );
      const account = yield* store.add('grant-oauth', grantCredential('stale', now + 1_000));
      const refreshing = yield* Effect.forkScoped(Effect.result(store.getAccessToken('grant-oauth', account)));
      yield* Deferred.await(began);
      yield* store.remove('grant-oauth', account);
      yield* Deferred.succeed(exchange, undefined);
      expect(yield* Fiber.join(refreshing)).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'TokenStoreFailed', kind: 'missing', account },
      });
      expect(yield* store.get('grant-oauth', account)).toBeNull();
    }),
  );

  it.live('keeps a failed refresh typed and retries it on the next call', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const now = yield* Clock.currentTimeMillis;
      const store = testStore(path);
      let attempts = 0;
      store.registerRefresher('grant-oauth', () => {
        attempts += 1;
        return Effect.fail(new OAuthFlowFailed({ reason: 'refresh denied' }));
      });
      const account = yield* store.add('grant-oauth', grantCredential('stale', now + 1_000));
      expect(yield* Effect.flip(store.getAccessToken('grant-oauth', account))).toMatchObject({
        _tag: 'TokenStoreFailed',
        kind: 'refresh',
        account,
        reason: 'refresh denied',
      });
      expect(yield* Effect.flip(store.getAccessToken('grant-oauth', account))).toBeInstanceOf(TokenStoreFailed);
      expect(attempts).toBe(2);
    }),
  );

  it.live('a refresh answering for another account refuses instead of rebinding the row', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const now = yield* Clock.currentTimeMillis;
      const store = testStore(path);
      store.registerRefresher('openai-oauth', (_refreshToken, existing) =>
        Effect.succeed({ ...existing, accessToken: 'fresh', accountId: 'another-account', expiresAt: now + 3_600_000 }),
      );
      store.registerRefresher('subscription', (_refreshToken, existing) =>
        Effect.succeed({
          ...existing,
          accessToken: 'fresh',
          account: { ...existing.account, uuid: 'another-account' },
          expiresAt: now + 3_600_000,
        }),
      );
      const openai = yield* store.add('openai-oauth', { ...openAICredential('openai-account', 'stale-openai'), expiresAt: now + 1_000 });
      const anthropic = yield* store.add('subscription', {
        ...anthropicCredential('anthropic-account'),
        accessToken: 'stale-anthropic',
        expiresAt: now + 1_000,
      });
      expect(yield* Effect.flip(store.getAccessToken('openai-oauth', openai))).toMatchObject({
        _tag: 'TokenStoreFailed',
        kind: 'reconnect',
        account: openai,
        reason: expect.stringContaining('answered for account another-account'),
      });
      expect(yield* Effect.flip(store.getAccessToken('subscription', anthropic))).toMatchObject({
        _tag: 'TokenStoreFailed',
        kind: 'reconnect',
        account: anthropic,
        reason: expect.stringContaining('answered for account another-account'),
      });
      expect((yield* store.get('openai-oauth', openai))?.credential.accessToken).toBe('stale-openai');
      expect((yield* store.get('subscription', anthropic))?.credential.accessToken).toBe('stale-anthropic');
    }),
  );

  it.live('an own row still uses its registered refresher', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const now = yield* Clock.currentTimeMillis;
      const store = testStore(path);
      let refreshes = 0;
      store.registerRefresher('openai-oauth', (_refreshToken, existing) => {
        refreshes += 1;
        return Effect.succeed({ ...existing, accessToken: 'fresh-owned', expiresAt: now + 3_600_000 });
      });
      const account = yield* store.add('openai-oauth', { ...openAICredential('openai-account', 'stale-owned'), expiresAt: now + 1_000 });
      expect(yield* store.getAccessToken('openai-oauth', account)).toBe('fresh-owned');
      expect(refreshes).toBe(1);
    }),
  );

  test('preserves vendor identity when refresh responses omit it', () => {
    const openai = openAICredential('chatgpt-account');
    expect(
      openaiTokensToStored(
        { accessToken: 'fresh-openai', refreshToken: 'fresh-refresh', expiresAt: future, idToken: '', accountId: undefined },
        openai,
      ),
    ).toMatchObject({ accountId: 'chatgpt-account' });
  });

  it.live('provider refresher failures surface as TokenStoreFailed without vendor egress', () =>
    Effect.gen(function* () {
      const path = yield* tokenPath;
      const now = yield* Clock.currentTimeMillis;
      const store = testStore(path);
      store.registerRefresher('subscription', () => Effect.fail(new OAuthFlowFailed({ reason: 'anthropic denied' })));
      store.registerRefresher('openai-oauth', () => Effect.fail(new OAuthFlowFailed({ reason: 'openai denied' })));
      const anthropic = yield* store.add('subscription', { ...anthropicCredential(), expiresAt: now + 1_000 });
      const openai = yield* store.add('openai-oauth', { ...openAICredential('operator'), expiresAt: now + 1_000 });
      expect(yield* Effect.flip(store.getAccessToken('subscription', anthropic))).toMatchObject({
        _tag: 'TokenStoreFailed',
        kind: 'refresh',
        reason: 'anthropic denied',
      });
      expect(yield* Effect.flip(store.getAccessToken('openai-oauth', openai))).toMatchObject({
        _tag: 'TokenStoreFailed',
        kind: 'refresh',
        reason: 'openai denied',
      });
    }),
  );
});
