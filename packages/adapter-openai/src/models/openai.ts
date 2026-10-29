import { Schema } from 'effect';
import type { CacheCurve } from '@runlith/llm/models/cacheLifetime';
import { ROTATING_GRANT } from '@runlith/llm/models/grant';
import {
  type ImageModelSpecs,
  type ModelSpecs,
  type ModelVendor,
  type ProviderDescription,
  type ProviderRequestLimits,
  type ModelSwitch,
  type TeamRating,
  servedModels,
  SPEED_SWITCH_ICON,
} from '@runlith/llm/models/description';

export const OPENAI_PROVIDER = 'openai';
export const OPENAI_OAUTH_PROVIDER = 'openai-oauth';
export const CODEX_PROVIDER = 'codex';

const OPENAI_SUBSCRIPTION_CACHE_PRIOR: CacheCurve = {
  buckets: [
    { gap: '<1m', warmShare: 0.94, sample: 210 },
    { gap: '1–5m', warmShare: 0.93, sample: 206 },
    { gap: '5–15m', warmShare: 0.86, sample: 97 },
    { gap: '15–30m', warmShare: 0.79, sample: 29 },
    { gap: '30–60m', warmShare: 0.74, sample: 23 },
    { gap: '1–2h', warmShare: 0.36, sample: 11 },
    { gap: '>2h', warmShare: 0, sample: 12 },
  ],
  measuredBy: 'operator installation',
  measuredAt: '2026-09-10',
};

export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-terra';
export const DEFAULT_OPENAI_OAUTH_MODEL = 'gpt-6.1-sol';

const OPENAI_REQUEST_LIMITS: ProviderRequestLimits = { bytes: 50 * 1024 * 1024, media: 500 };

const OPENAI_FRONTIER_CAPACITY = { context: 1_050_000, input: 922_000, output: 128_000 };
const OPENAI_OAUTH_FRONTIER_CAPACITY = { context: 872_000, input: 744_000, output: 128_000 };
const OPENAI_OAUTH_5_5_CAPACITY = { context: 272_000, input: 144_000, output: 128_000 };
const OPENAI_OAUTH_FRONTIER_LADDER = ['low', 'medium', 'high', 'xhigh', 'max'];
const OPENAI_OAUTH_LADDER = ['low', 'medium', 'high', 'xhigh'];
const fastSwitch = (description: string): readonly ModelSwitch[] => [
  {
    id: 'serviceTier',
    label: 'Fast',
    description,
    values: [
      { id: 'standard', label: 'Standard' },
      { id: 'priority', label: 'Fast' },
    ],
    default: null,
    icon: SPEED_SWITCH_ICON,
  },
];

const FAST_SWITCH = fastSwitch('1.5x speed, increased usage');
const ASTRA_FAST_SWITCH = fastSwitch('2x speed, increased usage');
const GPT_6_FAST_SWITCH = fastSwitch('1.5x speed');
const GPT_6_1_FAST_SWITCH = fastSwitch('Faster, increased usage');

const OPENAI_SPECS = {
  'gpt-6-astra': {
    label: 'GPT-6 Astra',
    short: 'Astra',
    capacity: OPENAI_OAUTH_FRONTIER_CAPACITY,
    capabilities: ['text', 'vision'],
    reasoning: OPENAI_OAUTH_FRONTIER_LADDER,
    defaultReasoning: 'high',
    switches: ASTRA_FAST_SWITCH,
  },
  'gpt-6.1-sol': {
    label: 'GPT-6.1 Sol',
    short: 'Sol 6.1',
    capacity: OPENAI_FRONTIER_CAPACITY,
    capabilities: ['text', 'vision'],
    reasoning: OPENAI_OAUTH_FRONTIER_LADDER,
    defaultReasoning: 'high',
  },
  'gpt-6.1-terra': {
    label: 'GPT-6.1 Terra',
    short: 'Terra 6.1',
    capacity: OPENAI_FRONTIER_CAPACITY,
    capabilities: ['text', 'vision'],
    reasoning: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'medium',
  },
  'gpt-6-sol': {
    label: 'GPT-6 Sol',
    short: 'Sol',
    capacity: OPENAI_FRONTIER_CAPACITY,
    capabilities: ['text', 'vision'],
    reasoning: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'high',
  },
  'gpt-6-luna': {
    label: 'GPT-6 Luna',
    short: 'Luna',
    capacity: OPENAI_FRONTIER_CAPACITY,
    capabilities: ['text', 'vision'],
    reasoning: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'high',
  },
  'gpt-5.6-sol': {
    label: 'GPT-5.6 Sol',
    short: 'Sol 5.6',
    capacity: OPENAI_FRONTIER_CAPACITY,
    capabilities: ['text', 'vision'],
    reasoning: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'high',
  },
  [DEFAULT_OPENAI_MODEL]: {
    label: 'GPT-5.6 Terra',
    short: 'Terra',
    capacity: OPENAI_FRONTIER_CAPACITY,
    capabilities: ['text', 'vision'],
    reasoning: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'high',
  },
  'gpt-5.6-luna': {
    label: 'GPT-5.6 Luna',
    short: 'Luna 5.6',
    capacity: OPENAI_FRONTIER_CAPACITY,
    capabilities: ['text', 'vision'],
    reasoning: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoning: 'high',
  },
  'gpt-5.5': {
    label: 'GPT-5.5',
    short: '5.5',
    capacity: OPENAI_FRONTIER_CAPACITY,
    capabilities: ['text', 'vision'],
    reasoning: ['none', 'low', 'medium', 'high', 'xhigh'],
    defaultReasoning: 'high',
  },
} satisfies ModelSpecs;

