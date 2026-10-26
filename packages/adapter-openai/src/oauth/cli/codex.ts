import { homedir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { OpenAISubscriptionCredential } from '../../models/openai.js';
import { asRecord, finiteNumber, jwtClaims, nonEmptyString, parsedCliLoginSource, readJson } from '@runlith/llm/oauth/cliStore';

const readCodexSource = Effect.fn('CliLogins.readCodexSource')(function* (provider: string, source: string) {
  const document = asRecord(yield* readJson(provider, source));
  if (!document) return null;

  const mode = nonEmptyString(document.auth_mode);
  if (mode !== undefined && mode !== 'chatgpt' && mode !== 'chatgptAuthTokens') return null;

  const tokens = asRecord(document.tokens);
  const accessToken = nonEmptyString(tokens?.access_token);
  const refreshToken = nonEmptyString(tokens?.refresh_token);
  const idToken = nonEmptyString(tokens?.id_token);
  if (!accessToken || !refreshToken || !idToken) return null;

  const identityClaims = yield* jwtClaims(provider, source, idToken);
  const accessClaims = yield* jwtClaims(provider, source, accessToken);
  const authClaims = asRecord(identityClaims?.['https://api.openai.com/auth']);
  const email = nonEmptyString(identityClaims?.email);
  const accountId =
    nonEmptyString(tokens?.account_id) ??
    nonEmptyString(identityClaims?.chatgpt_account_id) ??
    nonEmptyString(authClaims?.chatgpt_account_id);
  const expiresAtSeconds = finiteNumber(accessClaims?.exp) ?? finiteNumber(identityClaims?.exp);
  const label = email ?? accountId;
  if (!label || expiresAtSeconds === undefined) return null;

  return yield* parsedCliLoginSource({
    provider,
    schema: OpenAISubscriptionCredential,
    source,
    value: {
      accessToken,
      refreshToken,
      expiresAt: expiresAtSeconds * 1_000,
      accountId: accountId || undefined,
    },
    identity: { label, email: email || undefined },
  });
});

export const readCodexAccount = (
  directory: string | null,
): Effect.Effect<OpenAISubscriptionCredential | null, { readonly message: string }> =>
  Effect.map(
    readCodexSource('openai-oauth', join(directory ?? join(homedir(), '.codex'), 'auth.json')),
    (found) => found?.credential ?? null,
  );
