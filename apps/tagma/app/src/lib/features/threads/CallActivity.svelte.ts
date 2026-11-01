import type { CallAddress, CallControl, CallControlResult, CallEvent, CallRecord } from '@runlith/agent/callProgress';
import type { ThreadPhase } from '@tagma/server/threads/contract/wire/list';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Door } from '$lib/wire/Door.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { ProjectRung, type ProjectAim } from '$lib/features/workspace/ProjectRung.js';

const ENDED_WINDOW = 200;

const NO_CALLS: readonly CallRecord[] = [];

const keyOf = (address: CallAddress): string => `${address.runId}\u0000${address.toolCallId}`;

const standingFirst = (a: CallRecord, b: CallRecord): number => {
  if ((a.endedAt === null) !== (b.endedAt === null)) return a.endedAt === null ? -1 : 1;
  return (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt);
};

const endOf = (call: CallRecord): number => call.endedAt ?? 0;

function placeOf(ended: readonly CallRecord[], at: number): number {
  let low = 0;
  let high = ended.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (endOf(ended[middle] as CallRecord) > at) low = middle + 1;
    else high = middle;
  }
  return low;
}

function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const one = left as Record<string, unknown>;
  const other = right as Record<string, unknown>;
  const keys = Object.keys(one);
  if (keys.length !== Object.keys(other).length) return false;
  for (const key of keys) if (!(key in other) || !same(one[key], other[key])) return false;
  return true;
}

function sameCalls(left: readonly CallRecord[], right: readonly CallRecord[]): boolean {
  if (left.length !== right.length) return false;
  for (let at = 0; at < left.length; at += 1) if (left[at] !== right[at]) return false;
  return true;
}

class ThreadCalls {
  calls = $state.raw<readonly CallRecord[]>(NO_CALLS);
}

const answerText = (
  answer: { readonly control: CallControlResult['status']; readonly detail: string | null },
  action: CallControl['action'],
): string => {
  switch (answer.control) {
    case 'changed':
      return action === 'stop'
        ? 'Stopping — the run continues.'
        : action === 'background'
          ? 'Running in the background now; it is not cancelled.'
          : 'Limit set.';
    case 'ended':
      return 'It had already ended.';
    case 'missing':
      return answer.detail ?? 'It is no longer held.';
    case 'unavailable':
      return answer.detail ?? 'That is not available for it yet.';
  }
};

export class CallActivity extends Service<CallActivity>()('CallActivity', { tier: 'project' }) {
  static *make() {
    return new CallActivity(yield* ProjectRung.Current, yield* Live, yield* Door, yield* Scope);
  }

  failure = $state<string | null>(null);
  private acts = $state<Record<string, CallControl['action']>>({});
  private said = $state<Record<string, string>>({});
  private held = new Map<string, CallRecord>();
  private ended: CallRecord[] = [];
  private readonly threads = new Map<string, ThreadCalls>();
  private joined = $state(0);
  constructor(
    private readonly aim: ProjectAim,
    live: LiveConnection,
    private readonly door: Door,
    scope: Scope,
  ) {
    super();
    const held = live.hold(
      (client) => client['calls.subscribe']({ projectId: this.aim.projectId, ended: ENDED_WINDOW }),
      (frame) => this.apply(frame),
      (failure) => {
        if (failure.kind === 'subscription') this.failure = failure.message;
      },
      'frame',
    );
    scope.defer(() => held.unsubscribe());
  }

  callsOf(threadId: string): readonly CallRecord[] {
    const slice = this.threads.get(threadId);
    if (slice !== undefined) return slice.calls;
    void this.joined;
    return NO_CALLS;
  }

  waitingOf(threadId: string, standing: ThreadPhase | null): number {
    const told = new Set([...(standing?.calls.map((call) => call.id) ?? []), ...(standing?.queued ?? [])]);
    return this.callsOf(threadId).filter(
      (call) =>
        call.endedAt === null &&
        call.mode === 'background' &&
        (call.phase === 'waiting' || call.phase === 'preparing') &&
        !told.has(call.toolCallId),
    ).length;
  }

  callAt(threadId: string | null, runId: string | undefined, toolCallId: string): CallRecord | null {
    const record = this.recordAt(threadId, runId, toolCallId);
    return record === null || record.endedAt !== null ? null : record;
  }

  endedAt(threadId: string | null, runId: string | undefined, toolCallId: string): CallRecord | null {
    const record = this.recordAt(threadId, runId, toolCallId);
    return record === null || record.endedAt === null ? null : record;
  }

