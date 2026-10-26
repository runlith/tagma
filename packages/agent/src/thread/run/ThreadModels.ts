import { Context, Deferred, Effect, Exit, Layer } from 'effect';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { ThreadModelChoice } from '../../agent/contracts';
import { actDigest, evidenceKey, type Keyed, type TransitionOutcome } from '../keyed';
import { ThreadStorageFailed } from '../persisted';
import type { ThreadMetadataRow } from '../rows';
import { ThreadActReusedError } from '../transition/port';
import type { ThreadBorderFailed } from '../ThreadBorder';
import { ThreadEventJournal, ThreadStore, ThreadTransitions, type ThreadWriteTx } from '../ThreadPorts';
import { answerOf, control } from '../transition/kernel';
import { ThreadJournalLane } from '../transition/lane';
import { ThreadEntryKinds } from '../../transcript/kinds';
import type { Decision } from '../transition/port';
import { ThreadRunLedger } from './ThreadRunLedger';

export type ThreadModelSettings = {
  readonly account?: string | null;
  readonly provider: string;
  readonly model: string;
  readonly reasoning: string | null;
  readonly switches: ModelSwitches;
};

export type ThreadModelChange = { readonly from: ThreadModelChoice; readonly to: ThreadModelChoice; readonly resume?: string };

export class ThreadModels extends Context.Service<
  ThreadModels,
  {
    set(thread: ThreadMetadataRow, settings: ThreadModelSettings): Effect.Effect<ThreadModelChange, ThreadBorderFailed>;
    move(
      thread: ThreadMetadataRow,
      key: Keyed,
      choose: (row: ThreadMetadataRow) => ThreadModelSettings,
      resume?: string,
    ): Effect.Effect<TransitionOutcome<ThreadModelChange | null>, ThreadBorderFailed>;
    adapted<E>(
      thread: ThreadMetadataRow,
      key: Keyed,
      act: Effect.Effect<ThreadModelChange | null, E>,
    ): Effect.Effect<TransitionOutcome<ThreadModelChange | null>, ThreadBorderFailed | E>;
  }
>()('@runlith/agent/ThreadModels') {}

const changeOf = (result: unknown): ThreadModelChange | null => {
  if (typeof result !== 'object' || result === null) return null;
  const { from, to } = result as { from?: unknown; to?: unknown };
  return typeof from === 'object' && from !== null && typeof to === 'object' && to !== null ? (result as ThreadModelChange) : null;
};

function landing(row: ThreadMetadataRow, chosen: ThreadModelSettings, resume?: string) {
  return {
    result: {
      from: { provider: row.provider, model: row.model, reasoning: row.reasoning },
      to: { provider: chosen.provider, model: chosen.model, reasoning: chosen.reasoning },
      resume,
    },
    patch: {
      account: chosen.account,
      provider: chosen.provider,
      model: chosen.model,
      reasoning: chosen.reasoning,
      switches: chosen.switches,
    },
  };
}

export const threadModelsLayer: Layer.Layer<
  ThreadModels,
  never,
  ThreadEventJournal | ThreadRunLedger | ThreadStore | ThreadTransitions | ThreadEntryKinds
> = Layer.effect(
  ThreadModels,
  Effect.gen(function* () {
    const ledger = yield* ThreadRunLedger;
    const store = yield* ThreadStore;
    const kernel = {
      store,
      log: yield* ThreadEventJournal,
      transitions: yield* ThreadTransitions,
      lane: yield* ThreadJournalLane,
      kinds: yield* ThreadEntryKinds,
    };

    const flying = new Map<string, { readonly digest: string; readonly done: Deferred.Deferred<ThreadModelChange | null, unknown> }>();

    const adapted = <E>(
      thread: ThreadMetadataRow,
      key: Keyed,
      act: Effect.Effect<ThreadModelChange | null, E>,
    ): Effect.Effect<TransitionOutcome<ThreadModelChange | null>, ThreadBorderFailed | E> =>
      Effect.suspend(() => {
        const reused = new ThreadActReusedError({ threadId: thread.id, evidence: key.evidence });
        const name = JSON.stringify([thread.id, evidenceKey(key.evidence)]);
        const standing = flying.get(name);
        if (standing !== undefined) {
          return standing.digest === key.digest
            ? Effect.map(
                Deferred.await(standing.done) as Effect.Effect<ThreadModelChange | null, ThreadBorderFailed | E>,
                (change) => ({ replayed: change }) as TransitionOutcome<ThreadModelChange | null>,
              )
            : Effect.fail(reused);
        }
        const done = Deferred.makeUnsafe<ThreadModelChange | null, unknown>();
        flying.set(name, { digest: key.digest, done });
        const run = Effect.gen(function* () {
          const reading = yield* kernel.transitions.readRecord(thread.id, key.evidence);
          if (reading.kind === 'present') {
            if (reading.digest !== key.digest) return yield* Effect.fail(reused);
            const change = changeOf(reading.result);
            if (change === null) {
              return yield* new ThreadStorageFailed({
                call: 'model.adapted',
                cause: new Error(`Thread ${thread.id}: the record under this key holds no model move.`),
              });
            }
            return { replayed: change } as TransitionOutcome<ThreadModelChange | null>;
          }
          if (reading.kind === 'spent') {
            return reading.digest !== key.digest
              ? yield* Effect.fail(reused)
              : ({ spent: { at: reading.at } } as TransitionOutcome<ThreadModelChange | null>);
          }
          if (reading.kind === 'before-epoch') return { spent: { at: 'before-epoch' } } as TransitionOutcome<ThreadModelChange | null>;
          if (reading.kind === 'standing' && reading.digest !== key.digest) return yield* Effect.fail(reused);
          const change = yield* act;
          if (change === null) return { committed: null } as TransitionOutcome<ThreadModelChange | null>;
          yield* store.transaction((tx) =>
            Effect.flatMap(kernel.transitions.readRecord(thread.id, key.evidence, tx), (written) =>
              written.kind === 'present'
                ? Effect.void
                : kernel.transitions.writeRecord(thread.id, key.evidence, { digest: key.digest, result: change }, tx),
            ),
          );
          return { committed: change } as TransitionOutcome<ThreadModelChange | null>;
        });
        return run.pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              flying.delete(name);
              Deferred.doneUnsafe(
                done,
                Exit.map(exit, (outcome) => ('committed' in outcome ? outcome.committed : 'replayed' in outcome ? outcome.replayed : null)),
              );
            }),
          ),
        );
      });

    return ThreadModels.of({
      adapted,

      set: (thread, settings) =>
        Effect.flatMap(
          control<ThreadModelChange, ThreadWriteTx>(
            kernel,
            thread.id,
            { decide: (row) => Effect.succeed({ apply: true, ...landing(row, settings) } as Decision<ThreadModelChange, ThreadWriteTx>) },
            { evidence: { decidedBy: `model:${thread.id}` }, digest: actDigest(['model', thread.id, settings]) },
          ),
          (outcome) => answerOf(thread.id, outcome),
        ),

      move: (thread, key, choose, resume) =>
        control<ThreadModelChange | null, ThreadWriteTx>(
          kernel,
          thread.id,
          {
            decide: Effect.fnUntraced(function* (row, tx) {
              if (yield* ledger.activeRunIn(row.id, tx)) return { refuse: null } as Decision<ThreadModelChange | null, ThreadWriteTx>;
              return { apply: true, ...landing(row, choose(row), resume) } as Decision<ThreadModelChange | null, ThreadWriteTx>;
            }),
          },
          key,
        ),
    });
  }),
);
