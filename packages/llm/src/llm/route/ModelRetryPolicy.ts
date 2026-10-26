import { Duration, Effect } from 'effect';
import { AuthenticationReason, LLMError } from '../schema/errors';

export type ModelRetryVerdict =
  | { readonly again: false; readonly stop: 'exhausted' | 'not-retryable'; readonly of: number; readonly failure?: LLMError }
  | { readonly again: false; readonly stop: 'delay-limit'; readonly of: number; readonly retryAfterMs: number; readonly ceilingMs: number }
  | {
      readonly again: true;
      readonly after: Duration.Duration;
      readonly of: number;
      readonly prepare?: Effect.Effect<void, LLMError>;
      readonly announce?: boolean;
      readonly attempt?: number;
    };

export type ModelRetryContext = {
  readonly attempt: number;
  readonly failures: readonly LLMError[];
  readonly outputStarted: boolean;
  readonly recover?: Effect.Effect<void, LLMError>;
};

export interface ModelRetryPolicy {
  readonly recover?: Effect.Effect<void, LLMError>;
  open?(): ModelRetrySession;
}

export interface ModelRetrySession {
  decide(failure: LLMError, context: ModelRetryContext): Effect.Effect<ModelRetryVerdict>;
}

export const openRetry = (policy: ModelRetryPolicy | undefined, fallback: ModelRetrySession): ModelRetrySession => {
  const ordinary = policy?.open?.() ?? fallback;
  let recovered = false;
  let outside = 0;
  return {
    decide: (failure, context) =>
      Effect.suspend((): Effect.Effect<ModelRetryVerdict> => {
        const laddered = { ...context, attempt: context.attempt - outside };
        if (failure.status === 401) {
          if (recovered)
            return Effect.succeed({
              again: false,
              stop: 'not-retryable',
              of: 1,
              failure: new LLMError({
                module: 'Auth',
                method: 'recover',
                reason: new AuthenticationReason({
                  message: 'The renewed sign-in was rejected; reconnect this account.',
                  kind: 'expired',
                  http: 'http' in failure.reason ? failure.reason.http : undefined,
                }),
              }),
            });
          const recover = context.recover ?? policy?.recover;
          if (recover === undefined) return Effect.succeed({ again: false, stop: 'not-retryable', of: 1 });
          recovered = true;
          return Effect.map(ordinary.decide(failure, laddered), (scheduled): ModelRetryVerdict => {
            if (scheduled.again)
              return { ...scheduled, prepare: scheduled.prepare === undefined ? recover : Effect.andThen(recover, scheduled.prepare) };
            outside = 1;
            return { again: true, after: Duration.zero, of: 1, attempt: 1, prepare: recover };
          });
        }
        return ordinary.decide(failure, laddered);
      }),
  };
};
