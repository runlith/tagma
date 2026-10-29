import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer, Schema } from 'effect';
import { openMemoryStorage } from '@runlith/agent/thread/conformance/memoryStorage';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { AuthenticationReason, LLMError } from '@runlith/llm/schema/errors';
import { AccountCredentials } from '../providers/contract/service/access.js';
import { ProviderRegistry } from '../providers/contract/service/registry.js';
import { providerCatalogOf, staticRegistry, testRegistry } from '../providers/testing/registry.js';
import { Settings } from '../settings/contract/service/values.js';
import { type Harness, HarnessRegistry } from './contract/service/harness.js';
import type { ThreadMetadata } from './list/store.js';
import { askerOf, makeRoads, TITLE_ROLE, type RejectedRoad, type RoadAsker } from './roads.js';

const provider = testRegistry.current().models.named('test-provider');
const models = {
  large: {
    label: 'Large',
    capacity: { context: 64_000 },
    capabilities: ['text'] as const,
    reasoning: ['low', 'medium'],
    defaultReasoning: 'medium',
  },
  light: { label: 'Light', capacity: { context: 16_000 }, capabilities: ['text'] as const, reasoning: ['low'], defaultReasoning: 'low' },
};
const catalog = providerCatalogOf([
  { ...provider, id: 'first', models, defaultTextModel: 'large', lightTextModel: { model: 'light', rung: 'low' } },
  { ...provider, id: 'second', models, defaultTextModel: 'large', lightTextModel: { model: 'light', rung: 'low' } },
]);

const setup = Effect.gen(function* () {
  const storage = yield* openMemoryStorage();
  const row = yield* storage.aggregate.insert({
    ownerId: 'operator',
    agentId: 'tagma',
    provider: 'first',
    model: 'large',
    reasoning: 'medium',
  });
  const thread: ThreadMetadata = { ...row, projectId: 1, scopeBlockUuid: null, harness: null };
  const values = new Map<string, unknown>();
  const connected = new Set<string>();
  const roads = yield* makeRoads.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(HarnessRegistry, {
          list: () => {
            throw new Error('native title selection does not list harnesses');
          },
          writes: () => {
            throw new Error('native title selection does not ask for harness writes');
          },
        }),
        Layer.mock(Settings, {
          value: (key) => Schema.decodeUnknownEffect(key.schema)(values.get(key.id) ?? key.fallback).pipe(Effect.orDie),
        }),
        Layer.succeed(ProviderRegistry, staticRegistry(catalog)),
        Layer.succeed(AccountCredentials, {
          account: (provider) =>
            connected.has(provider)
              ? Effect.succeed(AccountKey.make(`account-${provider}`))
              : Effect.fail(
                  new LLMError({
                    module: 'test',
                    method: 'account',
                    reason: new AuthenticationReason({ message: 'No connected account.', kind: 'missing' }),
                  }),
                ),
        }),
      ),
    ),
  );
  return { asker: askerOf(thread), values, connected, roads };
});

const asked = (asker: RoadAsker | null, rejected: readonly RejectedRoad[] = []) => ({ asker, projectId: 1, rejected });

it.effect('title selection uses the configured model, then a connected light model, then the native thread model', () =>
  Effect.gen(function* () {
    const { asker, values, connected, roads } = yield* setup;
    expect(yield* roads.choose(TITLE_ROLE, asked(asker, [{ road: 'warm', reason: 'no-prefix' }]))).toMatchObject({
      name: 'thread-model',
      road: { _tag: 'Model', option: { provider: 'first', id: 'large' }, reasoning: 'low', account: null },
      rejected: [
        { road: 'warm', reason: 'no-prefix' },
        { road: 'title-model', reason: 'not-configured' },
        { road: 'provider-light', reason: 'account-unavailable' },
        { road: 'cli', reason: 'not-declared' },
      ],
    });
    connected.add('first');
    expect(yield* roads.choose(TITLE_ROLE, asked(asker))).toMatchObject({
      name: 'provider-light',
      road: { _tag: 'Model', option: { provider: 'first', id: 'light' }, reasoning: 'low', account: 'account-first' },
    });
    values.set('threads.titleModel', 'second:large');
    values.set('threads.titleReasoning', 'medium');
    expect(yield* roads.choose(TITLE_ROLE, asked(asker))).toMatchObject({
      name: 'title-model',
      road: { _tag: 'Model', option: { provider: 'second', id: 'large' }, reasoning: 'medium', account: null },
      rejected: [],
    });
  }),
);

