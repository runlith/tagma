import { type ModelSpecs, type ModelVendor, type ProviderDescription } from '@runlith/llm/models/description';

export const OPENCODE_GO_PROVIDER = 'opencode-go';

export const DEFAULT_OPENCODE_GO_MODEL = 'glm-5.3-flash';

const FULL_LADDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

const BUDGET_ONLY = ['none', 'high'] as const;

const NO_CONTROL = [] as const;

const OPENCODE_GO_SPECS = {
  [DEFAULT_OPENCODE_GO_MODEL]: {
    label: 'GLM-5.3 Flash',
    short: 'GLM Flash',
    capacity: { context: 1_000_000, output: 131_072 },
    capabilities: ['text', 'vision'],
    reasoning: FULL_LADDER,
    defaultReasoning: 'max',
  },
  'glm-5.3': {
    label: 'GLM-5.3',
    short: 'GLM',
    capacity: { context: 1_000_000, output: 131_072 },
    capabilities: ['text'],
    reasoning: FULL_LADDER,
    defaultReasoning: 'max',
  },
  'glm-5.2': {
    label: 'GLM-5.2',
    short: 'GLM 5.2',
    capacity: { context: 1_000_000, output: 131_072 },
    capabilities: ['text'],
    reasoning: NO_CONTROL,
    defaultReasoning: null,
  },
  'glm-5.1': {
    label: 'GLM-5.1',
    short: 'GLM 5.1',
    capacity: { context: 202_752, output: 32_768 },
    capabilities: ['text'],
    reasoning: NO_CONTROL,
    defaultReasoning: null,
  },
  'kimi-k3': {
    label: 'K3',
    capacity: { context: 1_048_576, output: 131_072 },
    capabilities: ['text', 'vision'],
    reasoning: FULL_LADDER,
    defaultReasoning: 'max',
  },
  'kimi-k2.7-code': {
    label: 'Kimi K2.7 Code',
    short: 'K2.7',
    capacity: { context: 262_144, output: 262_144 },
    capabilities: ['text', 'vision'],
    reasoning: NO_CONTROL,
    defaultReasoning: null,
  },
  'kimi-k2.6': {
    label: 'Kimi K2.6',
    short: 'K2.6',
    capacity: { context: 262_144, output: 65_536 },
    capabilities: ['text', 'vision'],
    reasoning: FULL_LADDER,
    defaultReasoning: 'high',
  },
  'longcat-2.0': {
    label: 'LongCat-2.0',
    short: 'LongCat',
    capacity: { context: 1_000_000, output: 131_072 },
    capabilities: ['text'],
    reasoning: NO_CONTROL,
    defaultReasoning: null,
  },
  'deepseek-v4.1-flash': {
    label: 'DeepSeek V4.1 Flash',
    short: 'DS Flash',
    capacity: { context: 1_000_000, output: 384_000 },
    capabilities: ['text', 'vision'],
    reasoning: FULL_LADDER,
    defaultReasoning: 'high',
  },
  'deepseek-v4-pro': {
    label: 'DeepSeek V4 Pro',
    capacity: { context: 1_000_000, output: 384_000 },
    capabilities: ['text'],
    reasoning: FULL_LADDER,
    defaultReasoning: 'high',
  },
  'mimo-v2.5': {
    label: 'MiMo-V2.5',
    short: 'MiMo',
    capacity: { context: 1_000_000, output: 128_000 },
    capabilities: ['text', 'vision'],
    reasoning: FULL_LADDER,
    defaultReasoning: 'high',
  },
  'mimo-v2.5-pro': {
    label: 'MiMo-V2.5 Pro',
    short: 'MiMo Pro',
    capacity: { context: 1_048_576, output: 128_000 },
    capabilities: ['text'],
    reasoning: FULL_LADDER,
    defaultReasoning: 'high',
  },
  hy3: {
    label: 'Hy3',
    short: 'Hy3',
    capacity: { context: 256_000, output: 128_000 },
    capabilities: ['text'],
    reasoning: FULL_LADDER,
    defaultReasoning: 'high',
  },
  'hy4-preview': {
    label: 'Hy4 Preview',
    short: 'Hy4',
    capacity: { context: 1_024_000, output: 64_000 },
    capabilities: ['text'],
    reasoning: FULL_LADDER,
    defaultReasoning: 'high',
  },

  'gpt-5.6-luna': {
    label: 'GPT-5.6 Luna',
    short: 'Luna 5.6',
    capacity: { context: 1_050_000, output: 128_000 },
    capabilities: ['text', 'vision'],
    reasoning: FULL_LADDER,
    defaultReasoning: 'high',
  },
  'grok-4.6': {
    label: 'Grok 4.6',
    short: 'Grok',
    capacity: { context: 500_000, output: 500_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['low', 'medium', 'high', 'xhigh'],
    defaultReasoning: 'high',
  },
  'gemini-4-argon-contributor': {
    label: 'Gemini 4 Argon Contributor',
    short: 'Argon C',
    capacity: { context: 1_048_576, output: 65_536 },
    capabilities: ['text', 'vision'],
    reasoning: ['low', 'medium', 'high'],
    defaultReasoning: 'high',
  },
  'muse-spark-1.3-contributor': {
    label: 'Spark 1.3 Contributor',
    short: 'Spark C',
    capacity: { context: 1_048_576, output: 131_072 },
    capabilities: ['text', 'vision'],
    reasoning: FULL_LADDER,
    defaultReasoning: 'high',
  },
  'muse-spark-1.2-contributor': {
    label: 'Spark 1.2 Contributor',
    short: 'Spark C',
    capacity: { context: 1_048_576, output: 131_072 },
    capabilities: ['text', 'vision'],
    reasoning: FULL_LADDER,
    defaultReasoning: 'high',
  },

  'minimax-m3': {
    label: 'MiniMax M3',
    short: 'M3',
    capacity: { context: 1_000_000, output: 131_072 },
    capabilities: ['text', 'vision'],
    reasoning: BUDGET_ONLY,
    defaultReasoning: 'high',
  },
  'minimax-m2.7': {
    label: 'MiniMax M2.7',
    short: 'M2.7',
    capacity: { context: 204_800, output: 131_072 },
    capabilities: ['text'],
    reasoning: NO_CONTROL,
    defaultReasoning: null,
  },
  'qwen3.8-max': {
    label: 'Qwen3.8 Max',
    short: 'Qwen Max',
    capacity: { context: 1_000_000, output: 131_072 },
    capabilities: ['text', 'vision'],
    reasoning: BUDGET_ONLY,
    defaultReasoning: 'high',
  },
  'qwen3.8-flash': {
    label: 'Qwen3.8 Flash',
    short: 'Qwen Flash',
    capacity: { context: 1_000_000, output: 131_072 },
    capabilities: ['text', 'vision'],
    reasoning: BUDGET_ONLY,
    defaultReasoning: 'high',
  },
  'qwen3.7-plus': {
    label: 'Qwen3.7 Plus',
    short: 'Qwen Plus',
    capacity: { context: 1_000_000, output: 65_536 },
    capabilities: ['text', 'vision'],
    reasoning: BUDGET_ONLY,
    defaultReasoning: 'high',
  },
  'qwen3.7-max': {
    label: 'Qwen3.7 Max',
    short: 'Qwen 3.7',
    capacity: { context: 1_000_000, output: 65_536 },
    capabilities: ['text'],
    reasoning: BUDGET_ONLY,
    defaultReasoning: 'high',
  },
  'qwen3.6-plus': {
    label: 'Qwen3.6 Plus',
    short: 'Qwen 3.6',
    capacity: { context: 1_000_000, output: 65_536 },
    capabilities: ['text', 'vision'],
    reasoning: BUDGET_ONLY,
    defaultReasoning: 'high',
  },
  'union-alpha': {
    label: 'Union Alpha',
    short: 'Union',
    capacity: { context: 262_144, output: 131_072 },
    capabilities: ['text', 'vision'],
    reasoning: NO_CONTROL,
    defaultReasoning: null,
  },
} satisfies ModelSpecs;

export const opencodeGoDescription: ProviderDescription = {
  id: OPENCODE_GO_PROVIDER,
  label: 'OpenCode Go',
  auth: 'api-key',
  keyScope: 'workspace',
  models: OPENCODE_GO_SPECS,
  cacheLifetime: { promisedSeconds: null, prior: null },
  defaultTextModel: DEFAULT_OPENCODE_GO_MODEL,
};

export const opencodeGoVendor = { providers: [opencodeGoDescription] } as const satisfies ModelVendor;
