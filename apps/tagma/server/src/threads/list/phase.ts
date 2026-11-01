import { entryOf } from '@runlith/agent/transcript/kinds';
import { standingWork, toolStanding, type StandingSource } from '@runlith/agent/transcript/entries';
import type { ThreadLiveEvent } from '@runlith/agent/thread/run/ThreadLiveFeed';
import type { ThreadStateShape } from '@runlith/agent/thread/state';
import type { ThreadOpenChange, ThreadOpenView } from '@runlith/agent/transcript/live';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ThreadPhase } from '../contract/wire/list.js';

type LiveWork = {
  phase: ThreadPhase['phase'];
  since: ThreadPhase['since'];
  waiting: ThreadPhase['waiting'];
  readonly tools: Map<string, StandingSource>;
  shown: ThreadPhase | null;
};

const STEP_ENDING_PHASES: ReadonlySet<ThreadPhase['phase']> = new Set(['preparing', 'retrying', 'compacting']);

export function phaseChanges<TState extends ThreadStateShape>(event: ThreadLiveEvent<TState>): readonly ThreadOpenChange[] {
  if (event.type === 'open') return [event.change];
  const changes: ThreadOpenChange[] = [];
  for (const delta of event.frame.deltas) if (delta.entry?.type === 'tool') changes.push({ op: 'put', entry: delta.entry });
  return changes;
}

export class ThreadPhaseFeed {
  private readonly live = new Map<string, LiveWork>();
  private readonly watching = new Map<string, () => void>();
  private readonly sowing = new Map<string, ThreadOpenChange[]>();

  constructor(
    private readonly options: {
      watch(threadId: string, listener: (change: readonly ThreadOpenChange[]) => void): () => void;
      view(threadId: string): ThreadOpenView;
      journal(threadId: string, runId: string, deliver: (entries: readonly ThreadTranscriptEntry[]) => void): void;
      onChanged(threadId: string): void;
    },
  ) {}

  phaseOf(threadId: string): ThreadPhase | null {
    return this.live.get(threadId)?.shown ?? null;
  }

  follow(threadId: string, runId: string | null): void {
    if (runId === null) {
      this.release(threadId);
      return;
    }
    if (this.watching.has(threadId)) return;
    const waiting: ThreadOpenChange[] = [];
    this.sowing.set(threadId, waiting);
    this.watching.set(
      threadId,
      this.options.watch(threadId, (changes) => this.hear(threadId, changes)),
    );
    const open = this.options.view(threadId);
    this.take(threadId, [
      ...open.open.map((entry): ThreadOpenChange => ({ op: 'put', entry })),
      { op: 'progress', progress: open.progress },
    ]);
    this.options.journal(threadId, runId, (entries) => this.sow(threadId, waiting, entries));
  }

  dispose(): void {
    for (const threadId of [...this.watching.keys()]) this.release(threadId);
  }

  private release(threadId: string): void {
    this.watching.get(threadId)?.();
    this.watching.delete(threadId);
    this.sowing.delete(threadId);
    if (this.live.delete(threadId)) this.options.onChanged(threadId);
  }

  private hear(threadId: string, changes: readonly ThreadOpenChange[]): void {
    const waiting = this.sowing.get(threadId);
    if (waiting === undefined) this.take(threadId, changes);
    else waiting.push(...changes);
  }

  private sow(threadId: string, waiting: readonly ThreadOpenChange[], entries: readonly ThreadTranscriptEntry[]): void {
    if (this.sowing.get(threadId) !== waiting) return;
    this.sowing.delete(threadId);
    const known = this.live.get(threadId)?.tools;
    const fresh = entries.filter((entry) => !known?.has(entry.id)).map((entry): ThreadOpenChange => ({ op: 'put', entry }));
    this.take(threadId, [...fresh, ...waiting]);
  }

  private take(threadId: string, changes: readonly ThreadOpenChange[]): void {
    let ended = false;
    let moved = false;
    for (const change of changes) {
      if (change.op === 'progress' && (change.progress?.phase ?? null) === null) ended = this.live.delete(threadId) || ended;
      else moved = this.move(threadId, change) || moved;
    }
    if (!moved && !ended) return;
    const work = this.live.get(threadId);
    if (work === undefined) {
      if (ended) this.options.onChanged(threadId);
      return;
    }
    const standing = standingWork(work.tools.values());
    const next: ThreadPhase = {
      phase: work.phase,
      since: work.since,
      waiting: work.waiting,
      calls: standing.calls,
      queued: standing.queued,
    };
    if (work.shown !== null && samePhase(work.shown, next)) {
      if (ended) this.options.onChanged(threadId);
      return;
    }
    work.shown = next;
    this.options.onChanged(threadId);
  }

  private move(threadId: string, change: ThreadOpenChange): boolean {
    if (change.op === 'progress') {
      const phase = change.progress?.phase ?? null;
      if (phase === null) return false;
      const work = this.hold(threadId, phase.phase);
      work.phase = phase.phase;
      work.since = phase.since;
      work.waiting = phase.waiting;
      if (STEP_ENDING_PHASES.has(work.phase)) work.tools.clear();
      return true;
    }
    if (change.op === 'drop') return this.live.get(threadId)?.tools.delete(change.id) ?? false;
    if (change.op !== 'put' || !entryOf('tool')(change.entry)) return false;
    const call = change.entry;
    if (toolStanding(call) === null) return this.live.get(threadId)?.tools.delete(call.id) ?? false;
    const work = this.hold(threadId, 'tools');
    const held = work.tools.get(call.id);
    if (held === undefined && work.phase !== 'tools') {
      work.phase = 'tools';
      work.since = null;
      work.waiting = undefined;
    }
    work.tools.set(call.id, {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      title: call.toolDisplay?.title ?? held?.title ?? null,
      toolState: call.toolState,
      execution: call.execution,
    });
    return true;
  }

  private hold(threadId: string, phase: ThreadPhase['phase']): LiveWork {
    const held = this.live.get(threadId);
    if (held) return held;
    const work: LiveWork = { phase, since: null, waiting: undefined, tools: new Map(), shown: null };
    this.live.set(threadId, work);
    return work;
  }
}

function samePhase(held: ThreadPhase, next: ThreadPhase): boolean {
  return (
    held.phase === next.phase &&
    held.since === next.since &&
    held.waiting?.reason === next.waiting?.reason &&
    held.waiting?.place === next.waiting?.place &&
    held.queued.length === next.queued.length &&
    held.queued.every((id, index) => id === next.queued[index]) &&
    held.calls.length === next.calls.length &&
    held.calls.every(
      (call, index) =>
        call.id === next.calls[index]?.id &&
        call.name === next.calls[index]?.name &&
        call.title === next.calls[index]?.title &&
        call.since === next.calls[index]?.since,
    )
  );
}