const OPENAI_TEAM: readonly TeamRating[] = [
  { model: 'gpt-6.1-sol', reasoning: 'high', open: 4, depth: 7, taste: 6, ui: 5, spend: 5, not: ['design'] },
  { model: 'gpt-6.1-sol', reasoning: 'xhigh', open: 5, depth: 8, taste: 7, ui: 5, spend: 8 },
  {
    model: 'gpt-6-luna',
    reasoning: 'medium',
    open: 2,
    depth: 3,
    taste: 3,
    ui: 2,
    spend: 1,
    only: ['research', 'fix'],
    note: 'lookups and small edits',
  },
  { model: 'gpt-6-astra', reasoning: 'high', open: 9, depth: 9, taste: 8, ui: 7, spend: 10, operatorOnly: true },
];

export const openaiConsoleDescription: ProviderDescription = {
  id: OPENAI_PROVIDER,
  label: 'OpenAI',
  auth: 'api-key',
  models: servedModels(OPENAI_SPECS, {
    ids: ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', DEFAULT_OPENAI_MODEL, 'gpt-5.6-luna', 'gpt-5.5'],
  }),
  cacheLifetime: { promisedSeconds: null, prior: null },
  requestLimits: OPENAI_REQUEST_LIMITS,
  defaultTextModel: DEFAULT_OPENAI_MODEL,
  lightTextModel: { model: 'gpt-6-luna', rung: 'none' },
  team: OPENAI_TEAM,
};

export const OPENAI_IMAGE_MODEL = 'gpt-image-2';

const OPENAI_IMAGE_MODELS = {
  [OPENAI_IMAGE_MODEL]: { label: 'GPT Image 2', inputs: 5, inputTypes: ['image/png', 'image/jpeg', 'image/webp'], transparent: true },
} satisfies ImageModelSpecs;

