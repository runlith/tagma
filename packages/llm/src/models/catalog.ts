import type { ModelCacheLifetime } from './cacheLifetime';
import {
  type ModelCapability,
  type ModelCapacity,
  type ModelCompactionTrigger,
  type ModelSwitch,
  type ProviderDescription,
  type ProviderRequestLimits,
} from './description';
import type { ToolChoiceMode } from '../llm/schema/options';
import { ReasoningEfforts } from '../llm/schema/ids';

const OPERATOR_ONLY_REASONING: ReadonlySet<string> = new Set(['max']);

export type ReasoningOption = {
  id: string;
  label: string;
  short: string;
};

export type ModelProviderOption = {
  id: string;
  label: string;
};

export type ModelOption = {
  id: string;
  key: string;
  label: string;
  short: string;
  provider: string;
  providerLabel: string;
  capacity?: ModelCapacity;
  cacheLifetime: ModelCacheLifetime;
  requestLimits?: ProviderRequestLimits;
  capabilities: readonly ModelCapability[];
  toolChoice?: readonly ToolChoiceMode[];
  reasoningOptions: readonly ReasoningOption[];
  defaultReasoning: string | null;
  switches: readonly ModelSwitch[];
  supportsAdaptiveThinking: boolean;
  operatorOnly: boolean;
  compactionTrigger?: ModelCompactionTrigger;
};

export type ModelCatalog<R extends ProviderDescription = ProviderDescription> = {
  readonly providers: readonly R[];
  readonly providerOptions: readonly ModelProviderOption[];
  readonly options: readonly ModelOption[];
  registered(provider: string): boolean;
  named(provider: string): R;
  oauth(provider: string): boolean;
  providerLabel(provider: string): string;
  modelsOf(provider: string): readonly ModelOption[];
  modelsFor(provider: string | null | undefined, capability: ModelCapability): readonly ModelOption[];
  modelsByCapability(capability: ModelCapability): readonly ModelOption[];
  defaultTextModelId(provider: string): string;
  findTextModel(provider: string, modelId: string | null | undefined): ModelOption | undefined;
  resolveTextModel(provider: string, modelId: string | null | undefined): ModelOption;
  spawnInherits(provider: string, modelId: string): ModelOption;
  spawnReasoning(option: ModelOption, rung: string | null | undefined, named: boolean): string | null;
  textModelCapacity(provider: string, modelId: string | null | undefined): ModelCapacity;
  namedSelection(provider: string, model: string): { provider: string; model: string };
  supportsAdaptiveThinking(provider: string, modelId: string | null | undefined): boolean;
  textModelIds(): [string, ...string[]];
  reasoningLevelIds(): [string, ...string[]];
};

export function descriptionFault(provider: ProviderDescription): string | null {
  const operatorOnly = Object.entries(provider.models).filter(
    ([, spec]) => spec.operatorOnly === true && spec.capabilities.includes('text'),
  );
  if (operatorOnly.length > 0) {
    const spawnTextModel = provider.spawnTextModel;
    if (!spawnTextModel) return `Provider "${provider.id}" has operator-only text model "${operatorOnly[0]?.[0]}" but no spawnTextModel.`;
    const inherited = provider.models[spawnTextModel];
    if (!inherited?.capabilities.includes('text')) {
      return `Provider "${provider.id}" spawnTextModel "${spawnTextModel}" is absent or not a text model.`;
    }
    if (inherited.operatorOnly) return `Provider "${provider.id}" spawnTextModel "${spawnTextModel}" is operator-only.`;
  }
  const light = provider.lightTextModel;
  if (light !== undefined) {
    const spec = provider.models[light.model];
    if (!spec?.capabilities.includes('text') || spec.operatorOnly) {
      return `Provider "${provider.id}" lightTextModel "${light.model}" is absent, not a text model or operator-only.`;
    }
    if (light.rung === null ? spec.reasoning.length > 0 : !spec.reasoning.includes(light.rung)) {
      return `Provider "${provider.id}" lightTextModel "${light.model}" offers no rung ${light.rung ?? 'none'}.`;
    }
  }
  const uncounted = Object.entries(provider.models).find(([, spec]) => spec.capabilities.includes('text') && !spec.capacity);
  if (uncounted !== undefined) return `Text model capacity is required for ${provider.id}/${uncounted[0]}.`;
  if (provider.defaultTextModel === '' && !Object.values(provider.models).some((spec) => spec.capabilities.includes('text'))) return null;
  if (!provider.models[provider.defaultTextModel]?.capabilities.includes('text')) {
    return `Provider "${provider.id}" defaultTextModel "${provider.defaultTextModel}" is absent or not a text model.`;
  }
  return null;
}

