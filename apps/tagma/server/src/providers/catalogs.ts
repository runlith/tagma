import { dirname, join } from 'node:path';
import { makeCredentialFile } from '@runlith/credential-file/CredentialFile';
import { CredentialFileInvalid } from '@runlith/credential-file/failure';
import { descriptionFault } from '@runlith/llm/models/catalog';
import { vendorWire } from '@runlith/llm/oauth/vendorCall';
import { Clock, Context, Data, Effect, Layer, Schema, Semaphore, Stream } from 'effect';
import { CredentialFiles, ProviderCredentials } from './contract/service/credentials.js';
import { DefaultAccounts } from './contract/service/accounts.js';
import { HarnessAccounts } from './contract/service/harness.js';
import { HarnessDirectories } from './accounts/harnessRows.js';
import { ProviderRegistry } from './contract/service/registry.js';
import { VendorWires } from './contract/service/signIns.js';
import { catalogSnapshotSchema, type CatalogSnapshot } from './contract/wire/catalog.js';
import { makeOperatorCredentials } from './credentials/operator.js';
import { OPERATOR_PRINCIPAL } from '../platform/contract/wire/actor.js';

export class ModelCatalogs extends Context.Service<
  ModelCatalogs,
  {
    refresh(provider?: string): Effect.Effect<void>;
    readonly serve: Effect.Effect<never>;
  }
>()('tagma/providers/ModelCatalogs') {}

class CatalogReadFailed extends Data.TaggedError('CatalogReadFailed')<{ readonly message: string }> {}

const snapshotsSchema = Schema.Record(Schema.String, catalogSnapshotSchema);
const DAY_MS = 24 * 60 * 60 * 1_000;

export const modelCatalogsLayer = Layer.effect(
  ModelCatalogs,
  Effect.gen(function* () {
    const registry = yield* ProviderRegistry;
    const defaults = yield* DefaultAccounts;
    const harnesses = yield* HarnessAccounts;
    const directories = yield* HarnessDirectories;
    const { tokens, keys } = yield* ProviderCredentials;
    const wire = yield* Effect.serviceOption(VendorWires);
    const http = wire._tag === 'Some' ? wire.value.wire : vendorWire;
    const path = join(dirname((yield* CredentialFiles).tokensPath), 'model-catalogs.json');
    const file = makeCredentialFile({
      path,
      codec: {
        empty: (): Readonly<Record<string, CatalogSnapshot>> => ({}),
        decode: (path, parsed) =>
          Schema.decodeUnknownEffect(snapshotsSchema)(parsed).pipe(
            Effect.map((value) => ({ value, needsWrite: false })),
            Effect.mapError((cause) => new CredentialFileInvalid({ path, reason: cause.message })),
          ),
      },
    });
    const gate = yield* Semaphore.make(1);
    const snapshots = new Map<string, CatalogSnapshot>();
    const restored = yield* Effect.result(file.read());
    if (restored._tag === 'Success') {
      for (const [provider, snapshot] of Object.entries(restored.success)) {
        snapshots.set(provider, snapshot);
        yield* registry.updateCatalog(provider, snapshot);
      }
    } else yield* Effect.logWarning('Provider model catalogs could not be restored', { reason: restored.failure.message });

    const refresh = Effect.fn('ModelCatalogs.refresh')(function* (selected?: string, staleOnly = false) {
      const requested =
        selected === undefined
          ? yield* Effect.result(Effect.map(directories.requestedProviders(), (providers) => new Set(providers)))
          : undefined;
      for (const provider of registry.current().models.providers) {
        if (provider.catalog === undefined || (selected !== undefined && provider.id !== selected)) continue;
        const cli = provider.kind === 'harness' && provider.auth === 'cli';
        if (cli && requested?._tag === 'Success' && !requested.success.has(provider.id)) continue;
        const previous = snapshots.get(provider.id);
        const now = yield* Clock.currentTimeMillis;
        if (staleOnly && previous?.state.readAt !== null && previous?.state.readAt !== undefined && now - previous.state.readAt < DAY_MS)
          continue;
        const reading = Effect.gen(function* () {
          if (cli && requested?._tag === 'Failure') return yield* requested.failure;
          const account = (yield* defaults.defaultAccount(provider.id)).account;
          const credentials = makeOperatorCredentials({ tokens, keys, defaultAccount: defaults.defaultAccount });
          const models = yield* Effect.gen(function* () {
            if (provider.kind === 'harness' && provider.auth === 'cli') {
              const address = yield* harnesses.launch(provider.id, account ?? undefined);
              if (address === null) return yield* new CatalogReadFailed({ message: `${provider.id} has no CLI account address.` });
              return yield* provider.catalog!.read(address);
            }
            return yield* provider.catalog!.read(credentials, OPERATOR_PRINCIPAL, account ?? undefined);
          }).pipe(Effect.provide(http));
          const fault = descriptionFault({ ...provider, ...models });
          if (fault !== null) return yield* new CatalogReadFailed({ message: fault });
          const snapshot = yield* Schema.decodeUnknownEffect(catalogSnapshotSchema)({
            models: models.models,
            defaultTextModel: models.defaultTextModel,
            state: { readAt: now, failure: null, warnings: models.warnings ?? [] },
          });
          yield* file.update((held) => Effect.succeed({ ...held, [provider.id]: snapshot }));
          return snapshot;
        });
        const result = yield* Effect.result(reading);
        const snapshot: CatalogSnapshot =
          result._tag === 'Success'
            ? result.success
            : {
                models: previous?.models ?? provider.models,
                defaultTextModel: previous?.defaultTextModel ?? provider.defaultTextModel,
                state: {
                  readAt: previous?.state.readAt ?? null,
                  failure: result.failure.message,
                  warnings: previous?.state.warnings ?? [],
                },
              };
        snapshots.set(provider.id, snapshot);
        yield* registry.updateCatalog(provider.id, snapshot);
      }
    });
    const locked = (provider?: string) => gate.withPermits(1)(refresh(provider));
    const serve = Effect.gen(function* () {
      yield* Effect.forkScoped(
        Stream.runForEach(Stream.merge(defaults.defaultAccountMoved, harnesses.defaultSignedIn), (provider) => locked(provider)),
      );
      yield* gate.withPermits(1)(refresh(undefined, true));
      return yield* Effect.forever(Effect.andThen(Effect.sleep('1 day'), locked()));
    }).pipe(Effect.scoped);
    return ModelCatalogs.of({ refresh: locked, serve });
  }),
);
