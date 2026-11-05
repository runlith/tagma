import { Context, Effect, Layer } from 'effect';
import type { Cursor } from '@runlith/paging';
import { agentSpan } from '../agent/spans';
import type { ToolEffectSettlement } from '../agent/tool';
import { EndingStages, type ReportReceipt, type RunEnded } from '../thread/ending';
import { barrierIdAhead, behindBarrierId } from '../thread/inboxItems';
import { actDigest, type Keyed } from '../thread/keyed';
import { causeSentence } from '../thread/persisted';
import { threadTarget, type ThreadRecord, type ThreadTarget } from '../thread/record';
import { ThreadCallBroke, threadCauseOf } from '../thread/ThreadBorder';
import { ThreadInbox, ThreadOwnWork, ThreadResting } from '../thread/ThreadPorts';
import {
  THREAD_REQUEST_REQUESTER_GONE,
  type ThreadInboxItem,
  type ThreadInboxRequest,
  type ThreadInputAcceptance,
} from '../thread/storage/inbox';
import type { ThreadSummarizerSkip } from '../transcript/entries';
import { collectReports, type ThreadWaitArrival, type ThreadWaitAsk, type ThreadWaitResult, waitForArrivals } from './arrivals';
import { DeclaredCollaboration } from './CollaborationConfig';
import { ContextCompaction } from './compaction';
import { actDeadline, controlled, itemOf } from './envelopeActs';
import { ThreadDirectory } from './ThreadDirectory';
import { isObligation, isTaken, notedClosed, requesterOf, threadFinalEnvelopeId } from './ThreadObligations';
import type { ThreadChildSummarizer, ThreadPlaneFailure } from './ThreadPlaneAccess';
import {
  finalEnvelope,
  finalKey,
  sameEnvelope,
  sendEvidence,
  threadEnvelopeId,
  threadReportEnvelopeId,
  type FinalAnswered,
} from './envelopeKeys';
import { planeRefused } from './planeRefusal';
import { resolveThread } from './reach';
import { reportOwed, withdrawQueued } from './reporting';
import { ThreadRuns } from './runs';
import { type ThreadDirectoryRow, Threads } from './threads';
import { type ColdRecipient, wakeWords } from './wakeCost';
import { makeWakes } from './wakes';
import type { AgentSignalContext, WakeCost } from '../agent/contracts';

export type ThreadEnvelopeIntent = 'message' | 'task' | 'report' | 'interrupt' | 'approval';

export type ThreadEnvelopeInput = {
  readonly id: string;
  readonly senderThreadId: string | null;
  readonly intent: ThreadEnvelopeIntent;
  readonly text: string;
  readonly inReplyTo?: string | null;
  readonly context?: AgentSignalContext;
};

export type ThreadEnvelopeRecipient = ThreadTarget & {
  readonly name: string | null;
  readonly sameTeam: boolean;
};

export type ThreadEnvelopeReceipt = {
  readonly envelopeId: string;
  readonly intent: ThreadEnvelopeIntent;
  readonly status: 'delivered' | 'queued' | 'woken' | 'stored';
  readonly runId: string | null;
  readonly acted: boolean;
  readonly recipient: ThreadEnvelopeRecipient;
  readonly closed?: readonly string[];
  readonly acceptance?: ThreadInputAcceptance;
  readonly compaction?: { readonly requestId: string; readonly runId: string | null; readonly summarizer: ThreadChildSummarizer | null };
  readonly cache?: string;
};

export type ThreadDeliveryPending = {
  readonly envelopeId: string;
  readonly intent: ThreadEnvelopeIntent;
  readonly status: 'pending';
  readonly runId: null;
  readonly acted: false;
  readonly recipient: ThreadEnvelopeRecipient;
  readonly failure: string;
};

export type ThreadSent = {
  readonly status: 'sent';
  readonly deliveries: readonly (ThreadEnvelopeReceipt | ThreadDeliveryPending)[];
};

export type ThreadSendRefused =
  | { readonly status: 'refused'; readonly code: 'no-open-request' | 'final-in-reply' | 'final-to-many' | 'compact-to-many' }
  | { readonly status: 'refused'; readonly code: 'cold-wake'; readonly cold: readonly ColdRecipient[] };

export type ThreadCompactRefused = {
  readonly status: 'refused';
  readonly code: 'no-summarizer';
  readonly skipped: readonly ThreadSummarizerSkip[];
};

