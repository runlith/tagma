import { modelCatalog } from '@runlith/llm/models/catalog';
import { pickerOrder } from '@runlith/llm/models/description';
import type { ProductIdentity } from '@runlith/llm/profiles/contract';
import type { AdapterHost, HarnessProvider, Provider, SettingInstance, WireProvider } from '@runlith/tagma/adapter/provider';
import { claimSections, type SectionClaim } from '@runlith/tagma/adapter/declaration';
import { Effect, Layer, Result, Semaphore, Stream, SubscriptionRef } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { PROGRAM_RELEASE } from '../platform/contract/wire/program.js';
import type { ServedProvider, ServedSettings, CatalogSnapshot } from './contract/wire/catalog.js';
import { AdapterInstances } from './contract/service/instances.js';
import {
  AdapterPlaces,
  type AdapterSource,
  BuiltinAdapters,
  defaultModelOf,
  notInstalled,
  type ProviderCatalog,
  ProviderRegistry,
  type SignedProviders,
} from './contract/service/registry.js';
import { machineSources, releaseSources } from './adapters/external.js';
import { failed, type Loaded, load } from './adapters/judge.js';
import { publicValues } from './adapters/settingValues.js';
import { dirname, join } from 'node:path';
import { accountSource, makeAccountModes, modeSections } from './accounts/modes.js';
import type { AccountSection } from './contract/wire/catalog.js';
import { CredentialFiles } from './contract/service/credentials.js';
import { AccountCli } from './contract/service/cli.js';

const product: ProductIdentity = { mcpServer: 'tagma', client: { name: 'tagma', version: PROGRAM_RELEASE } };

const servedOf =
  (instanced: ReadonlySet<string>, failures: ReadonlyMap<string, string>, sourceOf: (provider: string) => string) =>
  (provider: Provider): ServedProvider => ({
    id: provider.id,
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
    family: provider.family,
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
  const offered = pickerOrder(loaded.map((adapter) => (adapter.state.state === 'disabled' ? [] : adapter.providers))).map((provider) => {
    const snapshot = provider.catalog === undefined ? undefined : snapshots.get(provider.id);
    return snapshot === undefined ? provider : { ...provider, models: snapshot.models, defaultTextModel: snapshot.defaultTextModel };
  });
  const borrowers = new Map(
    offered.flatMap((provider) =>
      provider.kind === 'wire' && provider.borrows !== undefined ? [[provider.borrows.provider, provider.id]] : [],
    ),
  );
  const providers = offered.map((provider) =>
    provider.kind === 'harness' && borrowers.has(provider.id) ? { ...provider, family: borrowers.get(provider.id) } : provider,
  );
  const wires = modelCatalog(providers.filter((provider): provider is WireProvider => provider.kind === 'wire'));
  const failures = new Map(
    loaded.flatMap(({ state, providers }) =>
      state.state === 'failed' ? providers.map((provider) => [provider.id, state.reason] as const) : [],
    ),
  );
  const first = wires.providers.find(
    (provider) => !failures.has(provider.id) && provider.models[provider.defaultTextModel]?.capabilities.includes('text'),
  );
  const adapters = loaded.map((adapter) => adapter.state);
  const instanced = new Set([...instances.values()].flatMap((held) => held.map((instance) => instance.id)));
  const sourceOf = (id: string) => accountSource(providers, sections, id);
  const serve = servedOf(instanced, failures, sourceOf);
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
    selectable: (id) => !hidden.has(id),
    inMode: (id) => !outOfMode.has(id),
    accountSource: sourceOf,
    wires,
    harnesses: providers.filter((provider): provider is HarnessProvider => provider.kind === 'harness'),
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
    const adapter = read.state.state !== 'loaded' && prior !== undefined ? { ...read, providers: prior.providers } : read;
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
    const { sources } = yield* BuiltinAdapters;
    const places = yield* Effect.serviceOption(AdapterPlaces);
    const place = places._tag === 'Some' ? places.value : { machine: null, release: null, host: { shared: {}, developer: {} } };
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
    const externals = Effect.gen(function* () {
      const { instances, secrets } =
        stored._tag === 'Some'
          ? yield* Effect.orDie(stored.value.read())
          : { instances: new Map<string, readonly SettingInstance[]>(), secrets: {} };
      const hostOf = (adapter: string): AdapterHost => ({
        product,
        instances: (instances.get(adapter) ?? []).map((instance) => ({ ...instance, secrets: secrets[instance.id] ?? {} })),
      });
      const priorMachine = previous.filter((adapter) => adapter.state.origin === 'machine');
      const machine = yield* machineSources(place.machine, place.host, process.execArgv).pipe(
        Effect.map((installed) => ({ installed, unreadable: [] as readonly Loaded[] })),
        Effect.catchTag('RecordUnreadable', (failure) =>
          Effect.succeed({
            installed: [] as readonly AdapterSource[],
            unreadable:
              priorMachine.length === 0
                ? [failed({ id: failure.path, origin: 'machine', version: null }, failure.reason)]
                : priorMachine.map((adapter) =>
                    adapter.state.state === 'disabled'
                      ? adapter
                      : { ...failed(adapter.state, failure.reason), providers: adapter.providers },
                  ),
          }),
        ),
      );
      const { unreadable } = machine;
      const release = yield* releaseSources(place.release, place.host, process.execArgv);
      const loaded = yield* loadAll([...sources, ...release, ...machine.installed], hostOf, unreadable, previous);
      const next = [...loaded, ...unreadable];
      const catalog = catalogOf(next, instances, yield* sectionsOf(next), snapshots);
      previousInstances = instances;
      previous = next;
      return catalog;
    });
    const state = yield* SubscriptionRef.make(yield* externals);
    const lock = yield* Semaphore.make(1);
    const runs = new Map<string, ProviderCatalog>();
    let current = yield* SubscriptionRef.get(state);
    const publish = Effect.fnUntraced(function* (next: ProviderCatalog) {
      current = next;
      yield* SubscriptionRef.set(state, next);
      return next;
    });
    const reload = lock.withPermits(1)(Effect.flatMap(externals, publish));
    const resettled = Effect.gen(function* () {
      const sections = yield* sectionsOf(previous);
      return JSON.stringify(sections) === JSON.stringify(current.sections)
        ? current
        : yield* publish(catalogOf(previous, previousInstances, sections, snapshots));
    });
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
            : Effect.fail(new GateRefusal('provider-failed', failure, ['repair or update the adapter']));
        }),
      pinRun: (runId) => {
        if (!runs.has(runId)) runs.set(runId, current);
      },
      forRun: (runId) => runs.get(runId) ?? current,
      releaseRun: (runId) => Effect.sync(() => void runs.delete(runId)),
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
