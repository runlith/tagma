import { modelCatalog } from '@runlith/llm/models/catalog';
import { pickerOrder } from '@runlith/llm/models/description';
import type { AdapterHost, HarnessProvider, Provider, SettingInstance, WireProvider } from '@runlith/tagma/adapter/provider';
import type { AskKind } from '@runlith/llm/models/description';
import { askKinds } from './contract/wire/asks.js';
import { claimSections, type SectionClaim } from '@runlith/tagma/adapter/declaration';
import { Effect, FileSystem, Layer, Result, Semaphore, Stream, SubscriptionRef } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { PluginFaults, PluginRevisions } from '../plugins/contract/service/plugins.js';
import { PROVIDER_FAULTS } from '../plugins/contract/wire/rows.js';
import type { ServedProvider, ServedSettings, CatalogSnapshot } from './contract/wire/catalog.js';
import { AdapterInstances } from './contract/service/instances.js';
import {
  AdapterPlaces,
  type AdapterSource,
  AdapterSources,
  type AskOffers,
  type AskRoute,
  defaultModelOf,
  notInstalled,
  type ProviderCatalog,
  ProviderRegistry,
  type SignedProviders,
} from './contract/service/registry.js';
import { adapterHost } from './hosts.js';
import { indexHarnesses } from './harnessIndex.js';
import { type Loaded, load } from './adapters/judge.js';
import { publicValues } from './adapters/settingValues.js';
import { dirname, join } from 'node:path';
import { importProviders } from '@runlith/tagma/adapter/loader';
import { accountSource, makeAccountModes, modeSections } from './accounts/modes.js';
import type { AccountSection } from './contract/wire/catalog.js';
import { CredentialFiles } from './contract/service/credentials.js';
import { AccountCli } from './contract/service/cli.js';

const askOffers = (
  providers: readonly Provider[],
  borrowers: ReadonlyMap<string, string>,
  failures: ReadonlyMap<string, string>,
  packages: ReadonlyMap<string, string>,
): AskOffers => {
  const byId = new Map(providers.map((provider) => [provider.id, provider] as const));
  const route = (provider: string, model: string): AskRoute | null => {
    const registration = byId.get(provider);
    if (registration === undefined || failures.has(provider)) return null;
    if (registration.kind === 'wire') return { path: 'request', provider };
    const borrower = borrowers.get(provider);
    if (borrower !== undefined && !failures.has(borrower) && byId.get(borrower)?.models[model] !== undefined)
      return { path: 'request', provider: borrower };
    const program = registration.asks?.program;
    return program === undefined ? null : { path: 'program', provider, program, package: packages.get(provider) ?? null };
  };
  const kinds = (provider: string, model: string): readonly AskKind[] => {
    const routed = route(provider, model);
    const spec = routed === null ? undefined : byId.get(routed.provider)?.models[model];
    return routed === null || spec === undefined ? [] : askKinds(routed.path, spec.capabilities);
  };
  return { route, kinds, answers: (provider, model, kind) => kinds(provider, model).includes(kind) };
};

const askedModels = (provider: Provider, asks: AskOffers): ServedProvider['asks'] =>
  Object.fromEntries(
    Object.keys(provider.models).flatMap((model) => {
      const kinds = asks.kinds(provider.id, model);
      return kinds.length === 0 ? [] : [[model, kinds] as const];
    }),
  );

const servedOf =
  (
    instanced: ReadonlySet<string>,
    failures: ReadonlyMap<string, string>,
    sourceOf: (provider: string) => string,
    asks: AskOffers,
    plugins: ReadonlyMap<string, string>,
  ) =>
  (provider: Provider): ServedProvider => ({
    id: provider.id,
    plugin: plugins.get(provider.id) ?? provider.id,
    instance: instanced.has(provider.id) ? true : undefined,
    failure: failures.get(provider.id),
    label: provider.label,
    kind: provider.kind,
    auth: provider.auth,
    keyScope: provider.keyScope,
    icon: provider.icon ?? null,
    accountsLabel: provider.kind === 'wire' ? (provider.accountsLabel ?? null) : null,
    signInMethods:
      provider.kind === 'harness' && provider.auth === 'cli'
        ? provider.accounts === undefined
          ? []
          : ['external-cli']
        : (provider.accounts?.signIns.map((method) => method.kind) ??
          (provider.auth === 'api-key' && !instanced.has(provider.id) ? ['key'] : [])),
    keyHint: provider.kind === 'harness' && provider.auth === 'cli' ? null : (provider.keyHint ?? null),
    dynamicCatalog: provider.dynamicCatalog,
    textless: provider.textless,
    catalogState: undefined,
    quotaFromReplies: provider.kind === 'wire' && provider.quotaFromReplies === true,
    models: provider.models,
    imageModels: provider.imageModels,
    cacheLifetime: provider.cacheLifetime,
    requestLimits: provider.requestLimits,
    defaultTextModel: provider.defaultTextModel,
    spawnTextModel: provider.spawnTextModel,
    lightTextModel: provider.lightTextModel,
    asks: askedModels(provider, asks),
    accountSource: sourceOf(provider.id),
  });

