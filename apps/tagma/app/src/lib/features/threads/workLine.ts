import type { ThreadPhase } from '@tagma/server/threads/contract/wire/list';
import { CALL_CLOCK_MIN_MS, runningWorkText } from '@runlith/chat-ui/activity';
import { elapsedDuration } from '@runlith/chat-ui/chatTime';
import type { AgentWaiting } from '@runlith/agent/AgentPhase';
import { queuedCalls, waitingWords } from './workWords.js';

export const DWELL_MS = 1_000;
export const LONG_THINKING_MS = 20_000;
const SEEN_KEPT = 32;

export type WorkPhase = ThreadPhase['phase'];

export type WorkInput = {
  readonly phase: WorkPhase | null;
  readonly since: number | null;
  readonly waiting?: AgentWaiting;
  readonly calls: ThreadPhase['calls'];
  readonly queued: number;
};

type OpenCall = { readonly name: string; readonly label: string; readonly since: number | null };
type SeenCall = { readonly name: string; readonly label: string; readonly at: number };

export type WorkCallView =
  | {
      readonly kind: 'call';
      readonly label: string | null;
      readonly more: number;
      readonly elapsedMs: number | null;
      readonly queued: number;
    }
  | { readonly kind: 'burst'; readonly calls: readonly { readonly name: string; readonly count: number }[] };

export type WorkView =
  | WorkCallView
  | { readonly kind: 'opening'; readonly words: string; readonly elapsedMs: number | null }
  | {
      readonly kind: 'phase';
      readonly phase: 'thinking' | 'writing' | 'retrying' | 'compacting';
      readonly after: WorkCallView | null;
      readonly queued: number;
      readonly elapsedMs: number | null;
    };

export type WorkShown = { readonly view: WorkView; readonly text: string; readonly elapsed: string | null; readonly at: number };

export type WorkMemory = {
  readonly open: readonly OpenCall[];
  readonly seen: readonly SeenCall[];
  readonly shown: WorkShown | null;
};

export const NO_WORK: WorkMemory = { open: [], seen: [], shown: null };

export function observe(memory: WorkMemory, input: WorkInput, now: number): WorkMemory {
  const pool = [...memory.open];
  const fresh: SeenCall[] = [];
  const open = input.calls.map((call): OpenCall => {
    const label = call.title ?? call.name;
    const held = pool.findIndex((entry) => entry.label === label);
    if (held >= 0) pool.splice(held, 1);
    else fresh.push({ name: call.name, label, at: now });
    return { name: call.name, label, since: call.since };
  });
  const next: WorkMemory = {
    open,
    seen: [...memory.seen, ...fresh].slice(-SEEN_KEPT),
    shown: memory.shown,
  };
  const view = viewOf(next, input, now);
  if (view === null) return next;
  const text = workLineText(view);
  const elapsed = workLineElapsed(view);
  const shown = next.shown;
  if (shown === null || ((text !== shown.text || elapsed !== shown.elapsed) && now - shown.at >= DWELL_MS)) {
    return { ...next, shown: { view, text, elapsed, at: now } };
  }
  return next;
}

function viewOf(memory: WorkMemory, input: WorkInput, now: number): WorkView | null {
  const [first, ...rest] = memory.open;
  if (first !== undefined) {
    const since = memory.shown?.at ?? now;
    const recent = memory.seen.filter((call) => call.at >= since || now - call.at < DWELL_MS);
    if (recent.length > memory.open.length) return burst(recent);
    const elapsed = first.since === null ? null : now - first.since;
    return {
      kind: 'call',
      label: first.label,
      more: rest.length,
      elapsedMs: elapsed !== null && elapsed >= CALL_CLOCK_MIN_MS ? elapsed : null,
      queued: input.queued,
    };
  }
  const words = input.phase === 'opening' && input.waiting !== undefined ? waitingWords(input.waiting) : null;
  if (words !== null) return { kind: 'opening', words, elapsedMs: input.since === null ? null : Math.max(0, now - input.since) };
  const phase = phaseOf(input.phase);
  if (phase === null) {
    return input.queued > 0 ? { kind: 'call', label: null, more: 0, elapsedMs: null, queued: input.queued } : lastBurst(memory.seen);
  }
  const thought = phase === 'thinking' && input.since !== null ? now - input.since : 0;
  return {
    kind: 'phase',
    phase,
    after: lastBurst(memory.seen),
    queued: input.queued,
    elapsedMs: thought > LONG_THINKING_MS ? thought : null,
  };
}

function phaseOf(phase: WorkPhase | null): Extract<WorkView, { kind: 'phase' }>['phase'] | null {
  switch (phase) {
    case 'reasoning':
    case 'calling':
    case 'preparing':
    case 'opening':
      return 'thinking';
    case 'writing':
      return 'writing';
    case 'retrying':
      return 'retrying';
    case 'compacting':
      return 'compacting';
    case 'tools':
    case null:
      return null;
  }
}

function lastBurst(seen: readonly SeenCall[]): WorkCallView | null {
  const last = seen.at(-1);
  if (last === undefined) return null;
  let from = seen.length - 1;
  while (from > 0 && (seen[from] as SeenCall).at - (seen[from - 1] as SeenCall).at < DWELL_MS) from -= 1;
  const calls = seen.slice(from);
  return calls.length === 1 ? { kind: 'call', label: last.label, more: 0, elapsedMs: null, queued: 0 } : burst(calls);
}

function burst(calls: readonly SeenCall[]): WorkCallView {
  const counts = new Map<string, number>();
  for (const call of calls) counts.set(call.name, (counts.get(call.name) ?? 0) + 1);
  return { kind: 'burst', calls: [...counts].map(([name, count]) => ({ name, count })) };
}

function callText(view: WorkCallView): string {
  if (view.kind === 'burst') return view.calls.map(({ name, count }) => (count > 1 ? `${name} ×${count}` : name)).join(' · ');
  return runningWorkText({ ...view, elapsedMs: null }, { queuedCalls });
}

export function workLineText(view: WorkView): string {
  if (view.kind === 'opening') return view.words;
  if (view.kind !== 'phase') return callText(view);
  const said = [
    view.after === null ? `${view.phase}…` : `${view.phase} · after ${callText(view.after)}`,
    ...(view.queued > 0 ? [queuedCalls(view.queued)] : []),
  ];
  return said.join(' · ');
}

export function workLineElapsed(view: WorkView): string | null {
  if (view.kind === 'burst' || view.elapsedMs === null) return null;
  return elapsedDuration(view.elapsedMs);
}
