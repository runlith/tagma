import type {
  ThreadLivePosition,
  ThreadLiveProgress,
  ThreadLiveView,
  ThreadOpenChange,
  ThreadOpenEntry,
  ThreadOpenText,
} from '../../transcript/live';
import type { ThreadTranscriptEntry } from '../../transcript/rows';
import { coreEntry } from '../../transcript/kinds';
import { appendedEntry, OPEN_WINDOW, openSlice, openText, openWindow } from '../../transcript/openText';
import { wireWeight } from '../../transcript/cap';
import { Effect, FiberSet, Layer, Semaphore } from 'effect';
import type { ThreadBorderFailed } from '../ThreadBorder';
import { ThreadFeed, type ThreadTx } from '../ThreadPorts';
import type { ThreadState, ThreadStateFrame, ThreadStateShape } from '../state';
import { createEventEmitter, createKeyedEventEmitter } from '@runlith/utils/event';

export type ThreadLiveEvent<TState> = ThreadLivePosition &
  (
    | { readonly type: 'state'; readonly frame: ThreadStateFrame<TState>; readonly weight: number }
    | { readonly type: 'open'; readonly change: ThreadOpenChange; readonly weight: number }
  );

type Lane<TState> = {
  readonly incarnation: string;
  seq: number;
  position: number;
  runId: string | null;
  watchers: number;
  readonly open: Map<string, ThreadTranscriptEntry>;
  readonly landing: Set<string>;
  progress: ThreadLiveProgress | null;
  state: TState | null;
};

const STILL: ThreadLiveProgress = { phase: null, estimate: null };

export type ThreadLiveFeed<TState extends ThreadStateShape> = Effect.Success<ReturnType<typeof makeThreadLiveFeed<TState>>>;

