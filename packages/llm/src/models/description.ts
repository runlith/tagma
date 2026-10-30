import type { ToolChoiceMode } from '../llm/schema/options';
import type { ModelCacheLifetime } from './cacheLifetime';

export type ModelCapacity = {
  readonly context: number;
  readonly input?: number;
  readonly output?: number;
};

export const MODEL_CAPABILITIES = ['text', 'vision', 'decision'] as const;
export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

export const ASK_KINDS = ['text', 'object', 'decision'] as const;
export type AskKind = (typeof ASK_KINDS)[number];

export type ModelSwitch = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly values: readonly { readonly id: string; readonly label: string }[];
  readonly default: string | null;
  readonly icon?: string;
};

export const SPEED_SWITCH_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>';

export type ModelSwitches = Readonly<Record<string, string>>;

export function keptSwitches(declared: readonly ModelSwitch[], stored: ModelSwitches): ModelSwitches {
  const kept: Record<string, string> = {};
  for (const one of declared) {
    const value = stored[one.id];
    if (value !== undefined && one.values.some((option) => option.id === value)) kept[one.id] = value;
  }
  return kept;
}

export function chosenSwitches(declared: readonly ModelSwitch[], chosen: ModelSwitches | undefined): ModelSwitches {
  const values: Record<string, string> = {};
  for (const one of declared) {
    const value = chosen?.[one.id];
    const kept = value !== undefined && one.values.some((option) => option.id === value) ? value : one.default;
    if (kept !== null) values[one.id] = kept;
  }
  return values;
}

export type ModelSpec = {
  label: string;
  short?: string;
  capacity?: ModelCapacity;
  capabilities: readonly ModelCapability[];
  toolChoice?: readonly ToolChoiceMode[];
  reasoning: readonly string[];
  defaultReasoning: string | null;
  switches?: readonly ModelSwitch[];
  compactionTrigger?: ModelCompactionTrigger;
  servedAs?: string;
  aliases?: readonly string[];
  supportsAdaptiveThinking?: boolean;
  operatorOnly?: true;
};

export type ModelCompactionTrigger = { readonly strategy: 'percent'; readonly trigger: number } | { readonly strategy: 'reserve-output' };

export type ModelSpecs = Readonly<Record<string, ModelSpec>>;

export const DEFAULT_COMPACTION_TRIGGER: Extract<ModelCompactionTrigger, { strategy: 'percent' }> = {
  strategy: 'percent',
  trigger: 0.9,
};

export type ProviderRequestLimits = {
  readonly bytes: number;
  readonly media: number;
};

export const TEAM_WORK = ['design', 'implementation', 'fix', 'review', 'research', 'ui', 'tests', 'docs'] as const;
export type TeamWork = (typeof TEAM_WORK)[number];

export type TeamRating = {
  readonly model: string;
  readonly reasoning: string | null;
  readonly open: number;
  readonly depth: number;
  readonly taste: number;
  readonly ui: number;
  readonly spend: number;
  readonly only?: readonly TeamWork[];
  readonly not?: readonly TeamWork[];
  readonly note?: string;
  readonly operatorOnly?: true;
};

export type ImageModelSpec = {
  readonly label: string;
  readonly inputs: number;
  readonly inputTypes: readonly string[];
  readonly transparent: boolean;
};

export type ImageModelSpecs = Readonly<Record<string, ImageModelSpec>>;

export type ProviderDescription = {
  readonly id: string;
  readonly label: string;
  readonly auth: 'api-key' | 'oauth' | 'cli';
  readonly keyScope?: 'identity' | 'workspace';
  readonly models: ModelSpecs;
  readonly imageModels?: ImageModelSpecs;
  readonly cacheLifetime: ModelCacheLifetime;
  readonly requestLimits?: ProviderRequestLimits;
  readonly defaultTextModel: string;
  readonly dynamicCatalog?: true;
  readonly textless?: true;
  readonly spawnTextModel?: string;
  readonly lightTextModel?: ModelSelection;
  readonly spell?: (selection: ModelSelection) => string;
  readonly team?: readonly TeamRating[];
};

export type ModelVendor = {
  readonly providers: readonly ProviderDescription[];
};

const AUTH_ORDER: Readonly<Record<ProviderDescription['auth'], number>> = { oauth: 0, cli: 0, 'api-key': 1 };

export function pickerOrder<R extends Pick<ProviderDescription, 'auth'>>(groups: readonly (readonly R[])[]): readonly R[] {
  return groups.flat().sort((left, right) => AUTH_ORDER[left.auth] - AUTH_ORDER[right.auth]);
}

export type ModelSelection = {
  readonly model: string;
  readonly rung: string | null;
  readonly switches?: ModelSwitches;
};

export function servedModels(
  specs: ModelSpecs,
  transport: { ids: readonly string[]; overrides?: Readonly<Record<string, Partial<ModelSpec>>> },
): ModelSpecs {
  return Object.fromEntries(
    transport.ids.map((id) => {
      const spec = specs[id];
      if (!spec) throw new Error(`Model "${id}" is served but described nowhere.`);
      return [id, { ...spec, ...transport.overrides?.[id] }];
    }),
  );
}

export function modelContextWindow(capacity: ModelCapacity | undefined): number | undefined {
  return capacity?.context;
}

export function modelInputLimit(capacity: ModelCapacity | undefined): number | undefined {
  return capacity?.input;
}

export function modelContextFraction(tokens: number, capacity: ModelCapacity | undefined): number | undefined {
  const window = modelContextWindow(capacity);
  return window === undefined || window <= 0 ? undefined : tokens / window;
}