export const openaiSubscriptionDescription: ProviderDescription = {
  id: OPENAI_OAUTH_PROVIDER,
  label: 'ChatGPT',
  auth: 'oauth',
  imageModels: OPENAI_IMAGE_MODELS,
  models: servedModels(OPENAI_SPECS, {
    ids: [
      'gpt-6-astra',
      DEFAULT_OPENAI_OAUTH_MODEL,
      'gpt-6.1-terra',
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-5.6-sol',
      DEFAULT_OPENAI_MODEL,
      'gpt-5.6-luna',
      'gpt-5.5',
    ],
    overrides: {
      'gpt-6.1-sol': {
        capacity: OPENAI_OAUTH_FRONTIER_CAPACITY,
        reasoning: OPENAI_OAUTH_FRONTIER_LADDER,
        switches: GPT_6_1_FAST_SWITCH,
      },
      'gpt-6.1-terra': {
        capacity: OPENAI_OAUTH_FRONTIER_CAPACITY,
        reasoning: OPENAI_OAUTH_FRONTIER_LADDER,
        defaultReasoning: 'low',
        switches: GPT_6_FAST_SWITCH,
      },
      'gpt-6-sol': {
        capacity: OPENAI_OAUTH_FRONTIER_CAPACITY,
        reasoning: OPENAI_OAUTH_FRONTIER_LADDER,
        switches: GPT_6_FAST_SWITCH,
      },
      'gpt-6-luna': {
        capacity: OPENAI_OAUTH_FRONTIER_CAPACITY,
        reasoning: OPENAI_OAUTH_FRONTIER_LADDER,
        switches: GPT_6_FAST_SWITCH,
      },
      'gpt-5.6-sol': {
        capacity: OPENAI_OAUTH_FRONTIER_CAPACITY,
        reasoning: OPENAI_OAUTH_FRONTIER_LADDER,
        switches: FAST_SWITCH,
      },
      [DEFAULT_OPENAI_MODEL]: {
        capacity: OPENAI_OAUTH_FRONTIER_CAPACITY,
        reasoning: OPENAI_OAUTH_FRONTIER_LADDER,
        switches: FAST_SWITCH,
      },
      'gpt-5.6-luna': {
        capacity: OPENAI_OAUTH_FRONTIER_CAPACITY,
        reasoning: OPENAI_OAUTH_FRONTIER_LADDER,
        switches: FAST_SWITCH,
      },
      'gpt-5.5': { capacity: OPENAI_OAUTH_5_5_CAPACITY, reasoning: OPENAI_OAUTH_LADDER, switches: FAST_SWITCH },
    },
  }),
  cacheLifetime: { promisedSeconds: null, prior: OPENAI_SUBSCRIPTION_CACHE_PRIOR },
  requestLimits: OPENAI_REQUEST_LIMITS,
  defaultTextModel: DEFAULT_OPENAI_OAUTH_MODEL,
  lightTextModel: { model: 'gpt-6-luna', rung: 'low' },
  team: OPENAI_TEAM,
};

export const DEFAULT_CODEX_MODEL = 'gpt-6-astra';

export const codexDescription: ProviderDescription = {
  id: CODEX_PROVIDER,
  label: 'Codex',
  auth: 'cli',
  models: servedModels(OPENAI_SPECS, {
    ids: [
      DEFAULT_CODEX_MODEL,
      'gpt-6.1-sol',
      'gpt-6.1-terra',
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-5.6-sol',
      DEFAULT_OPENAI_MODEL,
      'gpt-5.6-luna',
      'gpt-5.5',
    ],
    overrides: {
      [DEFAULT_CODEX_MODEL]: { switches: [] },
      'gpt-6.1-sol': { capacity: OPENAI_OAUTH_FRONTIER_CAPACITY, reasoning: OPENAI_OAUTH_FRONTIER_LADDER },
      'gpt-6.1-terra': {
        capacity: OPENAI_OAUTH_FRONTIER_CAPACITY,
        reasoning: OPENAI_OAUTH_FRONTIER_LADDER,
        defaultReasoning: 'low',
      },
      'gpt-6-sol': { capacity: OPENAI_OAUTH_FRONTIER_CAPACITY, reasoning: OPENAI_OAUTH_FRONTIER_LADDER },
      'gpt-6-luna': { capacity: OPENAI_OAUTH_FRONTIER_CAPACITY, reasoning: OPENAI_OAUTH_FRONTIER_LADDER },
      'gpt-5.6-sol': { capacity: OPENAI_OAUTH_FRONTIER_CAPACITY, reasoning: OPENAI_OAUTH_FRONTIER_LADDER },
      [DEFAULT_OPENAI_MODEL]: { capacity: OPENAI_OAUTH_FRONTIER_CAPACITY, reasoning: OPENAI_OAUTH_FRONTIER_LADDER },
      'gpt-5.6-luna': { capacity: OPENAI_OAUTH_FRONTIER_CAPACITY, reasoning: OPENAI_OAUTH_FRONTIER_LADDER },
      'gpt-5.5': { capacity: OPENAI_OAUTH_5_5_CAPACITY, reasoning: OPENAI_OAUTH_LADDER },
    },
  }),
  cacheLifetime: { promisedSeconds: null, prior: null },
  defaultTextModel: DEFAULT_CODEX_MODEL,
  lightTextModel: { model: 'gpt-6-luna', rung: 'low' },
};

export const OpenAISubscriptionCredential = Schema.Struct({ ...ROTATING_GRANT, accountId: Schema.optional(Schema.String) });
export type OpenAISubscriptionCredential = typeof OpenAISubscriptionCredential.Type;

export const openaiVendor = {
  providers: [openaiSubscriptionDescription, openaiConsoleDescription, codexDescription],
} as const satisfies ModelVendor;
