import { afterAll, expect } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer, Schema, Stream } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import type { HarnessProvider, WireProvider } from '@runlith/tagma/adapter/provider';
import { makeFileTokenStore } from '@runlith/llm/oauth/FileTokenStore';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { vendorWire } from '@runlith/llm/oauth/vendorCall';
import { AccountCli } from '../contract/service/cli.js';
import { CredentialFiles, ProviderCredentials } from '../contract/service/credentials.js';
import { type AdapterSource, BuiltinAdapters, ProviderRegistry } from '../contract/service/registry.js';
import { DefaultAccounts } from '../contract/service/accounts.js';
import { AccountQuota } from '../contract/service/quota.js';
import { registryLayer } from '../registry.js';
import { makeBorrowingTokens } from '../credentials/borrowed.js';
import { HarnessDirectories, makeHarnessDirectoryStore } from './harnessRows.js';
import type { DirectoryAccount } from '../contract/wire/harnessAccounts.js';
import { makeHarnessAccountBook } from './harnessAccounts.js';
import { DefaultLogins, makeDefaultLoginBook } from './defaultLogins.js';
import { testCredentials } from '../testing/tokens.js';
import { harnessStored } from './harnessStored.js';
import { subscriptionAccounts } from './stored.js';
import { defaultAccountsLayer } from './defaults.js';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';

const home = await mkdtemp(join(tmpdir(), 'account-modes-'));
afterAll(() => rm(home, { recursive: true, force: true }));
const OWN = { accessToken: 'own-token', refreshToken: null, expiresAt: null };
const LENT = { ...OWN, accessToken: 'cli-token' };
const description = {
  models: {
    model: { label: 'Model', capacity: { context: 64000 }, capabilities: ['text'] as const, reasoning: [], defaultReasoning: null },
  },
  cacheLifetime: { promisedSeconds: null, prior: null },
  defaultTextModel: 'model',
};
const official: HarnessProvider = {
  ...description,
  id: 'official',
  label: 'Official',
  kind: 'harness',
  auth: 'cli',
  environment: () => [],
  accounts: {
    directory: 'official',
    login: { program: 'official', args: ['login'] },
    status: { program: 'official', args: ['status'] },
    loggedIn: () => Effect.succeed(null),
  },
  accountMode: { section: 'vendor', title: 'Vendor', default: 'cli', id: 'cli', label: 'Official', hint: 'Official account' },
};
const wire: WireProvider = {
  ...description,
  id: 'native',
  label: 'Native',
  kind: 'wire',
  auth: 'oauth',
  profile: { model: () => Effect.die('the mode test calls no model'), options: () => undefined, output: { budget: 100, sent: false } },
  quota: { read: () => Effect.die('the mode test reads no quota'), fromHeaders: () => null },
  accounts: {
    credential: Schema.Struct({
      accessToken: Schema.String,
      refreshToken: Schema.NullOr(Schema.String),
      expiresAt: Schema.NullOr(Schema.Number),
    }),
    key: () => AccountKey.make('same'),
    label: () => 'Own account',
    signIns: [{ kind: 'loopback', run: () => Effect.succeed(OWN) }],
  },
  borrows: { provider: official.id, read: () => Effect.succeed(LENT) },
  accountMode: { section: 'vendor', title: 'Vendor', default: 'cli', id: 'browser', label: 'Browser', hint: 'Own account' },
};
const cli = (installed: () => boolean): AccountCli['Service'] => ({
  installed: () => Effect.sync(() => (installed() ? ({ _tag: 'Found' } as const) : ({ _tag: 'Missing', reason: 'absent' } as const))),
  changes: Stream.empty,
  run: () => Effect.succeed({ stdout: '', stderr: '', code: 0 }),
  login: () => Effect.die('the mode test starts no terminal'),
  ended: () => Effect.never,
  stop: () => Effect.die('the mode test cancels no login terminal'),
});
const fixture: AdapterSource = { id: 'fixture', origin: 'builtin', version: null, load: async () => ({ adapter: () => [official, wire] }) };
const registry = (path: string, installed: () => boolean, sources: readonly AdapterSource[] = [fixture]) =>
  Effect.map(
    Layer.build(
      registryLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(BuiltinAdapters, { sources }),
            Layer.succeed(CredentialFiles, { tokensPath: join(path, 'tokens.json') }),
            Layer.succeed(AccountCli, cli(installed)),
          ),
        ),
      ),
    ),
    (context) => Context.get(context, ProviderRegistry),
  );
const ownStore = (path: string) =>
  makeFileTokenStore({ path: join(path, 'tokens.json'), schemes: (id) => (id === wire.id ? wire.accounts : undefined), wire: vendorWire });
