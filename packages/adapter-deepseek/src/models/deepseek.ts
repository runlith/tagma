import { type ModelSpecs, type ModelVendor, type ProviderDescription } from '@runlith/llm/models/description';

export const DEEPSEEK_PROVIDER = 'deepseek';

export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-pro';

const DEEPSEEK_SPECS = {
  [DEFAULT_DEEPSEEK_MODEL]: {
    label: 'DeepSeek V4 Pro',
    capacity: { context: 1_000_000, output: 384_000 },
    capabilities: ['text'],
    reasoning: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'high',
  },
  'deepseek-v4-flash': {
    label: 'DeepSeek V4 Flash',
    capacity: { context: 1_000_000, output: 384_000 },
    capabilities: ['text'],
    reasoning: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'high',
  },
} satisfies ModelSpecs;

export const deepseekDescription: ProviderDescription = {
  id: DEEPSEEK_PROVIDER,
  label: 'DeepSeek',
  auth: 'api-key',
  models: DEEPSEEK_SPECS,
  cacheLifetime: { promisedSeconds: null, prior: null },
  defaultTextModel: DEFAULT_DEEPSEEK_MODEL,
};

export const deepseekVendor = { providers: [deepseekDescription] } as const satisfies ModelVendor;
