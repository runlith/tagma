import { type Context, Effect } from 'effect';
import { threadSignalEvent, threadUserMessageEvent, type ThreadEventBody } from '../../events';
import {
  beforeBarrier,
  carriesWords,
  compactionHead,
  isInboxRequest,
  isReaderWordsItem,
  isUnreadSteer,
  opensTurn,
  openingWords,
  queuedTurnText,
  readableBefore,
  saidAsOperator,
  spokenByAgent,
  threadQueuedTurnOf,
  threadSignalOfInboxItem,
  waitsForTurn,
} from '../../inboxItems';
import { inputAddressOf, type Keyed } from '../../keyed';
import { TransportCannotError } from '../../record';
import type { ThreadMetadataRow } from '../../rows';
import type { ThreadInboxItem } from '../../storage/inbox';
import { ThreadRunConflictError, ThreadRunHeldError, ThreadRunNotInterruptedError, type ThreadRunStartKey } from '../../storage/runs';
import { ThreadCallBroke, threadCauseOf, type ThreadBorderFailed } from '../../ThreadBorder';
import { ThreadAttachments, ThreadInbox, ThreadResidency, ThreadStore, type ThreadWriteTx } from '../../ThreadPorts';
import { threadRunInterrupted } from '../../rows';
import { RunAdmission } from '../runAdmission';
import { ThreadRunLedger } from '../ThreadRunLedger';
import type { Compactions } from './compactions';
import { begunOf, type Opening, type Openings, type ThreadBegun, type WordsConsumed } from './openings';

export type Cohort = (pending: readonly ThreadInboxItem[]) => readonly ThreadInboxItem[];

export type QueueSource = {
  readonly runId: string | null;
  readonly items: readonly ThreadInboxItem[];
  readonly cohort: Cohort;
};

function sourceOf(runId: string | null, pending: readonly ThreadInboxItem[], cohort: Cohort): QueueSource {
  return { runId, items: cohort(pending), cohort };
}

export type Door = { readonly key: Keyed | undefined; readonly item: ThreadInboxItem };

export type Arrival = { readonly item: ThreadInboxItem; readonly event: (runId: string | null) => ThreadEventBody };

export type Queues = Effect.Success<ReturnType<typeof makeQueues>>;

