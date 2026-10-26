import type { PresenceEvent, PresenceMissingReason, PresenceRow } from '@tagma/server/threads/contract/wire/presence';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Stream } from 'effect';
import { ProjectRung, type ProjectAim } from '$lib/features/workspace/ProjectRung.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { Holds } from './Holds.js';
import { applyPresence, type PresenceCell } from './rows.js';

class Cell implements PresenceCell {
  row = $state.raw<PresenceRow | undefined>(undefined);
  revision = $state.raw(0);
  missing = $state.raw<PresenceMissingReason | undefined>(undefined);
}

export class PresenceSet {
  known = $state(false);
  problem = $state<string | null>(null);
  private readonly cells: ReadonlyMap<string, Cell>;
  private readonly feed: { unsubscribe: () => void };

  constructor(projectId: number, threadIds: readonly string[], live: LiveConnection) {
    this.cells = new Map(threadIds.map((id) => [id, new Cell()]));
    let generation = 0;
    this.feed = live.hold(
      (client) => {
        const mine = (generation += 1);
        return Stream.map(client['threads.presence']({ projectId, threadIds }), (event) => ({ generation: mine, event }));
      },
      ({ generation: from, event }: { readonly generation: number; readonly event: PresenceEvent }) => {
        if (from !== generation) return;
        applyPresence(this.cells, event);
        if (event.type === 'initial') this.known = true;
        this.problem = null;
      },
      (failure) => {
        if (failure.kind === 'subscription') this.problem = failure.message;
      },
    );
  }

  row(threadId: string): PresenceRow | undefined {
    return this.cells.get(threadId)?.row;
  }

  revision(threadId: string): number {
    return this.cells.get(threadId)?.revision ?? 0;
  }

  missing(threadId: string): PresenceMissingReason | undefined {
    return this.cells.get(threadId)?.missing;
  }

  close(): void {
    this.feed.unsubscribe();
  }
}

export type PresenceHold = { readonly set: PresenceSet; release(): void };

export class ThreadPresence extends Service<ThreadPresence>()('ThreadPresence', { tier: 'project' }) {
  static *make() {
    return new ThreadPresence(yield* ProjectRung.Current, yield* Live, yield* Scope);
  }

  private readonly sets = new Holds<PresenceSet>((set) => set.close());

  constructor(
    private readonly aim: ProjectAim,
    private readonly live: LiveConnection,
    scope: Scope,
  ) {
    super();
    scope.defer(() => this.sets.closeAll());
  }

  watch(threadIds: readonly string[]): PresenceHold {
    const ids = [...new Set(threadIds)].sort();
    const hold = this.sets.take(JSON.stringify(ids), () => new PresenceSet(this.aim.projectId, ids, this.live));
    return { set: hold.value, release: hold.release };
  }
}
