import { testTokens } from '../testing/tokens.js';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { OPENAI_OAUTH_PROVIDER } from '@runlith/adapter-openai/models/openai';
import type { ModelCredentials, ProviderQuota } from '@runlith/llm/profiles/contract';
import {
  QuotaMissingScope,
  QuotaInvalidResponse,
  QuotaObservation,
  QuotaRateLimited,
  QuotaServerFailure,
  QuotaUnsupported,
  QuotaUnavailable,
  QuotaWindow,
} from '@runlith/llm/schema/quota';
import { Clock, Context, Deferred, Effect, Exit, Fiber, Latch, Layer, Option, Queue, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { accountQuotaReading } from '../store/tables.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import type { QuotaTable } from '../contract/wire/accounts.js';
import type { AccountRows } from '../contract/service/accounts.js';
import { AccountQuota } from '../contract/service/quota.js';
import { TokenStoreFailed } from '@runlith/llm/oauth/storeFailure';
import { type AccountQuotaProvider, accountQuotaLayer } from './ledger.js';
import { subscriptionAccounts } from '../accounts/stored.js';
import { makeQuotaReadings } from './readings.js';
import { makeOperatorCredentials } from '../credentials/operator.js';

const storage = unitsLayer(MachineUnits, MachineStore).pipe(Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations)));

const readings = Effect.map(Effect.all([MachineStore, MachineUnits]), ([store, units]) => makeQuotaReadings({ db: store.db, units }));

const clearReadings = Effect.flatMap(Effect.all([MachineStore, MachineUnits]), ([store, units]) =>
  units.write('AccountQuota', (unit) => unit.run(store.db.delete(accountQuotaReading))),
);

const credentials: ModelCredentials = {
  apiKey: () => Promise.reject(new Error('unused fake credential')),
  accessToken: () => Promise.reject(new Error('unused fake credential')),
  credential: async () => ({
    accessToken: 'token',
    refreshToken: 'refresh',
    expiresAt: 0,
    scope: '',
    account: { uuid: 'account-uuid', email: 'operator@example.com' },
    organization: { uuid: 'organization-uuid', name: '' },
    accountId: undefined,
  }),
};

const observation = (source: 'reply' | 'usage', usedPercent: number) =>
  new QuotaObservation({
    observedAt: new Date(),
    source,
    windows: [new QuotaWindow({ kind: 'session', usedPercent })],
  });

const account = AccountKey.make('account-1');

const hasReading = (table: QuotaTable): boolean => table.some((row) => row.quota !== null || row.failure !== null);

const bootSettled = (quota: Context.Service.Shape<typeof AccountQuota>) => quota.changes.pipe(Stream.filter(hasReading), Stream.runHead);

const buildQuota = Effect.fnUntraced(function* (
  accounts: AccountRows,
  providers: () => readonly AccountQuotaProvider[],
  defaultAccount: Parameters<typeof accountQuotaLayer>[4],
  signing: Parameters<typeof accountQuotaLayer>[5] = () => credentials,
  uninstalled?: Parameters<typeof accountQuotaLayer>[6],
) {
  const scope = yield* Scope.make();
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
  const built = yield* Scope.provide(
    Layer.build(accountQuotaLayer('operator', accounts, yield* readings, providers, defaultAccount, signing, uninstalled)),
    scope,
  );
  return { quota: Context.get(built, AccountQuota), close: Scope.close(scope, Exit.void) };
});

const boot = (
  accounts: AccountRows,
  read: ProviderQuota['read'],
  signing?: Parameters<typeof accountQuotaLayer>[5],
  uninstalled?: Parameters<typeof accountQuotaLayer>[6],
) => {
  const provider: AccountQuotaProvider = {
    id: OPENAI_OAUTH_PROVIDER,
    quota: { fromHeaders: () => null, read },
  };
  return buildQuota(
    accounts,
    () => [provider],
    () => Effect.succeed({ account, revision: 0 }),
    signing,
    uninstalled,
  );
};

const openaiCredential = (accessToken: string) => ({
  accessToken,
  refreshToken: 'refresh',
  expiresAt: Date.now() + 3_600_000,
  accountId: account,
});

const world = Effect.fnUntraced(function* (read: ProviderQuota['read']) {
  const tokens = testTokens(join(mkdtempSync(join(tmpdir(), 'account-quota-')), 'tokens.json'));
  yield* tokens.add(OPENAI_OAUTH_PROVIDER, openaiCredential('access'));
  const held = yield* boot(subscriptionAccounts(tokens), read);
  yield* bootSettled(held.quota);
  return held;
});

const rowOf = (held: { readonly quota: Context.Service.Shape<typeof AccountQuota> }) => Effect.map(held.quota.table(), (table) => table[0]);

