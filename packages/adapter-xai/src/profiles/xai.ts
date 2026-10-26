import { Effect } from 'effect';
import * as Auth from '@runlith/llm/route/auth';
import * as OpenAIResponses from '@runlith/llm/protocols/openai-responses';
import type { StreamRefusalPolicy } from '@runlith/llm/route/refusal';
import type { Model, ProviderOptions } from '@runlith/llm/schema/options';
import { XAI_PROVIDER, xaiConsoleDescription } from '../models/xai';
import { consoleKey } from '@runlith/llm/profiles/credential';
import type { ModelProfile, ProfileCall, ProviderQuota, ProviderRegistration } from '@runlith/llm/profiles/contract';
import { unsupportedQuota } from '@runlith/llm/profiles/quotaRead';
import { reasoningRung } from '@runlith/llm/profiles/reasoning';

export const XAI_BASE_URL = 'https://api.x.ai/v1';
export const XAI_OUTPUT_RESERVATION = 32_000;

const xaiConsoleQuota: ProviderQuota = {
  fromHeaders: () => null,
  read: unsupportedQuota,
};

const XAI_CAPACITY_SENTENCE = 'The model is currently at capacity due to high demand';

export const xaiRefusals: StreamRefusalPolicy = (refusal) =>
  refusal.code === undefined && refusal.message.startsWith(XAI_CAPACITY_SENTENCE) ? { retryable: true } : null;

export function xaiOptions(call: ProfileCall): ProviderOptions {
  return OpenAIResponses.options({
    store: false,
    reasoningEffort: reasoningRung(call.rung),
    parallelToolCalls: call.parallelToolCalls,
  });
}

const xaiConsoleProfile: ModelProfile = {
  output: { budget: XAI_OUTPUT_RESERVATION, sent: true },
  model: (selection) =>
    Effect.succeed(
      xaiModel(
        selection.model,
        XAI_PROVIDER,
        consoleKey(selection.credentials, selection.ownerId, XAI_PROVIDER, selection.account).bearer(),
        xaiConsoleQuota,
      ),
    ),
  options: xaiOptions,
};

export function xaiModel(id: string, provider: string, auth: ReturnType<typeof Auth.bearer>, quota: ProviderQuota): Model {
  return OpenAIResponses.route
    .with({
      provider,
      quota: quota.fromHeaders,
      refusals: xaiRefusals,
      endpoint: { baseURL: XAI_BASE_URL },
      limits: { output: XAI_OUTPUT_RESERVATION },
      auth,
    })
    .model({ id });
}

export const xaiConsoleRegistration: ProviderRegistration = {
  ...xaiConsoleDescription,
  profile: xaiConsoleProfile,
  quota: xaiConsoleQuota,
};
