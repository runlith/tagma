import { afterAll, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { mkdtemp, rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Clock, Context, Deferred, Effect, Fiber, Layer, Schema, Stream } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { TestClock } from 'effect/testing';
import { AccountKey } from '@runlith/llm/models/authStatus';
import type { StoredCredential } from '@runlith/llm/oauth/credential';
import { subscriptionFact, subscriptionToken } from '@runlith/llm/profiles/credential';
import { QuotaDoor, quotaGet } from '@runlith/llm/profiles/quotaRead';
import { InvalidRequestReason, LLMError } from '@runlith/llm/schema/errors';
import { QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import { answering } from '@runlith/llm/route/transport/answering';
import type { HarnessProvider, Provider, WireProvider } from '@runlith/tagma/adapter/provider';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { unitsLayer } from '../../platform/store/units.js';
import { makeHarnessDirectoryStore } from '../accounts/harnessRows.js';
import { ModelAccess } from '../contract/service/access.js';
import { DefaultAccounts, ProviderAccounts } from '../contract/service/accounts.js';
import { AccountCli } from '../contract/service/cli.js';
import { CredentialFiles } from '../contract/service/credentials.js';
import { HarnessAccounts } from '../contract/service/harness.js';
import { AccountQuota } from '../contract/service/quota.js';
import { BuiltinAdapters } from '../contract/service/registry.js';
import { providersLayer } from '../layer.js';
import { sessionlessLayer } from '../testing/holders.js';

const home = await mkdtemp(join(tmpdir(), 'borrowed-quota-'));
afterAll(() => rm(home, { recursive: true, force: true }));
const account = AccountKey.make('default');
const ids = ['claude-fixture', 'codex-fixture'];
const held = new Map<string, StoredCredential>();
const models = {
  model: { label: 'Model', capabilities: ['text'] as const, capacity: { context: 10_000 }, reasoning: [], defaultReasoning: null },
};

const providers: Provider[] = ids.flatMap((id): Provider[] => {
  const wire: WireProvider = {
    id,
    label: id,
    kind: 'wire',
    auth: 'oauth',
    models,
    defaultTextModel: 'model',
    cacheLifetime: { promisedSeconds: null, prior: null },
    accounts: {
      credential: Schema.Struct({
        accessToken: Schema.String,
        refreshToken: Schema.NullOr(Schema.String),
        expiresAt: Schema.NullOr(Schema.Number),
      }),
      key: () => account,
      label: () => 'Fixture',
      signIns: [{ kind: 'loopback', run: () => Effect.die('No sign-in runs in this fixture') }],
    },
    borrows: { provider: `${id}-cli`, read: () => Effect.succeed(held.get(id)!), renewOnReject: true },
    profile: {
      output: { budget: 100, sent: false },
      options: () => undefined,
      model: ({ credentials, ownerId, account }) =>
        subscriptionFact('fixture token', () => credentials.accessToken(ownerId, id, account)).pipe(
          Effect.flatMap((token) =>
            Effect.fail(new LLMError({ module: 'Probe', method: token, reason: new InvalidRequestReason({ message: 'Signed' }) })),
          ),
        ),
    },
    quota: {
      fromHeaders: () => null,
      read: (credentials, ownerId, account) =>
        quotaGet({ url: `https://fixture.invalid/${id}`, auth: subscriptionToken(credentials, ownerId, id, account).bearer() }).pipe(
          Effect.map(
            (reply) =>
              new QuotaObservation({
                observedAt: reply.observedAt,
                source: 'usage',
                windows: [new QuotaWindow({ kind: 'session', usedPercent: 25 })],
              }),
          ),
        ),
    },
  };
  const harness: HarnessProvider = {
    id: `${id}-cli`,
    label: 'Fixture CLI',
    kind: 'harness',
    auth: 'cli',
    models,
    defaultTextModel: 'model',
    cacheLifetime: wire.cacheLifetime,
    accounts: {
      directory: id,
      login: { program: 'fixture-cli', args: ['login', id] },
      status: { program: 'fixture-cli', args: ['status', id] },
      renew: { program: 'fixture-cli', args: ['renew', id] },
      loggedIn: () => Effect.succeed({ kind: 'signed-in' as const, label: 'Fixture' }),
    },
    environment: () => [],
  };
  return [wire, harness];
});

const cli: AccountCli['Service'] = {
  installed: () => Effect.succeed({ _tag: 'Found' } as const),
  changes: Stream.empty,
  run: (command) =>
    Effect.sync(() => {
      const [act, id] = command.args;
      if (act === 'renew') held.set(id!, { accessToken: 'renewed', refreshToken: null, expiresAt: Date.now() + 3_600_000 });
      else if (act !== 'status') throw new Error(`Unexpected fixture CLI act: ${act}`);
      return { stdout: '', stderr: '', code: 0 };
    }),
  login: () => Effect.die('No login process runs in this fixture'),
  ended: () => Effect.die('No login process runs in this fixture'),
  stop: () => Effect.die('No login process stops in this fixture'),
};

const layer = providersLayer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(BuiltinAdapters, {
        sources: [{ id: 'fixture', origin: 'builtin', version: null, load: async () => ({ adapter: () => providers }) }],
      }),
      Layer.succeed(CredentialFiles, { tokensPath: join(home, 'tokens.json') }),
      Layer.succeed(AccountCli, cli),
      sessionlessLayer,
    ),
  ),
  Layer.provideMerge(unitsLayer(MachineUnits, MachineStore)),
  Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool)),
);

