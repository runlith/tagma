import type { Context } from 'effect';
import { Effect } from 'effect';
import { type ActivityEnding, activity, note } from '@runlith/activity/Activity';
import { type CollaborationNote, REPORT, type ReportResult } from './activities';
import type { EndingStages, ReportReceipt, RunEnded } from '../thread/ending';
import { isInboxRequest } from '../thread/inboxItems';
import { actDigest } from '../thread/keyed';
import type { ThreadRecord } from '../thread/record';
import type { ThreadContextReading } from '../thread/rows';
import type { AgentSignalContext } from '../agent/contracts';
import type { ThreadInbox, ThreadOwnWork } from '../thread/ThreadPorts';
import { THREAD_REQUEST_REQUESTER_GONE, type ThreadInboxItem, type ThreadInboxRequest } from '../thread/storage/inbox';
import { controlled, itemOf } from './envelopeActs';
import { sentTaskPrefixes, threadReportEnvelopeId, threadWithdrawnEnvelopeId } from './envelopeKeys';
import { isObligation, isTaken, newestByRequester, presentRequesters, requesterOf } from './ThreadObligations';
import type { ThreadEnvelopeInput, ThreadEnvelopeReceipt } from './ThreadEnvelopes';
import type { ThreadPlaneFailure } from './ThreadPlaneAccess';
import { completionReport, withdrawnRequestReport } from './reportTexts';
import type { ThreadRuns } from './runs';
import type { Threads } from './threads';

export type EnvelopeDelivery = (
  recipient: ThreadRecord,
  envelope: ThreadEnvelopeInput,
) => Effect.Effect<ThreadEnvelopeReceipt, ThreadPlaneFailure>;

export type ReportContext = (
  source: ThreadRecord,
  reading: ThreadContextReading | null,
) => Effect.Effect<AgentSignalContext | undefined, ThreadPlaneFailure>;