const signedIn = Effect.fnUntraced(function* () {
  const tokens = testTokens(join(mkdtempSync(join(tmpdir(), 'account-quota-kept-')), 'tokens.json'));
  yield* tokens.add(OPENAI_OAUTH_PROVIDER, openaiCredential('access'));
  return { tokens };
});

const measuredBefore = Effect.fnUntraced(function* (tokens: ReturnType<typeof testTokens>, usedPercent: number) {
  const first = yield* boot(subscriptionAccounts(tokens), () => Effect.succeed(observation('usage', 10)));
  yield* bootSettled(first.quota);
  yield* first.quota.observe(OPENAI_OAUTH_PROVIDER, account, observation('reply', usedPercent));
  const quota = (yield* rowOf(first))?.quota;
  yield* first.close;
  return quota;
});

layer(storage, { excludeTestServices: true })('account quota', (it) => {
  it.effect('a session-fed provider keeps its last observation through quota refresh without a polling source', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      const provider = 'session-fixture';
      const key = AccountKey.make('directory');
      const accounts: AccountRows = {
        of: () =>
          Effect.succeed([
            {
              key,
              label: 'CLI',
              origin: { kind: 'cli', place: 'directory' },
              secret: 'subscription',
              fingerprint: 'machine/directory',
              enrollment: '1',
              durable: true,
              problem: null,
            },
          ]),
      };
      const { quota } = yield* buildQuota(
        accounts,
        () => [{ id: provider, quota: null }],
        () => Effect.succeed({ account: key, revision: 0 }),
      );
      const measured = observation('reply', 42);
      yield* quota.observe(provider, key, measured);
      yield* quota.refresh(provider, key);
      const [row] = yield* quota.table();
      expect(row).toMatchObject({ provider, account: key, failure: null, restored: false });
      expect(row?.quota?.windows[0]?.usedPercent).toBe(42);
      expect(row?.quota?.observedAt.getTime()).toBe(measured.observedAt.getTime());
      yield* quota.fail(provider, key, new QuotaInvalidResponse({ message: 'unreadable report' }));
      const [failed] = yield* quota.table();
      expect(failed?.failure?._tag).toBe('invalid-response');
      expect(failed?.quota?.windows[0]?.usedPercent).toBe(42);
      yield* quota.observe(provider, key, observation('reply', 43));
      expect((yield* quota.table())[0]?.failure).toBeNull();
    }),
  );

  it.effect('a merged window stands beside the account windows through later observations and a restart', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      const { tokens } = yield* signedIn();
      const images = (usedPercent: number) =>
        new QuotaObservation({
          observedAt: new Date(),
          source: 'reply',
          windows: [new QuotaWindow({ kind: 'bucket', label: 'images', usedPercent, windowMinutes: 1440 })],
        });
      const windowsOf = (held: { readonly quota: Context.Service.Shape<typeof AccountQuota> }) =>
        Effect.map(rowOf(held), (row) => row?.quota?.windows.map((window) => [window.kind, window.label, window.usedPercent]));
      const first = yield* boot(subscriptionAccounts(tokens), () => Effect.succeed(observation('usage', 10)));
      yield* bootSettled(first.quota);
      yield* first.quota.merge(OPENAI_OAUTH_PROVIDER, account, images(30));
      yield* first.quota.merge(OPENAI_OAUTH_PROVIDER, account, images(40));
      yield* first.quota.observe(OPENAI_OAUTH_PROVIDER, account, observation('reply', 20));
      expect(yield* windowsOf(first)).toEqual([
        ['session', undefined, 20],
        ['bucket', 'images', 40],
      ]);
      yield* first.close;

      const second = yield* boot(subscriptionAccounts(tokens), () => Effect.never);
      yield* second.quota.observe(OPENAI_OAUTH_PROVIDER, account, observation('reply', 25));
      expect(yield* windowsOf(second)).toEqual([
        ['session', undefined, 25],
        ['bucket', 'images', 40],
      ]);
      yield* second.close;
    }),
  );

  it.effect('a borrowing provider polls under the lender row it is shown as, and a hidden provider is not published', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      const key = AccountKey.make('directory');
      const row = (fingerprint: string) => ({
        key,
        label: 'CLI',
        origin: { kind: 'cli' as const, place: 'directory' },
        secret: 'subscription' as const,
        fingerprint,
        enrollment: '1',
        durable: true,
        problem: null,
      });
      const accounts: AccountRows = { of: (provider) => Effect.succeed([row(provider)]) };
      let polled = 0;
      const reader: ProviderQuota = { fromHeaders: () => null, read: () => Effect.sync(() => observation('usage', 10 + ++polled)) };
      const { quota } = yield* buildQuota(
        accounts,
        () => [
          { id: 'borrower', quota: reader, shownAs: 'lender' },
          { id: 'lender', quota: null },
          { id: 'other-mode', quota: null, shownAs: null },
        ],
        () => Effect.succeed({ account: key, revision: 0 }),
      );
      yield* quota.refresh('lender', key);
      const table = yield* quota.table();
      expect(table.map((entry) => entry.provider)).toEqual(['lender']);
      expect(table[0]?.quota?.windows[0]?.usedPercent).toBe(10 + polled);
      expect(polled).toBeGreaterThan(0);
    }),
  );

  it.effect('the table and stream keep quota per account', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      const held = yield* world(() => Effect.succeed(observation('usage', 10)));
      const frames = yield* Queue.make<unknown>();
      const fiber = yield* Effect.forkChild(Stream.runForEach(held.quota.changes, (frame) => Queue.offer(frames, frame)));

      const opened = (yield* Queue.take(frames)) as ReadonlyArray<{ account: string; quota: unknown }>;
      expect(opened).toHaveLength(1);
      expect(opened[0]).toMatchObject({ account, default: true });

      yield* held.quota.observe(OPENAI_OAUTH_PROVIDER, account, observation('reply', 61));
      const changed = (yield* Queue.take(frames)) as ReadonlyArray<{
        account: string;
        quota: { source: string; windows: ReadonlyArray<{ usedPercent: number }> };
        failedAt: number | null;
      }>;
      expect(changed[0]).toMatchObject({
        account,
        quota: { source: 'reply', windows: [{ usedPercent: 61 }] },
      });
      expect(changed[0]?.failedAt).toBeNull();

      yield* Fiber.interrupt(fiber);
      yield* held.close;
    }),
  );

  it.effect('a reply keeps the plan the usage read named', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      const named = new QuotaObservation({
        observedAt: new Date(yield* Clock.currentTimeMillis),
        source: 'usage',
        plan: 'Muse Code High Usage',
        windows: [new QuotaWindow({ kind: 'session', usedPercent: 10 })],
      });
      const held = yield* world(() => Effect.succeed(named));

      yield* held.quota.observe(OPENAI_OAUTH_PROVIDER, account, observation('reply', 61));
      const [row] = yield* held.quota.table();
      expect(row?.quota).toMatchObject({ source: 'reply', plan: 'Muse Code High Usage', windows: [{ usedPercent: 61 }] });

      const renamed = new QuotaObservation({ ...observation('reply', 62), plan: 'another tier' });
      yield* held.quota.observe(OPENAI_OAUTH_PROVIDER, account, renamed);
      const [moved] = yield* held.quota.table();
      expect(moved?.quota?.plan).toBe('another tier');

      yield* held.close;
    }),
  );

  it.effect('usage polling lives only for an open account subscription', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      const tokens = testTokens(join(mkdtempSync(join(tmpdir(), 'account-quota-clock-')), 'tokens.json'));
      yield* tokens.add(OPENAI_OAUTH_PROVIDER, openaiCredential('access'));
      const reads = yield* Queue.make<number>();
      let ordinal = 0;
      const provider: AccountQuotaProvider = {
        id: OPENAI_OAUTH_PROVIDER,
        quota: {
          fromHeaders: () => null,
          read: () => Queue.offer(reads, ++ordinal).pipe(Effect.as(observation('usage', 10))),
        },
      };
      const { quota } = yield* buildQuota(
        subscriptionAccounts(tokens),
        () => [provider],
        () => Effect.succeed({ account, revision: 0 }),
      );

      expect(yield* Queue.take(reads)).toBe(1);
      yield* Effect.yieldNow;
      yield* TestClock.adjust('20 minutes');
      yield* Effect.yieldNow;
      expect(Option.isNone(yield* Queue.poll(reads))).toBe(true);

      const subscriber = yield* Effect.forkChild(Stream.runDrain(quota.changes));
      yield* Effect.yieldNow;
      yield* TestClock.adjust('15 minutes');
      expect(yield* Queue.take(reads)).toBe(2);

      yield* Fiber.interrupt(subscriber);
      yield* TestClock.adjust('20 minutes');
      yield* Effect.yieldNow;
      expect(Option.isNone(yield* Queue.poll(reads))).toBe(true);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect('an account is read again just after its window resets, before the next quarter-hour pass', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      const tokens = testTokens(join(mkdtempSync(join(tmpdir(), 'account-quota-reset-')), 'tokens.json'));
      yield* tokens.add(OPENAI_OAUTH_PROVIDER, openaiCredential('access'));
      const reads = yield* Queue.make<number>();
      let ordinal = 0;
      const provider: AccountQuotaProvider = {
        id: OPENAI_OAUTH_PROVIDER,
        quota: {
          fromHeaders: () => null,
          read: Effect.fnUntraced(function* () {
            const now = yield* Clock.currentTimeMillis;
            yield* Queue.offer(reads, ++ordinal);
            return new QuotaObservation({
              observedAt: new Date(now),
              source: 'usage',
              windows: [new QuotaWindow({ kind: 'session', usedPercent: 40, resetsAt: (now + 5 * 60_000) / 1000 })],
            });
          }),
        },
      };
      const { quota } = yield* buildQuota(
        subscriptionAccounts(tokens),
        () => [provider],
        () => Effect.succeed({ account, revision: 0 }),
      );
      expect(yield* Queue.take(reads)).toBe(1);
      yield* bootSettled(quota);

      const subscriber = yield* Effect.forkChild(Stream.runDrain(quota.changes));
      yield* Effect.yieldNow;
      yield* TestClock.adjust('5 minutes');
      yield* Effect.yieldNow;
      expect(Option.isNone(yield* Queue.poll(reads))).toBe(true);
      yield* TestClock.adjust('10 seconds');
      expect(yield* Queue.take(reads)).toBe(2);
      yield* Fiber.interrupt(subscriber);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect('a remembered window past its reset stands reset at the next reading', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      const { tokens } = yield* signedIn();
      const held = yield* boot(subscriptionAccounts(tokens), () => Effect.succeed(observation('usage', 10)));
      yield* bootSettled(held.quota);
      const day = 24 * 3_600_000;
      const at = yield* Clock.currentTimeMillis;
      yield* held.quota.merge(
        OPENAI_OAUTH_PROVIDER,
        account,
        new QuotaObservation({
          observedAt: new Date(at - day),
          source: 'reply',
          windows: [
            new QuotaWindow({ kind: 'bucket', label: 'images', usedPercent: 70, windowMinutes: 1440, resetsAt: (at - day / 2) / 1000 }),
          ],
        }),
      );
      yield* held.quota.observe(OPENAI_OAUTH_PROVIDER, account, observation('reply', 20));

      const images = (yield* rowOf(held))?.quota?.windows.find((window) => window.label === 'images');
      expect(images).toMatchObject({ usedPercent: 0, resetsAt: (at + day / 2) / 1000 });
      yield* held.close;
    }),
  );

  it.effect('a failed usage read keeps the previous windows', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      let next: Effect.Effect<QuotaObservation, QuotaMissingScope> = Effect.succeed(observation('usage', 32));
      const held = yield* world(() => next);

      const before = yield* rowOf(held);
      expect(before?.quota).toMatchObject({ windows: [{ usedPercent: 32 }] });

      next = Effect.fail(new QuotaMissingScope({ scope: 'user:profile' }));
      yield* held.quota.refresh(OPENAI_OAUTH_PROVIDER, account);
      const after = yield* rowOf(held);
      expect(after?.quota).toBe(before?.quota);
      expect(after?.failure).toMatchObject({ _tag: 'missing-scope', scope: 'user:profile' });

      yield* held.close;
    }),
  );

  it.effect('a transient unavailable quota keeps its last windows and recovers at the next refresh', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      let next: Effect.Effect<QuotaObservation, QuotaUnavailable> = Effect.succeed(observation('usage', 10));
      const held = yield* world(() => next);
      next = Effect.fail(new QuotaUnavailable({ reason: 'Sign in with the same CLI account' }));
      yield* held.quota.refresh(OPENAI_OAUTH_PROVIDER, account);
      expect(yield* rowOf(held)).toMatchObject({
        quota: { windows: [{ usedPercent: 10 }] },
        failure: { _tag: 'unavailable', reason: 'Sign in with the same CLI account' },
      });
      next = Effect.succeed(observation('usage', 25));
      yield* held.quota.refresh(OPENAI_OAUTH_PROVIDER, account);
      expect(yield* rowOf(held)).toMatchObject({ quota: { windows: [{ usedPercent: 25 }] }, failure: null });
      yield* held.close;
    }),
  );

  it.effect('an unsupported provider is read once at boot and never polled again', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      let calls = 0;
      const held = yield* world(() => {
        calls += 1;
        return Effect.fail(new QuotaUnsupported());
      });

      expect(calls).toBe(1);
      yield* held.quota.refresh(OPENAI_OAUTH_PROVIDER, account);
      expect(calls).toBe(1);
      expect((yield* rowOf(held))?.failure).toMatchObject({ _tag: 'unsupported' });

      yield* held.close;
    }),
  );

  it.effect('reply freshness and Retry-After gate usage reads by the test clock', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      const tokens = testTokens(join(mkdtempSync(join(tmpdir(), 'account-quota-skips-')), 'tokens.json'));
      yield* tokens.add(OPENAI_OAUTH_PROVIDER, openaiCredential('access'));
      const reads = yield* Queue.make<number>();
      let ordinal = 0;
      let next: Effect.Effect<QuotaObservation, QuotaRateLimited> = Effect.succeed(observation('usage', 10));
      const provider: AccountQuotaProvider = {
        id: OPENAI_OAUTH_PROVIDER,
        quota: {
          fromHeaders: () => null,
          read: () => Queue.offer(reads, ++ordinal).pipe(Effect.andThen(next)),
        },
      };
      const { quota } = yield* buildQuota(
        subscriptionAccounts(tokens),
        () => [provider],
        () => Effect.succeed({ account, revision: 0 }),
      );
      expect(yield* Queue.take(reads)).toBe(1);
      yield* bootSettled(quota);

      const subscriber = yield* Effect.forkChild(Stream.runDrain(quota.changes));
      yield* Effect.yieldNow;
      yield* TestClock.adjust('13 minutes');
      const replyAt = yield* Clock.currentTimeMillis;
      yield* quota.observe(
        OPENAI_OAUTH_PROVIDER,
        account,
        new QuotaObservation({
          observedAt: new Date(replyAt),
          source: 'reply',
          windows: [new QuotaWindow({ kind: 'session', usedPercent: 61 })],
        }),
      );
      yield* TestClock.adjust('2 minutes');
      yield* Effect.yieldNow;
      expect(Option.isNone(yield* Queue.poll(reads))).toBe(true);
      yield* Fiber.interrupt(subscriber);

      yield* TestClock.adjust('4 minutes');
      next = Effect.fail(new QuotaRateLimited({ retryAfterMs: 900_000 }));
      yield* quota.refresh(OPENAI_OAUTH_PROVIDER, account);
      expect(yield* Queue.take(reads)).toBe(2);
      const limited = (yield* quota.table())[0];
      expect(limited?.quota).toMatchObject({ source: 'reply', windows: [{ usedPercent: 61 }] });
      expect(limited?.failure).toMatchObject({ _tag: 'rate-limited', retryAfterMs: 900_000 });

      yield* quota.refresh(OPENAI_OAUTH_PROVIDER, account);
      expect(Option.isNone(yield* Queue.poll(reads))).toBe(true);
      yield* TestClock.adjust('899 seconds');
      yield* quota.refresh(OPENAI_OAUTH_PROVIDER, account);
      expect(Option.isNone(yield* Queue.poll(reads))).toBe(true);

      next = Effect.succeed(observation('usage', 22));
      yield* TestClock.adjust('1 second');
      yield* quota.refresh(OPENAI_OAUTH_PROVIDER, account);
      expect(yield* Queue.take(reads)).toBe(3);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect('an in-flight read is single and drops its result after re-signing the row', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      const tokens = testTokens(join(mkdtempSync(join(tmpdir(), 'account-quota-race-')), 'tokens.json'));
      yield* tokens.add(OPENAI_OAUTH_PROVIDER, {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        expiresAt: (yield* Clock.currentTimeMillis) + 3_600_000,
        accountId: account,
      });
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<QuotaObservation>();
      let calls = 0;
      let next: Effect.Effect<QuotaObservation> = Effect.succeed(observation('usage', 10));
      const provider: AccountQuotaProvider = {
        id: OPENAI_OAUTH_PROVIDER,
        quota: {
          fromHeaders: () => null,
          read: () =>
            Effect.suspend(() => {
              calls += 1;
              return next;
            }),
        },
      };
      const { quota } = yield* buildQuota(
        subscriptionAccounts(tokens),
        () => [provider],
        () => Effect.succeed({ account, revision: 0 }),
      );
      yield* bootSettled(quota);
      const before = (yield* quota.table())[0]?.quota;

      next = Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)));
      const reading = yield* Effect.forkChild(quota.refresh(OPENAI_OAUTH_PROVIDER, account));
      yield* Deferred.await(started);
      yield* quota.refresh(OPENAI_OAUTH_PROVIDER, account);
      expect(calls).toBe(2);

      yield* tokens.add(OPENAI_OAUTH_PROVIDER, {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAt: (yield* Clock.currentTimeMillis) + 3_600_000,
        accountId: account,
      });
      yield* quota.table();
      yield* Deferred.succeed(release, observation('usage', 99));
      yield* Fiber.join(reading);

      expect((yield* quota.table())[0]?.quota).toBe(before);
    }),
  );

  it.effect(
    'an unreadable row and the rows of an uninstalled provider stand in the table by their problem, and no quota is read for them',
    () =>
      Effect.gen(function* () {
        yield* clearReadings;
        const path = join(mkdtempSync(join(tmpdir(), 'account-quota-problems-')), 'tokens.json');
        const tokens = testTokens(path);
        yield* tokens.add(OPENAI_OAUTH_PROVIDER, openaiCredential('access'));
        const stored = yield* Effect.promise(() => Bun.file(path).json());
        stored.providers[OPENAI_OAUTH_PROVIDER].broken = {
          key: 'broken',
          label: 'Broken',
          origin: { kind: 'own' },
          addedAt: 1,
          credential: { accessToken: 7 },
        };
        stored.providers['gone-oauth'] = { only: { key: 'only', label: 'Gone', origin: { kind: 'own' }, addedAt: 1, credential: {} } };
        yield* Effect.promise(() => Bun.write(path, JSON.stringify(stored)));

        const read: string[] = [];
        const held = yield* boot(
          subscriptionAccounts(tokens),
          (_credentials, _owner, selected) => {
            read.push(selected ?? '');
            return Effect.succeed(observation('usage', 10));
          },
          undefined,
          tokens.heldProviders(),
        );
        yield* bootSettled(held.quota);
        const table = yield* held.quota.table();

        expect(table.map((row) => [row.provider, String(row.account), row.problem?.kind ?? null])).toEqual([
          [OPENAI_OAUTH_PROVIDER, String(account), null],
          [OPENAI_OAUTH_PROVIDER, 'broken', 'unreadable'],
          ['gone-oauth', 'only', 'not-installed'],
        ]);
        expect(read).toEqual([String(account)]);
        yield* held.close;
      }),
  );

  it.effect('a usage result landing in the same millisecond as a reply does not overwrite it', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      const tokens = testTokens(join(mkdtempSync(join(tmpdir(), 'account-quota-version-')), 'tokens.json'));
      yield* tokens.add(OPENAI_OAUTH_PROVIDER, openaiCredential('access'));
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<QuotaObservation>();
      let next: Effect.Effect<QuotaObservation> = Effect.succeed(observation('usage', 10));
      const provider: AccountQuotaProvider = {
        id: OPENAI_OAUTH_PROVIDER,
        quota: { fromHeaders: () => null, read: () => Effect.suspend(() => next) },
      };
      const { quota } = yield* buildQuota(
        subscriptionAccounts(tokens),
        () => [provider],
        () => Effect.succeed({ account, revision: 0 }),
      );
      yield* quota.changes.pipe(
        Stream.filter((table) => table.some((row) => row.quota !== null)),
        Stream.runHead,
      );

      next = Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)));
      const reading = yield* Effect.forkChild(quota.refresh(OPENAI_OAUTH_PROVIDER, account));
      yield* Deferred.await(started);
      yield* quota.observe(OPENAI_OAUTH_PROVIDER, account, observation('reply', 61));
      yield* Deferred.succeed(release, observation('usage', 12));
      yield* Fiber.join(reading);

      expect((yield* quota.table())[0]?.quota).toMatchObject({
        source: 'reply',
        windows: [{ usedPercent: 61 }],
      });
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect('a reply observed after its credential was removed reaches no published frame', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      const tokens = testTokens(join(mkdtempSync(join(tmpdir(), 'account-quota-removed-')), 'tokens.json'));
      yield* tokens.add(OPENAI_OAUTH_PROVIDER, openaiCredential('access'));
      const provider: AccountQuotaProvider = {
        id: OPENAI_OAUTH_PROVIDER,
        quota: { fromHeaders: () => null, read: () => Effect.succeed(observation('usage', 10)) },
      };
      const { quota, close } = yield* buildQuota(
        subscriptionAccounts(tokens),
        () => [provider],
        () => Effect.succeed({ account, revision: 0 }),
      );
      yield* quota.changes.pipe(
        Stream.filter((table) => table.some((row) => row.quota !== null)),
        Stream.runHead,
      );

      const seen: number[] = [];
      const watching = yield* Effect.forkChild(
        Stream.runForEach(quota.changes, (table) =>
          Effect.sync(() => {
            for (const row of table) seen.push(row.quota?.windows[0]?.usedPercent ?? -1);
          }),
        ),
      );

      yield* tokens.remove(OPENAI_OAUTH_PROVIDER, account);
      yield* quota.observe(OPENAI_OAUTH_PROVIDER, account, observation('reply', 61));

      expect(yield* quota.table()).toHaveLength(0);
      expect(seen).not.toContain(61);

      yield* Fiber.interrupt(watching);
      yield* close;
    }),
  );

  it.effect('two subscribers in one tick share one scheduler, which lives until the last one leaves', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      const tokens = testTokens(join(mkdtempSync(join(tmpdir(), 'account-quota-pair-')), 'tokens.json'));
      yield* tokens.add(OPENAI_OAUTH_PROVIDER, openaiCredential('access'));
      let ordinal = 0;
      const provider: AccountQuotaProvider = {
        id: OPENAI_OAUTH_PROVIDER,
        quota: {
          fromHeaders: () => null,
          read: () => Effect.sync(() => observation('usage', ++ordinal)),
        },
      };
      const { quota } = yield* buildQuota(
        subscriptionAccounts(tokens),
        () => [provider],
        () => Effect.succeed({ account, revision: 0 }),
      );
      const frames = yield* Queue.make<QuotaTable>();
      const firstReady = yield* Latch.make();
      const secondReady = yield* Latch.make();
      const applied = Effect.fnUntraced(function* (expected: number) {
        while (true) {
          const table = yield* Queue.take(frames);
          const used = table.find((row) => row.account === account)?.quota?.windows[0]?.usedPercent;
          if (used === expected) return;
        }
      });

      const first = yield* quota.changes.pipe(
        Stream.tap((frame) => Effect.andThen(firstReady.open, Queue.offer(frames, frame))),
        Stream.runDrain,
        Effect.forkChild,
      );
      const second = yield* quota.changes.pipe(
        Stream.tap(() => secondReady.open),
        Stream.runDrain,
        Effect.forkChild,
      );
      yield* firstReady.await;
      yield* secondReady.await;

      yield* applied(1);
      expect(ordinal).toBe(1);

      yield* TestClock.adjust('15 minutes');
      yield* applied(2);
      expect(ordinal).toBe(2);

      yield* Fiber.interrupt(second);
      yield* TestClock.adjust('15 minutes');
      yield* applied(3);
      expect(ordinal).toBe(3);

      yield* Fiber.interrupt(first);
      yield* TestClock.adjust('30 minutes');
      expect(ordinal).toBe(3);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect('a rate limit with no Retry-After is read again at the next trigger', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      let next: Effect.Effect<QuotaObservation, QuotaRateLimited> = Effect.succeed(observation('usage', 22));
      let calls = 0;
      const held = yield* world(() => {
        calls += 1;
        return next;
      });

      const before = yield* rowOf(held);
      expect(before?.quota).toMatchObject({ windows: [{ usedPercent: 22 }] });
      expect(before?.failedAt).toBeNull();

      next = Effect.fail(new QuotaRateLimited({}));
      yield* held.quota.refresh(OPENAI_OAUTH_PROVIDER, account);
      const limited = yield* rowOf(held);
      expect(limited?.failure).toMatchObject({ _tag: 'rate-limited' });
      expect(limited?.failure?._tag === 'rate-limited' && limited.failure.retryAfterMs).toBeUndefined();
      expect(limited?.failedAt).toBeNumber();
      expect(limited?.quota).toBe(before?.quota);

      const spent = calls;
      yield* held.quota.refresh(OPENAI_OAUTH_PROVIDER, account);
      expect(calls).toBe(spent + 1);

      yield* held.close;
    }),
  );

  it.effect('the last reading outlives a restart and a renewed token as last known, until the boot read replaces it', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      const { tokens } = yield* signedIn();
      const measured = yield* measuredBefore(tokens, 61);
      yield* tokens.add(OPENAI_OAUTH_PROVIDER, openaiCredential('renewed-access'));

      const answer = yield* Deferred.make<QuotaObservation>();
      const second = yield* boot(subscriptionAccounts(tokens), () => Deferred.await(answer));
      const kept = yield* rowOf(second);
      expect(kept).toMatchObject({ restored: true, failure: null, quota: { source: 'reply', windows: [{ usedPercent: 61 }] } });
      expect(kept?.quota?.observedAt.getTime()).toBe(measured?.observedAt.getTime());

      yield* Deferred.succeed(answer, observation('usage', 64));
      yield* second.quota.changes.pipe(
        Stream.filter((table) => table[0]?.restored === false),
        Stream.runHead,
      );
      expect(yield* rowOf(second)).toMatchObject({ restored: false, quota: { source: 'usage', windows: [{ usedPercent: 64 }] } });

      yield* second.close;
    }),
  );

  it.effect('a failed boot read keeps the kept figures and names the failure', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      const { tokens } = yield* signedIn();
      yield* measuredBefore(tokens, 61);

      const second = yield* boot(subscriptionAccounts(tokens), () => Effect.fail(new QuotaServerFailure({ status: 503 })));
      yield* second.quota.changes.pipe(
        Stream.filter((table) => table[0]?.failure != null),
        Stream.runHead,
      );
      expect(yield* rowOf(second)).toMatchObject({
        restored: true,
        quota: { windows: [{ usedPercent: 61 }] },
        failure: { _tag: 'server', status: 503 },
      });

      yield* second.close;
    }),
  );

  it.effect('a boot read that renews its own token replaces the kept reading', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      const tokens = testTokens(join(mkdtempSync(join(tmpdir(), 'account-quota-renew-')), 'tokens.json'), {
        refresh: {
          [OPENAI_OAUTH_PROVIDER]: (_refreshToken, existing) =>
            Effect.succeed({ ...existing, accessToken: 'renewed-access', expiresAt: Date.now() + 3_600_000 }),
        },
      });
      yield* tokens.add(OPENAI_OAUTH_PROVIDER, openaiCredential('access'));
      yield* measuredBefore(tokens, 61);
      yield* tokens.add(OPENAI_OAUTH_PROVIDER, { ...openaiCredential('expiring'), expiresAt: (yield* Clock.currentTimeMillis) + 1_000 });

      const renewing: Parameters<typeof accountQuotaLayer>[5] = (onAccess) =>
        makeOperatorCredentials({ tokens, defaultAccount: () => Effect.succeed({ account, revision: 0 }), onAccess });
      const second = yield* boot(
        subscriptionAccounts(tokens),
        (signed, ownerId, reading) =>
          Effect.promise(() => signed.accessToken(ownerId, OPENAI_OAUTH_PROVIDER, reading)).pipe(Effect.as(observation('usage', 64))),
        renewing,
      );
      yield* second.quota.changes.pipe(
        Stream.filter((table) => table[0]?.restored === false),
        Stream.runHead,
      );
      expect(yield* rowOf(second)).toMatchObject({ restored: false, quota: { source: 'usage', windows: [{ usedPercent: 64 }] } });

      yield* second.close;
    }),
  );

  it.effect('a removed account takes its reading with it, so signing it in again starts unmeasured', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      const { tokens } = yield* signedIn();
      const first = yield* boot(subscriptionAccounts(tokens), () => Effect.succeed(observation('usage', 37)));
      yield* bootSettled(first.quota);
      yield* tokens.remove(OPENAI_OAUTH_PROVIDER, account);
      expect(yield* first.quota.table()).toHaveLength(0);
      yield* first.close;

      yield* tokens.add(OPENAI_OAUTH_PROVIDER, openaiCredential('access'));
      const second = yield* boot(subscriptionAccounts(tokens), () => Effect.never);
      expect(yield* rowOf(second)).toMatchObject({ restored: false, quota: null });

      yield* second.close;
    }),
  );

  it.effect('an account removed while the server was down loses its reading at the next boot', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      const { tokens } = yield* signedIn();
      yield* measuredBefore(tokens, 61);
      yield* tokens.remove(OPENAI_OAUTH_PROVIDER, account);
      const second = yield* boot(subscriptionAccounts(tokens), () => Effect.never);
      expect(yield* second.quota.table()).toHaveLength(0);
      yield* second.close;

      yield* tokens.add(OPENAI_OAUTH_PROVIDER, openaiCredential('access'));
      const third = yield* boot(subscriptionAccounts(tokens), () => Effect.never);
      expect(yield* rowOf(third)).toMatchObject({ restored: false, quota: null });

      yield* third.close;
    }),
  );

  it.effect('an account signed in anew while the server was down does not inherit the reading its key held', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      const { tokens } = yield* signedIn();
      yield* measuredBefore(tokens, 61);
      const previous = yield* tokens.get(OPENAI_OAUTH_PROVIDER, account);
      if (previous === null) return yield* Effect.die('the signed-in account is missing');
      yield* tokens.remove(OPENAI_OAUTH_PROVIDER, account);
      yield* Clock.clockWith((clock) =>
        tokens.add(OPENAI_OAUTH_PROVIDER, openaiCredential('other-grant')).pipe(
          Effect.provideService(Clock.Clock, {
            currentTimeMillis: Effect.succeed(previous.addedAt + 1),
            currentTimeMillisUnsafe: () => previous.addedAt + 1,
            currentTimeNanos: Effect.succeed(BigInt(previous.addedAt + 1) * 1_000_000n),
            currentTimeNanosUnsafe: () => BigInt(previous.addedAt + 1) * 1_000_000n,
            monotonicTimeNanos: clock.monotonicTimeNanos,
            monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
            sleep: (duration) => clock.sleep(duration),
          }),
        ),
      );

      const second = yield* boot(subscriptionAccounts(tokens), () => Effect.never);
      expect(yield* rowOf(second)).toMatchObject({ restored: false, quota: null });

      yield* second.close;
    }),
  );

  it.effect('an account store unreadable at boot leaves the kept reading for when it answers', () =>
    Effect.gen(function* () {
      yield* clearReadings;
      const { tokens } = yield* signedIn();
      yield* measuredBefore(tokens, 61);

      const store = { readable: false };
      const accounts: AccountRows = {
        of: (provider) =>
          store.readable
            ? subscriptionAccounts(tokens).of(provider)
            : Effect.fail(new TokenStoreFailed({ kind: 'read', reason: 'unreadable' })),
      };
      const second = yield* boot(accounts, () => Effect.never);
      expect(yield* second.quota.table()).toHaveLength(0);

      store.readable = true;
      expect(yield* rowOf(second)).toMatchObject({ restored: true, quota: { windows: [{ usedPercent: 61 }] } });

      yield* second.close;
    }),
  );
});
