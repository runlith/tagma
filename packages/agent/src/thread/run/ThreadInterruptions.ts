import { waiters } from '@runlith/held/Waiters';
import { Effect, Exit } from 'effect';
import { THREAD_TOOL_INPUT_INTERRUPTED, type ThreadInterruptedInput } from '../../transcript/entries';
import { coreEntry } from '../../transcript/kinds';
import { toolEntryId } from '../../transcript/entryNames';
import type { ThreadTranscriptEntry } from '../../transcript/rows';
import { ThreadStore } from '../ThreadPorts';
import type { ThreadBorderFailed } from '../ThreadBorder';
import { ThreadRunLedger } from './ThreadRunLedger';

function inputOf(entry: ThreadTranscriptEntry | undefined): ThreadInterruptedInput | null {
  if (entry === undefined || !coreEntry(entry) || entry.type !== 'tool') return null;
  return entry.toolState === THREAD_TOOL_INPUT_INTERRUPTED ? (entry.toolInputRaw ?? null) : null;
}

export type ThreadInterruptionsInput = { readonly threadId: string; readonly runId: string };

export const makeThreadInterruptions = Effect.gen(function* () {
  const store = yield* ThreadStore;
  const ledger = yield* ThreadRunLedger;
  return Effect.fnUntraced(function* ({ threadId, runId }: ThreadInterruptionsInput) {
    const waiting = yield* waiters<string, void, ThreadBorderFailed>({
      name: 'interrupted call inputs',
      owner: '@runlith/agent/ThreadInterruptions',
      key: (toolCallId) => toolCallId,
    });
    let ended = false;
    const receipt = Effect.fn('ThreadInterruptions.receipt')(function* (
      toolCallId: string,
    ): Effect.fn.Return<ThreadInterruptedInput | null, ThreadBorderFailed> {
      const id = toolEntryId(toolCallId);
      const recorded = inputOf(yield* store.entryById(threadId, id));
      if (recorded) return recorded;
      const run = yield* ledger.latestRun(threadId);
      return run?.id === runId ? inputOf(run.streamTail?.find((entry) => entry.id === id)) : null;
    });
    const close = (): void => {
      ended = true;
      waiting.completeAll(Exit.void);
    };
    yield* Effect.addFinalizer(() => Effect.sync(close));
    return {
      took: (toolCallId: string): void => {
        waiting.complete(toolCallId, Exit.void);
      },
      settled: (toolCallIds: readonly string[]): Effect.Effect<ReadonlyMap<string, ThreadInterruptedInput>, ThreadBorderFailed> =>
        Effect.scoped(
          Effect.gen(function* () {
            const answered = new Map<string, ThreadInterruptedInput>();
            for (const id of toolCallIds) {
              for (;;) {
                const arrived = yield* waiting.watch([id]);
                const input = yield* receipt(id);
                if (input) answered.set(id, input);
                if (input || ended) break;
                yield* arrived;
              }
            }
            return answered;
          }),
        ),
      failed: (failure: ThreadBorderFailed): void => {
        waiting.completeAll(Exit.fail(failure));
      },
      close,
    };
  });
});
