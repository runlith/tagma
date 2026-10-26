import { consoleKey } from '@runlith/llm/profiles/credential';
import type { DecisionProfile } from '@runlith/llm/profiles/decisions';
import type { ModelProfile, ProviderQuota } from '@runlith/llm/profiles/contract';
import { reasoningRung } from '@runlith/llm/profiles/reasoning';
import * as Decisions from '@runlith/llm/protocols/decisions';
import * as OpenAICompatibleChat from '@runlith/llm/protocols/openai-compatible-chat';
import { QuotaUnsupported } from '@runlith/llm/schema/quota';
import { defineAdapter } from '@runlith/tagma/adapter/provider';
import { Effect } from 'effect';
import { catalog, OPENROUTER_API, OPENROUTER_PROVIDER } from './catalog';

const OUTPUT_RESERVATION = 32_000;

const quota: ProviderQuota = {
  fromHeaders: () => null,
  read: () => Effect.fail(new QuotaUnsupported()),
};

const profile: ModelProfile = {
  output: { budget: OUTPUT_RESERVATION, sent: true },
  model: (selection) =>
    Effect.succeed(
      OpenAICompatibleChat.route
        .with({
          provider: OPENROUTER_PROVIDER,
          endpoint: { baseURL: `${OPENROUTER_API}/v1` },
          limits: { output: OUTPUT_RESERVATION },
          auth: consoleKey(selection.credentials, selection.ownerId, OPENROUTER_PROVIDER, selection.account).bearer(),
        })
        .model({ id: selection.model }),
    ),
  options: (call) => OpenAICompatibleChat.options({ reasoningEffort: reasoningRung(call.rung), parallelToolCalls: call.parallelToolCalls }),
};

export const decisions: DecisionProfile = {
  decide: (selection, request) =>
    Decisions.decide(
      {
        provider: OPENROUTER_PROVIDER,
        url: `${OPENROUTER_API}/alpha/decisions`,
        auth: consoleKey(selection.credentials, selection.ownerId, OPENROUTER_PROVIDER, selection.account).bearer(),
      },
      selection.model,
      request,
    ),
};

export const adapter = defineAdapter(() => [
  {
    kind: 'wire',
    id: OPENROUTER_PROVIDER,
    label: 'OpenRouter',
    auth: 'api-key',
    keyHint: 'An OpenRouter API key. Its decision models answer the decisions Tagma asks about threads.',
    models: {},
    defaultTextModel: '',
    dynamicCatalog: true,
    textless: true,
    catalog,
    cacheLifetime: { promisedSeconds: null, prior: null },
    profile,
    quota,
    decisions,
  },
]);
