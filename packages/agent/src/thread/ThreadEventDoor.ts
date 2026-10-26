import { Effect } from 'effect';
import { type ThreadEntryPlacement, type ThreadEventFact } from '../transcript/eventFold';
import { TranscriptFold } from '../transcript/TranscriptFold';
import { HistoryFold, moveThreadHistory } from './HistoryFold';
import type { ThreadFoldSpan } from './storage/aggregate';
import type { ThreadCacheObservationValues } from './storage/cacheObservations';
import type { ThreadTx, ThreadWriteTx } from './ThreadPorts';
import type { ThreadAggregateStorage } from './storage/aggregate';
import type { ThreadEventLogStorage } from './storage/eventLog';
import type { ThreadContextReading, ThreadHistory } from './rows';
import type { ThreadTranscript, ThreadTranscriptEntry } from '../transcript/rows';
import { mintThreadEventId } from './identity';
import { decodeThreadEventPayload, type ThreadEventBody, type ThreadEventInput, type ThreadStepContext } from './events';
import { type ThreadPortFailure } from './ThreadBorder';
import { ThreadStorageFailed } from './persisted';
import { coreEntry, type ThreadEntryReader } from '../transcript/kinds';

export type ThreadLogState = {
  readonly history: ThreadHistory;
  readonly transcript: ThreadTranscript;
  readonly contextReading: ThreadContextReading | null;
  readonly placements: readonly ThreadEntryPlacement[];
  readonly cacheObservations: readonly ThreadCacheObservationValues[];
  readonly covered: ThreadFoldSpan | null;
};

export type ThreadSealedEvent = {
  readonly id: string;
  readonly body: ThreadEventBody;
};

export function sealThreadEvents(events: readonly ThreadEventInput[]): readonly ThreadSealedEvent[] {
  return events.map((event) => {
    const id = mintThreadEventId();
    return { id, body: 'compose' in event ? { kind: event.kind, payload: event.compose(id) } : event };
  });
}

export const appendThreadEventsIn = Effect.fnUntraced(function* <TWrite = ThreadWriteTx>(
  log: ThreadEventLogStorage<unknown, TWrite>,
  kinds: ThreadEntryReader,
  tx: TWrite,
  threadId: string,
  events: readonly ThreadSealedEvent[],
): Effect.fn.Return<readonly number[], ThreadPortFailure> {
  const positions: number[] = [];
  for (const { id, body } of events) {
    yield* replayableThreadEvent(kinds, body);
    const row = yield* log.append({ threadId, id, kind: body.kind, payload: body.payload }, tx);
    positions.push(row.position);
  }
  return positions;
});

function replayableThreadEvent(kinds: ThreadEntryReader, body: ThreadEventBody): Effect.Effect<void, ThreadPortFailure> {
  return Effect.try({
    try: () => {
      decodeThreadEventPayload(kinds, body.payload);
    },
    catch: (cause) => new ThreadStorageFailed({ call: 'append', cause }),
  });
}

export const threadPlacementSeed = Effect.fnUntraced(function* <TTx = ThreadTx, TWrite extends TTx = TTx>(
  store: ThreadAggregateStorage<TTx, TWrite>,
  threadId: string,
  events: readonly ThreadSealedEvent[],
  tx: TTx,
): Effect.fn.Return<ThreadTranscript, ThreadPortFailure> {
  const seed: ThreadTranscriptEntry[] = [];
  const seen = new Set<string>();
  for (const { body } of events) {
    for (const runId of placedRuns(body)) {
      for (const entry of yield* store.entriesOfRun(threadId, runId, tx)) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        seed.push(entry);
      }
    }
    const id = body.payload.entry?.id;
    if (id === undefined || seen.has(id)) continue;
    const held = yield* store.entryById(threadId, id, tx);
    if (!held) continue;
    seen.add(held.id);
    seed.push(held);
  }
  return seed;
});

function placedRuns(body: ThreadEventBody): readonly string[] {
  const { withdrawn, rewound, restored } = body.payload;
  if (withdrawn) return [withdrawn.runId];
  return rewound?.runIds ?? restored?.runIds ?? [];
}

export function threadEventFact(event: ThreadEventBody): ThreadEventFact {
  const { entry, withdrawn, rewound, restored, branched } = event.payload;
  return {
    kind: event.kind,
    entry: entry,
    withdrawn: withdrawn ? { runId: withdrawn.runId } : undefined,
    rewound: rewound ? { id: rewound.id, scope: rewound.scope, runIds: rewound.runIds } : undefined,
    restored: restored ? { rewindId: restored.rewindId, runIds: restored.runIds } : undefined,
    branched,
  };
}

export function foldThreadEvent(state: ThreadLogState, event: ThreadEventBody): ThreadLogState {
  return foldThreadEvents(state, [event]);
}