export const makeThreadLiveFeed = Effect.fnUntraced(function* <TState extends ThreadStateShape>() {
  const runCallback = yield* FiberSet.makeRuntime<never, void, never>();
  const listenerFailed = (error: unknown): void => {
    runCallback(Effect.logWarning('a live feed listener failed', error));
  };
  const events = createKeyedEventEmitter<string, [ThreadLiveEvent<TState>]>(listenerFailed);
  const stateListeners = createEventEmitter<[TState]>(listenerFailed);
  const lanes = new Map<string, Lane<TState>>();
  const emptyIncarnation = crypto.randomUUID();
  const cuts = new Map<string, { gate: Semaphore.Semaphore; readers: number }>();

  const atCut = <A, E, R>(threadId: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const cut = cuts.get(threadId) ?? { gate: Semaphore.makeUnsafe(1), readers: 0 };
        cut.readers += 1;
        cuts.set(threadId, cut);
        return cut;
      }),
      (cut) => cut.gate.withPermit(work),
      (cut) =>
        Effect.sync(() => {
          cut.readers -= 1;
          if (cut.readers === 0) cuts.delete(threadId);
        }),
    );

  const tail = (threadId: string, runId: string, entries: readonly ThreadTranscriptEntry[], landed: readonly string[]): void => {
    const lane = running(threadId, runId);
    for (const id of landed) if (lane.open.has(id)) lane.landing.add(id);
    const seen = new Set<string>();
    for (const entry of entries) {
      seen.add(entry.id);
      const held = lane.open.get(entry.id);
      lane.open.set(entry.id, entry);
      lane.landing.delete(entry.id);
      if (held === entry) continue;
      const grown = held === undefined ? null : growth(held, entry);
      if (grown === '') continue;
      emitOpen(threadId, lane, grown === null ? { op: 'put', ...openWindow(entry) } : grew(entry, grown));
    }
    for (const id of [...lane.open.keys()]) {
      if (seen.has(id) || lane.landing.has(id)) continue;
      lane.open.delete(id);
      emitOpen(threadId, lane, { op: 'drop', id });
    }
    release(threadId, lane);
  };

  const append = (threadId: string, runId: string, id: string, text: string): void => {
    if (text.length === 0) return;
    const lane = running(threadId, runId);
    const held = lane.open.get(id);
    if (held === undefined) return;
    const entry = appendedEntry(held, text);
    lane.open.set(id, entry);
    emitOpen(threadId, lane, grew(entry, text));
  };

  const progress = (threadId: string, runId: string, progress: ThreadLiveProgress): void => {
    const lane = running(threadId, runId);
    const held = lane.progress ?? STILL;
    if (held.phase === progress.phase && held.estimate === progress.estimate) return;
    lane.progress = progress;
    emitOpen(threadId, lane, { op: 'progress', progress });
  };

  const publishState = (frame: ThreadStateFrame<TState>): void => {
    const state = frame.state;
    const threadId = state.thread.id;
    const lane = laneOf(threadId);
    for (const delta of frame.deltas) {
      if (delta.entry !== undefined) {
        lane.open.delete(delta.entry.id);
        lane.landing.delete(delta.entry.id);
      }
      if (delta.withdrawn === undefined) continue;
      for (const [id, entry] of lane.open) {
        if (entry.runId !== delta.withdrawn.runId) continue;
        lane.open.delete(id);
        lane.landing.delete(id);
      }
    }
    lane.position =
      frame.rewritten === true ? frame.state.position : Math.max(lane.position, frame.state.position, frame.deltas.at(-1)?.position ?? 0);
    lane.state = state;
    lane.seq += 1;
    events.emit(threadId, {
      type: 'state',
      incarnation: lane.incarnation,
      runId: state.activeRun?.id ?? state.latestRun?.id ?? null,
      at: { position: lane.position, seq: lane.seq },
      frame,
      weight: lane.watchers === 0 ? 0 : frame.deltas.reduce((sum, delta) => sum + weigh(delta.entry), 0),
    });
    if (lane.runId !== null && state.activeRun?.id !== lane.runId && state.latestRun?.id === lane.runId) close(threadId, lane);
    release(threadId, lane);
    stateListeners.emit(state);
  };

  const view = (threadId: string): ThreadLiveView => {
    const lane = lanes.get(threadId);
    if (lane === undefined) return { incarnation: emptyIncarnation, runId: null, at: { position: 0, seq: 0 }, open: [], progress: null };
    const open: ThreadOpenEntry[] = [];
    for (const [id, entry] of lane.open) if (!lane.landing.has(id)) open.push(openWindow(entry));
    return {
      incarnation: lane.incarnation,
      runId: lane.runId,
      at: { position: lane.position, seq: lane.seq },
      open,
      progress: lane.progress,
    };
  };

  const text = (threadId: string, id: string, from: number, limit: number): ThreadOpenText | null => {
    const entry = lanes.get(threadId)?.open.get(id);
    const held = entry === undefined ? null : openText(entry);
    return held === null ? null : openSlice(held, from, limit);
  };

  const stateOf = (threadId: string): TState | null => lanes.get(threadId)?.state ?? null;

  const watched = (): readonly string[] => {
    const followed: string[] = [];
    for (const [threadId, lane] of lanes) if (lane.watchers > 0) followed.push(threadId);
    return followed;
  };

  const subscribe = (threadId: string, listener: (event: ThreadLiveEvent<TState>) => void): (() => void) => {
    const lane = laneOf(threadId);
    lane.watchers += 1;
    const unsubscribe = events.subscribe(threadId, listener);
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      unsubscribe();
      lane.watchers -= 1;
      release(threadId, lane);
    };
  };
  const subscribeStates = (listener: (state: TState) => void): (() => void) => stateListeners.subscribe(listener);

  function running(threadId: string, runId: string): Lane<TState> {
    const lane = laneOf(threadId);
    if (lane.runId !== runId) close(threadId, lane);
    lane.runId = runId;
    return lane;
  }
  function close(threadId: string, lane: Lane<TState>): void {
    for (const id of [...lane.open.keys()]) {
      lane.open.delete(id);
      lane.landing.delete(id);
      emitOpen(threadId, lane, { op: 'drop', id });
    }
    if (lane.progress !== null) {
      lane.progress = null;
      emitOpen(threadId, lane, { op: 'progress', progress: null });
    }
    lane.runId = null;
  }
  function emitOpen(threadId: string, lane: Lane<TState>, change: ThreadOpenChange): void {
    lane.seq += 1;
    events.emit(threadId, {
      type: 'open',
      incarnation: lane.incarnation,
      runId: lane.runId,
      at: { position: lane.position, seq: lane.seq },
      change,
      weight: lane.watchers === 0 ? 0 : changeWeight(change),
    });
  }
  function laneOf(threadId: string): Lane<TState> {
    const held = lanes.get(threadId);
    if (held !== undefined) return held;
    const lane: Lane<TState> = {
      incarnation: crypto.randomUUID(),
      seq: 0,
      position: 0,
      runId: null,
      watchers: 0,
      open: new Map(),
      landing: new Set(),
      progress: null,
      state: null,
    };
    lanes.set(threadId, lane);
    return lane;
  }
  function release(threadId: string, lane: Lane<TState>): void {
    if (lane.watchers > 0 || lane.runId !== null || lane.open.size > 0) return;
    if (lanes.get(threadId) === lane) lanes.delete(threadId);
  }
  return { atCut, tail, append, progress, publishState, stateOf, view, text, watched, subscribe, subscribeStates };
});

