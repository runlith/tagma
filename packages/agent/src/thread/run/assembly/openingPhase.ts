import { Clock, Duration, Effect, Fiber } from 'effect';
import type { ThreadWaitingOn } from '../../agents/ThreadAgent';
import type { RunProgress } from '../RunProgress';
import type { ThreadRunRef } from '../ThreadRunLedger';

export const OPENING_GRACE = Duration.seconds(1);

export type OpeningPhase = {
  readonly waitingOn: ThreadWaitingOn;
};

export const openingPhase = Effect.fnUntraced(function* (progress: RunProgress['Service'], run: ThreadRunRef) {
  yield* progress.enter(run, 'opening');
  const waitingOn: ThreadWaitingOn = (waiting, work) =>
    Effect.flatMap(Clock.currentTimeMillis, (began) => {
      const shown = { waiting: false };
      const announce = Effect.andThen(
        Effect.sleep(OPENING_GRACE),
        Effect.suspend(() => {
          shown.waiting = true;
          return progress.enter(run, 'opening', { waiting, since: began });
        }),
      );
      const settle = Effect.flatMap(Clock.currentTimeMillis, (ended) =>
        shown.waiting ? progress.enter(run, 'opening', { since: ended }) : Effect.void,
      );
      return Effect.flatMap(Effect.forkChild(announce), (announcing) =>
        Effect.ensuring(work, Effect.andThen(Fiber.interrupt(announcing), settle)),
      );
    });
  return { waitingOn } satisfies OpeningPhase;
});
