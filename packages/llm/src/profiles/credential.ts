import { Effect, Redacted } from 'effect';
import * as Auth from '../llm/route/auth';
import { AuthenticationReason, LLMError } from '../llm/schema/errors';
import type { ModelCredentials } from './contract';

export function consoleKey(credentials: ModelCredentials, ownerId: string, provider: string, account?: string) {
  return credential(`${provider} API key`, () => credentials.apiKey(ownerId, provider, account));
}

export function subscriptionToken(credentials: ModelCredentials, ownerId: string, provider: string, account?: string) {
  return credential(`${provider} access token`, () => credentials.accessToken(ownerId, provider, account));
}

function credential(what: string, read: () => Promise<string>) {
  return Auth.effect(
    Effect.tryPromise({
      try: read,
      catch: (cause) =>
        cause instanceof LLMError ? cause : new Auth.MissingCredentialError(cause instanceof Error ? cause.message : what),
    }).pipe(Effect.map(Redacted.make)),
  );
}

export function subscriptionFact<A>(what: string, read: () => Promise<A>): Effect.Effect<A, LLMError> {
  return Effect.tryPromise({
    try: read,
    catch: (cause) =>
      cause instanceof LLMError
        ? cause
        : new LLMError({
            module: 'Auth',
            method: 'apply',
            reason: new AuthenticationReason({
              message: `The stored ${what} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
              kind: 'missing',
            }),
          }),
  });
}