export function modelCatalog<R extends ProviderDescription>(providers: readonly R[]): ModelCatalog<R> {
  const byId = new Map<string, R>();
  for (const provider of providers) {
    if (byId.has(provider.id)) throw new Error(`Provider "${provider.id}" is registered twice.`);
    const fault = descriptionFault(provider);
    if (fault !== null) throw new Error(fault);
    byId.set(provider.id, provider);
  }
  const options: readonly ModelOption[] = providers.flatMap((provider) =>
    Object.entries(provider.models).map(([id, spec]) => {
      return {
        id,
        key: `${provider.id}:${id}`,
        label: spec.label,
        short: spec.short ?? spec.label,
        provider: provider.id,
        providerLabel: provider.label,
        capacity: spec.capacity,
        cacheLifetime: provider.cacheLifetime,
        requestLimits: provider.requestLimits,
        capabilities: spec.capabilities,
        toolChoice: spec.toolChoice,
        reasoningOptions: spec.reasoning.map((rung) => ({
          id: rung,
          label: reasoningLabel(rung),
          short: reasoningShortLabel(rung),
        })),
        defaultReasoning: spec.defaultReasoning,
        switches: spec.switches ?? [],
        supportsAdaptiveThinking: spec.supportsAdaptiveThinking ?? false,
        operatorOnly: spec.operatorOnly ?? false,
        compactionTrigger: spec.compactionTrigger,
      };
    }),
  );
  const named = (provider: string): R => {
    const registration = byId.get(provider);
    if (!registration) {
      throw new Error(`Unknown model provider "${provider}" — this catalog registers: ${providers.map((entry) => entry.id).join(', ')}.`);
    }
    return registration;
  };
  const modelsByCapability = (capability: ModelCapability) => options.filter((model) => model.capabilities.includes(capability));
  const modelsFor = (provider: string | null | undefined, capability: ModelCapability) =>
    modelsByCapability(capability).filter((model) => model.provider === provider);
  const findTextModel = (provider: string, modelId: string | null | undefined): ModelOption | undefined => {
    const registration = byId.get(provider);
    if (registration === undefined) return undefined;
    const id = modelId ?? registration.defaultTextModel;
    const available = modelsFor(registration.id, 'text');
    return available.find((entry) => entry.id === id) ?? available.find((entry) => registration.models[entry.id]?.aliases?.includes(id));
  };
  const resolveTextModel = (provider: string, modelId: string | null | undefined): ModelOption => {
    const selected = findTextModel(provider, modelId);
    if (!selected?.capacity) {
      const registration = named(provider);
      throw new Error(`Text model capacity is not configured for ${provider}/${modelId ?? registration.defaultTextModel}.`);
    }
    return selected;
  };
  const spawnInherits = (provider: string, modelId: string): ModelOption => {
    const selected = resolveTextModel(provider, modelId);
    return selected.operatorOnly ? resolveTextModel(provider, named(provider).spawnTextModel) : selected;
  };
  const spawnReasoning = (option: ModelOption, rung: string | null | undefined, named: boolean): string | null => {
    const resolved = reasoningForModel(rung, option);
    if (!resolved) return null;
    if (!OPERATOR_ONLY_REASONING.has(resolved) || (named && !option.operatorOnly)) return resolved;
    return option.reasoningOptions.filter((candidate) => !OPERATOR_ONLY_REASONING.has(candidate.id)).at(-1)?.id ?? null;
  };
  return {
    providers,
    providerOptions: providers.map((provider) => ({ id: provider.id, label: provider.label })),
    options,
    registered: (provider) => byId.has(provider),
    named,
    oauth: (provider) => named(provider).auth === 'oauth',
    providerLabel: (provider) => byId.get(provider)?.label ?? provider,
    modelsOf: (provider) => options.filter((model) => model.provider === provider),
    modelsFor,
    modelsByCapability,
    defaultTextModelId: (provider) => named(provider).defaultTextModel,
    findTextModel,
    resolveTextModel,
    spawnInherits,
    spawnReasoning,
    textModelCapacity: (provider, modelId) => {
      const selected = resolveTextModel(provider, modelId);
      if (!selected.capacity) throw new Error(`Text model capacity is not configured for ${selected.key}.`);
      return selected.capacity;
    },
    namedSelection: (provider, model) => {
      return { provider, model: resolveTextModel(provider, model).id };
    },
    supportsAdaptiveThinking: (provider, modelId) => resolveTextModel(provider, modelId).supportsAdaptiveThinking,
    textModelIds: () => {
      const ids = [...new Set(modelsByCapability('text').map((model) => model.id))];
      if (ids.length === 0) throw new Error('Model catalog has no text models.');
      return ids as [string, ...string[]];
    },
    reasoningLevelIds: () => {
      const ids = [...new Set(options.flatMap((model) => model.reasoningOptions.map((option) => option.id)))];
      if (ids.length === 0) throw new Error('Model catalog has no reasoning levels.');
      return ids as [string, ...string[]];
    },
  };
}

