import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { InvalidRequestReason, LLMError } from '@runlith/llm/schema/errors';
import type { TokenStore } from '@runlith/llm/oauth/FileTokenStore';
import { modelAccessLayer } from './access.js';
import { ModelAccess } from './contract/service/access.js';
import type { Provider, WireProvider } from '@runlith/tagma/adapter/provider';
import { Context, Effect, Layer, Result } from 'effect';
import { type AdapterSource, AdapterSources, ProviderRegistry } from './contract/service/registry.js';
import { registryLayer } from './registry.js';
import { fixedSources } from './testing/registry.js';

const acme = {
  id: 'acme',
  label: 'Acme',
  kind: 'wire',
  auth: 'api-key',
  models: {
    'acme-1': { label: 'Acme 1', capacity: { context: 100_000 }, capabilities: ['text'], reasoning: [], defaultReasoning: null },
  },
  cacheLifetime: { promisedSeconds: null, prior: null },
  defaultTextModel: 'acme-1',
  profile: { model: () => Effect.die('unused'), options: () => undefined, output: { budget: 100, sent: false } },
  quota: { read: () => Effect.die('unused'), fromHeaders: () => null },
} satisfies WireProvider;

const source = (id: string, load: AdapterSource['load']): AdapterSource => ({ id, title: id, origin: 'builtin', version: null, load });
const declaring = (id: string, providers: readonly Provider[]) => source(id, async () => () => providers);

const registry = (sources: readonly AdapterSource[]) =>
  Effect.map(Layer.build(registryLayer.pipe(Layer.provide(Layer.succeed(AdapterSources, fixedSources(sources))))), (context) =>
    Context.get(context, ProviderRegistry),
  );

it.effect('the first callable provider in picker order supplies its declared default', () =>
  Effect.gen(function* () {
    const beta = { ...acme, id: 'beta' } as Provider;
    const served = yield* (yield* registry([declaring('b', [beta]), declaring('a', [acme])])).catalog;
    expect(served.defaultModel).toEqual({ provider: 'beta', model: 'acme-1', reasoning: null });
  }),
);

it.effect('an adapter that fails to load or declares a faulty provider stands failed with its reason, and the rest load', () =>
  Effect.gen(function* () {
    const providers = yield* registry([
      declaring('good', [acme]),
      source('broken', () => Promise.reject(new Error('module not found'))),
      declaring('shapeless', [{ ...acme, id: 'bare', profile: undefined } as unknown as Provider]),
      declaring('twin', [acme]),
    ]);
    const catalog = yield* providers.catalog;

    expect(catalog.adapters).toEqual([
      { id: 'good', title: 'good', origin: 'builtin', version: null, state: 'loaded', providers: ['acme'] },
      { id: 'broken', title: 'broken', origin: 'builtin', version: null, state: 'failed', reason: 'module not found' },
      {
        id: 'shapeless',
        title: 'shapeless',
        origin: 'builtin',
        version: null,
        state: 'failed',
        reason: 'provider "bare" declares no request profile',
      },
      {
        id: 'twin',
        title: 'twin',
        origin: 'builtin',
        version: null,
        state: 'failed',
        reason: 'provider "acme" is already declared by adapter good',
      },
    ]);
    expect(catalog.served.providers.map((provider) => provider.id)).toEqual(['acme']);
  }),
);

it.effect('a provider no installed adapter declares is refused as provider-not-installed', () =>
  Effect.gen(function* () {
    const providers = yield* registry([declaring('good', [acme])]);

    expect(Result.isSuccess(yield* Effect.result(providers.registration('acme')))).toBe(true);
    const gone = yield* Effect.result(providers.registration('gone'));
    expect(Result.isFailure(gone) && gone.failure.code).toBe('provider-not-installed');
  }),
);

const unused = Effect.die('This provider does not request credentials.');
const tokens: TokenStore = {
  keeps: () => false,
  heldProviders: () => unused,
  held: () => unused,
  accounts: () => unused,
  get: () => unused,
  find: () => unused,
  owns: () => unused,
  add: () => unused,
  remove: () => unused,
  relabel: () => unused,
  getAccessToken: () => unused,
  recoverAccessToken: () => unused,
};
const accessOf = (providers: ProviderRegistry['Service']) =>
  Effect.map(
    Layer.build(
      modelAccessLayer(
        providers,
        () => tokens,
        () => unused,
      ),
    ),
    (context) => Context.get(context, ModelAccess),
  );