const signed = (key: string): DirectoryAccount => ({
  key: AccountKey.make(key),
  label: 'CLI account',
  machine: 'machine',
  directory: `/fixture/${key}`,
  addedAt: 1,
  signed: true,
  pending: false,
});
const always = () => true;

it.effect('the selected mode controls credentials and defaults, preserves both grants, and restores the manual choice', () =>
  Effect.gen(function* () {
    const path = join(home, 'choices');
    const catalog = yield* registry(path, always);
    const directories = makeHarnessDirectoryStore({ home: path, machine: 'machine' });
    yield* directories.keep(official.id, signed('same'));
    yield* directories.keep(official.id, signed('cli-only'));
    const own = ownStore(path);
    yield* own.add(wire.id, OWN);
    const tokens = makeBorrowingTokens({ own, catalog: catalog.current, directories, cli: cli(always) });
    const stores = unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool))),
    );
    const defaultsContext = yield* Layer.build(
      defaultAccountsLayer(
        harnessStored(
          subscriptionAccounts(tokens),
          directories,
          catalog,
          makeDefaultLoginBook({ rows: directories, cli: cli(always) }),
          () => [],
        ),
        () => [],
        catalog,
      ).pipe(Layer.provide(stores)),
    );
    const defaults = Context.get(defaultsContext, DefaultAccounts);
    expect(catalog.current().sections[0]?.selected).toBe('cli');
    expect(yield* tokens.getAccessToken(wire.id, AccountKey.make('same'))).toBe('cli-token');
    expect(yield* Effect.flip(tokens.getAccessToken(wire.id, AccountKey.make('elsewhere')))).toMatchObject({
      kind: 'missing',
      reason: expect.stringContaining('Official'),
    });
    expect((yield* tokens.held(wire.id)).map((row) => row.origin.kind)).toEqual(['cli']);
    yield* defaults.saveDefaultAccount(wire.id, 'same');
    expect((yield* defaults.defaultAccount(official.id)).account).toBe(AccountKey.make('same'));
    yield* catalog.selectMode('vendor', 'browser');
    expect(catalog.current().served.providers.find((provider) => provider.id === official.id)?.selectable).toBe(true);
    expect(catalog.current().menu.registered(official.id)).toBe(true);
    expect(catalog.current().inMode(official.id)).toBe(false);
    expect(yield* tokens.getAccessToken(wire.id, AccountKey.make('same'))).toBe('own-token');
    expect(yield* Effect.flip(tokens.getAccessToken(wire.id, AccountKey.make('cli-only')))).toMatchObject({
      kind: 'missing',
      reason: expect.stringContaining('Browser'),
    });
    expect((yield* tokens.held(wire.id)).map((row) => row.origin.kind)).toEqual(['own']);
    yield* defaults.saveDefaultAccount(wire.id, null);
    yield* catalog.selectMode('vendor', 'cli');
    expect((yield* defaults.defaultAccount(wire.id)).account).toBe(AccountKey.make('same'));
    expect(yield* tokens.getAccessToken(wire.id, AccountKey.make('same'))).toBe('cli-token');
    yield* catalog.selectMode('vendor', 'browser');

    const restored = yield* registry(path, always);
    expect(restored.current().sections[0]?.selected).toBe('browser');
  }),
);

it.effect('an installation already holding its own accounts starts in its own sign-in mode though the CLI is installed', () =>
  Effect.gen(function* () {
    const path = join(home, 'own-first');
    const own = ownStore(path);
    yield* own.add(wire.id, OWN);
    const catalog = yield* registry(path, always);
    yield* catalog.bindSignIns(own.heldProviders());
    expect(catalog.current().sections[0]?.selected).toBe('browser');
    const reopened = yield* registry(path, always);
    expect(reopened.current().sections[0]?.selected).toBe('browser');
  }),
);

it.effect('a CLI installed after the first show clears its unavailability on the next read and can be selected', () =>
  Effect.gen(function* () {
    let installed = false;
    const catalog = yield* registry(join(home, 'no-cli'), () => installed);
    expect(catalog.current().sections[0]?.selected).toBe('browser');
    expect(catalog.current().selectable(official.id)).toBe(false);
    expect(yield* Effect.flip(catalog.selectMode('vendor', 'cli'))).toMatchObject({ code: 'mode-unavailable' });
    installed = true;
    const reread = yield* catalog.recheck;
    expect(reread.sections[0]?.options.find((option) => option.id === 'cli')?.unavailable).toBeNull();
    expect(reread.selectable(official.id)).toBe(true);
    expect((yield* catalog.selectMode('vendor', 'cli')).sections[0]?.selected).toBe('cli');
  }),
);

