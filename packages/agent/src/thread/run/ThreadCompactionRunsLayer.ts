import { Cause, Clock, Effect, Exit, Layer } from 'effect';
import { entryOf } from '../../transcript/kinds';
import { activity } from '@runlith/activity/Activity';
import { RUN } from '../../agent/activities';
import type { Message } from '@runlith/llm/schema/messages';
import type { ThreadCompactionEntry } from '../../transcript/entries';
import { compactionEntryId } from '../../transcript/entryNames';
import type { ThreadRunRow } from '../rows';
import type { ThreadInboxItemValues } from '../storage/inbox';
import { sealThreadEvents } from '../ThreadEventDoor';
import { actDigest } from '../keyed';
import { answerOf, transitionDeps, transitionNow } from '../transition/kernel';
import type { Decision } from '../transition/port';
import { threadCompactionEvent, threadPruningEvent, type ThreadHistoryFold } from '../events';
import { ThreadAttachments, ThreadInbox, ThreadToolRegistry, type ThreadWriteTx } from '../ThreadPorts';
import { ThreadCompactor } from './ThreadCompaction';
import { isCompactionRequest, keptWordsOf, namedSummarizerOf } from '../inboxItems';
import { ThreadNoSummarizerError } from '../storage/compaction';
import type { ThreadSummarizing } from '../compaction/summarizer';
import { ThreadAgents } from '../agents/ThreadAgents';
import { ThreadAgentDoors } from '../agents/ThreadAgentDoors';
import { admittedToolSources } from '../agents/admittedToolSources';
import { wireToolDefinitions } from '../../agent/ModelRequests';
import { deferredToolExclusions } from '../../agent/AgentDeferredTools';
import type { ThreadCompactionSettlement } from '../compaction/settlement';
import { ThreadCallBroke, type ThreadBorderFailed, threadCauseOf } from '../ThreadBorder';
import { ThreadRunAccounting } from './ThreadRunAccounting';
import { RunProgress } from './RunProgress';
import type { ThreadRunSettled } from './ThreadRunLedger';
import { RunExecution } from './RunExecution';
import { ThreadRunSettlements } from './ThreadRunSettlements';
import { ThreadSnapshots } from './ThreadSnapshots';
import { ThreadCompactionRuns, type ThreadCompactionRunInput, type ThreadCompactionTaken } from './ThreadCompactionRuns';
function compactionOutcome(status: ThreadRunSettled['status']): ThreadCompactionEntry['status'] {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'aborted':
    case 'cut':
    case 'withdrawn':
      return 'aborted';
  }
}
export const threadCompactionRunsLayer = Layer.effect(
  ThreadCompactionRuns,
  Effect.gen(function* () {
    const compactor = yield* ThreadCompactor;
    const inbox = yield* ThreadInbox;
    const execution = yield* RunExecution;
    const accounting = yield* ThreadRunAccounting;
    const progress = yield* RunProgress;
    const toolSources = yield* ThreadToolRegistry;
    const settlements = yield* ThreadRunSettlements;
    const snapshots = yield* ThreadSnapshots;
    const kernel = yield* transitionDeps;
    const store = kernel.store;
    const agents = yield* ThreadAgents;
    const doors = yield* ThreadAgentDoors;
    const attachments = yield* ThreadAttachments;
    const record = Effect.fn('ThreadCompactionRuns.recordEntry')(function* (
      threadId: string,
      compaction: ThreadCompactionEntry,
      moves: {
        readonly folded?: ThreadHistoryFold;
        readonly taken?: ThreadCompactionTaken;
      },
    ): Effect.fn.Return<undefined, ThreadBorderFailed> {
      const outcome = yield* transitionNow<undefined, ThreadWriteTx>(
        kernel,
        threadId,
        {
          declared: sealThreadEvents([threadCompactionEvent(compaction, moves.folded)]),
          decide: () =>
            Effect.succeed({
              apply: true,
              result: undefined,
              participants: (unit) => (moves.taken ? inbox.acknowledge(moves.taken.ids, moves.taken.runId, unit) : Effect.void),
            } as Decision<undefined, ThreadWriteTx>),
        },
        {
          evidence: { decidedBy: `compaction:${compaction.id}:${compaction.status}` },
          digest: actDigest(['compaction', compaction.id, compaction.status]),
        },
      ).pipe(
        Effect.catchTag('ThreadNotFound', () => Effect.fail(new ThreadCallBroke({ cause: new Error(`Thread not found: ${threadId}.`) }))),
      );
      return yield* answerOf(threadId, outcome);
    });
    const recordEntry = (
      threadId: string,
      compaction: ThreadCompactionEntry,
      folded?: ThreadHistoryFold,
      taken?: ThreadCompactionTaken,
    ): Effect.Effect<void, ThreadBorderFailed> => Effect.asVoid(record(threadId, compaction, { folded: folded, taken: taken }));
    const settle = Effect.fn('ThreadCompactionRuns.settle')(function* (
      threadId: string,
      settlement: ThreadCompactionSettlement,
      compaction: ThreadCompactionEntry,
      taken?: ThreadCompactionTaken,
      continuation?: ThreadInboxItemValues,
    ): Effect.fn.Return<boolean, ThreadBorderFailed> {
      const outcome = yield* transitionNow<boolean, ThreadWriteTx>(
        kernel,
        threadId,
        {
          declared: sealThreadEvents([threadCompactionEvent(compaction, settlement.replaced)]),
          decide: ({ row }) =>
            Effect.succeed<Decision<boolean, ThreadWriteTx>>(
              !settlement.covers(row.history)
                ? { refuse: false }
                : {
                    apply: true,
                    result: true,
                    participants: Effect.fnUntraced(function* (unit) {
                      yield* compactor.settleIn(settlement, unit);
                      if (taken) yield* inbox.acknowledge(taken.ids, taken.runId, unit);
                      if (continuation !== undefined) yield* inbox.put(continuation, unit);
                    }),
                  },
            ),
        },
        { evidence: { decidedBy: `compaction:${compaction.id}:settle` }, digest: actDigest(['compaction-settle', compaction.id]) },
      ).pipe(
        Effect.catchTag('ThreadNotFound', () => Effect.fail(new ThreadCallBroke({ cause: new Error(`Thread not found: ${threadId}.`) }))),
      );
      return yield* answerOf(threadId, outcome);
    });
    const settleEntries = (event: ThreadRunSettled): Effect.Effect<void, ThreadBorderFailed> => {
      const status = compactionOutcome(event.status);
      return transitionNow<undefined, ThreadWriteTx>(
        kernel,
        event.threadId,
        {
          declared: [],
          decide: Effect.fnUntraced(function* (_view, tx) {
            const taken = (yield* inbox.pending(event.threadId, tx))
              .filter((item) => isCompactionRequest(item) && item.state === 'delivered' && item.deliveredToRunId === event.runId)
              .map((item) => item.id);
            const updatedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
            const closing = (yield* store.entriesOfRun(event.threadId, event.runId, tx))
              .filter(entryOf('compaction'))
              .flatMap((compaction) => {
                if (compaction.runId !== event.runId || compaction.status !== 'running') return [];
                return [threadCompactionEvent({ ...compaction, status, updatedAt })];
              });
            return {
              apply: true,
              result: undefined,
              events: closing,
              participants: taken.length > 0 ? (unit: ThreadWriteTx) => inbox.acknowledge(taken, event.runId, unit) : undefined,
            } as Decision<undefined, ThreadWriteTx>;
          }),
        },
        { evidence: { decidedBy: `compaction-settled:${event.runId}` }, digest: actDigest(['compaction-settled', event.runId, status]) },
      ).pipe(
        Effect.asVoid,
        Effect.catchTag('ThreadNotFound', () => Effect.void),
      );
    };
    yield* settlements.subscribe({ name: 'compaction entries', handle: settleEntries });
    const opened = (input: ThreadCompactionRunInput, run: ThreadRunRow): ThreadCompactionEntry => ({
      type: 'compaction',
      id: compactionEntryId(run.id),
      runId: run.id,
      mode: input.mode ?? 'manual',
      status: 'running',
      occurredAt: run.startedAt.toISOString(),
      receipt: input.recovery === true ? { cause: 'overflow' } : undefined,
    });
    const intendedBy = (
      input: ThreadCompactionRunInput,
      compaction: ThreadCompactionEntry,
      summarizing: ThreadSummarizing,
    ): ThreadCompactionEntry => ({
      ...compaction,
      summarizer: compactor.intended(
        {
          provider: input.thread.provider,
          runId: compaction.runId,
          model: input.thread.model,
          reasoning: input.thread.reasoning,
          account: input.thread.account ?? undefined,
        },
        summarizing,
      ),
    });
    return ThreadCompactionRuns.of({
      recordEntry,
      settle,
      foldPruning: Effect.fn('ThreadCompactionRuns.foldPruning')(function* (threadId, settlement) {
        const declared = sealThreadEvents([threadPruningEvent(settlement.replaced)]);
        const outcome = yield* transitionNow<boolean, ThreadWriteTx>(
          kernel,
          threadId,
          {
            declared,
            decide: ({ row }) =>
              Effect.succeed<Decision<boolean, ThreadWriteTx>>(
                !settlement.covers(row.history)
                  ? { refuse: false }
                  : { apply: true, result: true, participants: (unit) => compactor.settleIn(settlement, unit) },
              ),
          },
          { evidence: { decidedBy: `pruning:${declared[0]!.id}` }, digest: actDigest(['pruning', declared[0]!.id]) },
        ).pipe(
          Effect.catchTag('ThreadNotFound', () => Effect.fail(new ThreadCallBroke({ cause: new Error(`Thread not found: ${threadId}.`) }))),
        );
        return yield* answerOf(threadId, outcome);
      }),
      opening: (input, run) => {
        const compaction = opened(input, run);
        return input.summarizing === undefined ? compaction : intendedBy(input, compaction, input.summarizing);
      },
      work: Effect.fn('ThreadCompactionRuns.work')(function* (input, run, held) {
        const compaction = opened(input, run);
        const intended = (summarizing: ThreadSummarizing) => intendedBy(input, compaction, summarizing);
        yield* accounting
          .progress(run.id, { stage: 'compacting', message: 'Compacting the thread context.' })
          .pipe(Effect.tapCause((cause) => execution.settle(run, cause)));
        yield* progress.enter(run, 'compacting', { since: run.startedAt.getTime() });
        const taken: ThreadCompactionTaken | undefined = held.length > 0 ? { runId: run.id, ids: held.map((item) => item.id) } : undefined;
        const withdrawn = input.requests?.alone === true && held.length === 0;
        const keep = keptWordsOf([input.keep, ...held.map((item) => item.body.keep)]);
        const compacting = activity(
          RUN,
          {
            provider: input.thread.provider,
            model: input.thread.model,
            reasoning: input.thread.reasoning,
            work: 'compaction',
          },
          Effect.gen(function* () {
            if (withdrawn) {
              yield* recordEntry(input.thread.id, {
                ...compaction,
                status: 'unchanged',
                updatedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
              });
              return yield* execution.complete(run);
            }
            let summarizing = input.summarizing;
            if (summarizing === undefined) {
              summarizing = yield* compactor.summarizing({
                threadId: input.thread.id,
                runId: run.id,
                provider: input.thread.provider,
                model: input.thread.model,
                running: false,
                compaction: input.recovery === true ? 'foreign' : input.thread.capabilities.compaction,
                named: namedSummarizerOf(held),
              });
              yield* recordEntry(input.thread.id, intended(summarizing));
              yield* snapshots.publish(input.thread.id);
            }
            const strategy = agents.find(input.thread.agentId)?.compaction;
            const result = yield* compactor.compact({
              threadId: input.thread.id,
              runId: run.id,
              ownerId: input.thread.ownerId,
              account: input.thread.account ?? undefined,
              cacheGroup: input.thread.cacheGroup,
              provider: input.thread.provider,
              model: input.thread.model,
              reasoning: input.thread.reasoning,
              switches: input.thread.switches,
              sourceMessages: input.thread.history,
              envelope: Effect.gen(function* () {
                const current = yield* store.find(input.thread.id);
                if (current === undefined || current.systemPrompt === null) {
                  return yield* new ThreadCallBroke({ cause: new Error('Compaction requires the thread frozen instructions.') });
                }
                const instructions = current.systemPrompt;
                const sources = yield* admittedToolSources(agents, toolSources, { thread: current, run });
                const context = yield* doors.toolContext({ thread: { ...current, transcript: [] }, run, sources });
                const catalog = context.catalog;
                const excluded = new Set(deferredToolExclusions(catalog, current.history));
                return yield* Effect.map(compactor.transcriptLocation(current.id), (transcriptLocation) => ({
                  instructions,
                  tools: wireToolDefinitions(
                    catalog,
                    Object.keys(catalog).filter((name) => !excluded.has(name)),
                  ),
                  transcriptLocation,
                  lower: (messages: readonly Message[]) => attachments.hydrate(current.id, messages),
                })).pipe(
                  Effect.tapCause(() => context.toolOutputs.dispose()),
                  Effect.tap(() => context.toolOutputs.dispose()),
                );
              }),
              keep: keep,
              summarizing,
              strategy: strategy,
            });
            yield* accounting.usage(run.id, result.usage);
            const summarized = result.summarizer === undefined ? {} : { summarizer: result.summarizer };
            if (result.settlement && input.releases) yield* input.releases;
            const settled = result.settlement
              ? yield* settle(
                  input.thread.id,
                  result.settlement,
                  {
                    ...compaction,
                    status: 'completed',
                    ...summarized,
                    updatedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
                  },
                  taken,
                  input.continuation,
                )
              : false;
            if (!settled) {
              yield* recordEntry(
                input.thread.id,
                {
                  ...compaction,
                  status: 'unchanged',
                  ...summarized,
                  updatedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
                },
                undefined,
                taken,
              );
            }
            yield* execution.complete(run);
          }),
          {
            thread: input.thread.id,
            run: run.id,
            actor: { kind: 'thread', id: input.thread.id },
            trigger: held.length === 0 ? null : { kind: 'inbox', refs: held.map((item) => item.id) },
          },
        );
        return Effect.uninterruptibleMask(
          Effect.fnUntraced(function* (restore) {
            const exit = yield* Effect.exit(restore(compacting));
            if (Exit.isSuccess(exit)) return;
            const stopped = Cause.hasInterruptsOnly(exit.cause);
            const refused = threadCauseOf(Cause.squash(exit.cause));
            const recorded = yield* Effect.exit(
              recordEntry(
                input.thread.id,
                {
                  ...compaction,
                  status: stopped ? 'aborted' : 'failed',
                  noSummarizer: refused instanceof ThreadNoSummarizerError ? { skipped: refused.skipped } : undefined,
                  updatedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
                },
                undefined,
                taken,
              ),
            );
            yield* execution.settle(run, exit.cause);
            if (!stopped) return yield* Effect.failCause(exit.cause);
            if (Exit.isFailure(recorded)) return yield* Effect.failCause(recorded.cause);
          }),
        );
      }),
    });
  }),
);
