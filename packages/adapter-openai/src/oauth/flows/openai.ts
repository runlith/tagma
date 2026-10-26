import { Effect, Option, Schema } from 'effect';
import { type CallbackResult, callbackServer } from '@runlith/llm/oauth/callback-server';
import { runFlow, vendorCallOrFail } from '@runlith/llm/oauth/vendorCall';
import { generatePkce, generateState } from '@runlith/llm/oauth/pkce';
import { type ManualOAuthStart, parseManualRedirect } from '@runlith/llm/oauth/flows/manual';
import { openBrowserDefault } from '@runlith/llm/oauth/flows/open-browser';
import {
  OAuthFlowFailed,
  oauthFailure,
  parseVendorPayload,
  readableVendorAnswer,
  vendorSeconds,
  withOAuthVendorCallTimeout,
} from '@runlith/llm/oauth/flows/vendorPayload';

export const OPENAI_OAUTH_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
export const OPENAI_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
export const OPENAI_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const OPENAI_OAUTH_SCOPE = 'openid profile email offline_access';
export const OPENAI_OAUTH_CALLBACK_PORT = 1455;
export const OPENAI_OAUTH_CALLBACK_PATH = '/auth/callback';
export const OPENAI_OAUTH_MANUAL_REDIRECT_URI = `http://localhost:${OPENAI_OAUTH_CALLBACK_PORT}${OPENAI_OAUTH_CALLBACK_PATH}`;
export const OPENAI_API_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';

const OPENAI_STATE_BYTES = 32;

export type OpenAITokens = {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
  accountId: string | undefined;
};

const tokenSchema = Schema.Struct({
  id_token: Schema.optional(Schema.String),
  access_token: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
  expires_in: vendorSeconds,
});

type TokenPayload = typeof tokenSchema.Type;

const idTokenClaimsSchema = Schema.Struct({
  sub: Schema.optional(Schema.String),
  chatgpt_account_id: Schema.optional(Schema.String),
  organizations: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.optional(Schema.String) }))),
  email: Schema.optional(Schema.String),
  'https://api.openai.com/auth': Schema.optional(Schema.Struct({ chatgpt_account_id: Schema.optional(Schema.String) })),
  'https://api.openai.com/profile': Schema.optional(Schema.Struct({ email: Schema.optional(Schema.String) })),
});

type IdTokenClaims = typeof idTokenClaimsSchema.Type;

const decodeIdTokenClaims = Schema.decodeUnknownOption(Schema.fromJsonString(idTokenClaimsSchema));

function parseOpenAIJwtClaims(token: string): Option.Option<IdTokenClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) return Option.none();
  return decodeIdTokenClaims(Buffer.from(parts[1] as string, 'base64url').toString());
}

export function accessTokenSubject(accessToken: string): string | undefined {
  return Option.getOrUndefined(parseOpenAIJwtClaims(accessToken))?.sub?.trim() || undefined;
}

export function accessTokenEmail(accessToken: string): string | undefined {
  const claims = Option.getOrUndefined(parseOpenAIJwtClaims(accessToken));
  return (claims?.['https://api.openai.com/profile']?.email ?? claims?.email)?.trim() || undefined;
}

function extractAccountIdFromClaims(found: Option.Option<IdTokenClaims>): string | undefined {
  if (Option.isNone(found)) return undefined;
  const claims = found.value;
  return claims.chatgpt_account_id ?? claims['https://api.openai.com/auth']?.chatgpt_account_id ?? claims.organizations?.[0]?.id;
}

export function extractOpenAIAccountId(raw: TokenPayload): string | undefined {
  if (raw.id_token) {
    const accountId = extractAccountIdFromClaims(parseOpenAIJwtClaims(raw.id_token));
    if (accountId) return accountId;
  }
  if (raw.access_token) {
    return extractAccountIdFromClaims(parseOpenAIJwtClaims(raw.access_token));
  }
  return undefined;
}

function normalizeOpenAITokens(raw: TokenPayload, fallbackRefresh?: string): Effect.Effect<OpenAITokens, OAuthFlowFailed> {
  const accessToken = (raw.access_token ?? '').trim();
  if (!accessToken) {
    return new OAuthFlowFailed({ reason: 'OpenAI token response missing access_token' });
  }
  const refreshToken = (raw.refresh_token ?? fallbackRefresh ?? '').trim();
  const idToken = (raw.id_token ?? '').trim();
  const expiresInSeconds = typeof raw.expires_in === 'number' && raw.expires_in > 0 ? raw.expires_in : 3600;
  return Effect.succeed({
    accessToken,
    refreshToken,
    idToken,
    expiresAt: Date.now() + expiresInSeconds * 1000,
    accountId: extractOpenAIAccountId(raw),
  });
}

const postForm = Effect.fn('OpenAIOAuth.postForm')(function* (body: Record<string, string>) {
  return yield* withOAuthVendorCallTimeout(
    Effect.gen(function* () {
      const response = yield* vendorCallOrFail(
        OPENAI_OAUTH_TOKEN_URL,
        { 'Content-Type': 'application/x-www-form-urlencoded' },
        new URLSearchParams(body).toString(),
      );
      const text = response.text;
      if (!response.ok) {
        return yield* new OAuthFlowFailed({
          reason: `OpenAI token exchange failed (${response.status}): ${readableVendorAnswer(text.trim(), body) || response.statusText}`,
        });
      }
      return yield* Effect.try({
        try: () => parseVendorPayload(tokenSchema, text, 'OpenAI token response', body),
        catch: oauthFailure,
      });
    }),
    'OpenAI token exchange',
  );
});