const servedSettings = (loaded: readonly Loaded[], instances: ReadonlyMap<string, readonly SettingInstance[]>): readonly ServedSettings[] =>
  loaded.flatMap((adapter) =>
    adapter.settings === undefined
      ? []
      : [
          {
            adapter: adapter.state.id,
            title: adapter.settings.title,
            instance: adapter.settings.instance,
            name: adapter.settings.name,
            fields: adapter.settings.fields,
            discovers: adapter.settings.discover !== undefined,
            instances: (instances.get(adapter.state.id) ?? []).map((instance) => ({
              id: instance.id,
              values: publicValues(adapter.settings!.fields, instance.values),
              revision: instance.revision,
            })),
          },
        ],
  );

export const catalogOf = (
  loaded: readonly Loaded[],
  instances: ReadonlyMap<string, readonly SettingInstance[]> = new Map(),
  sections: readonly AccountSection[] = [],
  snapshots: ReadonlyMap<string, CatalogSnapshot> = new Map(),
): ProviderCatalog => {
  const providers = pickerOrder(loaded.map((adapter) => (adapter.state.state === 'disabled' ? [] : adapter.providers))).map((provider) => {
    const snapshot = provider.catalog === undefined ? undefined : snapshots.get(provider.id);
    return snapshot === undefined ? provider : { ...provider, models: snapshot.models, defaultTextModel: snapshot.defaultTextModel };
  });
  const borrowers = new Map(
    providers.flatMap((provider) =>
      provider.kind === 'wire' && provider.borrows !== undefined ? [[provider.borrows.provider, provider.id] as const] : [],
    ),
  );
  const wires = modelCatalog(providers.filter((provider): provider is WireProvider => provider.kind === 'wire'));
  const failures = new Map(
    loaded.flatMap(({ state, providers }) =>
      state.state === 'failed' ? providers.map((provider) => [provider.id, state.reason] as const) : [],
    ),
  );
  const packages = new Map(
    loaded.flatMap(({ state, providers: declared, directory }) =>
      state.state === 'disabled' || directory === undefined ? [] : declared.map((provider) => [provider.id, directory] as const),
    ),
  );
  const asks = askOffers(providers, borrowers, failures, packages);
  const first = wires.providers.find(
    (provider) => !failures.has(provider.id) && provider.models[provider.defaultTextModel]?.capabilities.includes('text'),
  );
  const adapters = loaded.map((adapter) => adapter.state);
  const instanced = new Set([...instances.values()].flatMap((held) => held.map((instance) => instance.id)));
  const sourceOf = (id: string) => accountSource(providers, sections, id);
  const plugins = new Map(loaded.flatMap(({ state, providers: declared }) => declared.map((provider) => [provider.id, state.id] as const)));
  const serve = servedOf(instanced, failures, sourceOf, asks, plugins);
  const harnessesWhere = (judged: (section: AccountSection, mode: string) => boolean) =>
    new Set(
      providers
        .filter(
          ({ kind, accountMode: mode }) =>
            kind === 'harness' && mode !== undefined && sections.some((section) => section.id === mode.section && judged(section, mode.id)),
        )
        .map(({ id }) => id),
    );
  const hidden = harnessesWhere((section, mode) => section.options.some((option) => option.id === mode && option.unavailable !== null));
  const outOfMode = harnessesWhere((section, mode) => section.selected !== mode);
  return {
    models: modelCatalog(providers),
    menu: modelCatalog(providers.filter(({ id }) => !hidden.has(id))),
    sections,
    asks,
    selectable: (id) => !hidden.has(id),
    inMode: (id) => !outOfMode.has(id),
    accountSource: sourceOf,
    borrower: (provider) => borrowers.get(provider),
    wires,
    harnesses: providers.filter((provider): provider is HarnessProvider => provider.kind === 'harness'),
    packages,
    adapters,
    settings: new Map(loaded.flatMap((adapter) => (adapter.settings === undefined ? [] : [[adapter.state.id, adapter.settings] as const]))),
    failures,
    defaultModel: first === undefined ? null : defaultModelOf(first),
    served: {
      sections,
      providers: providers.map((provider) => ({
        ...serve(provider),
        catalogState: snapshots.get(provider.id)?.state,
        selectable: !hidden.has(provider.id),
      })),
      adapters,
      settings: servedSettings(loaded, instances),
    },
  };
};

