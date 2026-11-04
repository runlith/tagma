import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { OPENAI_OAUTH_PROVIDER } from '@runlith/adapter-openai/models/openai';
import { QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import { join } from 'node:path';
import { hostname } from 'node:os';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Context, Effect, FileSystem } from 'effect';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { writes } from '../../../platform/contract/service/writes.js';
import { OPERATOR_PRINCIPAL } from '../../../platform/contract/wire/actor.js';
import { defaultAccount } from '../../../providers/store/tables.js';
import { makeHarnessDirectoryStore } from '../../../providers/accounts/harnessRows.js';
import type { AccountQuotaProvider } from '../../../providers/quota/ledger.js';
import { doorFixture, DoorFixture } from '../doorFixture.js';
import { keepAccountDefaults } from '../claudeLogin.js';

const seedOrphan = Effect.fnUntraced(function* (world: DoorFixture['Service'], provider: string, keys: readonly string[]) {
  const files = yield* FileSystem.FileSystem;
  const path = join(world.root, 'home', 'tokens.json');
  const previous = (yield* files.exists(path)) ? yield* files.readFileString(path) : null;
  yield* keepAccountDefaults(world, provider);
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      for (const row of yield* world.runtime.tokens.held(provider))
        if (keys.includes(row.key)) yield* world.runtime.signIns.remove(provider, row.key);
      if (previous === null) yield* files.remove(path, { force: true });
      else yield* files.writeFileString(path, previous);
    }).pipe(Effect.orDie),
  );
  yield* files.writeFileString(
    path,
    JSON.stringify({
      providers: {
        [provider]: Object.fromEntries(keys.map((key) => [key, { key, label: key, addedAt: 0, credential: { opaque: key } }])),
      },
    }),
  );
  const { db } = Context.get(world.runtime.graph, MachineStore);
  const units = Context.get(world.runtime.graph, MachineUnits);
  yield* units.write(writes('test.seedDefault', [defaultAccount]), (unit) =>
    unit.run(db.insert(defaultAccount).values({ principalId: OPERATOR_PRINCIPAL, provider, account: keys[0]!, revision: 1 })),
  );
}, Effect.provide(BunFileSystem.layer));

const provider: AccountQuotaProvider = {
  id: OPENAI_OAUTH_PROVIDER,
  quota: {
    fromHeaders: () => null,
    read: () =>
      Effect.map(
        Clock.currentTimeMillis,
        (now) =>
          new QuotaObservation({
            observedAt: new Date(now),
            source: 'usage',
            windows: [new QuotaWindow({ kind: 'session', usedPercent: 22 })],
          }),
      ),
  },
};

