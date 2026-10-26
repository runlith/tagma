import { Effect } from 'effect';
import * as OpenAICompatibleChat from '@runlith/llm/protocols/openai-compatible-chat';
import type { ProviderOptions } from '@runlith/llm/schema/options';
import { QuotaUnsupported } from '@runlith/llm/schema/quota';
import { DEEPSEEK_PROVIDER, deepseekDescription } from '../models/deepseek';
import { consoleKey } from '@runlith/llm/profiles/credential';
import type { ModelProfile, ProfileCall, ProviderQuota, ProviderRegistration, VendorRegistrations } from '@runlith/llm/profiles/contract';
import { reasoningRung } from '@runlith/llm/profiles/reasoning';

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

export const DEEPSEEK_OUTPUT_RESERVATION = 32_000;

export const deepseekQuota: ProviderQuota = {
  fromHeaders: () => null,
  read: () => Effect.fail(new QuotaUnsupported()),
};

function deepseekOptions(call: ProfileCall): ProviderOptions {
  const rung = reasoningRung(call.rung);
  return OpenAICompatibleChat.options({
    ...(rung === 'none' ? { thinking: { type: 'disabled' as const } } : { reasoningEffort: rung }),
    parallelToolCalls: call.parallelToolCalls,
  });
}

const deepseekProfile: ModelProfile = {
  output: { budget: DEEPSEEK_OUTPUT_RESERVATION, sent: true },
  model: (selection) =>
    Effect.succeed(
      OpenAICompatibleChat.route
        .with({
          provider: DEEPSEEK_PROVIDER,
          quota: deepseekQuota.fromHeaders,
          endpoint: { baseURL: DEEPSEEK_BASE_URL },
          limits: { output: DEEPSEEK_OUTPUT_RESERVATION },
          auth: consoleKey(selection.credentials, selection.ownerId, DEEPSEEK_PROVIDER, selection.account).bearer(),
        })
        .model({ id: selection.model, compatibility: { reasoningEcho: 'required' } }),
    ),
  options: deepseekOptions,
};

export const deepseekRegistration: ProviderRegistration = {
  ...deepseekDescription,
  profile: deepseekProfile,
  quota: deepseekQuota,
};

export const deepseekRegistrations: VendorRegistrations = () => [deepseekRegistration];