const marked = (mark: string): WireProvider => ({
  ...acme,
  label: mark,
  profile: {
    ...acme.profile,
    model: () => Effect.fail(new LLMError({ module: 'Probe', method: mark, reason: new InvalidRequestReason({ message: mark }) })),
  },
});
const selected = { ownerId: 'owner', provider: 'acme', model: 'acme-1', reasoning: null, switches: {} };

it.effect('failed updates retain declarations, refuse calls and recover without changing an admitted run', () =>
  Effect.gen(function* () {
    let entry = marked('first');
    let fault: string | null = null;
    const providers = yield* registry([
      source('changing', async () => {
        if (fault !== null) throw new Error(fault);
        return () => [entry];
      }),
    ]);
    const access = yield* accessOf(providers);
    providers.pinRun('held');
    fault = 'broken update';
    const failed = yield* providers.reload;
    expect(failed.served.providers.map(({ id, failure, models }) => ({ id, failure, models: Object.keys(models) }))).toEqual([
      { id: 'acme', failure: 'broken update', models: ['acme-1'] },
    ]);
    expect(failed.adapters[0]).toMatchObject({ state: 'failed', reason: 'broken update' });
    const refused = yield* Effect.flip(access.request(selected).text({ prompt: 'hello' }));
    expect(refused.reason).toMatchObject({ _tag: 'AdapterFailed', provider: 'acme', detail: 'broken update' });
    expect((yield* Effect.flip(providers.callable('acme'))).code).toBe('provider-failed');
    fault = 'still broken';
    expect((yield* providers.reload).models.options[0]?.provider).toBe('acme');
    fault = null;
    entry = marked('second');
    yield* providers.reload;
    expect((yield* Effect.flip(access.request({ ...selected, runId: 'held' }).text({ prompt: 'hello' }))).method).toBe('first');
    providers.pinRun('next');
    expect((yield* Effect.flip(access.request({ ...selected, runId: 'next' }).text({ prompt: 'hello' }))).method).toBe('second');
    yield* providers.releaseRun('held');
    expect(providers.forRun('held').models.providerLabel('acme')).toBe('second');
  }),
);

it.effect('an admitted run keeps a provider that is removed before its first request', () =>
  Effect.gen(function* () {
    const sources = [declaring('changing', [marked('standing')])];
    const providers = yield* registry(sources);
    const access = yield* accessOf(providers);
    providers.pinRun('held');
    sources.length = 0;
    yield* providers.reload;
    expect((yield* Effect.flip(access.request({ ...selected, runId: 'held' }).text({ prompt: 'hello' }))).method).toBe('standing');
    expect((yield* Effect.flip(access.request(selected).text({ prompt: 'hello' }))).reason._tag).toBe('NotInstalled');
  }),
);

it.effect('a failed re-enable keeps the declaration from before the adapter was disabled', () =>
  Effect.gen(function* () {
    let broken = false;
    const installed = source('toggle', async () => {
      if (broken) throw new Error('failed re-enable');
      return () => [acme];
    });
    const sources: AdapterSource[] = [installed];
    const providers = yield* registry(sources);
    sources[0] = { ...installed, disabled: true };
    expect((yield* providers.reload).models.registered('acme')).toBe(false);
    broken = true;
    sources[0] = installed;
    const failed = yield* providers.reload;
    expect(failed.models.modelsFor('acme', 'text').map(({ id }) => id)).toEqual(['acme-1']);
    expect(failed.served.providers[0]?.failure).toBe('failed re-enable');
  }),
);

it.effect('a disabled adapter is listed but never loaded, and its provider is refused as provider-not-installed', () =>
  Effect.gen(function* () {
    let imported = false;
    const off: AdapterSource = {
      ...source('off', async () => {
        imported = true;
        return () => [acme];
      }),
      disabled: true,
    };
    const providers = yield* registry([off]);
    const catalog = yield* providers.catalog;

    expect(catalog.adapters).toEqual([{ id: 'off', title: 'off', origin: 'builtin', version: null, state: 'disabled' }]);
    expect(imported).toBe(false);
    const gone = yield* Effect.result(providers.registration('acme'));
    expect(Result.isFailure(gone) && gone.failure.code).toBe('provider-not-installed');
  }),
);
