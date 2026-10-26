import { Effect } from 'effect';
import { ActivityCause } from '@runlith/activity/cause';
import type { ThreadInterruptedInput } from '../../../transcript/entries';
import { type ThreadSignal } from '../../../transcript/parts';
import type { ThreadTranscriptEntry } from '../../../transcript/rows';
import type { ThreadPreparedRun, ThreadRunHandle, ThreadRunStartInput } from '../../agents/ThreadAgent';
import { ThreadAgents } from '../../agents/ThreadAgents';
import { keptWordsOf, namedSummarizerOf } from '../../inboxItems';
import { ThreadNotFoundError } from '../../storage/aggregate';
import type { ThreadBorderFailed } from '../../ThreadBorder';
import { ThreadInputRecoveries, ThreadInbox, ThreadRunRules, type ThreadTx, type ThreadWriteTx } from '../../ThreadPorts';
import type { TransitionDeps } from '../../transition/kernel';
import { KEEP_WARM_REFUSAL } from '../keepWarmRun';
import { runCause } from '../runCause';
import { makeThreadContextAnchors } from '../ThreadContextAnchor';
import { ThreadRunInbox } from '../ThreadRunInbox';
import { makeRunBoundary } from './boundary';
import { RunExecution } from '../RunExecution';
import type { RunOutputs } from './outputs';
import type { PromptFreeze } from './prompt';
import { makeRunSignals } from './signals';
export type NativeStart = ThreadRunStartInput & {
  readonly prepared: ThreadPreparedRun<ThreadWriteTx>;
  readonly outputs: RunOutputs;
  readonly keepWarm: boolean;
  readonly onProgress?: Effect.Effect<void, ThreadBorderFailed>;
  readonly onSignalsDelivered?: (signals: readonly ThreadSignal[]) => Effect.Effect<void, ThreadBorderFailed>;
  readonly flushRecorded?: Effect.Effect<void, ThreadBorderFailed>;
  readonly interruptedRecorded?: (
    toolCallIds: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, ThreadInterruptedInput>, ThreadBorderFailed>;
};
export const makeNativeRuns = Effect.fnUntraced(function* ({
  kernel,
  prompt,
}: {
  readonly kernel: TransitionDeps<ThreadTx, ThreadWriteTx>;
  readonly prompt: PromptFreeze;
}) {
  const agents = yield* ThreadAgents;
  const rules = yield* ThreadRunRules;
  const contextAnchor = yield* makeThreadContextAnchors;
  const inbox = yield* ThreadInbox;
  const runInbox = yield* ThreadRunInbox;
  const recoveries = yield* ThreadInputRecoveries;
  const execution = yield* RunExecution;
  const runSignals = yield* makeRunSignals({ kernel });
  const runBoundary = yield* makeRunBoundary;
  const start = ({
    prepared,
    outputs,
    onProgress,
    onSignalsDelivered,
    flushRecorded,
    interruptedRecorded,
    keepWarm,
    ...input
  }: NativeStart): Effect.Effect<ThreadRunHandle<ThreadTx>, ThreadBorderFailed> => {
    const { outputScope, heldScope, supply } = outputs;
    const signals = runSignals.of(input.thread.id, input.thread.ownerId, input.run.id, keepWarm, flushRecorded, onSignalsDelivered);
    const ref = { id: input.run.id, threadId: input.thread.id };
    const recorded = (flushRecorded ?? Effect.void).pipe(
      Effect.andThen(kernel.store.historyOf(input.thread.id)),
      Effect.flatMap((history) => (history === null ? Effect.fail(new ThreadNotFoundError(input.thread.id)) : Effect.succeed(history))),
    );
    const anchor = contextAnchor({
      thread: input.thread,
      runId: input.run.id,
      model: input.model,
      strategy: agents.find(input.thread.agentId)?.compaction,
      outputScope,
      history: recorded,
      requests: {
        take: () =>
          Effect.map(runInbox.takeRequest(ref), (items) => {
            if (items.length === 0) return null;
            const keep = keptWordsOf(items.map((item) => item.body.keep));
            const summarizer = namedSummarizerOf(items);
            return {
              ids: items.map((item) => item.id),
              keep: keep,
              summarizer: summarizer,
            };
          }),
      },
      onProgress,
    });
    const boundary = runBoundary(ref, supply, () => input.stop.stopped);
    return Effect.gen(function* () {
      let systemPromptEntry: ThreadTranscriptEntry | null = null;
      const delivered = yield* inbox.delivered(input.thread.id, input.run.id);
      const handle = yield* prepared
        .start({
          ...input,
          commitInstructions:
            input.instructions === undefined
              ? (instructions: string) =>
                  prompt.frozen(input.thread.id, input.run.id, instructions, (entry) => {
                    systemPromptEntry = entry;
                  })
              : input.commitInstructions,
          toolOutputs: heldScope,
          recovery:
            recoveries !== null && interruptedRecorded
              ? recoveries.of({ threadId: input.thread.id, runId: input.run.id, recorded: interruptedRecorded })
              : undefined,
          boundary: (input) => Effect.andThen(execution.checkpoint(ref), boundary(input)),
          context: anchor,
          signals: signals.port,
          rules: rules.rules(input.thread),
          oneStep: keepWarm ? { refusal: KEEP_WARM_REFUSAL } : undefined,
          keepWarm: keepWarm ? true : undefined,
        })
        .pipe(Effect.provideService(ActivityCause, runCause(input.thread.id, input.run.id, delivered, input.thread.transcript)));
      return {
        ...handle,
        toolOutputs: heldScope,
        systemPromptEntry,
        contextWindow: () => anchor.contextWindow(),
        inputLimit: () => anchor.inputLimit(),
      };
    }).pipe(Effect.onError(() => Effect.sync(() => signals.release())));
  };
  return { start };
});