export const reportOwed = Effect.fnUntraced(function* (
  inbox: Context.Service.Shape<typeof ThreadInbox>,
  threads: Context.Service.Shape<typeof Threads>,
  runs: Context.Service.Shape<typeof ThreadRuns>,
  stages: Context.Service.Shape<typeof EndingStages>,
  own: Context.Service.Shape<typeof ThreadOwnWork>,
  deliver: EnvelopeDelivery,
  ended: RunEnded,
  contextOf: ReportContext,
): Effect.fn.Return<readonly ReportReceipt[], ThreadPlaneFailure> {
  const ownEnding = (item: ThreadInboxItem | undefined): boolean =>
    own !== null && item !== undefined && item.kind === 'signal' && own.endings.has(item.body.type);

  const working = Effect.fnUntraced(function* (threadId: string): Effect.fn.Return<boolean, ThreadPlaneFailure> {
    if (own === null) return false;
    if (yield* own.owed(threadId)) return true;
    return (yield* inbox.pending(threadId)).some(ownEnding);
  });

  const reported = (request: ThreadInboxRequest): Effect.Effect<boolean, ThreadPlaneFailure> =>
    request.deliveredToRunId === null
      ? Effect.succeed(false)
      : Effect.map(inbox.receipt(threadReportEnvelopeId(request.id, request.deliveredToRunId)), (item) => item !== undefined);

  const reporting = (request: ThreadInboxRequest): Effect.Effect<boolean, ThreadPlaneFailure> =>
    request.deliveredToRunId === null
      ? Effect.succeed(false)
      : Effect.map(stages.read(request.deliveredToRunId), (taking) => taking?.owed.includes('reported') === true);

  const awaiting: (
    threadId: string,
    pending: readonly ThreadInboxItem[],
    runId: string | null,
    seen: Set<string>,
  ) => Effect.Effect<boolean, ThreadPlaneFailure> = Effect.fnUntraced(function* (threadId, pending, runId, seen) {
    const reports = pending.filter(isReport);
    if (reports.some((item) => item.state === 'queued')) return true;
    if (yield* working(threadId)) return true;
    const taken = runId === null ? [] : reports.filter((item) => item.deliveredToRunId !== null && item.deliveredToRunId !== runId);
    if (taken.length > 0) {
      const current = yield* runs.current(threadId);
      if (current !== null && taken.some((item) => item.deliveredToRunId === current.runId)) return true;
    }
    seen.add(threadId);
    for (const request of yield* inbox.openRequestsUnder(sentTaskPrefixes(threadId))) {
      if (request.state === 'queued') return true;
      if (yield* reported(request)) continue;
      if ((yield* runs.current(request.threadId)) !== null || (yield* reporting(request))) return true;
      if (seen.has(request.threadId)) continue;
      if (yield* awaiting(request.threadId, yield* inbox.pending(request.threadId), null, seen)) return true;
    }
    return false;
  });

  const unreported = Effect.fnUntraced(function* (
    open: readonly ThreadInboxRequest[],
    answering: readonly ThreadInboxRequest[],
    resumed: boolean,
  ): Effect.fn.Return<readonly ThreadInboxRequest[], ThreadPlaneFailure> {
    const requesters = new Set(answering.map(requesterOf));
    const taken = open.filter(
      (request) =>
        isObligation(request) &&
        request.state === 'acknowledged' &&
        request.deliveredToRunId !== null &&
        request.deliveredToRunId !== ended.runId,
    );
    const late: ThreadInboxRequest[] = [];
    for (const request of newestByRequester(taken)) {
      if (requesters.has(requesterOf(request)) || (yield* reported(request))) continue;
      if (!resumed && (yield* reporting(request))) continue;
      late.push(request);
    }
    return late;
  });

  const report = Effect.fnUntraced(function* (
    source: ThreadRecord,
    request: ThreadInboxRequest,
    taken: string,
    text: string,
    context: AgentSignalContext | undefined,
  ): Effect.fn.Return<ReportReceipt | null, ThreadPlaneFailure> {
    if (request.sender.kind !== 'thread') return null;
    const envelopeId = threadReportEnvelopeId(request.id, taken);
    const targetThreadId = request.sender.threadId;
    const recipient = yield* threads.find(targetThreadId, source.principal);
    const envelope: ThreadEnvelopeInput = {
      id: envelopeId,
      senderThreadId: source.id,
      intent: 'report',
      text,
      inReplyTo: request.id,
      context,
    };
    if (recipient) {
      const outcome = yield* controlled<null>(
        inbox,
        source.id,
        {
          decide: (view) =>
            Effect.map(view.request(request.id), (standing) =>
              standing === null || standing.state === 'closed'
                ? { refuse: null }
                : {
                    apply: (writes) => Effect.asVoid(writes.put(itemOf(recipient, envelope, source, text))),
                    result: null,
                  },
            ),
        },
        {
          evidence: { envelope: { namespace: 'report', id: `${request.id}:${taken}` } },
          digest: actDigest({ requester: targetThreadId, text }),
        },
      );
      if (outcome.status !== 'done') return null;
    }
    const standing: { value: ActivityEnding<ReportResult> } = { value: {} };
    const recorded = (delivery: ThreadEnvelopeReceipt | null): Effect.Effect<ThreadEnvelopeReceipt | null> =>
      Effect.sync(() => {
        standing.value =
          delivery === null
            ? { outcome: 'refused', reason: 'RequesterNotOwned', message: `Thread ${targetThreadId} is not a thread of this owner.` }
            : { result: { status: delivery.status, targetRun: delivery.runId, acted: delivery.acted } };
        return delivery;
      });
    const delivered = yield* activity(
      REPORT,
      { envelope: envelopeId, request: request.id, target: targetThreadId },
      Effect.flatMap(recipient ? deliver(recipient, envelope) : Effect.succeed(null), recorded),
      {
        thread: ended.threadId,
        run: ended.runId,
        outside: { run: ended.runId },
        ended: () => standing.value,
      },
    );
    if (delivered === null) return null;
    return {
      requesterThreadId: targetThreadId,
      requestId: request.id,
      envelopeId,
      status: delivered.status,
      acted: delivered.acted,
    } satisfies ReportReceipt;
  });

  if (ended.work === 'keep-warm' || (stopped(ended) && ended.stoppedBy === 'model')) return [];
  const pending = yield* inbox.pending(ended.threadId);
  const claimed = ended.handled === null ? null : new Set(ended.handled);
  const candidates =
    ended.status === 'completed' && ended.handled !== null ? yield* Effect.forEach(ended.handled, (id) => inbox.receipt(id)) : pending;
  const unread = new Set(yield* inbox.unconfirmed(ended.threadId, ended.runId));
  const diagnosing = ended.status === 'cut' || (ended.status === 'failed' && ended.work !== 'compaction');
  const handled = candidates.filter((item): item is ThreadInboxRequest => {
    if (item === undefined || !isInboxRequest(item) || unread.has(item.id)) return false;
    if (claimed === null) return item.state === 'delivered' && item.deliveredToRunId === ended.runId;
    return claimed.has(item.id) && (item.state === 'delivered' || diagnosing || ended.status === 'completed');
  });
  const silent = stopped(ended) && ended.stoppedBy === 'reader';
  const completed = ended.status === 'completed';
  const closing = completed && ended.work === 'turn';
  const open = silent || (handled.length === 0 && !diagnosing && !closing) ? [] : yield* inbox.openRequests(ended.threadId);
  const openIds = new Set(open.map((request) => request.id));
  const handledOpen = handled.filter((request) => openIds.has(request.id));
  const answering: ThreadInboxRequest[] = [];
  for (const request of completed ? handledOpen : []) if (!(yield* reported(request))) answering.push(request);
  const consumed = claimed === null ? pending.filter((item) => item.deliveredToRunId === ended.runId) : candidates;
  const resumed = consumed.some((item) => item !== undefined && (isReport(item) || ownEnding(item)));
  const fallbacks = completed ? [...answering, ...(closing ? yield* unreported(open, handledOpen, resumed) : [])] : handledOpen;
  const held = completed && fallbacks.length > 0 && (yield* awaiting(ended.threadId, pending, ended.runId, new Set()));
  const interrupters = owedInterrupters(ended, pending);
  const owed = silent
    ? []
    : diagnosing
      ? [...handledOpen, ...open.filter((request) => isObligation(request) && isTaken(request) && request.deliveredToRunId !== ended.runId)]
      : held
        ? []
        : fallbacks;
  const source = owed.length === 0 ? null : yield* threads.find(ended.threadId, ended.principal);
  const stopper = source && stopped(ended) && ended.stoppedBy === 'parent' ? source.parentThreadId : null;
  const answered = source
    ? yield* presentRequesters(inbox, threads, {
        principal: source.principal,
        runId: ended.runId,
        owed: newestByRequester(owed).filter((request) => {
          const from = requesterOf(request);
          return from !== null && from !== stopper && !interrupters.has(from);
        }),
        open,
      })
    : [];
  yield* note<CollaborationNote>(
    {
      type: 'run-reporting',
      requests: handled.length,
      fallbacks: completed ? answered.length : 0,
      diagnoses: completed ? 0 : answered.length,
      held: held ? fallbacks.length : 0,
      closed: silent ? 0 : handled.length - handledOpen.length,
    },
    { run: ended.runId },
  );
  const receipts: ReportReceipt[] = [];
  if (source && answered.length > 0) {
    const context = yield* contextOf(source, ended.reading);
    for (const request of answered) {
      const taken = completed ? (request.deliveredToRunId ?? ended.ending) : ended.ending;
      const receipt = yield* report(source, request, taken, ended.report ?? completionReport(source, ended, taken), context);
      if (receipt !== null) receipts.push(receipt);
    }
  }
  if (ended.status === 'completed' && ended.handled === null) {
    yield* inbox.acknowledge(
      handled.map((request) => request.id),
      ended.runId,
    );
  }
  return receipts;
});

