import { type ProviderDescription, servedModels } from '@runlith/llm/models/description';
import {
  ANTHROPIC_REQUEST_LIMITS,
  ANTHROPIC_SPECS,
  DEFAULT_ANTHROPIC_MODEL,
  REASONING_DISPLAY_SWITCH,
} from '@runlith/adapter-anthropic/models/anthropic';

export const SUBSCRIPTION_PROVIDER = 'subscription';
export const SUBSCRIPTION_CACHE_TTL_SECONDS = 3_600;

const IDS: readonly (keyof typeof ANTHROPIC_SPECS)[] = [
  DEFAULT_ANTHROPIC_MODEL,
  'claude-fable-5-1',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
];

export const subscriptionDescription: ProviderDescription = {
  id: SUBSCRIPTION_PROVIDER,
  label: 'Subscription',
  auth: 'oauth',
  models: servedModels(ANTHROPIC_SPECS, {
    ids: IDS,
    overrides: Object.fromEntries(IDS.map((id) => [id, { switches: REASONING_DISPLAY_SWITCH }])),
  }),
  cacheLifetime: { promisedSeconds: SUBSCRIPTION_CACHE_TTL_SECONDS, prior: null, reasoningKeyed: true },
  requestLimits: ANTHROPIC_REQUEST_LIMITS,
  defaultTextModel: DEFAULT_ANTHROPIC_MODEL,
  spawnTextModel: DEFAULT_ANTHROPIC_MODEL,
  lightTextModel: { model: 'claude-sonnet-5-5', rung: 'low' },
};
