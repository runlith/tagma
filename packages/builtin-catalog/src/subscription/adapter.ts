import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { CLAUDE_CODE_PROVIDER } from '@runlith/adapter-anthropic/models/anthropic';
import { readJson, unreadable } from '@runlith/llm/oauth/cliStore';
import { subscriptionAccounts as accounts } from '@runlith/llm/oauth/vendor';
import { defineAdapter } from '@runlith/tagma/adapter/provider';
import { SUBSCRIPTION_PROVIDER } from './description';
import { SubscriptionCredential, subscriptionAccounts, subscriptionRegistration } from './provider';

export const LENT_CREDENTIAL = 'credential.json';

const lent = (directory: string | null) => {
  if (directory === null) return Effect.succeed(null);
  const path = join(directory, LENT_CREDENTIAL);
  return readJson(SUBSCRIPTION_PROVIDER, path).pipe(
    Effect.flatMap((document) =>
      document === null
        ? Effect.succeed(null)
        : Schema.decodeUnknownEffect(SubscriptionCredential)(document).pipe(
            Effect.mapError((invalid) => unreadable(SUBSCRIPTION_PROVIDER, path, invalid)),
          ),
    ),
  );
};

export const adapter = defineAdapter(() => [
  {
    ...subscriptionRegistration,
    kind: 'wire',
    accountMode: {
      section: 'claude',
      title: 'Claude',
      default: 'claude',
      id: SUBSCRIPTION_PROVIDER,
      label: 'Subscription',
      hint: 'Signs in through the browser and keeps the token itself.',
    },
    accounts: accounts(subscriptionAccounts),
    borrows: { provider: CLAUDE_CODE_PROVIDER, read: lent },
  },
]);
