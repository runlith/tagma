import { Service } from '@runlith/layer/key';
import { Scope } from '@runlith/layer/Scope';
import type { GraphRecovery, UnreadableRecovery } from '@tagma/server/graph/contract/wire/recovery';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { Door } from '$lib/wire/Door.js';
import { ProjectRung, type ProjectAim } from '$lib/features/workspace/ProjectRung.js';

export class Recovery extends Service<Recovery>()('Recovery', { tier: 'project' }) {
  static *make() {
    return new Recovery(yield* Live, yield* Door, yield* ProjectRung.Current, yield* Scope);
  }

  pending: GraphRecovery | null = $state.raw(null);
  failure: string | null = $state(null);
  total = $state(0);
  unreadable: readonly UnreadableRecovery[] = $state.raw([]);
  busy = $state(false);
  private dismissed: string | null = $state(null);
  private readonly showing = $derived(
    JSON.stringify([
      this.pending?.id ?? null,
      this.pending?.threadId ?? null,
      this.total,
      this.failure,
      this.unreadable.map((entry) => [entry.file, entry.error.code, entry.error.reason]),
    ]),
  );
  readonly shown = $derived(
    (this.pending !== null || this.failure !== null || this.unreadable.length > 0) && this.showing !== this.dismissed,
  );

  constructor(
    live: LiveConnection,
    private readonly door: Door,
    private readonly aim: ProjectAim,
    scope: Scope,
  ) {
    super();
    const held = live.hold(
      (client) => client['graph.recovery']({ projectId: aim.projectId }),
      ({ recovery, total, unreadable }) => {
        this.pending = recovery;
        this.total = total;
        this.unreadable = unreadable;
        this.failure = null;
        this.settle();
      },
      (failure) => {
        if (failure.kind !== 'subscription') return;
        this.failure = failure.message;
        this.settle();
      },
    );
    scope.defer(() => held.unsubscribe());
  }

  private settle(): void {
    if (this.dismissed !== null && this.showing !== this.dismissed) this.dismissed = null;
  }

  dismiss(): void {
    this.dismissed = this.showing;
  }

  async assign(): Promise<string> {
    const pending = this.pending;
    if (pending === null) throw new Error('This graph recovery is no longer pending.');
    this.busy = true;
    try {
      const answer = await this.door.perform(
        'start_graph_recovery',
        { id: pending.id, branch: pending.branch },
        { project: String(this.aim.projectId) },
      );
      return answer.threadId;
    } finally {
      this.busy = false;
    }
  }
}
