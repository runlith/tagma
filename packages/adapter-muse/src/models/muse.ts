import { type ModelSpecs, type ModelVendor, type ProviderDescription, servedModels } from '@runlith/llm/models/description';

export const MUSE_PROVIDER = 'muse';

export const MUSE_API_BASE_URL = 'https://api.meta.ai/v1';

export const DEFAULT_MUSE_MODEL = 'muse-spark-1.3';

export const MUSE_SPECS = {
  'muse-wonder-full-1.0': {
    label: 'Muse Wonder Full 1.0',
    short: 'Wonder Full',
    toolChoice: ['auto'],
    capacity: { context: 1_007_997, output: 128_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'high',
  },
  'muse-wonder-full-1.0-contributor': {
    label: 'Muse Wonder Full 1.0 Contributor',
    short: 'Wonder Full C',
    toolChoice: ['auto'],
    capacity: { context: 1_007_997, output: 128_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'high',
  },
  'muse-wonder-1.0': {
    label: 'Muse Wonder 1.0',
    short: 'Wonder',
    toolChoice: ['auto'],
    capacity: { context: 1_007_997, output: 128_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'high',
  },
  'muse-wonder-1.0-contributor': {
    label: 'Muse Wonder 1.0 Contributor',
    short: 'Wonder C',
    toolChoice: ['auto'],
    capacity: { context: 1_007_997, output: 128_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'high',
  },
  [DEFAULT_MUSE_MODEL]: {
    label: 'Muse Spark 1.3',
    short: 'Spark',
    toolChoice: ['auto'],
    capacity: { context: 1_007_997, output: 128_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'high',
  },
  'muse-spark-1.3-contributor': {
    label: 'Muse Spark 1.3 Contributor',
    short: 'Spark C',
    toolChoice: ['auto'],
    capacity: { context: 1_007_997, output: 128_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'high',
  },
  'muse-spark-1.2-contributor': {
    label: 'Muse Spark 1.2 Contributor',
    short: 'Spark C',
    toolChoice: ['auto'],
    capacity: { context: 1_007_997, output: 128_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    defaultReasoning: 'high',
  },
  'muse-spark-1.2': {
    label: 'Muse Spark 1.2',
    short: 'Spark',
    toolChoice: ['auto'],
    capacity: { context: 1_007_997, output: 128_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    defaultReasoning: 'high',
  },
} satisfies ModelSpecs;

export const museConsoleDescription: ProviderDescription = {
  id: MUSE_PROVIDER,
  label: 'Muse',
  auth: 'api-key',
  keyScope: 'identity',
  models: servedModels(MUSE_SPECS, {
    ids: ['muse-spark-1.3', 'muse-spark-1.3-contributor', 'muse-wonder-1.0', 'muse-spark-1.2-contributor', 'muse-spark-1.2'],
  }),
  cacheLifetime: { promisedSeconds: null, prior: null },
  defaultTextModel: 'muse-spark-1.3',
  lightTextModel: { model: 'muse-spark-1.3-contributor', rung: 'minimal' },
};

export const museVendor = { providers: [museConsoleDescription] } as const satisfies ModelVendor;
