import { Clock, Data, Effect } from 'effect';
import type { ThreadAttachmentRef } from '../../../transcript/attachments';
import type { ThreadQueuedTurn } from '../../../transcript/live';
import { KEEP_WARM_SIGNAL_TYPE } from '../../../transcript/keepWarm';
import type { ThreadSignal } from '../../../transcript/parts';
import type { ThreadTranscriptEntry } from '../../../transcript/rows';
import { type AgentSignalNotice, type ThreadSignalAddressee, USER_MESSAGE_SIGNAL_TYPE } from '../../../agent/contracts';
import { threadSignalEvent, threadSignalOpening, threadUserMessageEvent } from '../../events';
import { mintThreadSignalId } from '../../identity';
import {
  carriesWords,
  inboxSignalValues,
  inboxSteerValues,
  inboxTurnValues,
  isInboxRequest,
  saidAsOperator,
  spokenByOther,
  threadQueuedTurnOf,
  threadSignalOfInboxItem,
  waitsForTurn,
  type ThreadInboxWords,
} from '../../inboxItems';
import { actDigest, type Keyed } from '../../keyed';
import { threadRunInterrupted, type ThreadMetadataRow, type ThreadRow, type ThreadRunRow } from '../../rows';
import type { ThreadInboxItem, ThreadInboxItemValues, ThreadInboxSender, ThreadInputAcceptance } from '../../storage/inbox';
import { ThreadRunConflictError, type ThreadRunStartKey } from '../../storage/runs';
import { ThreadCallBroke, threadCauseOf, type ThreadBorderFailed, type ThreadPortFailure } from '../../ThreadBorder';
import { ThreadAttachments, ThreadBudgetSpentError, ThreadInbox, type ThreadTx, type ThreadWriteTx } from '../../ThreadPorts';
import { answerOf, transitionNow, type TransitionDeps } from '../../transition/kernel';
import { ThreadActReusedError, type Decision } from '../../transition/port';
import { Claim } from './claim';
import { KEEP_WARM_TEXT } from '../keepWarmRun';
import { ThreadRunInbox } from '../ThreadRunInbox';
import { ThreadRunLedger } from '../ThreadRunLedger';
import { ThreadSnapshots } from '../ThreadSnapshots';
import { RunControl } from '../RunControl';
import { WordsInFlight } from '../WordsInFlight';
import type { Handover } from './handover';
import { begunOf, type Openings, type ThreadBegun } from './openings';
import { held, sameCohort, type Arrival, type Queues } from './queue';

export type ThreadTurnInput = {
  readonly text: string;
  readonly inputId?: string;
  readonly admitted?: Keyed;
  readonly sender?: ThreadInboxSender;
};

export type ThreadSaid = (
  | {
      readonly status: 'started';
      readonly runId: string;
      readonly entry: ThreadTranscriptEntry;
      readonly acceptance?: ThreadInputAcceptance;
    }
  | { readonly status: 'steered'; readonly runId: string; readonly itemId: string; readonly acceptance?: ThreadInputAcceptance }
  | { readonly status: 'queued'; readonly runId: string; readonly queued: ThreadQueuedTurn; readonly acceptance?: ThreadInputAcceptance }
) & { readonly replayed?: true };

export type ThreadKeepWarmResult =
  | { readonly status: 'woken'; readonly runId: string }
  | { readonly status: 'running' }
  | { readonly status: 'sent' }
  | { readonly status: 'interrupted' }
  | { readonly status: 'prompt-pending' };

export type ThreadSignalCondition<TWrite = ThreadWriteTx> = (tx: TWrite) => Effect.Effect<boolean, ThreadPortFailure>;

export type ThreadSignalBehavior<TWrite = ThreadWriteTx> = {
  ifActive?: 'deliver' | 'persist' | 'discard';
  ifIdle?: 'wake' | 'wake-completed' | 'wait' | 'persist' | 'discard';
  condition?: ThreadSignalCondition<TWrite>;
};

export type ThreadSignalResult =
  | { status: 'delivered'; runId: string }
  | { status: 'queued'; runId: string }
  | { status: 'waiting' }
  | { status: 'persisted'; runId?: string }
  | { status: 'woken'; runId: string }
  | { status: 'discarded' }
  | { status: 'declined' };

