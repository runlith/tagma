import { afterAll, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer, Schema, Stream } from 'effect';
import type { CliHarnessProvider } from '@runlith/tagma/adapter/provider';
import { ModelCatalogs, modelCatalogsLayer } from './catalogs.js';
import { registryLayer } from './registry.js';
import { AdapterSources, ProviderRegistry } from './contract/service/registry.js';
import { fixedSources } from './testing/registry.js';
import { CredentialFiles, ProviderCredentials } from './contract/service/credentials.js';
import { DefaultAccounts, ProviderAccounts } from './contract/service/accounts.js';
import { HarnessAccounts } from './contract/service/harness.js';
import { AccountCli } from './contract/service/cli.js';
import { AccountQuota } from './contract/service/quota.js';
import { makeHarnessDirectoryStore, HarnessDirectories } from './accounts/harnessRows.js';
import { DEFAULT_LOGIN, DefaultLogins, makeDefaultLoginBook } from './accounts/defaultLogins.js';
import { makeHarnessAccountBook } from './accounts/harnessAccounts.js';
import { harnessStored } from './accounts/harnessStored.js';
import { makeConnectedProviders } from './accounts/connected.js';
import { testCredentials, testTokens } from './testing/tokens.js';

const home = await mkdtemp(join(tmpdir(), 'passive-provider-cli-'));
afterAll(() => rm(home, { recursive: true, force: true }));

const Catalog = Schema.fromJsonString(
  Schema.Struct({
    models: Schema.Record(
      Schema.String,
      Schema.Struct({
        label: Schema.String,
        capacity: Schema.Struct({ context: Schema.Number }),
        capabilities: Schema.Array(Schema.Literal('text')),
        reasoning: Schema.Array(Schema.String),
        defaultReasoning: Schema.Null,
      }),
    ),
    defaultTextModel: Schema.String,
  }),
);

it.effect('passive catalog and account reads start no CLI until the provider is explicitly requested', () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const command = (action: string) => ({ program: 'fixture', args: [action] });
    const cli = AccountCli.of({
      installed: () => Effect.succeed({ _tag: 'Found' }),
      changes: Stream.empty,
      run: (input) =>
        Effect.sync(() => {
          const action = input.args[0]!;
          calls.push(action);
          return {
            stdout: JSON.stringify(
              action === 'status'
                ? { label: 'chosen@example.test' }
                : {
                    models: {
                      'upstream/model': {
                        label: 'Chosen model',
                        capacity: { context: 100000 },
                        capabilities: ['text'],
                        reasoning: [],
                        defaultReasoning: null,
                      },
                    },
                    defaultTextModel: 'upstream/model',
                  },
            ),
            stderr: '',
            code: 0,
          };
        }),
      login: () => Effect.die('the test requests an existing CLI login, not a new login terminal'),
      ended: () => Effect.never,
      stop: () => Effect.die('the passive catalog cancels no login terminal'),
    });
    const provider: CliHarnessProvider = {
      id: 'opencode',
      label: 'OpenCode',
      kind: 'harness',
      auth: 'cli',
      environment: () => [],
      models: {},
      defaultTextModel: '',
      dynamicCatalog: true,
      cacheLifetime: { promisedSeconds: null, prior: null },
      accounts: {
        directory: 'opencode',
        login: command('login'),
        status: command('status'),
        loggedIn: (output) =>
          Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ label: Schema.String })))(output.stdout).pipe(
            Effect.match({
              onSuccess: ({ label }) => ({ kind: 'signed-in' as const, label }),
              onFailure: (cause) => ({ kind: 'unreadable' as const, reason: cause.message }),
            }),
          ),
      },
      catalog: {
        read: () =>
          cli.run({ ...command('catalog'), entries: [], timeoutMs: 10000 }).pipe(
            Effect.flatMap((output) => Schema.decodeUnknownEffect(Catalog)(output.stdout)),
            Effect.mapError((cause) => ({ message: cause.message })),
          ),
      },
    };
    const tokensPath = join(home, 'tokens.json');
    const tokens = testTokens(tokensPath);
    const directories = makeHarnessDirectoryStore({ home, machine: 'fixture' });
    const defaults = DefaultAccounts.of({
      defaultAccount: () => Effect.succeed({ account: null, revision: 0 }),
      saveDefaultAccount: () => Effect.die('no default account edit'),
      settleDefaultAccount: () => Effect.die('no default settlement'),
      forgetAccount: () => Effect.die('no account removal'),
      adoptDefaultAccount: () => Effect.void,
      defaultAccountMoved: Stream.empty,
    });
    const common = Layer.mergeAll(
      Layer.succeed(
        AdapterSources,
        fixedSources([{ id: 'opencode', title: 'OpenCode', origin: 'builtin', version: null, load: async () => () => [provider] }]),
      ),
      Layer.succeed(CredentialFiles, { tokensPath }),
      Layer.succeed(DefaultAccounts, defaults),
      Layer.succeed(HarnessDirectories, directories),
      Layer.succeed(ProviderCredentials, testCredentials(tokens)),
    );
    const registry = Context.get(yield* Layer.build(registryLayer.pipe(Layer.provide(common))), ProviderRegistry);
    const logins = yield* Effect.provide(
      makeDefaultLoginBook,
      Context.make(HarnessDirectories, directories).pipe(Context.add(AccountCli, cli)),
    );
    const book = yield* makeHarnessAccountBook.pipe(
      Effect.provide(
        (yield* Layer.build(common)).pipe(
          Context.add(ProviderRegistry, registry),
          Context.add(AccountCli, cli),
          Context.add(DefaultLogins, logins),
          Context.add(
            AccountQuota,
            AccountQuota.of({
              table: () => Effect.die('no quota table read'),
              observe: () => Effect.void,
              merge: () => Effect.void,
              fail: () => Effect.void,
              refresh: () => Effect.void,
              changes: Stream.empty,
            }),
          ),
        ),
      ),
    );
    const rows = harnessStored({ of: () => Effect.succeed([]) }, directories, registry, logins, () => []);
    const accounts = ProviderAccounts.of({ ...rows, connected: yield* makeConnectedProviders({ rows, registry, directory: home }) });
    const catalogs = Context.get(
      yield* Layer.build(
        modelCatalogsLayer.pipe(
          Layer.provide(Layer.mergeAll(common, Layer.succeed(ProviderRegistry, registry), Layer.succeed(HarnessAccounts, book))),
        ),
      ),
      ModelCatalogs,
    );
    yield* catalogs.refresh();
    expect(calls).toEqual([]);
    expect((yield* accounts.connected).providers.size).toBe(0);
    expect(calls).toEqual([]);
    yield* directories.keep(provider.id, {
      key: DEFAULT_LOGIN,
      label: 'automatically discovered',
      directory: null,
      machine: 'fixture',
      addedAt: 1,
      signed: true,
      pending: false,
    });
    yield* catalogs.refresh();
    expect(yield* accounts.of(provider.id)).toEqual([]);
    expect(calls).toEqual([]);
    yield* catalogs.refresh(provider.id);
    expect(registry.current().models.defaultTextModelId(provider.id)).toBe('upstream/model');
    expect(registry.current().menu.options[0]?.label).toBe('Chosen model');
    expect((yield* accounts.of(provider.id))[0]?.label).toBe('chosen@example.test');
    expect(calls).toContain('catalog');
  }),
);
