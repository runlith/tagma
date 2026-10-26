import {
  type ModelSelection,
  type ModelSpecs,
  type ModelSwitch,
  type ModelVendor,
  type ProviderDescription,
  type ProviderRequestLimits,
  type TeamRating,
  servedModels,
} from '@runlith/llm/models/description';

export const ANTHROPIC_PROVIDER = 'anthropic';
export const CLAUDE_CODE_PROVIDER = 'claude-code';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

export const ANTHROPIC_LIGHT_MODEL: ModelSelection = { model: 'claude-haiku-4-5', rung: null };

const ANTHROPIC_CONSOLE_CACHE_TTL_SECONDS = 300;

export const ANTHROPIC_REQUEST_LIMITS: ProviderRequestLimits = { bytes: 32 * 1024 * 1024, media: 100 };

export const ANTHROPIC_SPECS = {
  [DEFAULT_ANTHROPIC_MODEL]: {
    label: 'Opus 5.5',
    short: 'Opus',
    toolChoice: ['auto', 'none'],
    capacity: { context: 1_000_000, output: 128_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'medium',
    supportsAdaptiveThinking: true,
  },
  'claude-fable-5-1': {
    label: 'Fable 5.1',
    short: 'Fable',
    toolChoice: ['auto', 'none'],
    capacity: { context: 1_000_000, output: 128_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'xhigh',
    supportsAdaptiveThinking: true,
    operatorOnly: true,
  },
  'claude-sonnet-5-5': {
    label: 'Sonnet 5.5',
    short: 'Sonnet',
    toolChoice: ['auto', 'none'],
    capacity: { context: 1_000_000, output: 128_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'high',
    supportsAdaptiveThinking: true,
  },
  'claude-haiku-5-5': {
    label: 'Haiku 5.5',
    short: 'Haiku',
    capacity: { context: 1_000_000, output: 128_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'medium',
    supportsAdaptiveThinking: true,
  },
  'claude-opus-5': {
    label: 'Opus 5',
    short: 'Opus',
    capacity: { context: 1_000_000, output: 128_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'high',
    supportsAdaptiveThinking: true,
  },
  'claude-sonnet-5': {
    label: 'Sonnet 5',
    short: 'Sonnet',
    capacity: { context: 1_000_000, output: 128_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'high',
    supportsAdaptiveThinking: true,
  },
  'claude-opus-4-8': {
    label: 'Opus 4.8',
    short: 'Opus',
    capacity: { context: 1_000_000, output: 128_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'high',
    supportsAdaptiveThinking: true,
  },
  'claude-fable-5': {
    label: 'Fable 5',
    short: 'Fable',
    capacity: { context: 1_000_000, output: 128_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'high',
    supportsAdaptiveThinking: true,
    operatorOnly: true,
  },
  'claude-opus-4-7': {
    label: 'Opus 4.7',
    short: 'Opus',
    capacity: { context: 1_000_000, output: 128_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'high',
    supportsAdaptiveThinking: true,
  },
  'claude-sonnet-4-6': {
    label: 'Sonnet 4.6',
    short: 'Sonnet',
    capacity: { context: 1_000_000, output: 64_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['low', 'medium', 'high', 'max'],
    defaultReasoning: 'high',
    supportsAdaptiveThinking: true,
  },
  'claude-opus-4-6': {
    label: 'Opus 4.6',
    short: 'Opus',
    capacity: { context: 1_000_000, output: 128_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['low', 'medium', 'high', 'max'],
    defaultReasoning: 'high',
    supportsAdaptiveThinking: true,
  },
  'claude-opus-4-5': {
    label: 'Opus 4.5',
    short: 'Opus',
    capacity: { context: 200_000, output: 64_000 },
    capabilities: ['text', 'vision'],
    reasoning: ['low', 'medium', 'high'],
    defaultReasoning: 'high',
  },
  'claude-haiku-4-5': {
    label: 'Haiku 4.5',
    short: 'Haiku',
    capacity: { context: 200_000, output: 64_000 },
    capabilities: ['text', 'vision'],
    reasoning: [],
    defaultReasoning: null,
  },
} satisfies ModelSpecs;

export const ANTHROPIC_TEAM: readonly TeamRating[] = [
  { model: 'claude-opus-5-5', reasoning: 'high', open: 8, depth: 8, taste: 9, ui: 9, spend: 4 },
  { model: 'claude-opus-5-5', reasoning: 'xhigh', open: 9, depth: 9, taste: 9, ui: 9, spend: 5 },
  { model: 'claude-sonnet-5-5', reasoning: 'high', open: 5, depth: 6, taste: 7, ui: 7, spend: 3 },
  {
    model: 'claude-haiku-5-5',
    reasoning: 'xhigh',
    open: 2,
    depth: 3,
    taste: 4,
    ui: 3,
    spend: 1,
    only: ['research'],
    note: 'facts, file reading, mechanical edits',
  },
  { model: 'claude-fable-5-1', reasoning: 'high', open: 10, depth: 10, taste: 10, ui: 10, spend: 5, operatorOnly: true },
];

export const anthropicConsoleDescription: ProviderDescription = {
  id: ANTHROPIC_PROVIDER,
  label: 'Anthropic',
  auth: 'api-key',
  models: ANTHROPIC_SPECS,
  cacheLifetime: { promisedSeconds: ANTHROPIC_CONSOLE_CACHE_TTL_SECONDS, prior: null, reasoningKeyed: true },
  requestLimits: ANTHROPIC_REQUEST_LIMITS,
  defaultTextModel: DEFAULT_ANTHROPIC_MODEL,
  spawnTextModel: 'claude-opus-5-5',
  lightTextModel: ANTHROPIC_LIGHT_MODEL,
  team: ANTHROPIC_TEAM,
};

export const REASONING_DISPLAY_SWITCH: readonly ModelSwitch[] = [
  {
    id: 'reasoningDisplay',
    label: 'Thinking summary',
    description: 'Return a summary of the model’s reasoning alongside its answer',
    values: [
      { id: 'omitted', label: 'Summary hidden' },
      { id: 'summarized', label: 'Summary shown' },
    ],
    default: 'summarized',
  },
];

export const DEFAULT_CLAUDE_CODE_MODEL = 'claude-opus-5-5';

const CLAUDE_CODE_IDS: readonly (keyof typeof ANTHROPIC_SPECS)[] = [
  DEFAULT_CLAUDE_CODE_MODEL,
  'claude-opus-5',
  'claude-fable-5-1',
  'claude-sonnet-5-5',
  'claude-sonnet-5',
  'claude-haiku-5-5',
  'claude-haiku-4-5',
];

export const claudeCodeDescription: ProviderDescription = {
  id: CLAUDE_CODE_PROVIDER,
  label: 'Claude',
  auth: 'cli',
  models: servedModels(ANTHROPIC_SPECS, {
    ids: CLAUDE_CODE_IDS,
    overrides: Object.fromEntries(
      CLAUDE_CODE_IDS.filter((id) => (ANTHROPIC_SPECS as ModelSpecs)[id]?.supportsAdaptiveThinking === true).map((id) => [
        id,
        { switches: REASONING_DISPLAY_SWITCH },
      ]),
    ),
  }),
  cacheLifetime: { promisedSeconds: null, prior: null },
  defaultTextModel: DEFAULT_CLAUDE_CODE_MODEL,
  spawnTextModel: DEFAULT_CLAUDE_CODE_MODEL,
  lightTextModel: ANTHROPIC_LIGHT_MODEL,
  team: ANTHROPIC_TEAM,
};

export const anthropicVendor = {
  providers: [anthropicConsoleDescription, claudeCodeDescription],
} as const satisfies ModelVendor;
