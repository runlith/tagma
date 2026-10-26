import type { ThreadRunRow } from '@runlith/agent/thread/rows';
import type { ThreadCompactionEntry } from '@runlith/agent/transcript/entries';
import type { RunLaunch } from '@runlith/agent/thread/transport/contract';
import type { RunOwnership } from '@runlith/agent/thread/run/ThreadRunLedger';

export type CompactionOrder = {
  readonly run: ThreadRunRow;
  readonly keep: string | undefined;
  readonly mode: ThreadCompactionEntry['mode'];
};

export class ProtocolLaunches {
  private readonly owed = new Map<string, RunLaunch>();
  private readonly compacting = new Map<string, CompactionOrder>();
  private readonly compactions = new Set<string>();
  private readonly leading = new Map<string, string>();
  private readonly handed = new Map<string, Set<string>>();
  private readonly waiting = new Set<string>();
  private readonly issued = new Set<string>();

  constructor(private readonly ownership: RunOwnership) {}

  owe(launch: RunLaunch): boolean {
    if (!this.ownership.launchable(launch.run.id) || this.leading.has(launch.run.id)) return false;
    this.leading.set(launch.run.id, launch.thread.id);
    this.owed.set(launch.thread.id, launch);
    return true;
  }

  oweCompaction(order: CompactionOrder): boolean {
    if (!this.ownership.launchable(order.run.id) || this.leading.has(order.run.id)) return false;
    this.leading.set(order.run.id, order.run.threadId);
    this.compactions.add(order.run.id);
    this.compacting.set(order.run.threadId, order);
    return true;
  }

  compactionOwed(threadId: string): CompactionOrder | undefined {
    return this.compacting.get(threadId);
  }

  owing(threadId: string): RunLaunch | undefined {
    return this.owed.get(threadId);
  }

  waits(runId: string): boolean {
    if (this.waiting.has(runId)) return false;
    this.waiting.add(runId);
    return true;
  }

  issue(runId: string): boolean {
    if (!this.unsent(runId)) return false;
    if (!this.ownership.launchable(runId)) {
      this.unsend(runId);
      return false;
    }
    this.issued.add(runId);
    return true;
  }

  issuing(runId: string): boolean {
    return this.issued.has(runId);
  }

  unsend(runId: string): boolean {
    if (!this.unsent(runId)) return false;
    this.finish(runId);
    return true;
  }

  private unsent(runId: string): boolean {
    const threadId = this.leading.get(runId);
    if (threadId === undefined || this.issued.has(runId)) return false;
    return this.owed.get(threadId)?.run.id === runId || this.compacting.get(threadId)?.run.id === runId;
  }

  sent(threadId: string, runId: string): void {
    this.issued.delete(runId);
    this.waiting.delete(runId);
    if (this.owed.get(threadId)?.run.id === runId) this.owed.delete(threadId);
    if (this.compacting.get(threadId)?.run.id === runId) this.compacting.delete(threadId);
  }

  threadOf(runId: string): string | undefined {
    return this.leading.get(runId);
  }

  finish(runId: string): boolean {
    const threadId = this.leading.get(runId);
    const compacted = this.compactions.delete(runId);
    this.leading.delete(runId);
    this.handed.delete(runId);
    this.waiting.delete(runId);
    this.issued.delete(runId);
    if (threadId === undefined) return compacted;
    if (this.owed.get(threadId)?.run.id === runId) this.owed.delete(threadId);
    if (this.compacting.get(threadId)?.run.id === runId) this.compacting.delete(threadId);
    return compacted;
  }

  drop(threadId: string): void {
    for (const [runId, led] of this.leading) if (led === threadId) this.finish(runId);
  }

  leads(runIds: readonly string[]): readonly string[] {
    return runIds.filter((runId) => this.issued.has(runId) || this.unsent(runId));
  }

  hand(runId: string, ids: readonly string[]): void {
    const held = this.handed.get(runId) ?? new Set<string>();
    for (const id of ids) held.add(id);
    this.handed.set(runId, held);
  }

  handedOf(runId: string): ReadonlySet<string> {
    return this.handed.get(runId) ?? new Set();
  }

  settle(runId: string, ids: readonly string[]): void {
    const held = this.handed.get(runId);
    if (held === undefined) return;
    for (const id of ids) held.delete(id);
    if (held.size === 0) this.handed.delete(runId);
  }
}