it.effect('an unavailable configured model or reasoning refuses that selection instead of silently taking another road', () =>
  Effect.gen(function* () {
    const { asker, values, connected, roads } = yield* setup;
    connected.add('first');
    for (const [model, reasoning] of [
      ['missing:model', ''],
      ['second:large', 'unserved'],
    ]) {
      values.set('threads.titleModel', model);
      values.set('threads.titleReasoning', reasoning);
      expect(yield* roads.choose(TITLE_ROLE, asked(asker))).toEqual({
        name: 'title-model',
        road: { _tag: 'Invalid' },
        rejected: [{ road: 'title-model', reason: 'invalid-selection' }],
      });
    }
  }),
);

it.effect('with no thread, a named model wins, then the light model of the first connected provider in catalog order', () =>
  Effect.gen(function* () {
    const { values, connected, roads } = yield* setup;
    expect(yield* roads.choose(TITLE_ROLE, asked(null))).toEqual({
      name: 'none',
      road: { _tag: 'None' },
      rejected: [
        { road: 'title-model', reason: 'not-configured' },
        { road: 'provider-light', reason: 'account-unavailable' },
        { road: 'cli', reason: 'no-thread' },
        { road: 'thread-model', reason: 'no-thread' },
      ],
    });
    connected.add('second');
    expect(yield* roads.choose(TITLE_ROLE, asked(null))).toMatchObject({
      name: 'provider-light',
      road: { option: { provider: 'second' } },
    });
    connected.add('first');
    expect(yield* roads.choose(TITLE_ROLE, asked(null))).toMatchObject({ name: 'provider-light', road: { option: { provider: 'first' } } });
    values.set('threads.titleModel', 'first:large');
    expect(yield* roads.choose(TITLE_ROLE, { ...asked(null), named: { model: 'second:large', reasoning: 'low' } })).toMatchObject({
      name: 'named',
      road: { _tag: 'Model', option: { provider: 'second', id: 'large' }, reasoning: 'low' },
    });
    expect(yield* roads.choose(TITLE_ROLE, { ...asked(null), named: { model: 'second:missing', reasoning: null } })).toMatchObject({
      name: 'named',
      road: { _tag: 'Invalid' },
    });
  }),
);

it.effect('a CLI thread whose provider has no wire is asked through its CLI, not through a light model nobody can call', () =>
  Effect.gen(function* () {
    const oneShot: NonNullable<Harness['Service']['oneShot']> = {
      capacity: { context: 16_000 },
      ask: () => Effect.succeed(null),
    };
    const cliProvider: Parameters<typeof providerCatalogOf>[0][number] = {
      id: 'cli-agent',
      label: 'CLI agent',
      kind: 'harness',
      auth: 'cli',
      environment: () => [],
      models,
      defaultTextModel: 'large',
      lightTextModel: { model: 'light', rung: 'low' },
      cacheLifetime: { promisedSeconds: null, prior: null },
    };
    const roads = yield* makeRoads.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(HarnessRegistry, {
            resolve: () => Effect.succeed({ provider: 'cli-agent', oneShot } as Harness['Service']),
            list: () => [],
            writes: (base) => base,
          }),
          Layer.mock(Settings, { value: (key) => Schema.decodeUnknownEffect(key.schema)(key.fallback).pipe(Effect.orDie) }),
          Layer.succeed(ProviderRegistry, staticRegistry(providerCatalogOf([cliProvider]))),
          Layer.succeed(AccountCredentials, { account: (provider) => Effect.succeed(AccountKey.make(`account-${provider}`)) }),
        ),
      ),
    );
    const asker: RoadAsker = { provider: 'cli-agent', model: null, account: null, harness: 'claude-code' };
    expect(yield* roads.choose(TITLE_ROLE, asked(asker))).toMatchObject({
      name: 'cli',
      road: { _tag: 'Cli', cli: oneShot },
      rejected: [
        { road: 'title-model', reason: 'not-configured' },
        { road: 'provider-light', reason: 'not-declared' },
      ],
    });
  }),
);
