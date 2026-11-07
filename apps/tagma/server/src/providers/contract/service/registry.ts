import type { ModelCatalog, ModelOption } from '@runlith/llm/models/catalog';
import type { AskKind } from '@runlith/llm/models/description';
import type { Adapter, AdapterSettings, AskProgram, HarnessProvider, Provider, WireProvider } from '@runlith/tagma/adapter/provider';
import type { HostModules } from '@runlith/tagma/adapter/loader';
import { Context, Effect, type Stream } from 'effect';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { AdapterOrigin, AdapterState, ServedCatalog, AccountSection, CatalogSnapshot } from '../wire/catalog.js';
import type { CredentialFileFault } from '@runlith/credential-file/failure';
import type { TokenStoreFault } from '@runlith/llm/oauth/storeFailure';

export type DefaultModel = { readonly provider: string; readonly model: string; readonly reasoning: string | null };

export const defaultModelOf = (provider: Provider): DefaultModel => ({
  provider: provider.id,
  model: provider.defaultTextModel,
  reasoning: provider.models[provider.defaultTextModel]?.defaultReasoning ?? null,
});

export type SignedProviders = Effect.Effect<readonly string[], TokenStoreFault>;

export type AskRoute =
  | { readonly path: 'request'; readonly provider: string }
  | { readonly path: 'program'; readonly provider: string; readonly program: AskProgram; readonly package: string | null };

export type AskOffers = {
  route(provider: string, model: string): AskRoute | null;
  kinds(provider: string, model: string): readonly AskKind[];
  answers(provider: string, model: string, kind: AskKind): boolean;
};

export type ProviderCatalog = {
  readonly models: ModelCatalog<Provider>;
  readonly menu: ModelCatalog<Provider>;
  readonly wires: ModelCatalog<WireProvider>;
  readonly harnesses: readonly HarnessProvider[];
  readonly packages: ReadonlyMap<string, string>;
  readonly adapters: readonly AdapterState[];
  readonly settings: ReadonlyMap<string, AdapterSettings>;
  readonly failures: ReadonlyMap<string, string>;
  readonly defaultModel: DefaultModel | null;
  readonly served: ServedCatalog;
  readonly sections: readonly AccountSection[];
  readonly asks: AskOffers;
  selectable(provider: string): boolean;
  inMode(provider: string): boolean;
  accountSource(provider: string): string;
  borrower(provider: string): string | undefined;
};

export type NotInstalled = GateRefusal<'provider-not-installed'>;

export const notInstalled = (provider: string): NotInstalled =>
  new GateRefusal('provider-not-installed', `No plugin on this machine provides "${provider}".`, [
    `install_plugin the plugin that provides ${provider}, or turn it on again on this machine; the Plugins screen lists what stands`,
  ]);

export function servedTextModel(
  models: ModelCatalog,
  provider: string,
  model: string | null | undefined,
): Effect.Effect<ModelOption, NotInstalled | GateRefusal<'unknown-model'>> {
  if (!models.registered(provider)) return Effect.fail(notInstalled(provider));
  const id = model ?? models.defaultTextModelId(provider);
  const served = models.modelsFor(provider, 'text');
  const option =
    served.find((candidate) => candidate.id === id) ??
    served.find((candidate) => models.named(provider).models[candidate.id]?.aliases?.includes(id));
  if (option !== undefined) return Effect.succeed(option);
  return Effect.fail(
    new GateRefusal('unknown-model', `"${id}" is not a text model ${models.providerLabel(provider)} serves.`, [
      `name one of: ${served.map((candidate) => candidate.id).join(', ')}`,
    ]),
  );
}

export class ProviderRegistry extends Context.Service<
  ProviderRegistry,
  {
    readonly catalog: Effect.Effect<ProviderCatalog>;
    current(): ProviderCatalog;
    readonly changes: Stream.Stream<ProviderCatalog>;
    registration(provider: string): Effect.Effect<Provider, NotInstalled>;
    callable(provider: string): Effect.Effect<Provider, NotInstalled | GateRefusal<'provider-failed'>>;
    pinRun(runId: string): void;
    forRun(runId: string): ProviderCatalog;
    releaseRun(runId: string): Effect.Effect<void>;
    pinned(): ReadonlySet<string>;
    loadVersion(directory: string): Effect.Effect<readonly Provider[]>;
    reload: Effect.Effect<ProviderCatalog>;
    selectMode(section: string, mode: string): Effect.Effect<ProviderCatalog, GateRefusal | CredentialFileFault>;
    readonly recheck: Effect.Effect<ProviderCatalog>;
    bindSignIns(signed: SignedProviders): Effect.Effect<void>;
    updateCatalog(provider: string, snapshot: CatalogSnapshot): Effect.Effect<void>;
  }
>()('tagma/providers/ProviderRegistry') {}

export type AdapterIdentity = {
  readonly id: string;
  readonly title: string;
  readonly origin: AdapterOrigin;
  readonly version: string | null;
};

export type AdapterSource = AdapterIdentity & {
  readonly load: () => Promise<Adapter | undefined>;
  readonly disabled?: true;
  readonly directory?: string;
};

export class AdapterSources extends Context.Service<
  AdapterSources,
  {
    current(): readonly AdapterSource[];
    readonly changes: Stream.Stream<readonly AdapterSource[]>;
    readonly host: HostModules;
  }
>()('tagma/providers/AdapterSources') {}

export class AdapterPlaces extends Context.Service<AdapterPlaces, { readonly data: string | null }>()('tagma/providers/AdapterPlaces') {}
