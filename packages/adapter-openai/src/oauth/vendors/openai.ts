import { Effect } from 'effect';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { OpenAISubscriptionCredential } from '../../models/openai.js';
import { SINGLE_ACCOUNT_KEY, signInDate } from '@runlith/llm/oauth/accountKey';
import { accessTokenEmail, accessTokenSubject, openAIFlow, openAIRefresh, type OpenAITokens } from '../flows/openai.js';
import type { SubscriptionAccounts } from '@runlith/llm/oauth/vendor';

export function openaiTokensToStored(tokens: OpenAITokens, existing?: OpenAISubscriptionCredential): OpenAISubscriptionCredential {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    accountId: tokens.accountId || existing?.accountId || undefined,
  };
}

export const openaiAccounts: SubscriptionAccounts<OpenAISubscriptionCredential> = {
  credential: OpenAISubscriptionCredential,
  signIns: [
    {
      kind: 'loopback',
      run: (openBrowser) => openAIFlow({ openBrowser }).pipe(Effect.map((result) => openaiTokensToStored(result.tokens))),
    },
  ],
  key: (credential) => AccountKey.make(credential.accountId?.trim() || accessTokenSubject(credential.accessToken) || SINGLE_ACCOUNT_KEY),
  label: (credential, addedAt) => accessTokenEmail(credential.accessToken) ?? `OpenAI account · ${signInDate(addedAt)}`,
  refresh: (refreshToken, existing) => openAIRefresh(refreshToken).pipe(Effect.map((tokens) => openaiTokensToStored(tokens, existing))),
};
