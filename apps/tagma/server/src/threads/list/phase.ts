import { entryOf } from '@runlith/agent/transcript/kinds';
import { standingWork, toolStanding, type StandingSource } from '@runlith/agent/transcript/entries';
import type { ThreadLiveEvent } from '@runlith/agent/thread/run/ThreadLiveFeed';
import type { ThreadStateShape } from '@runlith/agent/thread/state';
import type { ThreadLivePosition, ThreadLiveView, ThreadOpenChange, ThreadOpenView } from '@runlith/agent/transcript/live';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ThreadPhase } from '../contract/wire/list.js';

export type PhaseSeed = {
  readonly activeRunId: string | null;
  readonly storedOpen: readonly ThreadTranscriptEntry[];
  readonly live: ThreadLiveView;
};

type Heard = { readonly changes: readonly ThreadOpenChange[]; readonly at: ThreadLivePosition };

type Retained = {
  readonly runId: string;
  readonly view: ThreadOpenView | null;
  readonly stored: readonly ThreadTranscriptEntry[];
  readonly heard: Heard[];
};

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
  for (const delta of event.frame.deltas) if (delta.entry?.type === 'tool') changes.push({ op: 'put', entry: delta.entry, from: 0 });
  return changes;
}

export class ThreadPhaseFeed {
  private readonly live = new Map<string, LiveWork>();
  private readonly watching = new Map<string, () => void>();
  private readonly followed = new Map<string, string>();
  private readonly cutting = new Map<string, Heard[]>();
  private readonly retained = new Map<string, Retained>();

  constructor(
    private readonly options: {
      watch(threadId: string, listener: (changes: readonly ThreadOpenChange[], at: ThreadLivePosition) => void): () => void;
      cut(threadId: string, deliver: (seed: PhaseSeed | null) => void): void;
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
    const standing = this.followed.get(threadId);
    if (standing === runId) return;
    this.followed.set(threadId, runId);
    if (!this.watching.has(threadId)) {
      this.watching.set(
        threadId,
        this.options.watch(threadId, (changes, at) => this.hear(threadId, changes, at)),
      );
    }
    if (standing !== undefined && this.live.delete(threadId)) this.options.onChanged(threadId);
    const kept = this.retained.get(threadId);
    this.retained.delete(threadId);
    if (kept?.runId === runId) {
      this.seed(threadId, kept.view, kept.stored, kept.heard);
      return;
    }
    const heard: Heard[] = [];
    this.cutting.set(threadId, heard);
    this.options.cut(threadId, (seed) => this.settle(threadId, heard, seed));
  }

  watched(): readonly string[] {
    return [...this.watching.keys()];
  }

  dispose(): void {
    for (const threadId of [...this.watching.keys()]) this.release(threadId);
  }

  private release(threadId: string): void {
    this.watching.get(threadId)?.();
    this.watching.delete(threadId);
    this.followed.delete(threadId);
    this.cutting.delete(threadId);
    this.retained.delete(threadId);
    if (this.live.delete(threadId)) this.options.onChanged(threadId);
  }

  private hear(threadId: string, changes: readonly ThreadOpenChange[], at: ThreadLivePosition): void {
    const heard = this.cutting.get(threadId);
    if (heard !== undefined) {
      heard.push({ changes, at });
      return;
    }
    if (at.runId === null || at.runId === this.followed.get(threadId)) {
      this.take(threadId, changes);
      return;
    }
    const kept = this.retained.get(threadId);
    if (kept?.runId === at.runId) kept.heard.push({ changes, at });
  }

  private settle(threadId: string, heard: readonly Heard[], seed: PhaseSeed | null): void {
    if (this.cutting.get(threadId) !== heard) return;
    this.cutting.delete(threadId);
    const runId = this.followed.get(threadId);
    const after =
      seed === null ? heard : heard.filter(({ at }) => at.incarnation !== seed.live.incarnation || at.at.seq > seed.live.at.seq);
    if (seed === null || seed.activeRunId === runId) {
      this.seed(threadId, seed !== null && seed.live.runId === runId ? seed.live : null, seed?.storedOpen ?? [], after);
      return;
    }
    if (seed.activeRunId !== null) {
      this.retained.set(threadId, {
        runId: seed.activeRunId,
        view: seed.live.runId === seed.activeRunId ? seed.live : null,
        stored: seed.storedOpen,
        heard: after.filter(({ at }) => at.runId === seed.activeRunId),
      });
    }
    this.take(
      threadId,
      after.filter(({ at }) => at.runId === null || at.runId === runId).flatMap(({ changes }) => changes),
    );
  }

  private seed(threadId: string, view: ThreadOpenView | null, stored: readonly ThreadTranscriptEntry[], heard: readonly Heard[]): void {
    const runId = this.followed.get(threadId);
    if (view !== null) {
      this.take(threadId, [
        ...view.open.map((open): ThreadOpenChange => ({ op: 'put', entry: open.entry, from: open.from })),
        { op: 'progress', progress: view.progress },
      ]);
    }
    const known = this.live.get(threadId)?.tools;
    const fresh = stored.filter((entry) => !known?.has(entry.id)).map((entry): ThreadOpenChange => ({ op: 'put', entry, from: 0 }));
    const later = heard.filter(({ at }) => at.runId === null || at.runId === runId).flatMap(({ changes }) => changes);
    this.take(threadId, [...fresh, ...later]);
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