export const withdrawQueued = Effect.fnUntraced(function* (
  inbox: Context.Service.Shape<typeof ThreadInbox>,
  threads: Context.Service.Shape<typeof Threads>,
  deliver: EnvelopeDelivery,
  threadId: string,
  principal: string,
  inputId: string,
): Effect.fn.Return<boolean, ThreadPlaneFailure> {
  const thread = yield* threads.find(threadId, principal);
  if (!thread) return false;
  const promised: { value: { readonly envelope: ThreadEnvelopeInput; readonly to: ThreadRecord } | null } = { value: null };
  const outcome = yield* controlled<boolean>(
    inbox,
    thread.id,
    {
      decide: Effect.fnUntraced(function* (view) {
        const waiting = yield* view.item(inputId);
        if (!waiting || waiting.state !== 'queued' || !isInboxRequest(waiting)) return { refuse: false };
        const to = waiting.sender.kind === 'thread' ? yield* threads.find(waiting.sender.threadId, principal) : null;
        const envelope: ThreadEnvelopeInput | null =
          to === null
            ? null
            : {
                id: threadWithdrawnEnvelopeId(waiting.id),
                senderThreadId: thread.id,
                intent: 'report',
                text: withdrawnRequestReport(thread),
                inReplyTo: waiting.id,
              };
        return {
          apply: Effect.fnUntraced(function* (writes) {
            if (to !== null && envelope !== null) {
              yield* writes.put(itemOf(to, envelope, thread, envelope.text));
              promised.value = { envelope, to };
            }
            yield* writes.acknowledge([inputId], null);
            if (waiting.sender.kind === 'thread') {
              yield* writes.closeRequests([inputId], envelope?.id ?? THREAD_REQUEST_REQUESTER_GONE);
            }
          }),
          result: true,
        };
      }),
    },
    {
      evidence: { envelope: { namespace: 'withdrawn', id: inputId } },
      digest: actDigest({ thread: thread.id, item: inputId }),
    },
  );
  if (outcome.status !== 'done' || !outcome.result) return false;
  if (promised.value) yield* deliver(promised.value.to, promised.value.envelope);
  return true;
});

function isReport(item: ThreadInboxItem): boolean {
  return item.kind === 'envelope' && item.body.intent === 'report';
}

function stopped(ended: RunEnded): boolean {
  return ended.status === 'aborted' || ended.status === 'withdrawn';
}

function owedInterrupters(ended: RunEnded, pending: readonly ThreadInboxItem[]): ReadonlySet<string> {
  const threads = new Set<string>();
  if (!stopped(ended) || ended.stoppedBy !== 'agent') return threads;
  for (const item of pending) {
    if (!isInboxRequest(item) || item.body.intent !== 'interrupt' || item.state !== 'queued') continue;
    if (item.sender.kind === 'thread') threads.add(item.sender.threadId);
  }
  return threads;
}