it.effect('an addressed native model discovers its existing CLI login without a preliminary catalog, launch or sign-in', () =>
  Effect.gen(function* () {
    const directories = makeHarnessDirectoryStore({ home, machine: hostname() });
    for (const id of ids) {
      held.set(id, { accessToken: 'expired', refreshToken: null, expiresAt: 0 });
      yield* directories.keep(`${id}-cli`, {
        key: account,
        label: 'Old discovered login',
        machine: directories.machine,
        directory: null,
        addedAt: 1,
        signed: true,
        pending: false,
      });
    }
    const context = yield* Layer.build(layer);
    const accounts = Context.get(context, ProviderAccounts);
    const access = Context.get(context, ModelAccess);
    expect(yield* accounts.of(`${ids[0]}-cli`)).toEqual([]);
    expect(yield* accounts.of(`${ids[1]}-cli`)).toEqual([]);
    for (const [at, id] of ids.entries()) {
      const signed = yield* Effect.flip(
        access
          .request({ ownerId: 'owner', provider: id, model: 'model', account: at === 0 ? account : undefined })
          .text({ prompt: 'Hello' }),
      );
      expect(signed).toMatchObject({ module: 'Probe', method: 'renewed' });
      expect((yield* accounts.of(`${id}-cli`)).map((row) => row.key)).toEqual([account]);
    }
  }).pipe(
    Effect.provideService(
      QuotaDoor,
      answering(() => new Response('{}', { headers: { 'content-type': 'application/json' } })),
    ),
  ),
);

it.effect('borrowed quota boot, polling and manual reads stay stale without renewal; only a model request renews', () =>
  Effect.gen(function* () {
    const directories = makeHarnessDirectoryStore({ home, machine: hostname() });
    for (const id of ids) {
      held.set(id, { accessToken: 'expired', refreshToken: null, expiresAt: 0 });
      yield* directories.keep(`${id}-cli`, {
        key: account,
        label: 'Fixture',
        machine: directories.machine,
        directory: null,
        requested: true,
        addedAt: 1,
        signed: true,
        pending: false,
      });
    }
    yield* Effect.gen(function* () {
      const context = yield* Layer.build(layer);
      const quota = Context.get(context, AccountQuota);
      const defaults = Context.get(context, DefaultAccounts);
      const accounts = Context.get(context, ProviderAccounts);
      const harness = Context.get(context, HarnessAccounts);
      const access = Context.get(context, ModelAccess);
      const stale = (table: readonly { provider: string; failure: { _tag: string } | null }[]) =>
        ids.every((id) => table.some((row) => row.provider === id && row.failure?._tag === 'stale-token'));
      yield* quota.changes.pipe(Stream.filter(stale), Stream.take(1), Stream.runDrain);
      expect(ids.map((id) => held.get(id)?.accessToken)).toEqual(['expired', 'expired']);
      yield* quota.refresh();
      expect(stale(yield* quota.table())).toBe(true);
      for (const id of ids) {
        yield* accounts.of(id);
        yield* defaults.defaultAccount(id);
        yield* harness.launch(`${id}-cli`);
        yield* harness.status(`${id}-cli`);
        yield* directories.change(`${id}-cli`, account, (row) => ({ ...row, pending: true }));
        yield* harness.complete(`${id}-cli`, account);
      }
      expect(ids.map((id) => held.get(id)?.accessToken)).toEqual(['expired', 'expired']);
      const before = yield* Clock.currentTimeMillis;
      const watching = yield* Deferred.make<void>();
      const polling = yield* Effect.forkChild(
        quota.changes.pipe(
          Stream.tap(() => Deferred.succeed(watching, undefined)),
          Stream.filter(
            (table) =>
              stale(table) && ids.every((id) => table.some((row) => row.provider === id && (row.failedAt ?? 0) >= before + 900_000)),
          ),
          Stream.take(1),
          Stream.runDrain,
        ),
      );
      yield* Deferred.await(watching);
      yield* TestClock.adjust('15 minutes');
      yield* Fiber.join(polling);
      expect(ids.map((id) => held.get(id)?.accessToken)).toEqual(['expired', 'expired']);
      for (const id of ids) {
        const signed = yield* Effect.flip(
          access.request({ ownerId: 'owner', provider: id, model: 'model', account }).text({ prompt: 'Hello' }),
        );
        expect(signed).toMatchObject({ module: 'Probe', method: 'renewed' });
      }
      yield* quota.refresh();
      const table = yield* quota.table();
      expect(ids.map((id) => table.find((row) => row.provider === id)?.failure)).toEqual([null, null]);
      expect(ids.map((id) => table.find((row) => row.provider === id)?.quota?.windows[0]?.usedPercent)).toEqual([25, 25]);
    }).pipe(
      Effect.provideService(
        QuotaDoor,
        answering(() => new Response('{}', { headers: { 'content-type': 'application/json' } })),
      ),
    );
  }),
);