export type ThreadSteerInput = {
  readonly id?: string;
  readonly expectedRunId: string;
  readonly text: string;
  readonly attachments?: readonly ThreadAttachmentRef[];
};

export type ThreadSignalInput = {
  readonly id?: string;
  readonly type?: string;
  readonly addressee: ThreadSignalAddressee;
  readonly text: string;
  readonly from?: string;
  readonly senderThreadId?: string;
  readonly notice?: AgentSignalNotice;
};

export type ThreadInboxReadable = Extract<ThreadInboxItemValues, { kind: 'signal' | 'envelope' }>;
export type ThreadInboxTurnOpener = Extract<ThreadInboxItemValues, { kind: 'turn' | 'task' }>;

export type ThreadTurnWaiting = { readonly runId: string; readonly queued: ThreadQueuedTurn };

export type ThreadItemArrival =
  | { readonly status: 'woken'; readonly runId: string }
  | { readonly status: 'declined' }
  | { readonly status: 'standing'; readonly item: ThreadInboxItem }
  | { readonly status: 'kept'; readonly item: ThreadInboxItem };

export class ThreadSignalConflictError extends Data.TaggedError('ThreadSignalConflict')<{
  readonly message: string;
  readonly threadId: string;
  readonly signalId: string;
}> {
  constructor(input: { threadId: string; signalId: string }) {
    super({
      message: `Signal ${input.signalId} was already accepted with different content.`,
      threadId: input.threadId,
      signalId: input.signalId,
    });
    this.name = 'ThreadSignalConflictError';
  }
}
const REPLAY_FREE_FIELDS: ReadonlySet<string> = new Set(['occurredAt', 'state', 'deliveredToRunId']);
function acceptedOf(item: ThreadInboxItem | ThreadInboxItemValues): Record<string, unknown> {
  const fields = item as unknown as Record<string, unknown>;
  return item.kind === 'signal' ? { ...fields, body: { ...item.body, waits: undefined } } : fields;
}
function sameAcceptance(standing: ThreadInboxItem, sent: ThreadInboxItemValues): boolean {
  const kept = acceptedOf(standing);
  const replayed = acceptedOf(sent);
  return [...new Set([...Object.keys(kept), ...Object.keys(replayed)])]
    .filter((field) => !REPLAY_FREE_FIELDS.has(field))
    .every((field) => Bun.deepEquals(kept[field], replayed[field]));
}
function waitingBeside(pending: readonly ThreadInboxItem[], itemId: string): readonly ThreadInboxItem[] {
  return pending.filter((each) => each.id !== itemId && each.state === 'queued' && waitsForTurn(each));
}
function waitingOf(item: ThreadInboxReadable): ThreadInboxReadable {
  return item.kind === 'signal' ? { ...item, body: { ...item.body, waits: true } } : item;
}
function settledAs(item: ThreadInboxItem): ThreadSignalResult {
  if (item.deliveredToRunId === null) return { status: 'persisted' };
  return item.state === 'acknowledged'
    ? { status: 'delivered', runId: item.deliveredToRunId }
    : { status: 'persisted', runId: item.deliveredToRunId };
}
type Spoken = {
  readonly text: string;
  readonly id?: string;
  readonly attachments?: readonly ThreadAttachmentRef[];
  readonly admitted?: Keyed;
  readonly sender?: ThreadInboxSender;
};
type Aim = 'step' | 'turn' | { readonly run: string };
type Placed = {
  readonly item: ThreadInboxItem;
  readonly values: ThreadInboxItemValues;
  readonly latest: ThreadRunRow | null;
  readonly running: ThreadRunRow | null;
  readonly fresh: boolean;
  readonly pending: readonly ThreadInboxItem[];
};
function sameWords(standing: ThreadInboxItem, words: Spoken): boolean {
  if (standing.kind !== 'turn' && standing.kind !== 'signal') return false;
  return standing.body.text === words.text && Bun.deepEquals(standing.body.attachments ?? [], words.attachments ?? []);
}
function steersInto(thread: ThreadMetadataRow, running: ThreadRunRow | null, aim: Aim): running is ThreadRunRow {
  if (running === null || running.kind !== 'turn' || thread.capabilities.steer !== 'step') return false;
  return aim === 'step' || (typeof aim === 'object' && aim.run === running.id);
}
function saidOfWords(item: ThreadInboxItem, around: string): ThreadSaid {
  const runId = item.deliveredToRunId ?? around;
  if (item.kind === 'signal') return { status: 'steered', runId, itemId: item.id };
  if (item.kind !== 'turn' || item.state === 'queued') return { status: 'queued', runId, queued: threadQueuedTurnOf(runId, item) };
  return { status: 'started', runId, entry: threadUserMessageEvent({ id: runId }, { text: item.body.text, reader: true }).payload.entry };
}
export type Inputs = Effect.Success<ReturnType<typeof makeInputs>>;
export const makeInputs = Effect.fnUntraced(function* ({
  kernel,
  openings,
  queues,
  handover,
}: {
  readonly kernel: TransitionDeps<ThreadTx, ThreadWriteTx>;
  readonly openings: Openings;
  readonly queues: Queues;
  readonly handover: Handover;
}) {
  const inbox = yield* ThreadInbox;
  const runInbox = yield* ThreadRunInbox;
  const attachments = yield* ThreadAttachments;
  const ledger = yield* ThreadRunLedger;
  const snapshots = yield* ThreadSnapshots;
  const inflight = yield* WordsInFlight;
  const control = yield* RunControl;
  const place = (thread: ThreadMetadataRow, words: Spoken, aim: Aim, claim: Claim): Effect.Effect<Placed | null, ThreadPortFailure> =>
    kernel.store.transaction(
      Effect.fnUntraced(function* (tx) {
        const latest = yield* ledger.latestRun(thread.id, undefined, tx);
        const running = latest?.status === 'running' ? latest : null;
        if (running !== null && claim.check !== undefined && !(yield* claim.check(tx))) return null;
        const values = steersInto(thread, running, aim) ? inboxSteerValues(thread.id, words) : inboxTurnValues(thread.id, words);
        const { item, fresh } = yield* inbox.put(values, tx);
        if (!fresh && (item.threadId !== thread.id || !sameWords(item, words))) {
          return yield* new ThreadActReusedError({
            threadId: thread.id,
            evidence: words.admitted?.evidence ?? { inboxItem: item.id, run: null },
          });
        }
        if (running === null) return { item, values, latest, running, fresh, pending: yield* inbox.pending(thread.id, tx) };
        yield* claim.record(saidOfWords(item, running.id), tx);
        return { item, values, latest, running, fresh, pending: [] };
      }),
    );
  const kept = (claim: Claim, said: ThreadSaid): Effect.Effect<void, ThreadPortFailure> =>
    kernel.store.transaction((tx) =>
      Effect.flatMap(claim.check === undefined ? Effect.succeed(false) : claim.check(tx), (absent) =>
        absent ? claim.record(said, tx) : Effect.void,
      ),
    );
  const handed = Effect.fnUntraced(function* (
    thread: ThreadMetadataRow,
    item: ThreadInboxItem,
    values: ThreadInboxItemValues,
    running: ThreadRunRow,
  ): Effect.fn.Return<void, ThreadBorderFailed> {
    if (item.state !== 'queued') return;
    if (item.kind !== 'signal') {
      yield* snapshots.publish(thread.id);
      return yield* handover.queued(thread, running);
    }
    const delivery = yield* runInbox.enqueue({ id: running.id, threadId: thread.id }, values);
    yield* snapshots.publish(thread.id);
    if (delivery === 'queued' || delivery === 'delivered') yield* handover.deliver(thread, running, [item]);
  });
  const opened = Effect.fnUntraced(function* (
    thread: ThreadMetadataRow,
    words: Spoken,
    placed: Placed,
    claim: Claim,
  ): Effect.fn.Return<ThreadSaid, ThreadBorderFailed> {
    const { item, latest } = placed;
    if (item.state !== 'queued') return saidOfWords(item, latest?.id ?? '');
    if (latest !== null && inflight.live(latest.id) && control.holder(latest.id) === undefined) inflight.returned(latest);
    const unsettled = latest !== null && latest.status !== 'cut' && inflight.live(latest.id);
    const attempt = (pending: readonly ThreadInboxItem[] | undefined) =>
      queues.next(thread, latest?.id ?? null, false, { pending, door: { key: words.admitted, item } }).pipe(
        Effect.catchIf(
          (failure) => threadCauseOf(failure) instanceof ThreadRunConflictError,
          () => Effect.succeed(null),
        ),
        Effect.tapError((failure) =>
          threadCauseOf(failure) instanceof ThreadBudgetSpentError ? inbox.acknowledge([item.id], null) : Effect.void,
        ),
      );
    let opening = unsettled ? null : yield* attempt(placed.pending);
    while (opening?.status === 'declined') {
      const standing = yield* inbox.receipt(item.id);
      if (standing?.state !== 'queued' || (yield* ledger.activeRun(thread.id)) !== null) break;
      opening = yield* attempt(undefined);
    }
    if (opening?.status === 'recorded') return { ...opening.answer, replayed: true };
    if (opening?.status === 'opened' && opening.answer !== null) return opening.answer;
    const standing = (yield* inbox.receipt(item.id)) ?? item;
    const said = saidOfWords(standing, (yield* ledger.activeRun(thread.id))?.id ?? latest?.id ?? '');
    yield* kept(claim, said);
    const recorded = yield* claim.replayed();
    if (recorded !== null) return { ...recorded, replayed: true };
    yield* snapshots.publish(thread.id);
    return said;
  });
  const speak = Effect.fnUntraced(function* (
    thread: ThreadMetadataRow,
    words: Spoken,
    aim: Aim,
  ): Effect.fn.Return<ThreadSaid, ThreadBorderFailed> {
    const claim = new Claim(kernel.transitions, thread.id, words.admitted);
    const placed = yield* place(thread, words, aim, claim);
    const replayed = yield* claim.replayed();
    if (replayed !== null) return { ...replayed, replayed: true };
    if (placed === null)
      return yield* new ThreadCallBroke({ cause: new Error(`Thread ${thread.id}: the words were neither kept nor answered.`) });
    const { item, values, running, fresh } = placed;
    const said =
      running === null
        ? yield* opened(thread, words, placed, claim)
        : yield* Effect.as(handed(thread, item, values, running), saidOfWords(item, running.id));
    return fresh ? said : { ...said, replayed: true };
  });
  const say = (
    thread: ThreadMetadataRow,
    mode: 'send' | 'queue',
    turn: ThreadTurnInput,
    refs: readonly ThreadAttachmentRef[] | undefined,
  ): Effect.Effect<ThreadSaid, ThreadBorderFailed> => {
    const text = turn.text.trim();
    if (!text && !refs?.length) return Effect.fail(new ThreadCallBroke({ cause: new Error('Message is empty.') }));
    const words = { text, id: turn.inputId, attachments: refs?.length ? refs : undefined, admitted: turn.admitted, sender: turn.sender };
    return speak(thread, words, mode === 'send' ? 'step' : 'turn');
  };
  const steer = Effect.fnUntraced(function* (
    thread: ThreadMetadataRow,
    input: ThreadSteerInput,
    admitted?: Keyed,
  ): Effect.fn.Return<ThreadSaid, ThreadBorderFailed> {
    const text = input.text.trim();
    if (!text) return yield* new ThreadCallBroke({ cause: new Error('Message is empty.') });
    yield* resolveRefs(thread, input.attachments);
    return yield* speak(thread, { text, id: input.id, attachments: input.attachments, admitted }, { run: input.expectedRunId });
  });
  const sendSignal = Effect.fnUntraced(function* (
    thread: ThreadMetadataRow,
    input: ThreadSignalInput,
    behavior: ThreadSignalBehavior = {},
  ) {
    const text = input.text.trim();
    if (!text) return yield* new ThreadCallBroke({ cause: new Error('Signal text is empty.') });
    const signal: ThreadSignal = {
      id: input.id ?? mintThreadSignalId(),
      type: input.type ?? USER_MESSAGE_SIGNAL_TYPE,
      addressee: input.addressee,
      text,
      from: input.from,
      senderThreadId: input.senderThreadId,
      notice: input.notice,
      occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    };
    return yield* send(thread, inboxSignalValues(thread.id, signal, behavior.ifIdle === 'wait') as ThreadInboxReadable, behavior);
  });
  const send = Effect.fnUntraced(function* (
    thread: ThreadMetadataRow,
    item: ThreadInboxReadable,
    behavior: ThreadSignalBehavior = {},
  ): Effect.fn.Return<ThreadSignalResult, ThreadBorderFailed> {
    const standing = yield* inbox.receipt(item.id);
    if (standing) {
      if (!sameAcceptance(standing, item)) {
        return yield* new ThreadCallBroke({ cause: new ThreadSignalConflictError({ threadId: thread.id, signalId: item.id }) });
      }
      if (standing.state !== 'queued') return settledAs(standing);
    }
    const condition = standing ? undefined : behavior.condition;
    const activeRun = yield* ledger.activeRun(thread.id);
    if (!activeRun) return yield* idle(thread, item, behavior, condition);
    const onActive = behavior.ifActive ?? 'deliver';
    if (onActive === 'discard') return { status: 'discarded' } satisfies ThreadSignalResult;
    if (onActive === 'deliver') {
      const delivery = yield* runInbox.enqueue({ id: activeRun.id, threadId: thread.id }, item, condition);
      const handed = (status: 'delivered' | 'queued') =>
        Effect.andThen(
          snapshots.publish(thread.id),
          Effect.as(
            activeRun.kind === 'turn'
              ? handover.deliver(thread, activeRun, [{ ...item, state: 'queued', deliveredToRunId: null }])
              : Effect.void,
            { status, runId: activeRun.id } satisfies ThreadSignalResult,
          ),
        );
      switch (delivery) {
        case 'declined':
          return { status: 'declined' } satisfies ThreadSignalResult;
        case 'already-read':
          return { status: 'delivered', runId: activeRun.id } satisfies ThreadSignalResult;
        case 'delivered':
        case 'queued':
          return yield* handed(delivery);
        case 'not-running':
          return yield* send(thread, item, behavior);
      }
    }
    if (!(yield* ledger.activeRun(thread.id))) return yield* idle(thread, item, behavior, condition);
    return yield* persist(thread, true, item, condition);
  });
  const queue = Effect.fnUntraced(function* (
    thread: ThreadMetadataRow,
    item: ThreadInboxTurnOpener,
  ): Effect.fn.Return<ThreadTurnWaiting | 'read' | null, ThreadBorderFailed> {
    const activeRun = yield* ledger.activeRun(thread.id);
    if (!activeRun) return null;
    const queued = yield* runInbox.enqueue({ id: activeRun.id, threadId: thread.id }, item);
    if (queued === 'not-running') return null;
    if (queued === 'already-read') return 'read';
    yield* snapshots.publish(thread.id);
    yield* handover.queued(thread, activeRun);
    return { runId: activeRun.id, queued: threadQueuedTurnOf(activeRun.id, item) };
  });
  const wakeItem = (
    thread: ThreadMetadataRow,
    item: ThreadInboxItemValues,
    condition?: ThreadSignalCondition,
  ): Effect.Effect<ThreadItemArrival, ThreadBorderFailed> => {
    if (!carriesWords(item)) return Effect.die(new Error(`Inbox item ${item.id} is a compaction request; it wakes no run as words.`));
    return Effect.flatMap(inbox.pending(thread.id), (pending) =>
      Effect.flatMap(queues.arrivals(thread, waitingBeside(pending, item.id)), (arrivals) => wakeWith(thread, item, condition, arrivals)),
    );
  };
  const wakeWith = (
    thread: ThreadMetadataRow,
    item: ThreadInboxWords<ThreadInboxItemValues>,
    condition: ThreadSignalCondition | undefined,
    arrivals: readonly Arrival[],
  ): Effect.Effect<ThreadItemArrival, ThreadBorderFailed> => {
    const found: { standing: ThreadInboxItem | null; moved: boolean } = { standing: null, moved: false };
    const waiting = arrivals.map((arrival) => arrival.item);
    const ahead = waiting.map((each) => each.id);
    return openings
      .open(thread, {
        admits: Effect.fnUntraced(function* (tx, now) {
          if (!sameCohort(waiting, waitingBeside(now, item.id))) {
            found.moved = true;
            return false;
          }
          if (condition !== undefined && !(yield* condition(tx))) return false;
          const accepted = (yield* inbox.put(item, tx)).item;
          if (accepted.state === 'queued') return true;
          found.standing = accepted;
          return false;
        }),
        seed: [...waiting, item],
        consume: Effect.fnUntraced(function* (runId, tx, how) {
          if (isInboxRequest(item) || how === 'handed') yield* inbox.deliver([item.id], runId, tx);
          else yield* inbox.acknowledge([item.id], runId, tx);
          if (ahead.length === 0) return;
          if (how === 'handed') yield* inbox.deliver(ahead, runId, tx);
          else yield* inbox.acknowledge(ahead, runId, tx);
        }),
        facts: (runId) => arrivals.map((arrival) => arrival.event(runId)),
        turn: (runId) =>
          saidAsOperator(item)
            ? threadUserMessageEvent({ id: runId }, { text: item.body.text, reader: true })
            : threadSignalEvent(threadSignalOfInboxItem(item), runId),
        outputOptional: true,
        oriented: true,
      })
      .pipe(
        Effect.flatMap((opened): Effect.Effect<ThreadItemArrival, ThreadBorderFailed> => {
          if (opened.status === 'opened') return Effect.succeed({ status: 'woken', runId: opened.run.id });
          if (found.moved) return wakeItem(thread, item, condition);
          return Effect.succeed(found.standing === null ? { status: 'declined' } : { status: 'standing', item: found.standing });
        }),
        Effect.catchIf(
          (failure) => threadCauseOf(failure) instanceof ThreadRunConflictError,
          (failure) =>
            Effect.flatMap(inbox.receipt(item.id), (standing): Effect.Effect<ThreadItemArrival, ThreadBorderFailed> =>
              standing ? Effect.succeed({ status: 'standing', item: standing }) : Effect.fail(failure),
            ),
        ),
        Effect.catchIf(held, () =>
          Effect.map(keep(thread, item, condition), (kept): ThreadItemArrival =>
            kept === null ? { status: 'declined' } : { status: 'kept', item: kept },
          ),
        ),
      );
  };
  const conflict = (threadId: string): Effect.Effect<never, ThreadBorderFailed> =>
    Effect.flatMap(ledger.activeRun(threadId), (active) =>
      Effect.fail(new ThreadCallBroke({ cause: new ThreadRunConflictError({ threadId, runId: active?.id ?? threadId }) })),
    );
  const begin = (
    thread: ThreadMetadataRow,
    text: string,
    start?: { readonly startKey: ThreadRunStartKey; readonly itemId: string },
  ): Effect.Effect<ThreadBegun, ThreadBorderFailed> =>
    Effect.flatMap(
      Effect.flatMap(
        Effect.all([handover.words(thread), start === undefined ? Effect.undefined : inbox.receipt(start.itemId)]),
        ([how, asked]) => {
          const task = asked?.kind === 'task' && spokenByOther(asked) ? asked : undefined;
          const item =
            how === 'opening'
              ? null
              : {
                  ...inboxTurnValues(thread.id, { text, id: start === undefined ? undefined : start.itemId }),
                  sender: asked?.sender ?? { kind: 'host' as const },
                };
          return openings.open(thread, {
            turn: (runId) =>
              task === undefined
                ? threadUserMessageEvent({ id: runId }, { text, reader: false })
                : threadSignalOpening(threadSignalOfInboxItem(task), runId, text),
            outputOptional: true,
            seed: item === null ? undefined : [item],
            consume:
              item !== null
                ? (runId: string, tx: ThreadWriteTx) => Effect.andThen(inbox.put(item, tx), inbox.deliver([item.id], runId, tx))
                : start === undefined
                  ? undefined
                  : (runId: string, tx: ThreadWriteTx) => inbox.deliver([start.itemId], runId, tx),
            startKey: start === undefined ? undefined : start.startKey,
          });
        },
      ),
      (opened): Effect.Effect<ThreadBegun, ThreadBorderFailed> => {
        const begun = begunOf(opened);
        return begun === null ? conflict(thread.id) : Effect.succeed(begun);
      },
    );
  const keepWarm = Effect.fnUntraced(
    function* (thread: ThreadRow, signalId: string): Effect.fn.Return<ThreadKeepWarmResult, ThreadBorderFailed> {
      if (thread.pendingSystemPrompt !== null || thread.pendingDefinition != null) return { status: 'prompt-pending' } as const;
      const latest = yield* ledger.latestRun(thread.id);
      if (latest?.status === 'running') return { status: 'running' } as const;
      if (threadRunInterrupted(latest?.status)) return { status: 'interrupted' } as const;
      if ((yield* inbox.receipt(signalId)) !== undefined) return { status: 'sent' } as const;
      const signal: ThreadSignal = {
        id: signalId,
        type: KEEP_WARM_SIGNAL_TYPE,
        addressee: 'transport',
        text: KEEP_WARM_TEXT,
        occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      };
      const item = inboxSignalValues(thread.id, signal);
      const opened = yield* openings.open(thread, {
        kind: 'keep-warm',
        seed: [item],
        turn: (runId) => threadSignalEvent(signal, runId),
        inherits: false,
        keepsPrompt: true,
        outputOptional: true,
        oriented: false,
        consume: Effect.fnUntraced(function* (runId, tx, words) {
          yield* inbox.put(item, tx);
          if (words === 'handed') yield* inbox.deliver([item.id], runId, tx);
          else yield* inbox.acknowledge([item.id], runId, tx);
        }),
      });
      return opened.status === 'opened' ? ({ status: 'woken', runId: opened.run.id } as const) : ({ status: 'running' } as const);
    },
    Effect.catchIf(
      (failure) => threadCauseOf(failure) instanceof ThreadRunConflictError,
      () => Effect.succeed({ status: 'running' } as const),
    ),
  );
  const resolveRefs = (
    thread: ThreadMetadataRow,
    refs: readonly ThreadAttachmentRef[] | undefined,
  ): Effect.Effect<void, ThreadBorderFailed> =>
    refs?.length ? Effect.asVoid(attachments.resolve(thread.id, thread.ownerId, refs)) : Effect.void;
  const idle = (
    thread: ThreadMetadataRow,
    item: ThreadInboxReadable,
    behavior: ThreadSignalBehavior,
    condition: ThreadSignalCondition | undefined,
  ): Effect.Effect<ThreadSignalResult, ThreadBorderFailed> => {
    const onIdle = behavior.ifIdle ?? 'wake';
    if (onIdle === 'discard') return Effect.succeed({ status: 'discarded' });
    if (onIdle === 'persist') return persist(thread, false, item, condition);
    if (onIdle === 'wait') return wait(thread, item, behavior, condition);
    if (onIdle === 'wake-completed')
      return Effect.flatMap(restsCompleted(thread.id), (completed) =>
        completed ? woken(thread, item, behavior, condition) : wait(thread, item, behavior, condition, waitingOf(item)),
      );
    return woken(thread, item, behavior, condition);
  };
  const restsCompleted = (threadId: string): Effect.Effect<boolean, ThreadBorderFailed> =>
    Effect.map(ledger.latestRun(threadId), (latest) => latest !== null && (latest.kind === 'keep-warm' || latest.status === 'completed'));
  const woken = (
    thread: ThreadMetadataRow,
    item: ThreadInboxReadable,
    behavior: ThreadSignalBehavior,
    condition: ThreadSignalCondition | undefined,
  ): Effect.Effect<ThreadSignalResult, ThreadBorderFailed> =>
    wakeItem(thread, item, condition).pipe(
      Effect.matchEffect({
        onSuccess: (woke): Effect.Effect<ThreadSignalResult, ThreadBorderFailed> => {
          if (woke.status === 'woken') return Effect.succeed({ status: 'woken', runId: woke.runId });
          if (woke.status === 'declined') return Effect.succeed({ status: 'declined' });
          if (woke.status === 'kept') return Effect.succeed(settledAs(woke.item));
          return Effect.as(snapshots.publish(thread.id), settledAs(woke.item));
        },
        onFailure: (failure) =>
          threadCauseOf(failure) instanceof ThreadRunConflictError ? send(thread, item, behavior) : Effect.fail(failure),
      }),
    );
  const persist = Effect.fnUntraced(function* (
    thread: ThreadMetadataRow,
    beside: boolean,
    item: ThreadInboxReadable,
    condition: ThreadSignalCondition | undefined,
  ): Effect.fn.Return<ThreadSignalResult, ThreadBorderFailed> {
    const outcome = yield* transitionNow<ThreadSignalResult, ThreadWriteTx>(
      kernel,
      thread.id,
      {
        declared: [],
        decide: Effect.fnUntraced(function* (_view, tx) {
          if (condition !== undefined && !(yield* condition(tx)))
            return { refuse: { status: 'declined' } } as Decision<ThreadSignalResult, ThreadWriteTx>;
          const accepted = yield* inbox.put(item, tx);
          if (accepted.item.state !== 'queued')
            return { replayed: settledAs(accepted.item) } as Decision<ThreadSignalResult, ThreadWriteTx>;
          const runId = beside ? ((yield* ledger.latestRun(thread.id, ['running'], tx))?.id ?? null) : null;
          return {
            apply: true,
            result: runId === null ? { status: 'persisted' } : { status: 'persisted', runId },
            events: [threadSignalEvent(threadSignalOfInboxItem(item), runId)],
            participants: (unit) => (runId === null ? inbox.acknowledge([item.id], null, unit) : inbox.deliver([item.id], runId, unit)),
          } as Decision<ThreadSignalResult, ThreadWriteTx>;
        }),
      },
      { evidence: { inboxItem: item.id, run: null }, digest: actDigest(item.id) },
    );
    const result = yield* answerOf(thread.id, outcome);
    if (result.status !== 'declined') yield* snapshots.publish(thread.id);
    return result;
  });
  const keep = Effect.fnUntraced(function* (
    thread: ThreadMetadataRow,
    item: ThreadInboxItemValues,
    condition?: ThreadSignalCondition,
    accepted?: (kept: ThreadInboxItem, tx: ThreadWriteTx) => Effect.Effect<void, ThreadPortFailure>,
  ): Effect.fn.Return<ThreadInboxItem | null, ThreadBorderFailed> {
    const kept = yield* kernel.store.transaction(
      Effect.fnUntraced(function* (tx) {
        if (condition !== undefined && !(yield* condition(tx))) return null;
        const put = (yield* inbox.put(item, tx)).item;
        if (accepted !== undefined) yield* accepted(put, tx);
        return put;
      }),
    );
    if (kept === null) return null;
    if (kept.state === 'queued') yield* queues.owedToLift(thread.id);
    yield* snapshots.publish(thread.id);
    return kept;
  });
  const wait = Effect.fnUntraced(function* (
    thread: ThreadMetadataRow,
    item: ThreadInboxReadable,
    behavior: ThreadSignalBehavior,
    condition: ThreadSignalCondition | undefined,
    stored: ThreadInboxReadable = item,
  ): Effect.fn.Return<ThreadSignalResult, ThreadBorderFailed> {
    const kept = yield* kernel.store.transaction(
      Effect.fnUntraced(function* (tx) {
        if ((yield* ledger.latestRun(thread.id, ['running'], tx)) !== null) return 'running' as const;
        if (condition !== undefined && !(yield* condition(tx))) return null;
        return (yield* inbox.put(stored, tx)).item;
      }),
    );
    if (kept === 'running') return yield* send(thread, item, behavior);
    if (kept === null) return { status: 'declined' };
    yield* snapshots.publish(thread.id);
    return kept.state === 'queued' ? { status: 'waiting' } : settledAs(kept);
  });
  return { say, steer, sendSignal, send, queue, wakeItem, begin, keepWarm };
});
