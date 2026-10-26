import { Effect } from 'effect';
import type { ThreadCompactionEntry, ThreadToolEntry } from '../../../transcript/entries';
import type { ThreadTranscriptEntry } from '../../../transcript/rows';
import type { ThreadCompacted } from '../../run/scheduler/compactions';
import type { ThreadSaid } from '../../run/scheduler/inputs';
import { type Answer, EARLIER, OWNER, SCOPE, type Stack, compactionsOf, quiet, started, transcriptOf, until } from '../compactionWorld';
import type { ThreadStorageHarness } from '../storagePort';

export const spawnedChild = Effect.fnUntraced(function* <TTx, TWrite extends TTx = TTx>(stack: Stack<TTx, TWrite>, ...answers: Answer[]) {
  stack.world.answers.push(...answers);
  const spawned = yield* stack.world.harness.collaboration.spawn({
    parentThreadId: stack.threadId,
    ownerId: OWNER,
    requestId: 'call-spawn',
    agentId: stack.agentId,
    task: 'Do the work.',
  });
  return spawned.threadId;
});

export const compactAgentCall = Effect.fnUntraced(function* <TTx, TWrite extends TTx = TTx>(
  stack: Stack<TTx, TWrite>,
  input: Record<string, unknown>,
) {
  stack.world.answers.push({ call: 'compact_agent', input }, { text: 'Noted.' });
  const runId = yield* started(stack.handle, 'Compact the child.');
  yield* quiet(stack.world, stack.threadId);
  const call = (yield* transcriptOf(stack.storage, stack.threadId))
    .map((entry) => entry as unknown as ThreadToolEntry)
    .find((entry) => entry.type === 'tool' && entry.toolName === 'compact_agent' && entry.runId === runId);
  if (call === undefined) return yield* Effect.die('The parent never called compact_agent.');
  return call;
});

export function planned<TTx, TWrite extends TTx = TTx>(stack: Stack<TTx, TWrite>, threadId: string, ...answers: Answer[]): void {
  stack.world.lanes.set(threadId, [...(stack.world.lanes.get(threadId) ?? []), ...answers]);
}

export const sendTaskCall = Effect.fnUntraced(function* <TTx, TWrite extends TTx = TTx>(
  stack: Stack<TTx, TWrite>,
  input: Record<string, unknown>,
  ...after: Answer[]
) {
  planned(stack, stack.threadId, { call: 'send_task', input }, { text: 'Handed over.' }, ...after);
  const runId = yield* started(stack.handle, 'Hand the brief over.');
  let answered: ThreadToolEntry | undefined;
  yield* until(() =>
    Effect.map(transcriptOf(stack.storage, stack.threadId), (entries) => {
      answered = entries
        .map((entry) => entry as unknown as ThreadToolEntry)
        .find(
          (entry) =>
            entry.type === 'tool' &&
            entry.toolName === 'send_task' &&
            entry.runId === runId &&
            (entry.toolOutput !== undefined || entry.toolError !== undefined),
        );
      return answered !== undefined;
    }),
  );
  return answered!;
});

export const heardTimes = Effect.fnUntraced(function* <TTx, TWrite extends TTx = TTx>(
  stack: Stack<TTx, TWrite>,
  threadId: string,
  times: number,
) {
  yield* until(() => Effect.sync(() => (stack.world.heard.get(threadId)?.length ?? 0) >= times));
  yield* quiet(stack.world, threadId);
  return stack.world.heard.get(threadId) ?? [];
});

export const reportRead = <TTx, TWrite extends TTx = TTx>(stack: Stack<TTx, TWrite>, afterRunId: string | undefined) =>
  until(() =>
    Effect.map(
      stack.world.harness.reads.snapshot(stack.threadId),
      (state) =>
        state.activeRun === null &&
        state.latestRun !== null &&
        state.latestRun.id !== afterRunId &&
        state.latestRun.settledNotifiedAt !== null,
    ),
  );

export const seeded = Effect.fnUntraced(function* <TTx, TWrite extends TTx = TTx>(stack: Stack<TTx, TWrite>) {
  stack.world.answers.push({ text: EARLIER });
  yield* started(stack.handle, 'What stands so far?');
  yield* quiet(stack.world, stack.threadId);
});

export function compactionRunsOf(
  entries: readonly ThreadTranscriptEntry[],
): readonly (ThreadCompactionEntry & { readonly runId: string })[] {
  return compactionsOf(entries).flatMap((entry) =>
    entry.runId !== undefined && entry.id === `compaction:${entry.runId}` ? [{ ...entry, runId: entry.runId }] : [],
  );
}
export function onlyCompactionRun(entries: readonly ThreadTranscriptEntry[]): ThreadCompactionEntry & { readonly runId: string } {
  const runs = compactionRunsOf(entries);
  const [run] = runs;
  if (runs.length !== 1 || run === undefined) throw new Error(`Expected one compaction run, found ${runs.length}.`);
  return run;
}
export function requestOf(asked: ThreadCompacted): Extract<ThreadCompacted, { status: 'requested' }> {
  if (asked.status !== 'requested') throw new Error(`The compaction answered ${asked.status} instead of a request.`);
  return asked;
}
export function queuedIdOf(said: ThreadSaid): string {
  if (said.status !== 'queued') throw new Error(`The words answered ${said.status} instead of waiting.`);
  return said.queued.id;
}
export function userMessage(
  entries: readonly ThreadTranscriptEntry[],
  text: string,
): { readonly index: number; readonly runId: string | undefined } {
  const index = entries.findIndex(
    (entry) => entry.type === 'message' && (entry as { role?: string }).role === 'user' && (entry as { text?: string }).text === text,
  );
  return { index, runId: (entries[index] as { runId?: string } | undefined)?.runId };
}
export const standingOf = <TTx, TWrite extends TTx = TTx>(storage: ThreadStorageHarness<TTx, TWrite>, id: string) =>
  Effect.map(storage.inbox.receipt(id), (item) => (item === undefined ? undefined : { state: item.state, runId: item.deliveredToRunId }));
export const latestRun = <TTx, TWrite extends TTx = TTx>(storage: ThreadStorageHarness<TTx, TWrite>, threadId: string) =>
  storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(threadId);
export const PAID_SUMMARIZER = { provider: 'summarizer-x', model: 'x-1', reasoning: null, account: 'key-x' } as const;
export const SKIPPED_SUMMARIZER = { provider: 'summarizer-y', model: 'y-1', reason: 'quota', until: '2026-09-25T18:40:00.000Z' } as const;
