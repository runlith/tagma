import { Cause, Effect, type Scope, Stream } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { Settings } from '../../settings/contract/service/values.js';
import { delegation as delegationKey } from '../contract/wire/settings.js';
import type { ThreadMandate } from '../contract/service/mandate.js';
import type { Delegation } from '../contract/wire/birth.js';

export type DelegationReading = { readonly delegation: Delegation; readonly depth: number };

export const readDelegation = Effect.fnUntraced(function* (
  threads: ThreadMandate['Service'],
  settings: Settings['Service'],
  threadId: string,
): Effect.fn.Return<DelegationReading, StoreFailure> {
  const lineage = yield* threads.delegationLineage(threadId);
  const decided = lineage.nearest ?? { allowed: yield* settings.value(delegationKey), setAt: null };
  return { delegation: { own: lineage.own, ...decided }, depth: lineage.depth };
});

export const resolveDelegation = (
  threads: ThreadMandate['Service'],
  settings: Settings['Service'],
  threadId: string,
): Effect.Effect<Delegation, StoreFailure> => Effect.map(readDelegation(threads, settings, threadId), (reading) => reading.delegation);

export const republishOnMachineFlip = Effect.fnUntraced(function* (
  settings: Settings['Service'],
  atRest: () => readonly string[],
  publish: (threadId: string) => Effect.Effect<void, unknown>,
): Effect.fn.Return<void, never, Scope.Scope> {
  const followed = yield* Effect.result(settings.changes(delegationKey));
  if (followed._tag === 'Failure') {
    console.warn('[tagma] the machine delegation switch is not followed; open threads show a flip at their next frame', followed.failure);
    return;
  }
  const flips = followed.success.pipe(Stream.changes, Stream.drop(1));
  const logged = (what: string, threadId: string | null) => (cause: Cause.Cause<unknown>) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.failCause(cause)
      : Effect.sync(() => console.warn(`[tagma] machine delegation flipped, but ${what}`, { threadId, cause }));
  yield* Effect.forkScoped(
    Stream.runForEach(flips, () =>
      Effect.suspend(() =>
        Effect.forEach(
          atRest(),
          (threadId) =>
            Effect.suspend(() => publish(threadId)).pipe(Effect.catchCause(logged('a thread state was not published', threadId))),
          { discard: true },
        ),
      ).pipe(Effect.catchCause(logged('the open threads were not read', null))),
    ),
  );
});