export type ThreadAddressUnknown = {
  readonly status: 'not-found';
  readonly addresses: readonly string[];
  readonly addressable: readonly string[];
};

export type ThreadEnvelopeSender = { readonly id: string; readonly principal: string };

export function answerIdsOf(requestId: string, takenBy: string): readonly string[] {
  return [threadFinalEnvelopeId(requestId), threadReportEnvelopeId(requestId, takenBy)];
}

export type ThreadSendIntent = Exclude<ThreadEnvelopeIntent, 'report' | 'approval'>;

export type ThreadSendAsk = {
  readonly to: readonly string[];
  readonly intent: ThreadSendIntent;
  readonly text: string;
  readonly key: string;
  readonly inReplyTo?: string;
  readonly final?: boolean;
  readonly wake?: boolean;
};

export type ThreadRecipients = { readonly holder: ThreadRecord | null; readonly recipients: readonly ThreadRecord[] };

export type ThreadSendAheadAsk = { to: readonly string[]; text: string; keep: string; key: string };

export type ThreadMessagingAccess = {
  send(input: ThreadSendAsk): Effect.Effect<ThreadSent | ThreadAddressUnknown | ThreadSendRefused, ThreadPlaneFailure>;
  recipients(to: readonly string[]): Effect.Effect<ThreadRecipients | ThreadAddressUnknown, ThreadPlaneFailure>;
  sendAhead(
    recipient: ThreadRecord,
    input: ThreadSendAheadAsk,
  ): Effect.Effect<ThreadEnvelopeReceipt | ThreadCompactRefused, ThreadPlaneFailure>;
  settle(input: ThreadSendAsk, ahead: boolean): Effect.Effect<ToolEffectSettlement<ThreadSent>, ThreadPlaneFailure>;
  waitFor(input: ThreadWaitAsk): Effect.Effect<ThreadWaitResult, ThreadPlaneFailure>;
  collect(input: ThreadWaitAsk): Effect.Effect<ReadonlyMap<string, ThreadWaitArrival>, ThreadPlaneFailure>;
};

export class ThreadEnvelopes extends Context.Service<
  ThreadEnvelopes,
  {
    deliver(recipient: ThreadRecord, envelope: ThreadEnvelopeInput): Effect.Effect<ThreadEnvelopeReceipt, ThreadPlaneFailure>;
    completeRun(ended: RunEnded): Effect.Effect<readonly ReportReceipt[], ThreadPlaneFailure>;
    withdrawRequest(threadId: string, principal: string, inputId: string): Effect.Effect<boolean, ThreadPlaneFailure>;
    access(sender: ThreadEnvelopeSender, runId?: string): ThreadMessagingAccess;
  }
>()('@runlith/agent/ThreadEnvelopes') {}

const TEAM_READ_PAGE = 200;

const FINAL_ATTEMPTS = 3;