type MenuSwitch = Omit<ModelSwitch, 'icon'>;

export type MenuModel = {
  readonly id: string;
  readonly reasoning: readonly string[];
  readonly operatorOnly: boolean;
  readonly lowered: readonly { readonly rung: string; readonly to: string | null }[];
  readonly switches: readonly MenuSwitch[];
};

export type MenuProvider = { readonly id: string; readonly models: readonly MenuModel[] };

export function textMenu(offered: ModelCatalog): readonly MenuProvider[] {
  return [...Map.groupBy(offered.modelsByCapability('text'), (option) => option.provider)].map(([id, options]) => ({
    id,
    models: options.map((option) => ({
      id: option.id,
      reasoning: option.reasoningOptions.map((rung) => rung.id),
      operatorOnly: option.operatorOnly,
      lowered: option.operatorOnly
        ? option.reasoningOptions
            .filter((rung) => OPERATOR_ONLY_REASONING.has(rung.id))
            .map((rung) => ({ rung: rung.id, to: offered.spawnReasoning(option, rung.id, true) }))
        : [],
      switches: option.switches.map((declared) => ({
        id: declared.id,
        label: declared.label,
        description: declared.description,
        values: declared.values,
        default: declared.default,
      })),
    })),
  }));
}

export function reasoningForModel(preferred: string | null | undefined, model: ModelOption | null | undefined): string {
  if (!model || model.reasoningOptions.length === 0) return '';
  if (preferred && model.reasoningOptions.some((option) => option.id === preferred)) return preferred;
  if (model.defaultReasoning && model.reasoningOptions.some((option) => option.id === model.defaultReasoning)) {
    return model.defaultReasoning;
  }
  return model.reasoningOptions.find((option) => option.id === 'high')?.id ?? model.reasoningOptions[0]?.id ?? '';
}

export function lowestReasoning(model: ModelOption): string | null {
  const rank = (id: string) => {
    const at = ReasoningEfforts.indexOf(id as (typeof ReasoningEfforts)[number]);
    return at === -1 ? ReasoningEfforts.length : at;
  };
  return model.reasoningOptions.toSorted((left, right) => rank(left.id) - rank(right.id))[0]?.id ?? null;
}

function reasoningLabel(id: string): string {
  switch (id) {
    case 'none':
      return 'None';
    case 'minimal':
      return 'Minimal';
    case 'low':
      return 'Low';
    case 'medium':
      return 'Medium';
    case 'high':
      return 'High';
    case 'xhigh':
      return 'XHigh';
    case 'max':
      return 'Max';
    default:
      return id;
  }
}

function reasoningShortLabel(id: string): string {
  switch (id) {
    case 'none':
      return 'None';
    case 'minimal':
      return 'Min';
    case 'low':
      return 'Low';
    case 'medium':
      return 'Med';
    case 'high':
      return 'High';
    case 'xhigh':
      return 'XH';
    case 'max':
      return 'Max';
    default:
      return id;
  }
}
