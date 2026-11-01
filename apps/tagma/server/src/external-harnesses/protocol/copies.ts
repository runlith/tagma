import { Clock, Effect } from 'effect';
import type { AgentAside } from '@runlith/agent/AgentAside';
import { threadCacheWarmth } from '@runlith/agent/thread/cache/ThreadCacheWarmth';
import type { ThreadContextReading } from '@runlith/agent/thread/rows';
import type { ModelCacheLifetime } from '@runlith/llm/models/cacheLifetime';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { HarnessAsides } from '../../threads/contract/service/asides.js';
import { SessionCopies, type SessionCapture } from '../contract/service/copies.js';

const UNPROMISED: ModelCacheLifetime = { promisedSeconds: null, prior: null };

const warmUntil = (reading: ThreadContextReading, provider: string, now: number): number | undefined => {
  const warmth = threadCacheWarmth({
    reading,
    selection: { provider, model: reading.model, account: null },
    lifetime: UNPROMISED,
    curve: null,
    now,
  });
  return warmth.state !== 'warm' || warmth.expiresAt === null ? undefined : Date.parse(warmth.expiresAt);
};

const sessionAside = ({ turn, aside, readerInput, reading }: SessionCapture, now: number): AgentAside | null => {
  if (reading === null || reading.runId !== turn || reading.provider !== aside.served.provider) return null;
  const expiresAt = aside.life === 'session' ? null : warmUntil(reading, aside.served.provider, now);
  if (expiresAt === undefined) return null;
  const measuredAt = Date.parse(reading.measuredAt);
  return {
    source: 'session',
    runId: turn,
    stepNumber: 0,
    readerInput,
    readerPosition: null,
    binding: {
      origin: new ModelIdentity({ provider: ProviderID.make(aside.served.provider), model: ModelID.make(aside.served.model) }),
      account: undefined,
      cache: undefined,
    },
    reasoning: aside.served.reasoning,
    sentAt: reading.sentAt === undefined ? measuredAt : Date.parse(reading.sentAt),
    measuredAt,
    expiresAt,
    ask: aside.ask,
  };
};

export const makeSessionCopies = Effect.gen(function* () {
  const held = yield* HarnessAsides;
  const remember = Effect.fn('SessionCopies.measured')(function* (input: SessionCapture) {
    const kept = sessionAside(input, yield* Clock.currentTimeMillis);
    if (kept === null) return false;
    yield* held.hold(input.threadId, kept);
    return true;
  });
  return SessionCopies.of({
    measured: remember,
    settled: Effect.fn('SessionCopies.settled')(function* (input) {
      if (yield* remember(input)) yield* held.settled(input.threadId, input.turn);
    }),
    exited: (threadId) => Effect.suspend(() => (held.of(threadId)?.source === 'session' ? held.forget(threadId) : Effect.void)),
  });
});