export const makeQueues = Effect.fnUntraced(function* ({
  openings,
  compactions,
}: {
  readonly openings: Openings;
  readonly compactions: Compactions;
}) {
  const store = yield* ThreadStore;
  const inbox = yield* ThreadInbox;
  const attachments = yield* ThreadAttachments;
  const ledger = yield* ThreadRunLedger;
  const admission = yield* RunAdmission;
  const residency = yield* ThreadResidency;

  const signalsOf = (
    thread: ThreadMetadataRow,
    items: readonly ThreadInboxItem[],
    spoken: ReadonlySet<string> = new Set(),
  ): Effect.Effect<readonly Arrival[], ThreadBorderFailed> =>
    Effect.forEach(
      items.filter(carriesWords).filter((item) => item.state === 'queued' && !opensTurn(item) && !spoken.has(item.id)),
      (item) => {
        const signal = threadSignalOfInboxItem(item);
        return signal.attachments?.length
          ? Effect.map(attachments.resolve(thread.id, thread.ownerId, signal.attachments), (stored) => ({
              item,
              event: (runId: string | null) => threadSignalEvent(signal, runId, { attachments: stored }),
            }))
          : Effect.succeed({ item, event: (runId: string | null) => threadSignalEvent(signal, runId) });
      },
    );

  const queuedTurns = Effect.fnUntraced(function* (
    thread: ThreadMetadataRow,
    source: QueueSource,
    startKey?: ThreadRunStartKey,
    door?: Door,
    stopped = false,
  ): Effect.fn.Return<Opening, ThreadBorderFailed> {
    const turns = source.items.filter((item) => item.state === 'queued' && opensTurn(item));
    const said = openingWords(source.items.filter((item) => item.state === 'queued'));
    const tasked = turns.filter(carriesWords).filter(spokenByAgent);
    const refs = said.flatMap((item) => (item.kind === 'turn' || item.kind === 'signal' ? [...(item.body.attachments ?? [])] : []));
    const stored = refs.length > 0 ? yield* attachments.resolve(thread.id, thread.ownerId, refs) : undefined;
    const reader = said.some((item) => isReaderWordsItem(item) || saidAsOperator(item));
    const turnKey = said.flatMap((item) => inputAddressOf(item.id)?.key ?? []).at(-1);
    const signals = yield* signalsOf(thread, source.items, new Set(said.map((item) => item.id)));
    const opened = yield* openings.open(thread, {
      turn:
        said.length > 0
          ? (runId: string) => threadUserMessageEvent({ id: runId }, { text: queuedTurnText(said), attachments: stored, reader, turnKey })
          : undefined,
      oriented: turns.length > 0,
      facts: (runId) => [
        ...under(signals, stopped ? runId : source.runId, runId),
        ...tasked.map((item) => threadSignalEvent(threadSignalOfInboxItem(item), runId)),
      ],
      seed: source.items.filter(carriesWords),
      consume: consumed(inbox, source),
      admits: unmoved(source),
      startKey: startKey,
      key: door?.key,
      answer:
        door === undefined
          ? undefined
          : (run, turn) =>
              turn !== null && said.some((item) => item.id === door.item.id)
                ? { status: 'started', runId: run.id, entry: turn.payload.entry }
                : { status: 'queued', runId: run.id, queued: threadQueuedTurnOf(run.id, door.item) },
    });
    return opened;
  });

  const history = Effect.fnUntraced(function* (
    thread: ThreadMetadataRow,
    source?: QueueSource,
    startKey?: ThreadRunStartKey,
  ): Effect.fn.Return<Opening, ThreadBorderFailed> {
    const signals = source ? yield* signalsOf(thread, source.items) : [];
    const opened = yield* openings.open(thread, {
      outputOptional: true,
      facts: source ? (runId) => under(signals, source.runId, runId) : undefined,
      seed: source ? source.items.filter(carriesWords) : undefined,
      consume: source ? consumed(inbox, source) : undefined,
      admits: source ? unmoved(source) : undefined,
      startKey: startKey,
    });
    return opened;
  });

  const segment = Effect.fnUntraced(function* (
    thread: ThreadMetadataRow,
    runId: string | null,
    pending: readonly ThreadInboxItem[],
    door?: Door,
  ): Effect.fn.Return<Opening | null, ThreadBorderFailed> {
    const receipt = (yield* openings.words(thread)) === 'receipt';
    if (beforeBarrier(pending).some((item) => opensTurn(item) || isReaderWordsItem(item))) {
      return yield* queuedTurns(thread, sourceOf(runId, pending, beforeBarrier), undefined, door);
    }
    const readable = sourceOf(runId, pending, (items) => readableAhead(receipt ? items.filter((item) => item.state === 'queued') : items));
    return readable.items.some((item) => !waitsForTurn(item)) ? yield* history(thread, readable) : null;
  });

  const open = Effect.fnUntraced(function* (
    threadId: string,
    runId: string,
    pending: readonly ThreadInboxItem[],
  ): Effect.fn.Return<string | null, ThreadBorderFailed> {
    const thread = yield* store.metadata(threadId);
    if (thread === undefined) return null;
    return yield* settled(thread, runId, pending).pipe(Effect.catchIf(held, () => owedToLift(threadId)));
  });

  const settled = Effect.fnUntraced(function* (
    thread: ThreadMetadataRow,
    runId: string,
    pending: readonly ThreadInboxItem[],
  ): Effect.fn.Return<string | null, ThreadBorderFailed> {
    let standing = pending;
    for (;;) {
      const opened = yield* segment(thread, runId, standing);
      if (opened?.status !== 'declined') return begunOf(opened)?.runId ?? null;
      standing = yield* inbox.pending(thread.id);
    }
  });

  const following = Effect.fnUntraced(function* (
    thread: ThreadMetadataRow,
    after: string | null,
    stopped: boolean,
    pending: readonly ThreadInboxItem[],
    door: Door | undefined,
  ): Effect.fn.Return<Opening | null, ThreadBorderFailed> {
    const waiting = pending.filter((item) => item.state === 'queued');
    if (stopped && waiting.some(isUnreadSteer)) return yield* queuedTurns(thread, sourceOf(after, pending, steered), undefined, door, true);
    const head = compactionHead(waiting);
    if (head.length === 0) return yield* segment(thread, after, pending, door);
    const row = yield* store.find(thread.id);
    if (row !== undefined && row.capabilities.compaction !== 'none') yield* compactions.queued(row, head);
    return null;
  });

  const next = Effect.fnUntraced(
    function* (
      thread: ThreadMetadataRow,
      after: string | null,
      stopped: boolean,
      given: { readonly pending?: readonly ThreadInboxItem[]; readonly door?: Door } = {},
    ): Effect.fn.Return<Opening | null, ThreadBorderFailed> {
      let pending = given.pending ?? (yield* inbox.pending(thread.id));
      for (;;) {
        const opened = yield* following(thread, after, stopped, pending, given.door);
        if (opened?.status !== 'declined' || given.door !== undefined) return opened;
        pending = yield* inbox.pending(thread.id);
      }
    },
    (effect, thread) => effect.pipe(Effect.catchIf(held, () => Effect.as(owedToLift(thread.id), null))),
  );

  const waiting = Effect.fnUntraced(function* (threadId: string): Effect.fn.Return<string | null, ThreadBorderFailed> {
    const latest = yield* ledger.latestRun(threadId);
    if (latest === null || latest.status === 'running') return null;
    return yield* open(threadId, latest.id, yield* inbox.pending(threadId));
  });

  const owedToLift = (threadId: string): Effect.Effect<string | null, ThreadBorderFailed> =>
    admission.wakeOnLift(threadId) ? Effect.succeed(null) : waiting(threadId);

  return {
    open,
    next,
    waiting,
    owedToLift,
    arrivals: signalsOf,

    continue: Effect.fnUntraced(function* (
      threadId: string,
      ownerId: string,
      startKey?: ThreadRunStartKey,
    ): Effect.fn.Return<ThreadBegun, ThreadBorderFailed> {
      const thread = yield* store.findOwned(threadId, ownerId);
      if (!thread) return yield* new ThreadCallBroke({ cause: new Error(`Thread not found: ${threadId}.`) });
      const active = yield* ledger.activeRun(thread.id);
      if (active) {
        return yield* new ThreadCallBroke({ cause: new ThreadRunConflictError({ threadId: thread.id, runId: active.id }) });
      }
      let pending = yield* inbox.pending(thread.id);
      const said = () => beforeBarrier(pending).some((item) => opensTurn(item) || isReaderWordsItem(item));
      const cannot = () =>
        new ThreadCallBroke({
          cause: new TransportCannotError({ threadId: thread.id, capability: 'continue', adapter: thread.transport.adapter }),
        });
      if (!thread.capabilities.continue && !said()) return yield* cannot();
      const latest = yield* ledger.latestRun(thread.id);
      if (latest === null || !threadRunInterrupted(latest.status)) {
        return yield* new ThreadCallBroke({
          cause: new ThreadRunNotInterruptedError({ threadId: thread.id, status: latest?.status ?? null }),
        });
      }
      const attempt = () =>
        (said()
          ? queuedTurns(thread, sourceOf(latest.id, pending, beforeBarrier), startKey)
          : history(thread, sourceOf(latest.id, pending, readableAhead), startKey)
        ).pipe(Effect.tapError(() => residency.release(thread.id)));
      yield* residency.admit(thread);
      let opening = yield* attempt();
      while (opening.status === 'declined' && (yield* ledger.activeRun(thread.id)) === null) {
        pending = yield* inbox.pending(thread.id);
        if (!thread.capabilities.continue && !said()) {
          yield* residency.release(thread.id);
          return yield* cannot();
        }
        opening = yield* attempt();
      }
      const opened = begunOf(opening);
      if (!opened) {
        yield* residency.release(thread.id);
        const winner = yield* ledger.activeRun(thread.id);
        return yield* new ThreadCallBroke({
          cause: new ThreadRunConflictError({ threadId: thread.id, runId: winner?.id ?? latest.id }),
        });
      }
      return opened;
    }),
  };
});

