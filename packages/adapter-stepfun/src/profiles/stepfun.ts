import { Effect } from 'effect';
import * as OpenAICompatibleChat from '@runlith/llm/protocols/openai-compatible-chat';
import type { ProviderOptions } from '@runlith/llm/schema/options';
import { QuotaUnsupported } from '@runlith/llm/schema/quota';
import { STEPFUN_PROVIDER, stepfunDescription } from '../models/stepfun';
import { consoleKey } from '@runlith/llm/profiles/credential';
import type { ModelProfile, ProfileCall, ProviderQuota, ProviderRegistration, VendorRegistrations } from '@runlith/llm/profiles/contract';
import { reasoningRung } from '@runlith/llm/profiles/reasoning';

export const STEPFUN_BASE_URL = 'https://api.stepfun.ai/step_plan/v1';

export const STEPFUN_OUTPUT_RESERVATION = 32_000;

export const stepfunQuota: ProviderQuota = {
  fromHeaders: () => null,
  read: () => Effect.fail(new QuotaUnsupported()),
};

function stepfunOptions(call: ProfileCall): ProviderOptions {
  return OpenAICompatibleChat.options({
    reasoningEffort: reasoningRung(call.rung),
    parallelToolCalls: call.parallelToolCalls,
  });
}

const stepfunProfile: ModelProfile = {
  output: { budget: STEPFUN_OUTPUT_RESERVATION, sent: true },
  model: (selection) =>
    Effect.succeed(
      OpenAICompatibleChat.route
        .with({
          provider: STEPFUN_PROVIDER,
          quota: stepfunQuota.fromHeaders,
          endpoint: { baseURL: STEPFUN_BASE_URL },
          limits: { output: STEPFUN_OUTPUT_RESERVATION },
          auth: consoleKey(selection.credentials, selection.ownerId, STEPFUN_PROVIDER, selection.account).bearer(),
        })
        .model({ id: selection.model }),
    ),
  options: stepfunOptions,
};

export const stepfunRegistration: ProviderRegistration = {
  ...stepfunDescription,
  profile: stepfunProfile,
  quota: stepfunQuota,
};

export const stepfunRegistrations: VendorRegistrations = () => [stepfunRegistration];