export const threadEnvelopesLayer = Layer.effect(
  ThreadEnvelopes,
  Effect.gen(function* () {
    const compaction = yield* ContextCompaction;
    const collaboration = yield* DeclaredCollaboration;
    const directory = yield* ThreadDirectory;
    const inbox = yield* ThreadInbox;
    const runs = yield* ThreadRuns;
    const stages = yield* EndingStages;
    const threads = yield* Threads;
    const resting = yield* ThreadResting;
    const own = yield* ThreadOwnWork;
    const wakes = yield* makeWakes;
    const reconcileMs = collaboration?.reconcileIntervalMs ?? Number.POSITIVE_INFINITY;

    const claimKey = (holderId: string, key: string, content: unknown): Effect.Effect<void, ThreadPlaneFailure> =>
      Effect.asVoid(
        controlled<null>(
          inbox,
          holderId,
          { decide: () => Effect.succeed({ apply: () => Effect.void, result: null }) },
          { evidence: sendEvidence(holderId, key), digest: actDigest(content) },
        ),
      );

    const senderOf = (envelope: ThreadEnvelopeInput, recipient: ThreadRecord): Effect.Effect<ThreadRecord | null, ThreadPlaneFailure> =>
      envelope.senderThreadId === null ? Effect.succeed(null) : threads.find(envelope.senderThreadId, recipient.principal);

    const recipientOf = Effect.fnUntraced(function* (recipient: ThreadRecord, envelope: ThreadEnvelopeInput) {
      const sender = envelope.senderThreadId === null ? null : yield* threads.find(envelope.senderThreadId, recipient.principal);
      return {
        ...threadTarget(recipient),
        name: recipient.name,
        sameTeam: sender === null || sender.spawnRootId === recipient.spawnRootId,
      };
    });

    const unknownAddresses = Effect.fnUntraced(function* (
      sender: ThreadEnvelopeSender,
      from: ThreadRecord | null,
      addresses: readonly string[],
    ) {
      const addressable: string[] = [];
      let cursor: Cursor | null = null;
      while (from !== null) {
        const page: { readonly rows: readonly ThreadDirectoryRow[]; readonly cursor: Cursor | null } = yield* threads.list({
          principal: sender.principal,
          from: sender.id,
          limit: TEAM_READ_PAGE,
          cursor: cursor ?? undefined,
        });
        for (const row of page.rows) {
          if (row.name !== null && row.threadId !== sender.id && row.spawnRootId === from.spawnRootId) addressable.push(row.name);
        }
        cursor = page.cursor;
        if (cursor === null) break;
      }
      return { status: 'not-found' as const, addresses, addressable } satisfies ThreadAddressUnknown;
    });

    const addressed = Effect.fnUntraced(function* (sender: ThreadEnvelopeSender, addresses: readonly string[]) {
      const holder = yield* threads.find(sender.id, sender.principal);
      const found = new Map<string, ThreadRecord | null>();
      for (const address of addresses) {
        if (found.has(address)) continue;
        found.set(
          address,
          holder === null ? yield* threads.find(address, sender.principal) : yield* resolveThread(threads, holder, address),
        );
      }
      return { holder, found };
    });

    const recipientsOf = Effect.fnUntraced(function* (
      sender: ThreadEnvelopeSender,
      addresses: readonly string[],
    ): Effect.fn.Return<ThreadRecipients | ThreadAddressUnknown, ThreadPlaneFailure> {
      const { holder, found } = yield* addressed(sender, addresses);
      const unknown = [...found].flatMap(([address, record]) => (record === null ? [address] : []));
      if (unknown.length > 0) return yield* unknownAddresses(sender, holder, unknown);
      const recipients = new Map<string, ThreadRecord>();
      for (const record of found.values()) if (record !== null && !recipients.has(record.id)) recipients.set(record.id, record);
      return { holder, recipients: [...recipients.values()] };
    });

    const reachedOf = (holder: ThreadRecord | null, recipient: ThreadRecord): ThreadEnvelopeRecipient => ({
      ...threadTarget(recipient),
      name: recipient.name,
      sameTeam: holder === null || holder.spawnRootId === recipient.spawnRootId,
    });

    const act = Effect.fnUntraced(function* (
      recipient: ThreadRecord,
      item: ThreadInboxItem,
    ): Effect.fn.Return<
      { status: ThreadEnvelopeReceipt['status']; runId: string | null; acted: boolean; acceptance?: ThreadInputAcceptance },
      ThreadPlaneFailure
    > {
      const answer = yield* runs.deliver(recipient.id, { item, deadline: yield* actDeadline });
      return answer.status === 'spent' ? { status: 'stored' as const, runId: null, acted: false } : answer;
    });

    const refused = (code: Exclude<ThreadSendRefused['code'], 'cold-wake'>): ThreadSendRefused => ({ status: 'refused', code });

    const awake = Effect.fnUntraced(function* (recipients: readonly ThreadRecord[]) {
      if (resting === null) return;
      for (const recipient of recipients) {
        if (!(yield* resting.resting(recipient.id))) continue;
        return yield* planeRefused(
          'thread-archived',
          `thread ${recipient.name ?? recipient.id} is archived and starts no turn until it is brought back; nothing was sent.`,
        );
      }
    });

    const deliver = Effect.fnUntraced(function* (recipient: ThreadRecord, envelope: ThreadEnvelopeInput) {
      const text = envelope.text.trim();
      if (!text) return yield* new ThreadCallBroke({ cause: new Error('An envelope carries no words.') });
      const from = yield* senderOf(envelope, recipient);
      const accepted = yield* inbox.put(itemOf(recipient, envelope, from, text));
      if (!accepted.fresh && !sameEnvelope(accepted.item, recipient.id, envelope, text)) {
        return yield* planeRefused(
          'key-reused',
          `envelope ${accepted.item.id} already went to thread ${accepted.item.threadId} with other words; a changed send needs a key of its own.`,
        );
      }
      const reached = yield* recipientOf(recipient, envelope);
      const intent = accepted.item.kind === 'task' || accepted.item.kind === 'envelope' ? accepted.item.body.intent : envelope.intent;
      const effect = yield* act(recipient, accepted.item).pipe(
        agentSpan({
          type: 'delivery',
          envelopeId: accepted.item.id,
          intent,
          senderThreadId: envelope.senderThreadId,
          targetThreadId: recipient.id,
        }),
      );
      return {
        envelopeId: accepted.item.id,
        intent,
        ...effect,
        recipient: reached,
      } satisfies ThreadEnvelopeReceipt;
    });

    const answerFinally = Effect.fnUntraced(function* (
      runId: string | undefined,
      holder: ThreadRecord | null,
      target: ThreadRecord | ThreadAddressUnknown,
      input: ThreadSendAsk,
    ): Effect.fn.Return<ThreadEnvelopeReceipt | ThreadAddressUnknown | ThreadSendRefused, ThreadPlaneFailure> {
      const text = input.text.trim();
      if (!text) return yield* new ThreadCallBroke({ cause: new Error('An envelope carries no words.') });
      if (!holder) return refused('no-open-request');
      if ('addressable' in target) {
        const named = (yield* inbox.openRequests(holder.id)).filter((request) => {
          const from = request.sender;
          return from.kind === 'thread' && target.addresses.some((address) => from.threadId === address || from.name === address);
        });
        const orphaned: ThreadInboxRequest[] = [];
        for (const request of named) {
          const from = requesterOf(request);
          if (from !== null && (yield* threads.find(from, holder.principal)) === null) orphaned.push(request);
        }
        if (orphaned.length === 0) return target;
        const closed = yield* inbox.closeRequests(
          orphaned.map((request) => request.id),
          THREAD_REQUEST_REQUESTER_GONE,
        );
        yield* notedClosed(orphaned, closed, THREAD_REQUEST_REQUESTER_GONE, runId);
        return refused('no-open-request');
      }
      const recipient = target;
      const context = yield* wakes.contextOf(holder);
      for (let attempt = 0; attempt < FINAL_ATTEMPTS; attempt += 1) {
        const held = (yield* inbox.openRequests(holder.id)).filter((request) => requesterOf(request) === recipient.id && isTaken(request));
        const answering = held.filter(isObligation).at(-1);
        const written: { closed: readonly string[] } = { closed: [] };
        const outcome = yield* controlled<FinalAnswered | null>(
          inbox,
          holder.id,
          {
            decide: (view) =>
              answering === undefined
                ? Effect.succeed({ refuse: null })
                : Effect.map(view.newestTaken(holder.id, recipient.id), (newest) =>
                    newest?.id !== answering.id
                      ? { refuse: null }
                      : {
                          apply: Effect.fnUntraced(function* (writes) {
                            yield* writes.put(itemOf(recipient, finalEnvelope(holder, answering.id, text, context), holder, text));
                            written.closed = yield* writes.closeRequests(
                              held.map((request) => request.id),
                              threadFinalEnvelopeId(answering.id),
                            );
                          }),
                          result: { requestId: answering.id, closed: held.map((request) => request.id) },
                        },
                  ),
          },
          finalKey(holder.id, input),
        );
        if (outcome.status === 'spent') return refused('no-open-request');
        if (outcome.status === 'refused' || outcome.result === null) {
          if (answering !== undefined) continue;
          const unfinished = yield* finishAccepted(holder, recipient, text, ['queued']);
          return unfinished ?? refused('no-open-request');
        }
        const envelope = finalEnvelope(holder, outcome.result.requestId, text, context);
        if (outcome.acted) yield* notedClosed(held, written.closed, envelope.id, runId);
        const receipt = yield* deliver(recipient, envelope);
        return { ...receipt, closed: outcome.acted ? written.closed : outcome.result.closed };
      }
      return refused('no-open-request');
    });

    const keyReused = (key: string) =>
      planeRefused('key-reused', `the key ${key} already names another send; a changed send needs a key of its own.`);

    const acceptedUnder = Effect.fnUntraced(function* (sender: ThreadEnvelopeSender, input: ThreadSendAsk, ahead = false) {
      const at = (position: number) => {
        const id = threadEnvelopeId(input.intent, sender.id, input.key, position);
        return inbox.receipt(ahead ? behindBarrierId(barrierIdAhead({ id }), id) : id);
      };
      const first = yield* at(0);
      if (first === undefined) return null;
      const rest = yield* Effect.forEach(input.to.slice(1), (_address, position) => at(position + 1));
      return [first, ...rest.filter((item): item is ThreadInboxItem => item !== undefined)];
    });

    const deliverAll = Effect.fnUntraced(function* (
      sender: ThreadEnvelopeSender,
      holder: ThreadRecord | null,
      items: readonly ThreadInboxItem[],
      known: ReadonlyMap<string, ThreadRecord>,
      costs: ReadonlyMap<string, WakeCost> = new Map(),
    ): Effect.fn.Return<ThreadSent, ThreadPlaneFailure> {
      const deliveries: (ThreadEnvelopeReceipt | ThreadDeliveryPending)[] = [];
      for (const item of items) {
        if (item.kind !== 'task' && item.kind !== 'envelope') continue;
        const recipient = known.get(item.threadId) ?? (yield* threads.find(item.threadId, sender.principal));
        if (!recipient) continue;
        const sent = { envelopeId: item.id, intent: item.body.intent, recipient: reachedOf(holder, recipient) };
        const done = yield* Effect.result(
          act(recipient, item).pipe(
            agentSpan({
              type: 'delivery',
              envelopeId: item.id,
              intent: item.body.intent,
              senderThreadId: sender.id,
              targetThreadId: recipient.id,
            }),
          ),
        );
        const cost = costs.get(recipient.id);
        deliveries.push(
          done._tag === 'Success'
            ? { ...sent, ...done.success, cache: cost === undefined ? undefined : wakeWords(cost) }
            : {
                ...sent,
                status: 'pending' as const,
                runId: null,
                acted: false as const,
                failure: causeSentence(threadCauseOf(done.failure)),
              },
        );
      }
      yield* inbox.woke(deliveries.flatMap((receipt) => (receipt.status === 'pending' ? [] : [receipt.envelopeId])));
      return { status: 'sent', deliveries };
    });

    const sentAgain = (sender: ThreadEnvelopeSender, standing: readonly ThreadInboxItem[]) =>
      Effect.flatMap(threads.find(sender.id, sender.principal), (holder) => deliverAll(sender, holder, standing, new Map()));

    const fanOut = Effect.fnUntraced(function* (
      sender: ThreadEnvelopeSender,
      input: ThreadSendAsk,
    ): Effect.fn.Return<ThreadSent | ThreadAddressUnknown | ThreadSendRefused, ThreadPlaneFailure> {
      const text = input.text.trim();
      if (!text) return yield* new ThreadCallBroke({ cause: new Error('An envelope carries no words.') });
      const inReplyTo = input.inReplyTo || null;
      const key: Keyed = {
        evidence: sendEvidence(sender.id, input.key),
        digest: actDigest({ to: input.to, intent: input.intent, text, inReplyTo }),
      };
      const standing = yield* acceptedUnder(sender, input);
      if (standing !== null) {
        const recorded = yield* controlled<null>(inbox, sender.id, { decide: () => Effect.succeed({ refuse: null }) }, key);
        return recorded.status === 'done' ? yield* sentAgain(sender, standing) : yield* keyReused(input.key);
      }
      const resolved = yield* recipientsOf(sender, input.to);
      if ('addressable' in resolved) return resolved;
      const { holder, recipients } = resolved;
      yield* awake(recipients);
      const prices = holder === null || input.intent === 'interrupt' ? null : yield* wakes.priced(holder, recipients);
      const checked = prices !== null && input.wake !== true && inReplyTo === null;
      if (checked && prices.cold.length > 0) return { status: 'refused', code: 'cold-wake', cold: prices.cold } satisfies ThreadSendRefused;
      const values = recipients.map((recipient, position) =>
        itemOf(
          recipient,
          {
            id: threadEnvelopeId(input.intent, sender.id, input.key, position),
            senderThreadId: sender.id,
            intent: input.intent,
            text,
            inReplyTo,
          },
          holder,
          text,
        ),
      );
      const staged: { items: readonly ThreadInboxItem[] } = { items: [] };
      const outcome = yield* controlled<null>(
        inbox,
        sender.id,
        {
          decide: () =>
            Effect.succeed({
              apply: Effect.fnUntraced(function* (writes) {
                const accepted = yield* Effect.forEach(values, (value) => writes.put(value));
                yield* writes.intendWake(accepted.flatMap((put) => (put.fresh ? [put.item.id] : [])));
                staged.items = accepted.map((put) => put.item);
              }),
              result: null,
            }),
        },
        key,
      );
      if (outcome.status === 'spent') return yield* keyReused(input.key);
      if (outcome.status === 'done' && !outcome.acted) return yield* sentAgain(sender, (yield* acceptedUnder(sender, input)) ?? []);
      return yield* deliverAll(
        sender,
        holder,
        staged.items,
        new Map(recipients.map((recipient) => [recipient.id, recipient])),
        prices?.costs,
      );
    });

    const settleFanOut = Effect.fnUntraced(function* (
      sender: ThreadEnvelopeSender,
      input: ThreadSendAsk,
      ahead: boolean,
    ): Effect.fn.Return<ToolEffectSettlement<ThreadSent>, ThreadPlaneFailure> {
      const standing = yield* acceptedUnder(sender, input, ahead);
      if (standing === null) return { status: 'aborted' } as const;
      if (!ahead) return { status: 'completed', output: yield* sentAgain(sender, standing) } as const;
      const holder = yield* threads.find(sender.id, sender.principal);
      const deliveries: ThreadEnvelopeReceipt[] = [];
      for (const item of standing) {
        const recipient = yield* threads.find(item.threadId, sender.principal);
        if (!recipient) continue;
        deliveries.push({
          envelopeId: item.id,
          intent: 'task',
          status: 'queued',
          runId: item.deliveredToRunId,
          acted: false,
          recipient: reachedOf(holder, recipient),
        });
      }
      return { status: 'completed', output: { status: 'sent', deliveries } satisfies ThreadSent } as const;
    });

    const finishAccepted = Effect.fnUntraced(function* (
      holder: ThreadRecord,
      recipient: ThreadRecord,
      text: string,
      states: readonly ThreadInboxItem['state'][],
    ): Effect.fn.Return<ThreadEnvelopeReceipt | null, ThreadPlaneFailure> {
      const accepted = (yield* inbox.pending(recipient.id)).find(
        (item) =>
          item.kind === 'envelope' &&
          states.includes(item.state) &&
          item.body.intent === 'report' &&
          item.body.text === text &&
          item.sender.kind === 'thread' &&
          item.sender.threadId === holder.id &&
          item.id.startsWith(threadFinalEnvelopeId('')),
      );
      if (accepted === undefined || accepted.kind !== 'envelope') return null;
      const receipt = yield* deliver(recipient, {
        id: accepted.id,
        senderThreadId: holder.id,
        intent: 'report',
        text: accepted.body.text,
        inReplyTo: accepted.body.inReplyTo,
        context: accepted.body.context,
      });
      return { ...receipt, closed: [] };
    });

    const settleFinal = Effect.fnUntraced(function* (
      sender: ThreadEnvelopeSender,
      input: ThreadSendAsk,
    ): Effect.fn.Return<ToolEffectSettlement<ThreadSent>, ThreadPlaneFailure> {
      const resolved = yield* recipientsOf(sender, input.to);
      if ('addressable' in resolved || resolved.holder === null) return { status: 'unknown' } as const;
      const { holder } = resolved;
      const [recipient, ...more] = resolved.recipients;
      if (recipient === undefined || more.length > 0) return { status: 'aborted' } as const;
      const message = input.text;
      const recorded = yield* controlled<FinalAnswered | null>(
        inbox,
        holder.id,
        { decide: () => Effect.succeed({ refuse: null }) },
        finalKey(holder.id, input),
      );
      if (recorded.status === 'done' && recorded.result !== null) {
        const delivered = yield* deliver(recipient, finalEnvelope(holder, recorded.result.requestId, message.trim()));
        return {
          status: 'completed',
          output: { status: 'sent', deliveries: [{ ...delivered, closed: recorded.result.closed }] } satisfies ThreadSent,
        };
      }
      const finished = yield* finishAccepted(holder, recipient, message.trim(), ['queued', 'delivered']);
      if (finished !== null)
        return { status: 'completed', output: { status: 'sent', deliveries: [finished] } satisfies ThreadSent } as const;
      const owed = (yield* inbox.openRequests(holder.id)).some((request) => requesterOf(request) === recipient.id && isTaken(request));
      return owed ? ({ status: 'aborted' } as const) : ({ status: 'unknown' } as const);
    });

    const sendAhead = Effect.fnUntraced(function* (sender: ThreadEnvelopeSender, recipient: ThreadRecord, input: ThreadSendAheadAsk) {
      const text = input.text.trim();
      if (!text) return yield* new ThreadCallBroke({ cause: new Error('An envelope carries no words.') });
      const envelope: ThreadEnvelopeInput = {
        id: threadEnvelopeId('task', sender.id, input.key, 0),
        senderThreadId: sender.id,
        intent: 'task',
        text,
        inReplyTo: null,
      };
      if ((yield* acceptedUnder(sender, { to: input.to, intent: 'task', text, key: input.key }, true)) === null) yield* awake([recipient]);
      yield* claimKey(sender.id, input.key, { to: input.to, intent: 'task', text, keep: input.keep });
      const from = yield* senderOf(envelope, recipient);
      const asked = yield* compaction
        .compactAhead(recipient.id, {
          request: { key: input.key, deadline: yield* actDeadline },
          item: itemOf(recipient, envelope, from, text),
          keep: input.keep,
        })
        .pipe(
          Effect.catchTag('SummarizerMissing', (missing) =>
            Effect.succeed({
              status: 'refused',
              code: 'no-summarizer',
              skipped: missing.skipped,
            } satisfies ThreadCompactRefused),
          ),
        );
      if ('status' in asked && asked.status === 'refused') return asked;
      const reached = yield* recipientOf(recipient, envelope);
      if ('status' in asked) {
        return {
          envelopeId: envelope.id,
          intent: 'task',
          status: 'stored',
          runId: null,
          acted: false,
          recipient: reached,
        } satisfies ThreadEnvelopeReceipt;
      }
      return {
        envelopeId: asked.itemId,
        intent: 'task',
        status: 'queued',
        runId: asked.runId,
        acted: asked.acted,
        recipient: reached,
        compaction: { requestId: asked.requestId, runId: asked.started ? asked.runId : null, summarizer: asked.summarizer },
      } satisfies ThreadEnvelopeReceipt;
    });

    const send = Effect.fnUntraced(function* (sender: ThreadEnvelopeSender, runId: string | undefined, input: ThreadSendAsk) {
      if (input.to.length === 0) return yield* new ThreadCallBroke({ cause: new Error('A send names no recipient.') });
      if (input.final !== true) return yield* fanOut(sender, input);
      if (input.inReplyTo !== undefined) return refused('final-in-reply');
      const resolved = yield* recipientsOf(sender, input.to);
      const sent = (answered: ThreadEnvelopeReceipt | ThreadAddressUnknown | ThreadSendRefused) =>
        'envelopeId' in answered ? ({ status: 'sent', deliveries: [answered] } satisfies ThreadSent) : answered;
      if ('addressable' in resolved) {
        if (new Set(input.to).size > 1) return resolved;
        return sent(yield* answerFinally(runId, yield* threads.find(sender.id, sender.principal), resolved, input));
      }
      const [recipient, ...more] = resolved.recipients;
      if (recipient === undefined || more.length > 0) return refused('final-to-many');
      return sent(yield* answerFinally(runId, resolved.holder, recipient, input));
    });

    return ThreadEnvelopes.of({
      completeRun: (ended) => reportOwed(inbox, threads, runs, stages, own, deliver, ended, wakes.contextOf),

      withdrawRequest: (threadId, principal, inputId) => withdrawQueued(inbox, threads, deliver, threadId, principal, inputId),

      access: (sender, runId) => ({
        settle: (input, ahead) => (input.final === true ? settleFinal(sender, input) : settleFanOut(sender, input, ahead)),
        recipients: (to) => recipientsOf(sender, to),
        sendAhead: (recipient, input) => sendAhead(sender, recipient, input),
        waitFor: (input) =>
          Effect.flatMap(addressed(sender, input.from), ({ found }) =>
            waitForArrivals(
              threads,
              directory,
              inbox,
              reconcileMs,
              sender,
              input,
              input.from.map((address) => found.get(address) ?? null),
            ),
          ),
        collect: (input) =>
          Effect.flatMap(addressed(sender, input.from), ({ found }) =>
            collectReports(
              threads,
              directory,
              inbox,
              reconcileMs,
              sender,
              input,
              input.from.map((address) => found.get(address) ?? null),
            ),
          ),

        send: (input) => send(sender, runId, input),
      }),

      deliver,
    });
  }),
);