const loadAll = Effect.fn('providers.loadAll')(function* (
  sources: readonly AdapterSource[],
  hostOf: (adapter: string) => AdapterHost,
  standing: readonly Loaded[],
  previous: readonly Loaded[],
) {
  const taken = new Map<string, string>();
  for (const adapter of standing) {
    if (adapter.state.state !== 'disabled') for (const provider of adapter.providers) taken.set(provider.id, adapter.state.id);
  }
  const held = new Map(previous.map((adapter) => [`${adapter.state.origin}:${adapter.state.id}`, adapter]));
  for (const source of sources) {
    if (source.disabled === true) continue;
    const prior = held.get(`${source.origin}:${source.id}`);
    for (const provider of prior?.providers ?? []) {
      if (!taken.has(provider.id)) taken.set(provider.id, source.id);
    }
  }
  const loaded: Loaded[] = [];
  let sections = standing.reduce(
    (claims, adapter) =>
      adapter.state.state === 'disabled' ? claims : claimSections(claims, adapter.providers, `adapter ${adapter.state.id}`),
    new Map() as ReadonlyMap<string, SectionClaim>,
  );
  for (const source of sources) {
    const prior = held.get(`${source.origin}:${source.id}`);
    for (const provider of prior?.providers ?? []) {
      if (taken.get(provider.id) === source.id) taken.delete(provider.id);
    }
    const read = yield* load(source, hostOf(source.id), taken, sections);
    const adapter =
      read.state.state !== 'loaded' && prior !== undefined ? { ...read, providers: prior.providers, directory: prior.directory } : read;
    if (adapter.state.state !== 'disabled') {
      for (const provider of adapter.providers) taken.set(provider.id, source.id);
      sections = claimSections(sections, adapter.providers, `adapter ${source.id}`);
    }
    loaded.push(adapter);
  }
  return loaded;
});

