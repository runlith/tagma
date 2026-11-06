import { afterAll, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Layer, Schema, Stream } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { InvalidRequestReason, LLMError } from '@runlith/llm/schema/errors';
import type { WireProvider } from '@runlith/tagma/adapter/provider';
import { seededStoreLayer } from '../platform/store/open.js';
import { unitsLayer } from '../platform/store/units.js';
import { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { fixtureMigrations } from '../composition/testing/migrations.js';
import { ModelAccess } from './contract/service/access.js';
import { DefaultAccounts } from './contract/service/accounts.js';
import { CredentialFiles, ProviderCredentials, QuotaProviders } from './contract/service/credentials.js';
import { AccountCli } from './contract/service/cli.js';
import { BuiltinAdapters, ProviderRegistry, type AdapterSource } from './contract/service/registry.js';
import { providersLayer } from './layer.js';
import { sessionlessLayer } from './testing/holders.js';

const home = mkdtempSync(join(tmpdir(), 'provider-run-'));
const key = AccountKey.make('held-account');
const provider: WireProvider = {
  id: 'run-provider',
  label: 'Run provider',
  kind: 'wire',
  auth: 'oauth',
  models: { model: { label: 'Model', capabilities: ['text'], capacity: { context: 10_000 }, reasoning: [], defaultReasoning: null } },
  defaultTextModel: 'model',
  cacheLifetime: { promisedSeconds: null, prior: null },
  accounts: {
    credential: Schema.Struct({
      accessToken: Schema.String,
      refreshToken: Schema.NullOr(Schema.String),
      expiresAt: Schema.NullOr(Schema.Number),
    }),
    key: () => key,
    label: () => 'Held account',
    signIns: [{ kind: 'loopback', run: () => Effect.die('No sign-in runs in this fixture.') }],
  },
  profile: {
    output: { budget: 100, sent: false },
    options: () => undefined,
    model: ({ credentials, ownerId, account }) =>
      Effect.tryPromise({
        try: () => credentials.accessToken(ownerId, 'run-provider', account),
        catch: (cause) =>
          new LLMError({ module: 'Probe', method: 'credentials', reason: new InvalidRequestReason({ message: String(cause) }) }),
      }).pipe(
        Effect.flatMap((token) =>
          Effect.fail(new LLMError({ module: 'Probe', method: token, reason: new InvalidRequestReason({ message: 'Signed' }) })),
        ),
      ),
  },
  quota: { read: () => Effect.die('No quota is requested.'), fromHeaders: () => null },
};
let current = provider;
const sources: AdapterSource[] = [{ id: 'run-adapter', origin: 'builtin', version: null, load: async () => () => [current] }];
const providers = providersLayer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(BuiltinAdapters, { sources }),
      Layer.succeed(CredentialFiles, { tokensPath: join(home, 'tokens.json') }),
      Layer.succeed(QuotaProviders, { providers: [] }),
      sessionlessLayer,
      Layer.succeed(AccountCli, {
        installed: () => Effect.succeed({ _tag: 'Missing', reason: 'absent' } as const),
        changes: Stream.empty,
        run: () => Effect.die('unused'),
        login: () => Effect.die('unused'),
        ended: () => Effect.die('unused'),
        stop: () => Effect.die('unused'),
      }),
    ),
  ),
  Layer.provideMerge(unitsLayer(MachineUnits, MachineStore)),
  Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool)),
);
afterAll(() => rmSync(home, { recursive: true, force: true }));

layer(providers)('scoped credentials', (it) => {
  it.effect('an admitted subscription run keeps account declarations and reads live credentials after its adapter is removed', () =>
    Effect.gen(function* () {
      const registry = yield* ProviderRegistry;
      const credentials = yield* ProviderCredentials;
      const defaults = yield* DefaultAccounts;
      const access = yield* ModelAccess;
      yield* credentials.tokens.add(provider.id, { accessToken: 'first-token', refreshToken: null, expiresAt: null });
      yield* defaults.saveDefaultAccount(provider.id, key);
      registry.pinRun('held-run');
      const held = registry.forRun('held-run');
      current = {
        ...provider,
        accounts: {
          ...provider.accounts!,
          refresh: () => Effect.succeed({ accessToken: 'new-refresh', refreshToken: 'next-grant', expiresAt: null }),
        },
        profile: {
          ...provider.profile,
          model: () =>
            Effect.fail(
              new LLMError({ module: 'NewProfile', method: 'new-profile', reason: new InvalidRequestReason({ message: 'New profile' }) }),
            ),
        },
      };
      yield* registry.reload;
      yield* credentials.forCatalog(held).add(provider.id, { accessToken: 'expired', refreshToken: 'grant', expiresAt: 0 });
      const refreshed = yield* Effect.flip(
        access.request({ ownerId: 'owner', provider: provider.id, model: 'model', runId: 'held-run' }).text({ prompt: 'hello' }),
      );
      expect(refreshed).toMatchObject({ module: 'Probe', method: 'new-refresh' });
      sources.length = 0;
      yield* registry.reload;
      yield* credentials.forCatalog(held).add(provider.id, { accessToken: 'live-token', refreshToken: null, expiresAt: null });
      const selection = { ownerId: 'owner', provider: provider.id, model: 'model', runId: 'held-run' };
      for (const account of [undefined, key]) {
        const signed = yield* Effect.flip(access.request({ ...selection, account }).text({ prompt: 'hello' }));
        expect(signed).toMatchObject({ module: 'Probe', method: 'live-token' });
      }
      expect(yield* Effect.flip(defaults.defaultAccount(provider.id))).toMatchObject({ code: 'provider-not-installed' });
      expect((yield* Effect.flip(access.request({ ...selection, runId: undefined }).text({ prompt: 'hello' }))).reason._tag).toBe(
        'NotInstalled',
      );
    }),
  );
});
