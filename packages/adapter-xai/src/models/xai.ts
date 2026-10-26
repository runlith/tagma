import { type ModelSpecs, type ModelVendor, type ProviderDescription } from '@runlith/llm/models/description';

export const XAI_PROVIDER = 'xai';

export const DEFAULT_XAI_MODEL = 'grok-4.7';

export const XAI_SPECS = {
  [DEFAULT_XAI_MODEL]: {
    label: 'Grok 4.7',
    short: 'Grok',
    capacity: { context: 500_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['low', 'medium', 'high', 'xhigh'],
    defaultReasoning: 'high',
  },
  'grok-4.6': {
    label: 'Grok 4.6',
    short: 'Grok',
    capacity: { context: 500_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['low', 'medium', 'high', 'xhigh'],
    defaultReasoning: 'high',
  },
  'grok-4.5': {
    label: 'Grok 4.5',
    short: 'Grok',
    capacity: { context: 500_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['none', 'low', 'medium', 'high'],
    defaultReasoning: 'high',
  },
  'grok-composer-2.5-fast': {
    label: 'Composer 2.5',
    short: 'Composer',
    capacity: { context: 200_000 },
    capabilities: ['text', 'vision'],
    reasoning: [],
    defaultReasoning: null,
  },
  'grok-4.3': {
    label: 'Grok 4.3',
    short: 'Grok',
    capacity: { context: 1_000_000, output: 30_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['none', 'low', 'medium', 'high'],
    defaultReasoning: 'high',
  },
  'grok-4.20-0309-reasoning': {
    label: 'Grok 4.20 Reasoning',
    short: 'Grok R',
    capacity: { context: 2_000_000, output: 30_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['none', 'low', 'medium', 'high'],
    defaultReasoning: 'high',
  },
  'grok-4.20-0309-non-reasoning': {
    label: 'Grok 4.20 Non-Reasoning',
    short: 'Grok NR',
    capacity: { context: 2_000_000, output: 30_000 },
    capabilities: ['text', 'vision'],
    reasoning: [],
    defaultReasoning: null,
  },
} satisfies ModelSpecs;

export const xaiConsoleDescription: ProviderDescription = {
  id: XAI_PROVIDER,
  label: 'xAI',
  auth: 'api-key',
  models: XAI_SPECS,
  cacheLifetime: { promisedSeconds: null, prior: null },
  defaultTextModel: DEFAULT_XAI_MODEL,
};

export const xaiVendor = { providers: [xaiConsoleDescription] } as const satisfies ModelVendor;
