import { afterAll, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { layer } from '@runlith/effect-test';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { makeFileTokenStore } from '@runlith/llm/oauth/FileTokenStore';
import type { SubscriptionAccounts } from '@runlith/llm/oauth/vendor';
import { vendorWire } from '@runlith/llm/oauth/vendorCall';
import { adapter } from '@runlith/adapter-openai-compatible/adapter';
import { Effect, Layer, Schema, Stream } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { unitsLayer } from '../../platform/store/units.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import type { DefaultAccounts } from '../contract/service/accounts.js';
import type { AccountQuota } from '../contract/service/quota.js';
import { consoleKeyFile } from '../credentials/consoleKeyFile.js';
import { makeConsoleKeyStore } from '../credentials/consoleKeys.js';
import { providerCatalogOf, staticRegistry } from '../testing/registry.js';
import { signIns } from './signIns.js';

const directory = await mkdtemp(join(tmpdir(), 'provider-sign-ins-'));
afterAll(() => rm(directory, { recursive: true, force: true }));

const accounts: SubscriptionAccounts = {
  credential: Schema.Struct({
    accessToken: Schema.String,
    refreshToken: Schema.NullOr(Schema.String),
    expiresAt: Schema.NullOr(Schema.Number),
  }),
  key: () => AccountKey.make('account'),
  label: () => 'Account',
  signIns: [
    {
      kind: 'paste',
      begin: () =>
        Effect.succeed({
          authorizeUrl: 'https://vendor.test/authorize',
          complete: (code) =>
            code === 'approved'
              ? Effect.succeed({ accessToken: 'paste-token', refreshToken: null, expiresAt: null })
              : Effect.fail({ message: 'invalid code' }),
        }),
    },
    { kind: 'key', store: (key) => Effect.succeed({ accessToken: key, refreshToken: null, expiresAt: null }) },
  ],
};

const defaults: DefaultAccounts['Service'] = {
  defaultAccount: () => Effect.succeed({ account: null, revision: 0 }),
  heldAccount: () => Effect.die('sign-ins hold no speech provider'),
  saveDefaultAccount: () => Effect.succeed({ account: null, revision: 0 }),
  settleDefaultAccount: () => Effect.succeed({ account: null, revision: 0 }),
  forgetAccount: () => Effect.die('this test removes no uninstalled account'),
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

const setup = Effect.fnUntraced(function* () {
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  const tokens = makeFileTokenStore({ path: join(directory, 'tokens.json'), schemes: () => accounts, wire: vendorWire });
  const base = adapter({
    product: { mcpServer: 'test', client: { name: 'test', version: '0' } },
    instances: [
      { id: 'fixture', values: { name: 'Fixture', baseUrl: 'http://localhost/v1', models: [{ id: 'm', context: 8 }] }, secrets: {} },
    ],
  })[0]!;
  if (base.kind !== 'wire') return yield* Effect.die('wire provider expected');
  const registry = staticRegistry(
    providerCatalogOf([
      { ...base, auth: 'oauth', accounts },
      { ...base, id: 'keyed' },
      {
        id: 'harness-keyed',
        label: 'Harness key',
        auth: 'api-key',
        kind: 'harness',
        accounts,
        models: base.models,
        cacheLifetime: base.cacheLifetime,
        defaultTextModel: base.defaultTextModel,
        environment: () => [],
      },
    ]),
  );
  const keys = makeConsoleKeyStore({ db: store.db, units, file: consoleKeyFile(directory) });
  return {
    tokens,
    keys,
    signing: yield* signIns(tokens, keys, defaults, quota, vendorWire, () => ['keyed'], registry, {
      refresh: () => Effect.void,
      serve: Effect.never,
    }),
  };
});

layer(
  unitsLayer(MachineUnits, MachineStore).pipe(
    Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool))),
  ),
)('sign-ins', (it) => {
  it.effect('a key method advertised by an API-key provider stores a usable console-key account through the same sign-in operations', () =>
    Effect.gen(function* () {
      const { keys, signing } = yield* setup();
      expect(yield* signing.begin('keyed', undefined, undefined, 'key')).toEqual({ flow: 'key' });
      const completed = yield* signing.complete('keyed', undefined, 'console-secret');
      if ('pending' in completed) return yield* Effect.die('key completion must finish');
      expect(yield* keys.key('keyed', completed.account)).toBe('console-secret');
      expect(completed).toMatchObject({ provider: 'keyed', expiresAt: null, origin: { kind: 'own' } });
      expect(yield* Effect.flip(signing.complete('keyed', undefined, 'console-secret'))).toMatchObject({ code: 'no-sign-in' });
    }),
  );

  it.effect('a key harness signs in and exposes its stored account through the common account flow', () =>
    Effect.gen(function* () {
      const { tokens, signing } = yield* setup();
      expect(yield* signing.begin('harness-keyed', undefined, undefined, 'key')).toEqual({ flow: 'key' });
      const signed = yield* signing.complete('harness-keyed', undefined, 'harness-secret');
      if ('pending' in signed) return yield* Effect.die('key completion must finish');
      expect((yield* tokens.get('harness-keyed', signed.account))?.credential.accessToken).toBe('harness-secret');
      expect((yield* signing.status())['harness-keyed']).toMatchObject([
        { account: signed.account, label: 'Account', origin: { kind: 'own' } },
      ]);
    }),
  );

  it.effect('paste authorization stores the returned account, refuses bad codes, and a consumed challenge cannot complete twice', () =>
    Effect.gen(function* () {
      const { tokens, signing } = yield* setup();
      expect(yield* signing.begin('fixture', undefined, undefined, 'paste')).toEqual({
        flow: 'paste',
        authorizeUrl: 'https://vendor.test/authorize',
      });
      expect(yield* Effect.flip(signing.complete('fixture', undefined, 'wrong'))).toMatchObject({ code: 'sign-in-failed' });
      expect(yield* tokens.accounts('fixture')).toEqual([]);
      expect(yield* signing.complete('fixture', undefined, 'approved')).toMatchObject({ account: 'account', provider: 'fixture' });
      expect(yield* tokens.getAccessToken('fixture', AccountKey.make('account'))).toBe('paste-token');
      expect(yield* Effect.flip(signing.complete('fixture', undefined, 'approved'))).toMatchObject({ code: 'no-sign-in' });
      expect(yield* Effect.flip(signing.begin('fixture', undefined, undefined, 'device'))).toMatchObject({ code: 'sign-in-failed' });
      yield* signing.begin('fixture', undefined, undefined, 'paste');
      yield* signing.begin('fixture', undefined, undefined, 'key');
      yield* signing.complete('fixture', undefined, 'replacement-key');
      expect(yield* tokens.getAccessToken('fixture', AccountKey.make('account'))).toBe('replacement-key');
    }),
  );
});
