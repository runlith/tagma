import { Cause, Effect, PubSub, type Scope, Stream } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { Unit } from '../../platform/contract/service/units.js';
import type { SettingChanges } from '../../settings/contract/service/changes.js';
import type { Settings } from '../../settings/contract/service/values.js';
import { delegation as delegationKey, subAgentDepth } from '../contract/wire/settings.js';
import type { ThreadMandate } from '../contract/service/mandate.js';
import type { Delegation } from '../contract/wire/birth.js';
import type { ChangeRecord } from '../../platform/contract/wire/actor.js';

export type DelegationReading = { readonly delegation: Delegation; readonly depth: number };

export const readDelegation = Effect.fnUntraced(function* (
  threads: ThreadMandate['Service'],
  settings: Settings['Service'],
  threadId: string,
  unit?: Unit<'machine'>,
): Effect.fn.Return<DelegationReading, StoreFailure> {
  const lineage = yield* threads.delegationLineage(threadId, unit);
  const decided = lineage.nearest ?? { allowed: yield* settings.value(delegationKey, undefined, unit), setAt: null };
  return { delegation: { own: lineage.own, ...decided }, depth: lineage.depth };
});

export const delegationChange = Effect.fnUntraced(function* (
  threads: ThreadMandate['Service'],
  settings: Settings['Service'],
  threadId: string,
): Effect.fn.Return<ChangeRecord | null, StoreFailure> {
  const lineage = yield* threads.delegationLineage(threadId);
  if (lineage.nearest !== null) return lineage.switched;
  const machine = (yield* settings.read(delegationKey)).changed ?? null;
  if (lineage.switched === null || machine === null) return lineage.switched ?? machine;
  return lineage.switched.at >= machine.at ? lineage.switched : machine;
});

export const resolveDelegation = (
  threads: ThreadMandate['Service'],
  settings: Settings['Service'],
  threadId: string,
): Effect.Effect<Delegation, StoreFailure> => Effect.map(readDelegation(threads, settings, threadId), (reading) => reading.delegation);

export const republishOnMachineFlip = Effect.fnUntraced(function* (
  settings: Settings['Service'],
  followed: () => readonly string[],
  publish: (threadId: string) => Effect.Effect<void, unknown>,
): Effect.fn.Return<void, never, Scope.Scope> {
  const values = yield* Effect.result(settings.changes(delegationKey));
  if (values._tag === 'Failure') {
    console.warn('[tagma] the machine delegation switch is not followed; open threads show a flip at their next full read', values.failure);
    return;
  }
  yield* Effect.forkScoped(
    Stream.runForEach(values.success.pipe(Stream.changes, Stream.drop(1)), () =>
      republished('machine delegation flipped', followed, publish),
    ),
  );
});

export const republishOnDepthMove = Effect.fnUntraced(function* (
  changes: SettingChanges['Service'],
  followed: () => readonly string[],
  publish: (threadId: string) => Effect.Effect<void, unknown>,
): Effect.fn.Return<void, never, Scope.Scope> {
  const moved = yield* Effect.acquireRelease(PubSub.sliding<void>({ capacity: 1 }), PubSub.shutdown);
  const unwatch = changes.subscribe((event) =>
    event.key === subAgentDepth.id ? Effect.asVoid(PubSub.publish(moved, undefined)) : Effect.void,
  );
  yield* Effect.addFinalizer(() => Effect.sync(unwatch));
  yield* Effect.forkScoped(Stream.runForEach(Stream.fromPubSub(moved), () => republished('the sub-agent depth moved', followed, publish)));
});

const republished = (
  moved: string,
  followed: () => readonly string[],
  publish: (threadId: string) => Effect.Effect<void, unknown>,
): Effect.Effect<void, unknown> => {
  const logged = (what: string, threadId: string | null) => (cause: Cause.Cause<unknown>) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.failCause(cause)
      : Effect.sync(() => console.warn(`[tagma] ${moved}, but ${what}`, { threadId, cause }));
  return Effect.suspend(() =>
    Effect.forEach(
      followed(),
      (threadId) => Effect.suspend(() => publish(threadId)).pipe(Effect.catchCause(logged('a thread state was not published', threadId))),
      { discard: true },
    ),
  ).pipe(Effect.catchCause(logged('the open threads were not read', null)));
};
