import { Effect } from 'effect';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { actDigest, type Keyed } from '@runlith/agent/thread/keyed';
import type { sealThreadEvents } from '@runlith/agent/thread/ThreadEventDoor';
import { prepareTransition, transitionIn, type TransitionDeps } from '@runlith/agent/thread/transition/kernel';
import { ThreadVersionStaleError, type TransitionPlan } from '@runlith/agent/thread/transition/port';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import { NativeStorage, ThreadJournal } from '../contract/service/engine.js';
import { JournalOrder } from '../journal/lane.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { journalLaneFaces } from '@runlith/agent/thread/transition/lane';
import { HarnessTurnStale, type HarnessTurnWrite } from '../contract/service/rebinding.js';

export type JournaledTransitions = Effect.Success<typeof makeJournaledTransitions>;

export const makeJournaledTransitions = Effect.gen(function* () {
  const { threads: store, transitions } = yield* NativeStorage;
  const log = yield* ThreadJournal;
  const lane = journalLaneFaces(yield* JournalOrder);
  const kinds = yield* ThreadEntryKinds;
  const deps: TransitionDeps<Unit<'machine'>, WriteUnit<'machine'>> = { store, log, transitions, lane, kinds };
  return {
    write: Effect.fn('JournaledTransitions.write')(function* (
      threadId: string,
      declare: (history: number) => ReturnType<typeof sealThreadEvents>,
      ran: (unit: WriteUnit<'machine'>) => Effect.Effect<void, ThreadStorageFailed>,
    ): Effect.fn.Return<HarnessTurnWrite | null, ThreadStorageFailed> {
      yield* log.open(threadId);
      const prepared = yield* prepareTransition(deps, threadId, (row) => declare(row.history.length)).pipe(
        Effect.catchTag('ThreadNotFound', () => Effect.succeed(null)),
        Effect.mapError((cause) => new ThreadStorageFailed({ call: 'harnessTurns.prepare', cause })),
      );
      if (prepared === null) return null;
      const declared = prepared.declared;
      const act = declared.map((event) => event.id).join(',');
      const key: Keyed = {
        evidence: { owned: { namespace: 'harness-turn', id: `${threadId}:${declared[0]!.id}` } },
        digest: actDigest({ threadId, act }),
      };
      const plan: TransitionPlan<null, WriteUnit<'machine'>> = {
        declared,
        owned: { read: () => Effect.succeed({ kind: 'absent' as const }), write: () => Effect.void },
        decide: () => Effect.succeed({ apply: true, result: null }),
      };
      return (unit: WriteUnit<'machine'>) =>
        transitionIn(deps, unit, prepared, plan, key).pipe(
          Effect.andThen(ran(unit)),
          Effect.asVoid,
          Effect.mapError((failure) =>
            failure instanceof ThreadVersionStaleError
              ? new HarnessTurnStale({ threadId })
              : failure instanceof ThreadStorageFailed
                ? failure
                : new ThreadStorageFailed({ call: 'harnessTurns.write', cause: failure }),
          ),
        );
    }),
  };
});