it.effect('a first show without the CLI keeps no choice, so the CLI mode is selected once its CLI is found', () =>
  Effect.gen(function* () {
    let installed = false;
    const catalog = yield* registry(join(home, 'forced'), () => installed);
    yield* catalog.bindSignIns(Effect.succeed([]));
    expect((yield* catalog.recheck).sections[0]?.selected).toBe('browser');
    installed = true;
    expect((yield* catalog.recheck).sections[0]?.selected).toBe('cli');
  }),
);

it.effect('a sign-in made while the CLI was missing is kept as the choice once the CLI is found', () =>
  Effect.gen(function* () {
    let installed = false;
    const catalog = yield* registry(join(home, 'signed-without-cli'), () => installed);
    yield* catalog.bindSignIns(Effect.succeed([wire.id]));
    expect((yield* catalog.recheck).sections[0]?.selected).toBe('browser');
    installed = true;
    expect((yield* catalog.recheck).sections[0]?.selected).toBe('browser');
  }),
);

it.effect('an unreadable mode choice leaves the default mode standing, names the failure and refuses a selection', () =>
  Effect.gen(function* () {
    const path = join(home, 'corrupt');
    yield* Effect.promise(() => mkdir(path, { recursive: true }));
    yield* Effect.promise(() => writeFile(join(path, 'account-modes.json'), '{ not json'));
    const catalog = yield* registry(path, always);
    expect(catalog.current().sections[0]).toMatchObject({ selected: 'cli', failure: expect.any(String) });
    expect(yield* Effect.flip(catalog.selectMode('vendor', 'browser'))).toMatchObject({ _tag: 'CredentialFileInvalid' });
    expect(yield* Effect.promise(() => readFile(join(path, 'account-modes.json'), 'utf8'))).toBe('{ not json');
  }),
);

it.effect('an adapter whose account mode collides with a declared section fails alone and leaves the section whole', () =>
  Effect.gen(function* () {
    const rival: HarnessProvider = { ...official, id: 'rival', label: 'Rival' };
    const catalog = (yield* registry(join(home, 'collision'), always, [
      fixture,
      { id: 'rival', origin: 'machine', version: '1', load: async () => ({ adapter: () => [rival] }) },
    ])).current();
    expect(catalog.adapters.find((adapter) => adapter.id === 'rival')).toMatchObject({ state: 'failed' });
    expect(catalog.sections[0]?.options.map((option) => option.provider)).toEqual([official.id, wire.id]);
  }),
);

it.effect('a harness thread launches on its directory account whatever mode is selected, and refuses typed without one', () =>
  Effect.gen(function* () {
    const path = join(home, 'launch');
    const catalog = yield* registry(path, always);
    yield* catalog.selectMode('vendor', 'browser');
    const rows = makeHarnessDirectoryStore({ home: path, machine: 'machine' });
    const defaults: DefaultAccounts['Service'] = {
      defaultAccount: () => Effect.succeed({ account: null, revision: 0 }),
      saveDefaultAccount: () => Effect.die('the launch test saves no default'),
      settleDefaultAccount: () => Effect.die('the launch test settles no default'),
      forgetAccount: () => Effect.die('the launch test forgets no account'),
      adoptDefaultAccount: () => Effect.void,
      defaultAccountMoved: Stream.empty,
    };
    const quota: AccountQuota['Service'] = {
      table: () => Effect.succeed([]),
      observe: () => Effect.void,
      merge: () => Effect.void,
      fail: () => Effect.void,
      refresh: () => Effect.void,
      changes: Stream.empty,
    };
    const book = yield* makeHarnessAccountBook.pipe(
      Effect.provide(
        Context.make(HarnessDirectories, rows).pipe(
          Context.add(
            ProviderCredentials,
            testCredentials(makeFileTokenStore({ path: join(path, 'keys.json'), schemes: () => undefined, wire: vendorWire })),
          ),
          Context.add(ProviderRegistry, catalog),
          Context.add(DefaultAccounts, defaults),
          Context.add(AccountCli, cli(always)),
          Context.add(DefaultLogins, makeDefaultLoginBook({ rows, cli: cli(always) })),
          Context.add(AccountQuota, quota),
        ),
      ),
    );
    expect(yield* Effect.flip(book.launch(official.id))).toMatchObject({ code: 'account-required' });
    yield* rows.keep(official.id, signed('kept'));
    expect(yield* book.launch(official.id)).toMatchObject({ account: 'kept', directory: '/fixture/kept' });
  }),
);
