import { Duration, Effect, FiberMap, Schedule, Stream } from 'effect';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import { harnessSessionActive } from '../../threads/contract/wire/harness/session.js';
import { LEASE_RHYTHM } from '../../threads/contract/wire/rhythm.js';
import type { HarnessAdapters } from '../contract/service/adapters.js';
import type { HarnessSessionStore } from '../store/sessions.js';

type Stop = (threadId: string, sessionId: string) => Effect.Effect<'stopped' | 'not-running', HarnessFailure>;

const resting = (facet: ExternalSession): boolean => facet.turn === undefined && facet.session?.state === 'running';

const retried = <E>(work: Effect.Effect<void, E>, what: string) =>
  work.pipe(
    Effect.tapError((failure) => Effect.logWarning(what, { failure })),
    Effect.retry(Schedule.spaced(Duration.millis(LEASE_RHYTHM.takeoverAfterMs))),
  );

export const retireWithdrawn = Effect.fnUntraced(function* (input: {
  readonly store: HarnessSessionStore;
  readonly adapters: HarnessAdapters['Service'];
  readonly stop: Stop;
}) {
  const { store, adapters, stop } = input;
  const retiring = yield* FiberMap.make<string, void, never>();

  const retire = Effect.fnUntraced(function* (threadId: string) {
    for (;;) {
      const facet = yield* store.wait(threadId, (standing) => !harnessSessionActive(standing.session) || resting(standing));
      const session = facet?.session;
      if (facet === null || !harnessSessionActive(session) || adapters.find(facet.name) !== null) return;
      if ((yield* stop(threadId, session.id)) === 'stopped') return;
    }
  });

  const moved = Effect.fn('sessions.withdrawn')(function* () {
    for (const threadId of yield* store.standing('terminal')) {
      const facet = yield* store.read(threadId);
      if (facet === null || adapters.find(facet.name) !== null) continue;
      const retirement = retried(retire(threadId), 'a CLI of a removed harness could not be ended at rest; trying again');
      yield* FiberMap.run(retiring, threadId, Effect.orDie(retirement), { onlyIfMissing: true });
    }
  });

  yield* Effect.forkScoped(
    Stream.runForEach(adapters.changes, () => retried(moved(), 'the CLIs of a removed harness could not be read; trying again')),
  );
});
