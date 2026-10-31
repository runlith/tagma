import type { ThreadRunRow } from '@runlith/agent/thread/rows';
import type { ThreadCompactionEntry } from '@runlith/agent/transcript/entries';
import type { RunLaunch } from '@runlith/agent/thread/transport/contract';
import type { RunOwnership } from '@runlith/agent/thread/run/ThreadRunLedger';
import type { InterruptReceipt } from '@runlith/agent/thread/transport/contract';
import { Deferred, Effect } from 'effect';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';

export type CompactionOrder = {
  readonly run: ThreadRunRow;
  readonly keep: string | undefined;
  readonly mode: ThreadCompactionEntry['mode'];
};

type LaunchFlight = {
  readonly threadId: string;
  readonly cancelled: Deferred.Deferred<void>;
  drained: Deferred.Deferred<void>;
  readonly receipt: Deferred.Deferred<InterruptReceipt, HarnessFailure>;
  fenced: boolean;
  issued: boolean;
  closing: boolean;
  forgotten: boolean;
  launchDone: boolean;
  openings: number;
  release?: () => void;
};

export class ProtocolLaunches {
  private readonly owed = new Map<string, RunLaunch>();
  private readonly compacting = new Map<string, CompactionOrder>();
  private readonly compactions = new Set<string>();
  private readonly leading = new Map<string, string>();
  private readonly handed = new Map<string, Set<string>>();
  private readonly waiting = new Set<string>();
  private readonly issued = new Set<string>();
  private readonly flights = new Map<string, LaunchFlight>();

  constructor(private readonly ownership: RunOwnership) {}

  private flight(threadId: string): LaunchFlight {
    return {
      threadId,
      cancelled: Deferred.makeUnsafe(),
      drained: Deferred.makeUnsafe(),
      receipt: Deferred.makeUnsafe(),
      fenced: false,
      issued: false,
      closing: false,
      forgotten: false,
      launchDone: false,
      openings: 0,
    };
  }

  private advanced(runId: string, flight: LaunchFlight): void {
    if (!flight.launchDone || flight.openings !== 0) return;
    Deferred.doneUnsafe(flight.drained, Effect.void);
    if (flight.forgotten && !flight.fenced && this.flights.get(runId) === flight) {
      this.flights.delete(runId);
      flight.release?.();
    }
  }

  completed(runId: string): void {
    const flight = this.flights.get(runId);
    if (flight === undefined) return;
    flight.launchDone = true;
    this.advanced(runId, flight);
  }

  enterOpening(runId: string): boolean {
    const flight = this.flights.get(runId);
    if (flight === undefined || flight.fenced || flight.forgotten) return false;
    if (Deferred.isDoneUnsafe(flight.drained)) flight.drained = Deferred.makeUnsafe();
    flight.openings++;
    return true;
  }

  leaveOpening(runId: string): void {
    const flight = this.flights.get(runId);
    if (flight === undefined) return;
    flight.openings--;
    this.advanced(runId, flight);
  }

  track(runId: string, release: () => void): void {
    const flight = this.flights.get(runId);
    if (flight !== undefined) flight.release = release;
  }

  pending(runId: string): LaunchFlight | undefined {
    return this.flights.get(runId);
  }

  owe(launch: RunLaunch): boolean {
    if (!this.ownership.launchable(launch.run.id) || this.leading.has(launch.run.id)) return false;
    this.leading.set(launch.run.id, launch.thread.id);
    this.flights.set(launch.run.id, this.flight(launch.thread.id));
    this.owed.set(launch.thread.id, launch);
    return true;
  }

  oweCompaction(order: CompactionOrder): boolean {
    if (!this.ownership.launchable(order.run.id) || this.leading.has(order.run.id)) return false;
    this.leading.set(order.run.id, order.run.threadId);
    this.flights.set(order.run.id, this.flight(order.run.threadId));
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
    if (!this.ownership.launchable(runId)) return false;
    this.issued.add(runId);
    const flight = this.flights.get(runId);
    if (flight !== undefined) flight.issued = true;
    return true;
  }

  issuing(runId: string): boolean {
    return this.issued.has(runId);
  }

  fence(runId: string): { readonly flight: LaunchFlight; readonly first: boolean } | null {
    const flight = this.flights.get(runId);
    if (flight === undefined) return null;
    if (!flight.fenced) {
      if (flight.issued || (flight.forgotten && flight.launchDone)) return null;
      flight.fenced = true;
      this.finish(runId);
      Deferred.doneUnsafe(flight.cancelled, Effect.void);
    }
    const first = !flight.closing;
    flight.closing = true;
    return { flight, first };
  }

  closed(runId: string): void {
    const flight = this.flights.get(runId);
    if (flight === undefined) return;
    this.flights.delete(runId);
    flight.release?.();
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
    return this.leading.get(runId) ?? this.flights.get(runId)?.threadId;
  }

  finish(runId: string): boolean {
    const threadId = this.leading.get(runId);
    const compacted = this.compactions.delete(runId);
    this.leading.delete(runId);
    this.handed.delete(runId);
    this.waiting.delete(runId);
    this.issued.delete(runId);
    const flight = this.flights.get(runId);
    if (flight !== undefined) {
      flight.forgotten = true;
      this.advanced(runId, flight);
    }
    if (threadId === undefined) return compacted;
    if (this.owed.get(threadId)?.run.id === runId) this.owed.delete(threadId);
    if (this.compacting.get(threadId)?.run.id === runId) this.compacting.delete(threadId);
    return compacted;
  }

  drop(threadId: string): void {
    for (const [runId, led] of this.leading) if (led === threadId) this.finish(runId);
  }

  leads(runIds: readonly string[]): readonly string[] {
    return runIds.filter((runId) => {
      const flight = this.flights.get(runId);
      return this.issued.has(runId) || this.unsent(runId) || flight?.fenced === true ||
        (flight !== undefined && !flight.issued && (!flight.forgotten || !flight.launchDone));
    });
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
