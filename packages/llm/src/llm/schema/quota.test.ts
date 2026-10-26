import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import {
  QuotaFailure,
  QuotaInvalidResponse,
  QuotaMissingScope,
  QuotaRateLimited,
  QuotaServerFailure,
  QuotaStaleToken,
  QuotaTransportFailure,
  QuotaUnsupported,
} from './quota';

it.effect('quota refusals cross the account and harness wire with their tagged facts', () =>
  Effect.gen(function* () {
    const codec = Schema.toCodecJson(QuotaFailure);
    const refusals = [
      new QuotaRateLimited({ retryAfterMs: 1000 }),
      new QuotaStaleToken(),
      new QuotaMissingScope({ scope: 'user:profile' }),
      new QuotaServerFailure({ status: 503 }),
      new QuotaTransportFailure({ message: 'connection ended' }),
      new QuotaInvalidResponse({ message: 'no windows' }),
      new QuotaUnsupported(),
    ];
    const decoded = yield* Effect.forEach(refusals, (refused) =>
      Effect.flatMap(Schema.encodeUnknownEffect(codec)(refused), Schema.decodeUnknownEffect(codec)),
    );
    expect(decoded).toEqual([
      { _tag: 'rate-limited', retryAfterMs: 1000 },
      { _tag: 'stale-token' },
      { _tag: 'missing-scope', scope: 'user:profile' },
      { _tag: 'server', status: 503 },
      { _tag: 'transport', message: 'connection ended' },
      { _tag: 'invalid-response', message: 'no windows' },
      { _tag: 'unsupported' },
    ]);
  }),
);