export const registryLayer = Layer.effect(
  ProviderRegistry,
  Effect.gen(function* () {
    const sources = yield* AdapterSources;
    const places = yield* Effect.serviceOption(AdapterPlaces);
    const data = places._tag === 'Some' ? places.value.data : null;
    const disk = yield* Effect.serviceOption(FileSystem.FileSystem);
    const revisions = yield* Effect.serviceOption(PluginRevisions);
    const faults = yield* Effect.serviceOption(PluginFaults);
    const stored = yield* Effect.serviceOption(AdapterInstances);
    const files = yield* Effect.serviceOption(CredentialFiles);
    const cli = yield* Effect.serviceOption(AccountCli);
    const modes =
      files._tag === 'Some' && cli._tag === 'Some'
        ? makeAccountModes({ path: join(dirname(files.value.tokensPath), 'account-modes.json'), cli: cli.value })
        : null;
    let signed: SignedProviders | null = null;
    let previous: readonly Loaded[] = [];
    let previousInstances: ReadonlyMap<string, readonly SettingInstance[]> = new Map();
    const snapshots = new Map<string, CatalogSnapshot>();
    const sectionsOf = (loaded: readonly Loaded[]) => {
      const providers = loaded.flatMap((adapter) => (adapter.state.state === 'disabled' ? [] : adapter.providers));
      return modes === null ? modeSections(providers) : modes.resolve(providers, signed);
    };
    const snapshot =
      stored._tag === 'Some'
        ? Effect.orDie(stored.value.read())
        : Effect.succeed({ instances: new Map<string, readonly SettingInstance[]>(), secrets: {} });
    const loadVersion = Effect.fn('providers.loadVersion')(function* (directory: string) {
      const imported = yield* Effect.result(
        Effect.tryPromise({
          try: () => importProviders(directory, sources.host, process.execArgv),
          catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
        }),
      );
      if (Result.isFailure(imported)) {
        yield* Effect.logError('a held provider revision did not load', { directory, reason: imported.failure });
        return [];
      }
      const { id, version, models } = imported.success;
      const source: AdapterSource = { id, title: id, origin: 'plugin', version, directory, load: async () => models };
      return (yield* load(source, adapterHost(yield* snapshot, id), new Map(), new Map())).providers;
    });
    const faulted = (loaded: readonly Loaded[]): void => {
      if (faults._tag === 'None') return;
      for (const { state } of loaded) {
        if (state.state === 'failed')
          faults.value.put(state.id, PROVIDER_FAULTS.models, { title: 'Its model providers did not load.', detail: state.reason });
        else faults.value.clear(state.id, PROVIDER_FAULTS.models);
      }
    };
    const externals = Effect.gen(function* () {
      const { instances, secrets } = yield* snapshot;
      const hostOf = (adapter: string): AdapterHost => adapterHost({ instances, secrets }, adapter);
      const next = yield* loadAll(sources.current(), hostOf, [], previous);
      if (data !== null) {
        if (disk._tag === 'None') return yield* Effect.die('the harness index requires FileSystem');
        yield* indexHarnesses(data, next).pipe(Effect.provideService(FileSystem.FileSystem, disk.value), Effect.orDie);
      }
      faulted(next);
      const catalog = catalogOf(next, instances, yield* sectionsOf(next), snapshots);
      previousInstances = instances;
      previous = next;
      return catalog;
    });
    const state = yield* SubscriptionRef.make(yield* externals);
    const lock = yield* Semaphore.make(1);
    const runs = new Map<string, ProviderCatalog>();
    let current = yield* SubscriptionRef.get(state);
    const released = revisions._tag === 'Some' ? revisions.value.released : Effect.void;
    const publish = Effect.fnUntraced(function* (next: ProviderCatalog) {
      current = next;
      yield* SubscriptionRef.set(state, next);
      return next;
    });
    const reload = lock
      .withPermits(1)(Effect.flatMap(externals, publish))
      .pipe(Effect.tap(() => released));
    const resettled = Effect.gen(function* () {
      const sections = yield* sectionsOf(previous);
      return JSON.stringify(sections) === JSON.stringify(current.sections)
        ? current
        : yield* publish(catalogOf(previous, previousInstances, sections, snapshots));
    });
    const pinnedPackages = () => new Set([...new Set(runs.values())].flatMap((catalog) => [...catalog.packages.values()]));
    if (revisions._tag === 'Some')
      yield* revisions.value.register({ standing: () => new Set([...pinnedPackages(), ...current.packages.values()]) });
    let loadedFrom = sources.current();
    yield* Effect.forkScoped(
      Stream.runForEach(sources.changes, (next) => {
        if (next === loadedFrom) return Effect.void;
        loadedFrom = next;
        return Effect.asVoid(reload);
      }),
    );
    if (cli._tag === 'Some') yield* Effect.forkScoped(Stream.runForEach(cli.value.changes, () => lock.withPermits(1)(resettled)));
    return ProviderRegistry.of({
      catalog: Effect.sync(() => current),
      current: () => current,
      changes: SubscriptionRef.changes(state),
      registration: (provider) =>
        Effect.suspend(() =>
          current.models.registered(provider) ? Effect.succeed(current.models.named(provider)) : Effect.fail(notInstalled(provider)),
        ),
      callable: (provider) =>
        Effect.suspend((): Effect.Effect<Provider, ReturnType<typeof notInstalled> | GateRefusal<'provider-failed'>> => {
          if (!current.models.registered(provider)) return Effect.fail(notInstalled(provider));
          const failure = current.failures.get(provider);
          return failure === undefined
            ? Effect.succeed(current.models.named(provider))
            : Effect.fail(
                new GateRefusal('provider-failed', failure, [
                  'its plugin’s card on the Plugins screen names what broke: rebuild or update the plugin, or fix it with an agent',
                ]),
              );
        }),
      pinRun: (runId) => {
        if (!runs.has(runId)) runs.set(runId, current);
      },
      forRun: (runId) => runs.get(runId) ?? current,
      releaseRun: (runId) =>
        Effect.suspend(() => {
          const dropped = runs.get(runId);
          runs.delete(runId);
          if (dropped === undefined || dropped === current) return Effect.void;
          const held = new Set([...pinnedPackages(), ...current.packages.values()]);
          return [...dropped.packages.values()].some((directory) => !held.has(directory)) ? released : Effect.void;
        }),
      pinned: pinnedPackages,
      loadVersion,
      reload,
      selectMode: (section, mode) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            if (modes === null)
              return yield* new GateRefusal('mode-unavailable', 'Account mode settings have no machine store.', [
                'configure the credential files',
              ]);
            yield* modes.select((yield* resettled).sections, section, mode);
            const sections = current.sections.map((held) => (held.id === section ? { ...held, selected: mode } : held));
            return yield* publish(catalogOf(previous, previousInstances, sections, snapshots));
          }),
        ),
      recheck: lock.withPermits(1)(resettled),
      updateCatalog: (provider, snapshot) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            snapshots.set(provider, snapshot);
            yield* publish(catalogOf(previous, previousInstances, current.sections, snapshots));
          }),
        ),
      bindSignIns: (held) =>
        lock.withPermits(1)(
          Effect.suspend(() => {
            signed = held;
            return Effect.asVoid(resettled);
          }),
        ),
    });
  }),
);
