import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Duration, Effect } from 'effect';
import { AuthenticationReason, LLMError, ProviderInternalReason } from '../schema/errors';
import { openRetry, type ModelRetryContext, type ModelRetrySession } from './ModelRetryPolicy';

const http = (status: number) => ({
  request: { method: 'POST', url: 'https://provider.test/model', headers: {} },
  response: { status, headers: { 'x-should-retry': 'true' } },
});
const rejected = new LLMError({
  module: 'wire',
  method: 'send',
  reason: new AuthenticationReason({ message: 'Rejected', kind: 'invalid', http: http(401) }),
});
const busy = new LLMError({ module: 'wire', method: 'send', reason: new ProviderInternalReason({ message: 'Busy', http: http(503) }) });
const context = (attempt: number): ModelRetryContext => ({ attempt, failures: [], outputStarted: false });
const ordinary: ModelRetrySession = {
  decide: (failure, context) =>
    Effect.succeed(
      failure.status === 401
        ? { again: false, stop: 'not-retryable', of: 2 }
        : context.attempt > 2
          ? { again: false, stop: 'exhausted', of: 2 }
          : { again: true, after: Duration.zero, of: 2, attempt: context.attempt },
    ),
};

it.effect(
  'authentication recovery the ordinary policy does not schedule replays immediately once outside its budget and then requires reconnection',
  () =>
    Effect.gen(function* () {
      const session = openRetry({ recover: Effect.void }, ordinary);
      const recovery = yield* session.decide(rejected, context(1));
      expect(recovery).toMatchObject({ again: true, of: 1 });
      if (!recovery.again) return yield* Effect.die('Recovery was refused');
      expect(Duration.toMillis(recovery.after)).toBe(0);
      expect(yield* session.decide(busy, context(2))).toMatchObject({ again: true, attempt: 1 });
      expect(yield* session.decide(busy, context(3))).toMatchObject({ again: true, attempt: 2 });
      expect(yield* session.decide(busy, context(4))).toMatchObject({ again: false, stop: 'exhausted', of: 2 });
      const terminal = yield* session.decide(rejected, context(5));
      expect(terminal).toMatchObject({ again: false, of: 1, failure: { reason: { _tag: 'Authentication', kind: 'expired' } } });
    }),
);

it.effect('an unavailable recovery refuses authentication even when an ordinary policy would resend it', () =>
  Effect.gen(function* () {
    const resending: ModelRetrySession = { decide: () => Effect.succeed({ again: true, after: Duration.zero, of: 2 }) };
    expect(yield* openRetry(undefined, resending).decide(rejected, context(1))).toMatchObject({ again: false, stop: 'not-retryable' });
  }),
);
