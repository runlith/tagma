import { type Context, Effect, type Scope } from 'effect';
import type { AgentSignalArrivals } from '../../agent/AgentRunner';
import type { AgentSignal } from '../../agent/contracts';
import { carriesWords, isUnreadReport, isUnreadSteer, threadSignalOfInboxItem } from '../inboxItems';
import type { ThreadRunRow } from '../rows';
import type { ThreadPortFailure } from '../ThreadBorder';
import type { TransportRuns } from '../transport/contract';
import type { ThreadChanges } from './ThreadChanges';

export class HostedWords implements AgentSignalArrivals {
  private standing: readonly AgentSignal[] = [];
  private held: readonly string[] = [];
  private readonly listeners = new Set<(signal: AgentSignal) => void>();

  constructor(
    private readonly run: ThreadRunRow,
    private readonly runs: TransportRuns,
  ) {}

  subscribe(listener: (signal: AgentSignal) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  unread(): readonly AgentSignal[] {
    return this.standing;
  }

  handed(): readonly string[] {
    return this.held;
  }

  refresh(): Effect.Effect<void, ThreadPortFailure> {
    const handed = this.runs.handed?.(this.run) ?? Effect.succeed([]);
    return Effect.map(handed, (items) => {
      const words = items.filter(carriesWords);
      const seen = new Set(this.standing.map((signal) => signal.id));
      this.held = words.map((item) => item.id);
      this.standing = words.flatMap((item) => (isUnreadSteer(item) || isUnreadReport(item) ? [threadSignalOfInboxItem(item)] : []));
      for (const signal of this.standing) {
        if (seen.has(signal.id)) continue;
        for (const listener of this.listeners) listener(signal);
      }
    });
  }

  watch(changes: Context.Service.Shape<typeof ThreadChanges>): Effect.Effect<never, ThreadPortFailure, Scope.Scope> {
    return Effect.flatMap(changes.watch([this.run.threadId]), (moved) => Effect.forever(Effect.andThen(moved, this.refresh())));
  }
}
