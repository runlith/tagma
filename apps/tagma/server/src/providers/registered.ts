import { Effect } from 'effect';
import type { SubscriptionAccounts } from '@runlith/llm/oauth/vendor';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { ProviderRegistry } from './contract/service/registry.js';

export type SubscriptionProvider = { readonly id: string; readonly accounts: SubscriptionAccounts };

export const subscriptionProvider = Effect.fnUntraced(function* (registry: ProviderRegistry['Service'], value: string | undefined) {
  const registration = yield* registry.registration(value ?? '');
  if ((registration.kind === 'harness' && registration.auth === 'cli') || registration.accounts === undefined) {
    return yield* new GateRefusal('unknown-provider', `"${registration.id}" has no subscription sign-in flow`, [
      'name a provider that signs in by subscription',
    ]);
  }
  return { id: registration.id, accounts: registration.accounts } satisfies SubscriptionProvider;
});
