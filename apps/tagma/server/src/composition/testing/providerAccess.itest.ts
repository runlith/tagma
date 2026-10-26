import { testTokens } from '../../providers/testing/tokens.js';
import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { ThreadModelNotServed } from '@runlith/agent/thread/compaction/CompactionModels';
import { ModelAccess } from '../../providers/contract/service/access.js';
import { modelAccessLayer } from '../../providers/access.js';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { builtinRegistry } from './providerCatalog.js';
import { ProviderRegistry } from '../../providers/contract/service/registry.js';
import { staticRegistry } from '../../providers/testing/registry.js';

const SELECTED = { provider: 'subscription', model: 'claude-opus-5-5', reasoning: 'xhigh' } as const;

const models = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const tokens = testTokens(join(yield* files.makeTempDirectoryScoped({ prefix: 'tagma-models-' }), 'tokens.json'));
  const catalog = yield* (yield* ProviderRegistry).catalog;
  const built = yield* Layer.build(
    modelAccessLayer(
      staticRegistry(catalog),
      () => tokens,
      () => Effect.succeed({ account: null, revision: 0 }),
    ),
  );
  return { access: Context.get(built, ModelAccess), catalog };
});

layer(Layer.merge(BunFileSystem.layer, builtinRegistry), { excludeTestServices: true, testTimeout: 30_000, timeout: 60_000 })(
  'provider access',
  (it) => {
    it.effect('every text-serving wire provider the built-in adapters install prepares a request that names its own deployment', () =>
      Effect.gen(function* () {
        const { access, catalog } = yield* models;
        expect(catalog.wires.providers.length).toBeGreaterThan(0);
        for (const registration of catalog.wires.providers.filter((provider) => provider.textless !== true)) {
          const request = access.request({ ownerId: OPERATOR_PRINCIPAL, provider: registration.id });

          expect(request.refusal).toBeUndefined();
          expect(String(request.origin?.provider)).toBe(String(registration.id));
          expect(request.plannedOutputTokens).toBeGreaterThan(0);
        }
      }),
    );

    it.effect('a provider no adapter installs as a wire, and a harness provider, are refused as not installed', () =>
      Effect.gen(function* () {
        const { access, catalog } = yield* models;
        const uncallable = ['no-such-provider', ...catalog.harnesses.map(({ id }) => id)];
        for (const id of uncallable) {
          const request = access.request({ ownerId: OPERATOR_PRINCIPAL, provider: id });
          const failure = yield* Effect.flip(request.text({ prompt: 'Hello' }));
          expect(failure.reason).toMatchObject({ _tag: 'NotInstalled', provider: id });
        }
      }),
    );

    it.effect('a catalog model is prepared at the effort the request names', () =>
      Effect.gen(function* () {
        const { access } = yield* models;
        const request = access.request({ ownerId: OPERATOR_PRINCIPAL, ...SELECTED });

        expect(request.providerOptions).toMatchObject({ anthropic: { outputConfig: { effort: 'xhigh' } } });
      }),
    );

    it.effect('a served model answers its window, and a model or provider no adapter serves is refused by name', () =>
      Effect.gen(function* () {
        const { access } = yield* models;
        expect((yield* access.served(SELECTED.provider, SELECTED.model)).capacity.context).toBeGreaterThan(0);
        const unknownModel = yield* Effect.flip(access.served(SELECTED.provider, 'a-model-this-catalog-never-carried'));
        expect(unknownModel).toBeInstanceOf(ThreadModelNotServed);
        const removed = yield* Effect.flip(access.served('removed-oauth', null));
        expect(removed).toMatchObject({ _tag: 'ThreadModelNotServed', provider: 'removed-oauth' });
      }),
    );
  },
);