export function held(failure: ThreadBorderFailed): boolean {
  return threadCauseOf(failure) instanceof ThreadRunHeldError;
}

function under(arrivals: readonly Arrival[], addressed: string | null, opened: string): readonly ThreadEventBody[] {
  return arrivals.map(({ item, event }) => event(waitsForTurn(item) ? opened : addressed));
}

export function sameCohort(taken: readonly ThreadInboxItem[], now: readonly ThreadInboxItem[]): boolean {
  const standing = new Set(now.map((item) => `${item.id}:${item.state}`));
  return standing.size === taken.length && taken.every((item) => standing.has(`${item.id}:${item.state}`));
}

function readableAhead(items: readonly ThreadInboxItem[]): readonly ThreadInboxItem[] {
  return readableBefore(items, beforeBarrier(items));
}

function steered(items: readonly ThreadInboxItem[]): readonly ThreadInboxItem[] {
  const waiting = items.filter((item) => item.state === 'queued');
  const ahead = new Set(beforeBarrier(waiting).map((item) => item.id));
  return waiting.filter((item) => ahead.has(item.id) || isUnreadSteer(item));
}

function unmoved(source: QueueSource) {
  return (_tx: ThreadWriteTx, pending: readonly ThreadInboxItem[]) => Effect.succeed(sameCohort(source.items, source.cohort(pending)));
}

function consumed(inbox: Context.Service.Shape<typeof ThreadInbox>, source: QueueSource) {
  return Effect.fnUntraced(function* (runId: string, tx: ThreadWriteTx, how: WordsConsumed) {
    const words = source.items.filter(carriesWords);
    const requests = words.filter(isInboxRequest).map((item) => item.id);
    const taken = words.filter((item) => !isInboxRequest(item)).map((item) => item.id);
    if (requests.length > 0) yield* inbox.deliver(requests, runId, tx);
    if (taken.length > 0) yield* how === 'read' ? inbox.acknowledge(taken, runId, tx) : inbox.deliver(taken, runId, tx);
  });
}
