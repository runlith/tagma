import { afterAll, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { Context, Data, Effect, Layer, Queue, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import type { HarnessAccountAddress, Provider } from '@runlith/tagma/adapter/provider';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { makeFileTokenStore } from '@runlith/llm/oauth/FileTokenStore';
import { vendorWire } from '@runlith/llm/oauth/vendorCall';
import { ModelCatalogs, modelCatalogsLayer } from './catalogs.js';
import { registryLayer } from './registry.js';
import { BuiltinAdapters, ProviderRegistry } from './contract/service/registry.js';
import { CredentialFiles, ProviderCredentials } from './contract/service/credentials.js';
import { DefaultAccounts } from './contract/service/accounts.js';
import { HarnessAccounts } from './contract/service/harness.js';
import { HarnessDirectories, makeHarnessDirectoryStore } from './accounts/harnessRows.js';

const home = await mkdtemp(join(tmpdir(), 'provider-catalogs-'));
afterAll(() => rm(home, { recursive: true, force: true }));
class Offline extends Data.TaggedError('Offline')<{ readonly message: string }> {}

it.effect('a discovered model catalog survives a new registry and a failed refresh, and is read again when the server starts', () =>
  Effect.gen(function* () {
    let offline = false;
    let label = 'Discovered';
    let directory: string | null = null;
    const moves = yield* Queue.unbounded<string>();
    const signed = yield* Queue.unbounded<string>();
    const provider: Provider = {
      id: 'dynamic',
      label: 'Dynamic',
      auth: 'cli',
      kind: 'harness',
      environment: () => [],
      dynamicCatalog: true,
      models: {},
      defaultTextModel: '',
      cacheLifetime: { promisedSeconds: null, prior: null },
      catalog: {
        read: (address: HarnessAccountAddress) => {
          if (
            address.directory !== directory ||
            address.entries[0]?._tag !== 'Set' ||
            address.entries[0]?.value !== (directory ?? 'default')
          )
            return Effect.fail(new Offline({ message: 'wrong account address' }));
          return offline
            ? Effect.fail(new Offline({ message: 'offline' }))
            : Effect.succeed({
                models: {
                  discovered: { label, capacity: { context: 200_000 }, capabilities: ['text'], reasoning: [], defaultReasoning: null },
                },
                defaultTextModel: 'discovered',
                warnings: ['A second model has unknown capacity'],
              });
        },
      },
    };
    const tokensPath = join(home, 'tokens.json');
    const tokens = makeFileTokenStore({ path: tokensPath, schemes: () => undefined, wire: vendorWire });
    const directories = makeHarnessDirectoryStore({ home, machine: 'fixture' });
    yield* directories.keep('dynamic', {
      key: AccountKey.make('profile'),
      label: 'Configured',
      machine: 'fixture',
      directory: null,
      addedAt: 1,
      signed: true,
      pending: false,
      requested: true,
    });
    const inputs = Layer.mergeAll(
      Layer.succeed(BuiltinAdapters, {
        sources: [{ id: 'dynamic', origin: 'builtin', version: null, load: async () => ({ adapter: () => [provider] }) }],
      }),
      Layer.succeed(CredentialFiles, { tokensPath }),
      Layer.succeed(HarnessDirectories, directories),
      Layer.succeed(
        HarnessAccounts,
        HarnessAccounts.of({
          defaultSignedIn: Stream.fromQueue(signed),
          owns: () => Effect.die('no account ownership reads'),
          launchable: () => Effect.die('no account launch reads'),
          launch: () =>
            Effect.succeed({
              account: AccountKey.make('profile'),
              directory,
              entries: [{ _tag: 'Set', name: 'PROFILE', value: directory ?? 'default' }],
            }),
          status: () => Effect.die('no account status reads'),
          begin: () => Effect.die('no account login'),
          complete: () => Effect.die('no account login completion'),
          cancel: () => Effect.die('no account login cancellation'),
          rename: () => Effect.die('no account rename'),
          remove: () => Effect.die('no account removal'),
        }),
      ),
      Layer.succeed(DefaultAccounts, {
        defaultAccount: () => Effect.succeed({ account: null, revision: 0 }),
        saveDefaultAccount: () => Effect.die('no default writes'),
        settleDefaultAccount: () => Effect.die('no default settlement'),
        forgetAccount: () => Effect.die('no account removal'),
        adoptDefaultAccount: () => Effect.die('no account adoption'),
        defaultAccountMoved: Stream.fromQueue(moves),
      }),
      Layer.succeed(ProviderCredentials, {
        tokens,
        owned: tokens,
        forCatalog: () => tokens,
        consoles: () => [],
        keys: {
          accounts: () => Effect.die('no console keys'),
          has: () => Effect.die('no console keys'),
          key: () => Effect.die('no console keys'),
          values: () => Effect.die('no console keys'),
          removeProviders: () => Effect.die('no console keys'),
          save: () => Effect.die('no console keys'),
          remove: () => Effect.die('no console keys'),
          moveKeys: () => Effect.die('no console keys'),
        },
      }),
    );
    const boot = () => Layer.build(modelCatalogsLayer.pipe(Layer.provideMerge(registryLayer), Layer.provide(inputs)));
    const first = yield* boot();
    const catalogs = Context.get(first, ModelCatalogs);
    yield* catalogs.refresh();
    expect(
      Context.get(first, ProviderRegistry)
        .current()
        .menu.options.map(({ id }) => id),
    ).toEqual(['discovered']);
    offline = true;
    const second = yield* boot();
    const registry = Context.get(second, ProviderRegistry);
    expect(registry.current().menu.options.map(({ id }) => id)).toEqual(['discovered']);
    yield* Context.get(second, ModelCatalogs).refresh();
    expect(registry.current().menu.options.map(({ id }) => id)).toEqual(['discovered']);
    expect(registry.current().served.providers[0]?.catalogState).toMatchObject({
      failure: 'offline',
      warnings: ['A second model has unknown capacity'],
    });
    offline = false;
    label = 'After start';
    yield* Effect.forkScoped(Context.get(second, ModelCatalogs).serve);
    yield* registry.changes.pipe(
      Stream.filter((catalog) => catalog.menu.options[0]?.label === 'After start'),
      Stream.runHead,
    );
    label = 'After default';
    directory = '/account/profile';
    yield* Queue.offer(moves, 'dynamic');
    yield* registry.changes.pipe(
      Stream.filter((catalog) => catalog.menu.options[0]?.label === 'After default'),
      Stream.runHead,
    );
    expect(registry.current().menu.options[0]?.label).toBe('After default');
    label = 'After daily refresh';
    yield* TestClock.adjust('1 day');
    yield* registry.changes.pipe(
      Stream.filter((catalog) => catalog.menu.options[0]?.label === 'After daily refresh'),
      Stream.runHead,
    );
    expect(registry.current().menu.options[0]?.label).toBe('After daily refresh');
    label = 'After sign-in';
    yield* Queue.offer(signed, 'dynamic');
    yield* registry.changes.pipe(
      Stream.filter((catalog) => catalog.menu.options[0]?.label === 'After sign-in'),
      Stream.runHead,
    );
    expect(registry.current().menu.options[0]?.label).toBe('After sign-in');
  }),
);