export const openAIExchange = Effect.fn('OpenAIOAuth.exchange')(function* (params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId?: string;
}) {
  const raw = yield* postForm({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId ?? OPENAI_OAUTH_CLIENT_ID,
    code_verifier: params.codeVerifier,
  });
  return yield* normalizeOpenAITokens(raw);
});

export function exchangeOpenAIAuthorizationCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId?: string;
}): Promise<OpenAITokens> {
  return runFlow(openAIExchange(params));
}

export const openAIRefresh = Effect.fn('OpenAIOAuth.refresh')(function* (refreshToken: string, clientId?: string) {
  if (!refreshToken.trim()) {
    return yield* new OAuthFlowFailed({ reason: 'OpenAI refresh token is empty' });
  }
  const raw = yield* postForm({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId ?? OPENAI_OAUTH_CLIENT_ID,
  });
  return yield* normalizeOpenAITokens(raw, refreshToken);
});

export function refreshOpenAITokens(refreshToken: string, clientId?: string): Promise<OpenAITokens> {
  return runFlow(openAIRefresh(refreshToken, clientId));
}

function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  state: string;
  originator: string;
}): string {
  const url = new URL(OPENAI_OAUTH_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', params.scope);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('state', params.state);
  url.searchParams.set('originator', params.originator);
  return url.toString();
}

export const openAIManualBegin = Effect.fn('OpenAIOAuth.manualBegin')(function* (
  options: { clientId?: string; scope?: string; originator?: string } = {},
) {
  const pkce = yield* generatePkce().pipe(Effect.mapError(oauthFailure));
  const state = generateState('', OPENAI_STATE_BYTES);
  const authorizeUrl = buildAuthorizeUrl({
    clientId: options.clientId ?? OPENAI_OAUTH_CLIENT_ID,
    redirectUri: OPENAI_OAUTH_MANUAL_REDIRECT_URI,
    scope: options.scope ?? OPENAI_OAUTH_SCOPE,
    codeChallenge: pkce.challenge,
    state,
    originator: options.originator ?? 'tagma',
  });
  return { authorizeUrl, verifier: pkce.verifier, state } satisfies ManualOAuthStart;
});

export function beginOpenAIManualOAuth(
  options: { clientId?: string; scope?: string; originator?: string } = {},
): Promise<ManualOAuthStart> {
  return runFlow(openAIManualBegin(options));
}

export const openAIManualComplete = Effect.fn('OpenAIOAuth.manualComplete')(function* (
  input: string,
  start: Pick<ManualOAuthStart, 'verifier' | 'state'>,
  options: { clientId?: string } = {},
) {
  const { code, state } = yield* Effect.try({ try: () => parseManualRedirect(input), catch: oauthFailure });
  if (state && state !== start.state) {
    return yield* new OAuthFlowFailed({ reason: 'OpenAI OAuth state mismatch — restart the sign-in' });
  }
  return yield* openAIExchange({
    code,
    codeVerifier: start.verifier,
    redirectUri: OPENAI_OAUTH_MANUAL_REDIRECT_URI,
    clientId: options.clientId || undefined,
  });
});

export function completeOpenAIManualOAuth(
  input: string,
  start: Pick<ManualOAuthStart, 'verifier' | 'state'>,
  options: { clientId?: string } = {},
): Promise<OpenAITokens> {
  return runFlow(openAIManualComplete(input, start, options));
}

export type OpenAIOAuthFlowOptions = {
  clientId?: string;
  scope?: string;
  originator?: string;
  signal?: AbortSignal;
  openBrowser?: (authorizeUrl: string) => Promise<void> | void;
  timeoutMs?: number;
};

export type OpenAIOAuthFlowResult = {
  tokens: OpenAITokens;
  state: string;
  redirectUri: string;
  callback: CallbackResult;
};

export const openAIFlow = Effect.fn('OpenAIOAuth.flow')(function* (options: OpenAIOAuthFlowOptions = {}) {
  const pkce = yield* generatePkce().pipe(Effect.mapError(oauthFailure));
  const state = generateState('', OPENAI_STATE_BYTES);
  const originator = options.originator ?? 'tagma';

  const { callback, redirectUri } = yield* Effect.scoped(
    Effect.gen(function* () {
      const server = yield* callbackServer({
        path: OPENAI_OAUTH_CALLBACK_PATH,
        port: OPENAI_OAUTH_CALLBACK_PORT,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      });

      const authorizeUrl = buildAuthorizeUrl({
        clientId: options.clientId ?? OPENAI_OAUTH_CLIENT_ID,
        redirectUri: server.redirectUri,
        scope: options.scope ?? OPENAI_OAUTH_SCOPE,
        codeChallenge: pkce.challenge,
        state,
        originator,
      });

      const openBrowser = options.openBrowser ?? openBrowserDefault;
      yield* Effect.tryPromise({ try: () => Promise.resolve(openBrowser(authorizeUrl)), catch: oauthFailure });

      const settled = yield* server.result;

      if (settled.state !== state) {
        return yield* new OAuthFlowFailed({ reason: 'OpenAI OAuth state mismatch — possible CSRF or stale flow' });
      }
      return { callback: settled, redirectUri: server.redirectUri };
    }),
  );

  const tokens = yield* openAIExchange({
    code: callback.code,
    codeVerifier: pkce.verifier,
    redirectUri,
    clientId: options.clientId || undefined,
  });

  return { tokens, state, redirectUri, callback } satisfies OpenAIOAuthFlowResult;
});

export function runOpenAIOAuthFlow(options: OpenAIOAuthFlowOptions = {}): Promise<OpenAIOAuthFlowResult> {
  return runFlow(openAIFlow(options));
}
