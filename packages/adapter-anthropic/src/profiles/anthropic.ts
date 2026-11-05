import { Effect } from 'effect';
import * as AnthropicMessages from '@runlith/llm/protocols/anthropic-messages';
import * as Auth from '@runlith/llm/route/auth';
import type { Model, ProviderOptions } from '@runlith/llm/schema/options';
import { ANTHROPIC_PROVIDER, anthropicConsoleDescription } from '../models/anthropic';
import { consoleKey } from '@runlith/llm/profiles/credential';
import type {
  ModelProfile,
  ProfileCall,
  ProfileSelection,
  ProviderQuota,
  ProviderRegistration,
  VendorRegistrations,
} from '@runlith/llm/profiles/contract';
import { unsupportedQuota } from '@runlith/llm/profiles/quotaRead';
import { reasoningRung, thinkingBudget } from '@runlith/llm/profiles/reasoning';

export const ANTHROPIC_OUTPUT_RESERVATION = 32_000;

const quota: ProviderQuota = {
  fromHeaders: () => null,
  read: unsupportedQuota,
};

export const thinkingOptions = (call: ProfileCall) => {
  if (call.adaptive) {
    const effort = AnthropicMessages.AnthropicEfforts.find((one) => one === call.rung);
    return { thinking: { type: 'adaptive' as const }, outputConfig: effort === undefined ? undefined : { effort } };
  }
  const budget = thinkingBudget(reasoningRung(call.rung), call.outputTokens);
  return { thinking: budget === undefined ? undefined : { type: 'enabled' as const, budgetTokens: budget }, outputConfig: undefined };
};

const options = (call: ProfileCall): ProviderOptions | undefined =>
  AnthropicMessages.options({
    ...thinkingOptions(call),
    disableParallelToolUse: call.parallelToolCalls === undefined ? undefined : !call.parallelToolCalls,
  });

const profile: ModelProfile = {
  output: { budget: ANTHROPIC_OUTPUT_RESERVATION, sent: true },
  model: (selection) => Effect.succeed(model(selection)),
  options,
};

const model = (selection: ProfileSelection): Model =>
  AnthropicMessages.route
    .with({
      provider: ANTHROPIC_PROVIDER,
      quota: quota.fromHeaders,
      limits: { output: ANTHROPIC_OUTPUT_RESERVATION },
      auth: consoleKey(selection.credentials, selection.ownerId, ANTHROPIC_PROVIDER, selection.account).pipe(Auth.header('x-api-key')),
    })
    .model({ id: selection.model });

export const anthropicConsoleRegistration: ProviderRegistration = {
  ...anthropicConsoleDescription,
  profile,
  quota,
};

export const anthropicConsoleRegistrations: VendorRegistrations = () => [anthropicConsoleRegistration];