layer(doorFixture({ quotaProviders: [provider] }), { excludeTestServices: true })('accounts door', (it) => {
  it.effect('the accounts door answers the current quota table', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const account = AccountKey.make('door-account');
      const now = yield* Clock.currentTimeMillis;
      yield* keepAccountDefaults(world, OPENAI_OAUTH_PROVIDER);
      yield* Effect.acquireRelease(
        world.runtime.tokens.add(OPENAI_OAUTH_PROVIDER, {
          accessToken: 'access',
          refreshToken: 'refresh',
          expiresAt: now + 3_600_000,
          accountId: account,
        }),
        (key) => world.runtime.signIns.remove(OPENAI_OAUTH_PROVIDER, key).pipe(Effect.orDie),
      );
      yield* world.runtime.accountQuota.table();
      yield* world.runtime.accountQuota.observe(
        OPENAI_OAUTH_PROVIDER,
        account,
        new QuotaObservation({
          observedAt: new Date(now - 301_000),
          source: 'reply',
          windows: [new QuotaWindow({ kind: 'session', usedPercent: 61 })],
        }),
      );

      const ownAccounts = (body: unknown) =>
        (body as { accounts: { provider: string }[] }).accounts.filter((row) => row.provider === OPENAI_OAUTH_PROVIDER);
      const response = yield* world.op('list_accounts', {});
      expect(response.status).toBe(200);
      expect(ownAccounts(response.body)).toEqual([
        expect.objectContaining({
          provider: OPENAI_OAUTH_PROVIDER,
          account,
          quota: expect.objectContaining({ source: 'reply', windows: [{ kind: 'session', usedPercent: 61 }] }),
        }),
      ]);

      const refreshed = yield* world.op('refresh_accounts', { provider: OPENAI_OAUTH_PROVIDER, account });
      expect(refreshed.status).toBe(200);
      expect(ownAccounts(refreshed.body)).toEqual([
        expect.objectContaining({
          provider: OPENAI_OAUTH_PROVIDER,
          account,
          quota: expect.objectContaining({ source: 'usage', windows: [{ kind: 'session', usedPercent: 22 }] }),
        }),
      ]);

      const selected = yield* world.op('set_default_account', { provider: OPENAI_OAUTH_PROVIDER, account });
      expect(selected.status).toBe(200);
      expect(ownAccounts(selected.body)).toEqual([expect.objectContaining({ provider: OPENAI_OAUTH_PROVIDER, account, default: true })]);
    }),
  );

  it.effect('removing uninstalled accounts preserves another default and clears the removed default and credential', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const provider = 'removed-adapter';
      yield* seedOrphan(world, provider, ['primary', 'secondary']);
      const listed = yield* world.op('list_accounts', {});
      expect(listed.body).toMatchObject({
        accounts: expect.arrayContaining([
          expect.objectContaining({ provider, account: 'primary', problem: { kind: 'not-installed' } }),
          expect.objectContaining({ provider, account: 'secondary', problem: { kind: 'not-installed' } }),
        ]),
      });

      const secondary = yield* world.op('remove_account', { provider, account: 'secondary' });
      expect(secondary.status).toBe(200);
      expect(secondary.body).toMatchObject({ removed: { removed: 'secondary', default: 'primary' } });
      expect((yield* world.runtime.tokens.held(provider)).map((row) => row.key)).toEqual([AccountKey.make('primary')]);

      const primary = yield* world.op('remove_account', { provider, account: 'primary' });
      expect(primary.status).toBe(200);
      expect(primary.body).toMatchObject({ removed: { removed: 'primary', default: null } });
      expect(yield* world.runtime.tokens.held(provider)).toEqual([]);
      const { db } = Context.get(world.runtime.graph, MachineStore);
      const units = Context.get(world.runtime.graph, MachineUnits);
      const standing = yield* units.read((unit) => unit.run(db.select().from(defaultAccount).all()));
      expect(standing.find((row) => row.provider === provider)).toMatchObject({ account: null, revision: 2 });
      const remaining = (yield* world.op('list_accounts', {})).body as { accounts: { provider: string }[] };
      expect(remaining.accounts.filter((account) => account.provider === provider)).toEqual([]);
    }),
  );

  it.effect('directory accounts of an uninstalled harness remain removable without deleting their CLI directory', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const provider = 'removed-harness';
      const account = AccountKey.make('cli-primary');
      const directory = yield* world.directory('saved-cli');
      const rows = makeHarnessDirectoryStore({ home: join(world.root, 'home'), machine: hostname() });
      yield* keepAccountDefaults(world, provider);
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          if ((yield* rows.of(provider)).some((row) => row.key === account)) yield* world.runtime.signIns.remove(provider, account);
        }).pipe(Effect.orDie),
      );
      yield* rows.keep(provider, {
        key: account,
        label: 'CLI account',
        machine: hostname(),
        directory,
        addedAt: 0,
        signed: true,
        pending: false,
      });
      const { db } = Context.get(world.runtime.graph, MachineStore);
      const units = Context.get(world.runtime.graph, MachineUnits);
      yield* units.write(writes('test.seedCliDefault', [defaultAccount]), (unit) =>
        unit.run(db.insert(defaultAccount).values({ principalId: OPERATOR_PRINCIPAL, provider, account, revision: 1 })),
      );

      expect((yield* world.op('list_accounts', {})).body).toMatchObject({
        accounts: expect.arrayContaining([
          expect.objectContaining({
            provider,
            account,
            origin: expect.objectContaining({ kind: 'cli', place: directory, made: false }),
            problem: { kind: 'not-installed' },
          }),
        ]),
      });
      const removed = yield* world.op('remove_account', { provider, account });
      expect(removed.status).toBe(200);
      expect(removed.body).toMatchObject({ removed: { removed: account, default: null } });
      expect(yield* rows.of(provider)).toEqual([]);
      expect(yield* files.exists(directory)).toBe(true);
      const standing = yield* units.read((unit) => unit.run(db.select().from(defaultAccount).all()));
      expect(standing.find((row) => row.provider === provider)).toMatchObject({ account: null, revision: 2 });
      const remaining = (yield* world.op('list_accounts', {})).body as { accounts: { provider: string }[] };
      expect(remaining.accounts.filter((account) => account.provider === provider)).toEqual([]);
    }).pipe(Effect.provide(BunFileSystem.layer)),
  );

  it.effect('a directory Tagma made for a sign-in reads as made, a stored one from before the mark included', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const provider = 'made-harness';
      const home = join(world.root, 'home');
      const rows = makeHarnessDirectoryStore({ home, machine: hostname() });
      const made = AccountKey.make('7c1e0a52-made');
      const given = AccountKey.make('given');
      const givenDirectory = yield* world.directory('given-cli');
      yield* Effect.addFinalizer(() => Effect.all([rows.remove(provider, made), rows.remove(provider, given)]).pipe(Effect.orDie));
      const row = { label: 'CLI account', machine: hostname(), addedAt: 0, signed: true, pending: false };
      yield* rows.keep(provider, { ...row, key: made, directory: join(home, 'claude', made) });
      yield* rows.keep(provider, { ...row, key: given, directory: givenDirectory });

      const listed = (yield* world.op('list_accounts', {})).body as { accounts: { provider: string; account: string; origin: unknown }[] };
      expect(listed.accounts.filter((one) => one.provider === provider).map(({ account, origin }) => ({ account, origin }))).toEqual(
        expect.arrayContaining([
          { account: made, origin: expect.objectContaining({ kind: 'cli', place: join(home, 'claude', made), made: true }) },
          { account: given, origin: expect.objectContaining({ kind: 'cli', place: givenDirectory, made: false }) },
        ]),
      );
    }),
  );

  it.effect('an uninstalled provider default can be cleared through the door but cannot be assigned', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const provider = 'cleared-adapter';
      yield* seedOrphan(world, provider, ['primary']);
      const assigned = yield* world.op('set_default_account', { provider, account: 'primary' });
      expect(assigned.status).not.toBe(200);
      expect(assigned.body).toMatchObject({ code: 'provider-not-installed' });
      const cleared = yield* world.op('set_default_account', { provider, account: null, revision: 1 });
      expect(cleared.status).toBe(200);
      expect(cleared.body).toMatchObject({ account: null, revision: 2 });
      const stale = yield* world.op('set_default_account', { provider, account: null, revision: 1 });
      expect(stale.body).toMatchObject({ code: 'stale-revision' });
      expect((yield* world.runtime.tokens.held(provider)).map((row) => row.key)).toEqual([AccountKey.make('primary')]);
    }),
  );
});
