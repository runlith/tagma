import { anthropicConsoleRegistration } from '@runlith/adapter-anthropic/profiles/anthropic';
import type { ProviderRegistration } from '@runlith/llm/profiles/contract';
import { stepfunRegistration } from '@runlith/adapter-stepfun/profiles/stepfun';
import { subscriptionRegistration } from './subscription/provider';

export const recordedRegistrations = {
  anthropicConsole: anthropicConsoleRegistration,
  subscription: subscriptionRegistration,
  stepfun: stepfunRegistration,
} satisfies Readonly<Record<string, ProviderRegistration>>;
