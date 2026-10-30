import { dirname } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { openModelClient } from '@runlith/llm/models/client';
import { vendorWire } from '@runlith/llm/oauth/vendorCall';
import { Context, Effect, Layer, Option, Result } from 'effect';
import { homeless, makeMachineAdapters } from './adapters/installs.js';
import { makeAdapterInstanceRows } from './adapters/instanceRows.js';
import { AdapterInstalls, PackageHolders } from './contract/service/adapters.js';
import { AdapterInstances } from './contract/service/instances.js';
import { OPERATOR_PRINCIPAL } from '../platform/contract/wire/actor.js';
import { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { accountCredentialsLayer, modelAccess } from './access.js';
import { ModelAccess } from './contract/service/access.js';
import { ImageModels } from './contract/service/images.js';
import { makeImageModels } from './images.js';
import { signIns } from './accounts/signIns.js';
import { SignIns, VendorWires } from './contract/service/signIns.js';
import { defaultAccountsLayer } from './accounts/defaults.js';
import { providerAccounts } from './accounts/stored.js';
import { HarnessDirectories, harnessDirectoriesLayer } from './accounts/harnessRows.js';
import { makeHarnessAccountBook } from './accounts/harnessAccounts.js';
import { harnessStored } from './accounts/harnessStored.js';
import { makeConnectedProviders } from './accounts/connected.js';
import { DefaultLogins, defaultLoginsLayer } from './accounts/defaultLogins.js';
import { harnessSignIns } from './accounts/harnessSignIns.js';
import { HarnessAccounts } from './contract/service/harness.js';
import { AccountCli } from './contract/service/cli.js';
import { AdapterPlaces, type ProviderCatalog, ProviderRegistry } from './contract/service/registry.js';
import { DefaultAccounts, ProviderAccounts } from './contract/service/accounts.js';
import { CredentialFiles, KeyedProviders, ProviderCredentials, QuotaProviders } from './contract/service/credentials.js';
import { AccountQuota } from './contract/service/quota.js';
import { consoleKeyFile } from './credentials/consoleKeyFile.js';
import { instanceFile } from './credentials/instanceFile.js';
import { makeConsoleKeyStore } from './credentials/consoleKeys.js';
import { type BorrowingTokens, makeBorrowingTokens } from './credentials/borrowed.js';
import { makeOperatorCredentials } from './credentials/operator.js';
import { createProviderTokens } from './credentials/tokens.js';
import { type AccountQuotaProvider, accountQuotaLayer } from './quota/ledger.js';
import { makeQuotaReadings } from './quota/readings.js';
import { registryLayer } from './registry.js';
import { ModelCatalogs, modelCatalogsLayer } from './catalogs.js';

const instancesLayer = Layer.effect(
  AdapterInstances,
  Effect.gen(function* () {
    const { tokensPath } = yield* CredentialFiles;
    const { db } = yield* MachineStore;
    const units = yield* MachineUnits;
    const rows = makeAdapterInstanceRows({ db, units, file: instanceFile(dirname(tokensPath)) });
    yield* Effect.orDie(rows.moveSecrets(makeConsoleKeyStore({ db, units, file: consoleKeyFile(dirname(tokensPath)) })));
    return rows;
  }),
);

const credentials = Layer.effect(
  ProviderCredentials,
  Effect.gen(function* () {
    const { tokensPath } = yield* CredentialFiles;
    const store = yield* MachineStore;
    const keyed = Option.match(yield* Effect.serviceOption(KeyedProviders), { onNone: () => [], onSome: ({ ids }) => ids });
    const registry = yield* ProviderRegistry;
    const bound = yield* Effect.serviceOption(VendorWires);
    const wire = Option.match(bound, { onNone: () => vendorWire, onSome: ({ wire }) => wire });
    const directories = yield* HarnessDirectories;
    const cli = yield* AccountCli;
    const logins = yield* DefaultLogins;
    const tokens = (catalog: () => ProviderCatalog) =>
      makeBorrowingTokens({
        own: createProviderTokens(
          tokensPath,
          () => catalog().models,
          wire,
          () => registry.current().models,
        ),
        catalog,
        directories,
        cli,
        now: Date.now,
        options: { renew: true, logins },
      });
    const scoped = new WeakMap<ProviderCatalog, BorrowingTokens>();
    const owned = createProviderTokens(tokensPath, () => registry.current().models, wire);
    yield* registry.bindSignIns(owned.heldProviders());
    return {
      owned,
      tokens: makeBorrowingTokens({ own: owned, catalog: registry.current, directories, cli }),
      forCatalog: (catalog: ProviderCatalog) => {
        let held = scoped.get(catalog);
        if (held === undefined) {
          held = tokens(() => catalog);
          scoped.set(catalog, held);
        }
        return held;
      },
      keys: makeConsoleKeyStore({ db: store.db, units: yield* MachineUnits, file: consoleKeyFile(dirname(tokensPath)) }),
      consoles: () => [
        ...new Set([
          ...registry
            .current()
            .wires.providers.filter((provider) => provider.auth === 'api-key')
            .map((provider) => provider.id),
          ...keyed,
        ]),
      ],
    };
  }),
);

const accounts = Layer.effect(
  ProviderAccounts,
  Effect.gen(function* () {
    const { tokens, keys, consoles } = yield* ProviderCredentials;
    const registry = yield* ProviderRegistry;
    const rows = harnessStored(providerAccounts(tokens, keys), yield* HarnessDirectories, registry, yield* DefaultLogins, consoles);
    const directory = dirname((yield* CredentialFiles).tokensPath);
    return ProviderAccounts.of({ ...rows, connected: yield* makeConnectedProviders({ rows, registry, directory }) });
  }),
);

const defaults = Layer.unwrap(
  Effect.gen(function* () {
    return defaultAccountsLayer(yield* ProviderAccounts, (yield* ProviderCredentials).consoles, yield* ProviderRegistry);
  }),
);

const access = Layer.unwrap(
  Effect.gen(function* () {
    const { tokens, keys, forCatalog } = yield* ProviderCredentials;
    const { defaultAccount } = yield* DefaultAccounts;
    const registry = yield* ProviderRegistry;
    return Layer.merge(
      Layer.effectContext(
        Effect.gen(function* () {
          const client = yield* openModelClient();
          return Context.make(ModelAccess, modelAccess(registry, forCatalog, defaultAccount, client, keys)).pipe(
            Context.add(ImageModels, yield* makeImageModels(client)),
          );
        }),
      ),
      accountCredentialsLayer(tokens, defaultAccount, keys),
    );
  }),
);

const quotaProviders = (catalog: ProviderCatalog): readonly AccountQuotaProvider[] => [
  ...catalog.wires.providers.map(({ id, quota }) => ({ id, quota, shownAs: catalog.accountSource(id) })),
  ...catalog.harnesses.flatMap(({ id, accounts, quota }) =>
    accounts === undefined ? [] : [{ id, quota: quota ?? null, shownAs: catalog.inMode(id) ? id : null }],
  ),
];

const quota = Layer.unwrap(
  Effect.gen(function* () {
    const { tokens, keys } = yield* ProviderCredentials;
    const directories = yield* HarnessDirectories;
    const store = yield* MachineStore;
    const { defaultAccount } = yield* DefaultAccounts;
    const chosen = yield* Effect.serviceOption(QuotaProviders);
    const registry = yield* ProviderRegistry;
    return accountQuotaLayer(
      OPERATOR_PRINCIPAL,
      yield* ProviderAccounts,
      makeQuotaReadings({ db: store.db, units: yield* MachineUnits }),
      Option.match(chosen, {
        onNone: () => () => quotaProviders(registry.current()),
        onSome:
          ({ providers }) =>
          () =>
            providers,
      }),
      defaultAccount,
      (onAccess) => makeOperatorCredentials({ tokens, defaultAccount, onAccess, keys }),
      Effect.map(Effect.all([tokens.heldProviders(), directories.heldProviders()]), (sources) => [...new Set(sources.flat())]),
    );
  }),
);

const harnessAccounts = Layer.effect(HarnessAccounts, makeHarnessAccountBook);

const signing = Layer.effect(
  SignIns,
  Effect.gen(function* () {
    const { owned, keys, consoles } = yield* ProviderCredentials;
    const wire = yield* Effect.serviceOption(VendorWires);
    const ordinary = yield* signIns(
      owned,
      keys,
      yield* DefaultAccounts,
      yield* AccountQuota,
      Option.match(wire, { onNone: () => vendorWire, onSome: (bound) => bound.wire }),
      consoles,
      yield* ProviderRegistry,
      yield* ModelCatalogs,
    );
    return harnessSignIns(ordinary, yield* HarnessAccounts, yield* ProviderRegistry);
  }),
);

const adapters = Layer.effect(
  AdapterInstalls,
  Effect.gen(function* () {
    const places = yield* Effect.serviceOption(AdapterPlaces);
    const machine = Option.match(places, { onNone: () => null, onSome: (place) => place.machine });
    const holders = yield* PackageHolders;
    if (machine === null) return homeless;
    const installs = makeMachineAdapters({ machine, registry: yield* ProviderRegistry, holders });
    const swept = yield* Effect.result(installs.sweep());
    if (Result.isFailure(swept)) yield* Effect.logError('earlier adapter versions were not swept', { reason: swept.failure.reason });
    return installs;
  }),
);

const movedKeys = Layer.effectDiscard(
  Effect.flatMap(ProviderCredentials, ({ keys }) =>
    keys.moveKeys().pipe(
      Effect.tapError((failure) => Effect.logError('console keys could not move from the store to their file', { failure })),
      Effect.orDie,
    ),
  ),
);

const catalogDriver = Layer.effectDiscard(Effect.flatMap(ModelCatalogs, (catalogs) => Effect.asVoid(Effect.forkScoped(catalogs.serve))));

export const providersLayer = Layer.mergeAll(access, adapters, signing, movedKeys, catalogDriver).pipe(
  Layer.provideMerge(modelCatalogsLayer),
  Layer.provideMerge(harnessAccounts),
  Layer.provideMerge(quota),
  Layer.provideMerge(defaults),
  Layer.provideMerge(accounts),
  Layer.provideMerge(credentials),
  Layer.provideMerge(defaultLoginsLayer),
  Layer.provideMerge(harnessDirectoriesLayer),
  Layer.provideMerge(registryLayer.pipe(Layer.provide(BunFileSystem.layer), Layer.provideMerge(instancesLayer))),
);
