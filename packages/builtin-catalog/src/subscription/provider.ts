import { Clock, Effect, Schema } from 'effect';
import * as AnthropicMessages from '@runlith/llm/protocols/anthropic-messages';
import { ROTATING_GRANT } from '@runlith/llm/models/grant';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { callbackServer } from '@runlith/llm/oauth/callback-server';
import { generatePkce, generateState } from '@runlith/llm/oauth/pkce';
import { OAuthFlowFailed, oauthFailure, parseVendorPayload, vendorSeconds } from '@runlith/llm/oauth/flows/vendorPayload';
import { vendorCallOrFail } from '@runlith/llm/oauth/vendorCall';
import type { SubscriptionAccounts } from '@runlith/llm/oauth/vendor';
import { subscriptionToken } from '@runlith/llm/profiles/credential';
import type { ModelProfile, ProviderQuota, ProviderRegistration } from '@runlith/llm/profiles/contract';
import type { ModelCompactionPolicy } from '@runlith/llm/profiles/ModelCompactionPolicy';
import { unsupportedQuota } from '@runlith/llm/profiles/quotaRead';
import { thinkingOptions } from '@runlith/adapter-anthropic/profiles/anthropic';
import { SUBSCRIPTION_CACHE_TTL_SECONDS, SUBSCRIPTION_PROVIDER, subscriptionDescription } from './description';

export const SUBSCRIPTION_AUTHORIZE_URL = 'https://subscription.invalid/oauth/authorize';
export const SUBSCRIPTION_TOKEN_URL = 'https://subscription.invalid/oauth/token';

const BASE_URL = 'https://subscription.invalid/v1';
const OUTPUT_RESERVATION = 32_000;

export const SubscriptionCredential = Schema.Struct({
  ...ROTATING_GRANT,
  scope: Schema.String,
  account: Schema.Struct({ uuid: Schema.String, email: Schema.String }),
  organization: Schema.Struct({ uuid: Schema.String, name: Schema.String }),
});
export type SubscriptionCredential = typeof SubscriptionCredential.Type;

const quota: ProviderQuota = { fromHeaders: () => null, read: unsupportedQuota };

const compaction: ModelCompactionPolicy = {
  select: (messages, alreadyCovered) => {
    const latest = messages.findLastIndex((message) => message.role === 'assistant');
    return latest > alreadyCovered ? latest : null;
  },
  summary: (response) => response.text.trim(),
};

const profile: ModelProfile = {
  output: { budget: OUTPUT_RESERVATION, sent: true },
  compaction,
  options: (call) => AnthropicMessages.options(thinkingOptions(call)),
  model: (selection) =>
    Effect.succeed(
      AnthropicMessages.route
        .with({
          provider: SUBSCRIPTION_PROVIDER,
          quota: quota.fromHeaders,
          endpoint: { baseURL: BASE_URL },
          limits: { output: OUTPUT_RESERVATION },
          cache: { tools: false, system: true, ttlSeconds: SUBSCRIPTION_CACHE_TTL_SECONDS },
          auth: subscriptionToken(selection.credentials, selection.ownerId, SUBSCRIPTION_PROVIDER, selection.account).bearer(),
        })
        .model({ id: selection.model }),
    ),
};

export const subscriptionRegistration: ProviderRegistration = { ...subscriptionDescription, profile, quota };

const TokenAnswer = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: vendorSeconds,
  scope: Schema.optional(Schema.String),
  account: Schema.optional(Schema.Struct({ uuid: Schema.String, email_address: Schema.optional(Schema.String) })),
  organization: Schema.optional(Schema.Struct({ uuid: Schema.String, name: Schema.optional(Schema.String) })),
});

const granted = Effect.fn('subscription.granted')(function* (body: Record<string, string>, existing?: SubscriptionCredential) {
  const answer = yield* vendorCallOrFail(SUBSCRIPTION_TOKEN_URL, { 'Content-Type': 'application/json' }, JSON.stringify(body));
  if (!answer.ok) return yield* new OAuthFlowFailed({ reason: `Token exchange failed with status ${answer.status}` });
  const token = yield* Effect.try({ try: () => parseVendorPayload(TokenAnswer, answer.text, 'token answer', body), catch: oauthFailure });
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? body.refresh_token ?? '',
    expiresAt: (yield* Clock.currentTimeMillis) + (token.expires_in ?? 3_600) * 1_000,
    scope: token.scope ?? existing?.scope ?? '',
    account: {
      uuid: token.account?.uuid ?? existing?.account.uuid ?? '',
      email: token.account?.email_address ?? existing?.account.email ?? '',
    },
    organization: {
      uuid: token.organization?.uuid ?? existing?.organization.uuid ?? '',
      name: token.organization?.name ?? existing?.organization.name ?? '',
    },
  } satisfies SubscriptionCredential;
});

const loopback = Effect.fn('subscription.loopback')(function* (openBrowser: (authorizeUrl: string) => void) {
  const pkce = yield* generatePkce().pipe(Effect.mapError(oauthFailure));
  const state = generateState('subscription:');
  const { code, redirectUri } = yield* Effect.scoped(
    Effect.gen(function* () {
      const server = yield* callbackServer({ path: '/callback' });
      const authorize = new URL(SUBSCRIPTION_AUTHORIZE_URL);
      authorize.searchParams.set('redirect_uri', server.redirectUri);
      authorize.searchParams.set('code_challenge', pkce.challenge);
      authorize.searchParams.set('state', state);
      yield* Effect.try({ try: () => openBrowser(authorize.toString()), catch: oauthFailure });
      const settled = yield* server.result;
      if (settled.state !== state) return yield* new OAuthFlowFailed({ reason: 'OAuth state mismatch' });
      return { code: settled.code, redirectUri: server.redirectUri };
    }),
  );
  return yield* granted({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: pkce.verifier });
});

export const subscriptionAccounts: SubscriptionAccounts<SubscriptionCredential> = {
  credential: SubscriptionCredential,
  signIns: [{ kind: 'loopback', run: loopback }],
  key: (credential) => AccountKey.make(credential.account.uuid),
  label: (credential) => credential.account.email || credential.account.uuid,
  organization: (credential) => credential.organization.name || undefined,
  refresh: (refreshToken, existing) => granted({ grant_type: 'refresh_token', refresh_token: refreshToken }, existing),
};
