import { Cause, Effect, Exit } from 'effect';
import type { ThreadBinding } from '../record';
import { Transports } from './Transports';

export type HistoryMoved = (threadId: string, seated: ThreadBinding) => Effect.Effect<void>;

export const makeHistoryMoved = Effect.gen(function* () {
  const transports = yield* Transports;
  const scope = yield* Effect.scope;
  const moved: HistoryMoved = (threadId, seated) =>
    Effect.asVoid(
      Effect.forkIn(
        Effect.flatMap(
          Effect.exit(Effect.flatMap(transports.of(seated), (transport) => transport.history?.moved(threadId) ?? Effect.void)),
          (told) =>
            Exit.isFailure(told)
              ? Effect.logWarning('the transport did not align its session with the journal; its next launch aligns it', {
                  threadId,
                  cause: Cause.pretty(told.cause),
                })
              : Effect.void,
        ).pipe(Effect.withSpan('TransportHistory.moved')),
        scope,
      ),
    );
  return moved;
});