function growth(held: ThreadTranscriptEntry, next: ThreadTranscriptEntry): string | null {
  if (!coreEntry(held) || !coreEntry(next)) return null;
  if (held.type === 'tool' && next.type === 'tool') {
    const before = held.toolInputRaw;
    const after = next.toolInputRaw;
    if (before?.kind !== 'text' || after?.kind !== 'text' || before.complete !== after.complete) return null;
    return sameBesides(held, next, 'toolInputRaw') ? grownBy(before.text, after.text) : null;
  }
  if ((held.type === 'message' && next.type === 'message') || (held.type === 'reasoning' && next.type === 'reasoning')) {
    return sameBesides(held, next, 'text') ? grownBy(held.text, next.text) : null;
  }
  return null;
}

function grew(entry: ThreadTranscriptEntry, text: string): ThreadOpenChange {
  return text.length > OPEN_WINDOW ? { op: 'put', ...openWindow(entry) } : { op: 'append', id: entry.id, text };
}

function grownBy(before: string, after: string): string | null {
  if (after.length === before.length) return after === before ? '' : null;
  return after.length > before.length && after.startsWith(before) ? after.slice(before.length) : null;
}

function sameBesides(held: ThreadTranscriptEntry, next: ThreadTranscriptEntry, growing: string): boolean {
  const before = held as Readonly<Record<string, unknown>>;
  const after = next as Readonly<Record<string, unknown>>;
  let members = 0;
  for (const key in after) {
    const value = after[key];
    if (value === undefined) continue;
    members += 1;
    if (key !== growing && before[key] !== value) return false;
  }
  for (const key in before) if (before[key] !== undefined) members -= 1;
  return members === 0;
}

function changeWeight(change: ThreadOpenChange): number {
  switch (change.op) {
    case 'put':
      return weigh(change.entry);
    case 'append':
      return change.text.length;
    default:
      return 0;
  }
}

function weigh(entry: ThreadTranscriptEntry | undefined): number {
  return entry === undefined ? 0 : wireWeight(entry);
}

export function threadFeedLayer<TState extends ThreadStateShape>(
  live: ThreadLiveFeed<TState>,
  toState: (state: ThreadState, tx: ThreadTx) => Effect.Effect<TState, ThreadBorderFailed>,
): Layer.Layer<ThreadFeed> {
  const publish = (frame: ThreadStateFrame<ThreadState>, tx: ThreadTx, published: () => void): Effect.Effect<void, ThreadBorderFailed> =>
    Effect.map(toState(frame.state, tx), (projected) => {
      live.publishState({ ...frame, state: projected });
      published();
    });
  return Layer.succeed(ThreadFeed, {
    atCut: (threadId, work) => live.atCut(threadId, work),
    tail: (threadId, runId, entries, landed) => live.tail(threadId, runId, entries, landed),
    append: (threadId, runId, id, text) => live.append(threadId, runId, id, text),
    progress: (threadId, runId, progress) => live.progress(threadId, runId, progress),
    view: (threadId) => {
      const { at, open, progress } = live.view(threadId);
      return { at, open, progress };
    },
    liveView: live.view,
    text: live.text,
    publish,
    carry: (frame, published) => {
      const last = live.stateOf(frame.state.thread.id);
      if (last === null) return Effect.succeed(false);
      return Effect.sync(() => {
        live.publishState({ ...frame, state: { ...last, ...frame.state } });
        published();
        return true;
      });
    },
  });
}
