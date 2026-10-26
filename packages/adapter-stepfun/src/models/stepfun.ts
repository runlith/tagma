import { type ModelSpecs, type ModelVendor, type ProviderDescription } from '@runlith/llm/models/description';

export const STEPFUN_PROVIDER = 'stepfun';

export const DEFAULT_STEPFUN_MODEL = 'step-3.7-flash';

const TOOL_CHOICE = ['auto'] as const;

const THREE_RUNGS = ['low', 'medium', 'high'] as const;

const NO_CONTROL = [] as const;

const STEPFUN_SPECS = {
  [DEFAULT_STEPFUN_MODEL]: {
    label: 'Step 3.7 Flash',
    short: 'Step 3.7',
    toolChoice: TOOL_CHOICE,
    capacity: { context: 262_144 },
    capabilities: ['text', 'vision'],
    reasoning: THREE_RUNGS,
    defaultReasoning: 'high',
  },
  'step-5-preview': {
    label: 'Step 5 Preview',
    short: 'Step 5',
    toolChoice: TOOL_CHOICE,
    capacity: { context: 1_024_000, output: 64_000 },
    capabilities: ['text', 'vision'],
    reasoning: THREE_RUNGS,
    defaultReasoning: 'high',
  },
  'step-3.5-flash-2603': {
    label: 'Step 3.5 Flash 2603',
    short: 'Step 2603',
    toolChoice: TOOL_CHOICE,
    capacity: { context: 262_144 },
    capabilities: ['text'],
    reasoning: THREE_RUNGS,
    defaultReasoning: 'high',
  },
  'step-3.5-flash': {
    label: 'Step 3.5 Flash',
    short: 'Step 3.5',
    toolChoice: TOOL_CHOICE,
    capacity: { context: 262_144 },
    capabilities: ['text'],
    reasoning: NO_CONTROL,
    defaultReasoning: null,
  },
} satisfies ModelSpecs;

export const stepfunDescription: ProviderDescription = {
  id: STEPFUN_PROVIDER,
  label: 'StepFun',
  auth: 'api-key',
  keyScope: 'identity',
  models: STEPFUN_SPECS,
  cacheLifetime: { promisedSeconds: null, prior: null },
  defaultTextModel: DEFAULT_STEPFUN_MODEL,
};

export const stepfunVendor = { providers: [stepfunDescription] } as const satisfies ModelVendor;