export function foldThreadEvents(state: ThreadLogState, events: Iterable<ThreadEventBody>, after?: number): ThreadLogState {
  let history: HistoryFold | undefined;
  let transcript: TranscriptFold | undefined;
  let placements: ThreadEntryPlacement[] | undefined;
  let observations: ThreadCacheObservationValues[] | undefined;
  let contextReading = state.contextReading;
  for (const event of events) {
    const fact = threadEventFact(event);
    if (
      fact.entry !== undefined ||
      fact.withdrawn !== undefined ||
      fact.rewound !== undefined ||
      fact.restored !== undefined ||
      fact.branched !== undefined
    ) {
      transcript ??= new TranscriptFold(state.transcript);
      const placement = transcript.place(fact);
      if (placement !== null) {
        placements ??= [...state.placements];
        placements.push(placement);
      }
    }
    const move = moveThreadHistory(event, after === undefined ? undefined : ++after);
    if (move !== null) {
      history ??= new HistoryFold(state.history);
      history.move(move);
    }
    const observation = threadCacheObservationOf(contextReading, event);
    if (observation !== null) {
      observations ??= [...state.cacheObservations];
      observations.push(observation);
    }
    contextReading = foldThreadContextReading(contextReading, event);
  }
  return {
    covered: state.covered,
    history: history?.take() ?? state.history,
    transcript: transcript !== undefined && placements !== undefined ? transcript.take() : state.transcript,
    contextReading,
    placements: placements ?? state.placements,
    cacheObservations: observations ?? state.cacheObservations,
  };
}

export function threadCacheObservationOf(
  previous: ThreadContextReading | null,
  event: ThreadEventBody,
): ThreadCacheObservationValues | null {
  const measurement = event.payload.measurement;
  if (event.kind !== 'measurement' || measurement === undefined || measurement.sentAt === undefined) return null;
  if (previous === null || previous.stale) return null;
  if (measurement.provider === null || previous.provider !== measurement.provider || previous.model !== measurement.model) {
    return null;
  }
  if (previous.account !== undefined && measurement.account !== undefined && previous.account !== measurement.account) {
    return null;
  }
  if (previous.reasoning !== undefined && measurement.reasoning !== undefined && previous.reasoning !== measurement.reasoning) {
    return null;
  }
  const gapMs = Date.parse(measurement.sentAt) - Date.parse(previous.measuredAt);
  if (!Number.isFinite(gapMs) || gapMs < 0) return null;
  const inputTokens = measurement.usage.inputTokens;
  if (inputTokens === undefined || inputTokens <= 0) return null;
  return {
    runId: measurement.runId,
    stepNumber: measurement.stepNumber,
    provider: measurement.provider,
    model: measurement.model,
    sentAt: measurement.sentAt,
    gapMs,
    inputTokens,
    cacheReadTokens: measurement.usage.cacheReadInputTokens ?? 0,
  };
}

export function foldThreadContextReading(reading: ThreadContextReading | null, event: ThreadEventBody): ThreadContextReading | null {
  const { usage, context, measurement } = event.payload;
  if (event.kind === 'measurement' && measurement !== undefined) {
    return {
      usage: measurement.usage,
      contextWindow: measurement.contextWindow,
      inputLimit: measurement.inputLimit,
      attempt: measurement.attempt,
      footprint: measurement.footprint,
      runId: measurement.runId,
      stepNumber: measurement.stepNumber,
      provider: measurement.provider,
      model: measurement.model,
      account: measurement.account,
      reasoning: measurement.reasoning,
      measuredAt: measurement.measuredAt,
      sentAt: measurement.sentAt,
      cache: measurement.cache,
      stale: false,
    };
  }
  if (event.kind === 'step' && usage !== undefined && context !== undefined) {
    if (measuredAlready(reading, context)) return reading;
    return {
      usage,
      contextWindow: context.contextWindow,
      inputLimit: context.inputLimit ?? null,
      runId: context.runId,
      stepNumber: context.stepNumber,
      provider: context.provider,
      model: context.model,
      measuredAt: context.measuredAt,
      stale: false,
    };
  }
  if (reading === null) return reading;
  if (event.payload.rewound !== undefined || event.payload.restored !== undefined) {
    return reading.stale && reading.staleBy === 'rewind' ? reading : { ...reading, stale: true, staleBy: 'rewind' };
  }
  if (event.kind === 'pruning' && !reading.stale) return { ...reading, stale: true };
  if (event.kind === 'compaction' && !reading.stale) {
    const activity = event.payload.entry;
    if (activity !== undefined && coreEntry(activity) && activity.type === 'compaction' && activity.status === 'completed') {
      return { ...reading, stale: true };
    }
  }
  return reading;
}

function measuredAlready(reading: ThreadContextReading | null, context: ThreadStepContext): boolean {
  if (reading === null || reading.footprint === undefined) return false;
  return reading.runId === context.runId && reading.stepNumber >= context.stepNumber;
}