  private recordAt(threadId: string | null, runId: string | undefined, toolCallId: string): CallRecord | null {
    if (threadId === null || runId === undefined) return null;
    void this.callsOf(threadId);
    const record = this.held.get(keyOf({ runId, toolCallId }));
    return record === undefined || record.threadId !== threadId ? null : record;
  }

  actOf(call: CallRecord): CallControl['action'] | null {
    return this.acts[keyOf(call)] ?? null;
  }

  saidOf(call: CallRecord): string | null {
    return this.said[keyOf(call)] ?? null;
  }

  async control(call: CallRecord, control: CallControl): Promise<void> {
    const key = keyOf(call);
    if (this.acts[key] !== undefined) return;
    this.acts = { ...this.acts, [key]: control.action };
    this.said = { ...this.said, [key]: '' };
    try {
      const answer = await this.door.perform(
        'control_call',
        { runId: call.runId, toolCallId: call.toolCallId, control },
        { project: String(this.aim.projectId) },
      );
      this.said = { ...this.said, [key]: answerText(answer, control.action) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.said = { ...this.said, [key]: message };
    } finally {
      const { [key]: _done, ...rest } = this.acts;
      this.acts = rest;
    }
  }

  private apply(frame: CallEvent): void {
    if (frame.type === 'snapshot') {
      this.failure = null;
      this.replace(frame.calls);
    } else this.update(frame.call);
  }

  private replace(calls: readonly CallRecord[]): void {
    const held = new Map<string, CallRecord>();
    for (const call of calls) {
      const key = keyOf(call);
      const was = this.held.get(key);
      held.set(key, was !== undefined && same(was, call) ? was : call);
    }
    this.held = held;
    const ended = [...this.held.values()].filter((call) => call.endedAt !== null).sort((a, b) => endOf(b) - endOf(a));
    for (const gone of ended.splice(ENDED_WINDOW)) this.held.delete(keyOf(gone));
    this.ended = ended;
    const grouped = new Map<string, CallRecord[]>();
    for (const call of this.held.values()) {
      if (call.threadId === null) continue;
      const mine = grouped.get(call.threadId);
      if (mine === undefined) grouped.set(call.threadId, [call]);
      else mine.push(call);
    }
    for (const thread of [...this.threads.keys()]) if (!grouped.has(thread)) this.settle(thread, NO_CALLS);
    for (const [thread, mine] of grouped) this.settle(thread, mine.sort(standingFirst));
    this.forget();
  }

  private update(call: CallRecord): void {
    const key = keyOf(call);
    const before = this.held.get(key);
    const gone = new Set<CallRecord>();
    const touched = new Set<string>();
    if (before !== undefined) {
      gone.add(before);
      if (before.threadId !== null) touched.add(before.threadId);
      if (before.endedAt !== null) {
        let at = placeOf(this.ended, endOf(before));
        while (at < this.ended.length && this.ended[at] !== before) at += 1;
        if (at < this.ended.length) this.ended.splice(at, 1);
      }
    }
    this.held.set(key, call);
    if (call.threadId !== null) touched.add(call.threadId);
    if (call.endedAt !== null) this.ended.splice(placeOf(this.ended, endOf(call)), 0, call);
    while (this.ended.length > ENDED_WINDOW) {
      const out = this.ended.pop() as CallRecord;
      this.held.delete(keyOf(out));
      gone.add(out);
      if (out.threadId !== null) touched.add(out.threadId);
    }
    for (const thread of touched) {
      const kept = (this.threads.get(thread)?.calls ?? NO_CALLS).filter((held) => !gone.has(held));
      if (call.threadId === thread && this.held.get(key) === call) kept.push(call);
      this.settle(thread, kept.sort(standingFirst));
    }
    if (gone.size > (before === undefined ? 0 : 1)) this.forget();
  }

  private settle(thread: string, calls: readonly CallRecord[]): void {
    const slice = this.threads.get(thread);
    if (calls.length === 0) {
      if (slice === undefined) return;
      slice.calls = NO_CALLS;
      this.threads.delete(thread);
      return;
    }
    if (slice !== undefined) {
      if (!sameCalls(slice.calls, calls)) slice.calls = calls;
      return;
    }
    const born = new ThreadCalls();
    born.calls = calls;
    this.threads.set(thread, born);
    this.joined += 1;
  }

  private forget(): void {
    const stale = (key: string): boolean => !this.held.has(key);
    if (!Object.keys(this.said).some(stale) && !Object.keys(this.acts).some(stale)) return;
    const keeping = <T>(entries: Record<string, T>): Record<string, T> =>
      Object.fromEntries(Object.entries(entries).filter(([key]) => !stale(key)));
    this.said = keeping(this.said);
    this.acts = keeping(this.acts);
  }
}
