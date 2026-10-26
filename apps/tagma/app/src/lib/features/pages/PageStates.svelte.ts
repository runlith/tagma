import type { PageState } from '@tagma/server/artifacts/contract/wire/artifacts';
import { SvelteMap } from 'svelte/reactivity';
import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { ProjectRung, type ProjectAim } from '$lib/features/workspace/ProjectRung.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { refusalOf } from '$lib/wire/refusal.js';

type Held = { readers: number; readonly subscription: { unsubscribe: () => void } };

export class PageStates extends Service<PageStates>()('PageStates', { tier: 'project' }) {
  static *make() {
    return new PageStates(yield* Live, yield* ProjectRung.Current, yield* Scope, yield* Failure);
  }

  private readonly states = new SvelteMap<string, PageState>();
  private readonly held = new Map<string, Held>();

  constructor(
    private readonly live: LiveConnection,
    private readonly aim: ProjectAim,
    scope: Scope,
    private readonly failure: Failure,
  ) {
    super();
    scope.defer(() => {
      for (const one of this.held.values()) one.subscription.unsubscribe();
      this.held.clear();
    });
  }

  state(id: string): PageState | undefined {
    return this.states.get(id);
  }

  hold(id: string): () => void {
    const standing = this.held.get(id);
    const held = standing ?? { readers: 0, subscription: this.follow(id) };
    held.readers += 1;
    this.held.set(id, held);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      held.readers -= 1;
      if (held.readers > 0 || this.held.get(id) !== held) return;
      this.held.delete(id);
      held.subscription.unsubscribe();
      this.states.delete(id);
    };
  }

  private follow(id: string): { unsubscribe: () => void } {
    return this.live.hold(
      (client) => client['artifacts.page']({ projectId: this.aim.projectId, id }),
      (state) => {
        this.states.set(id, state);
      },
      (reason) => {
        if (reason.kind !== 'subscription') return;
        this.failure.report(
          reason.code === undefined
            ? new Error(reason.message)
            : refusalOf({ code: reason.code, reason: reason.message, unblock: reason.unblock ?? [] }),
        );
      },
    );
  }
}
