import type { PulseCounts } from '@tagma/server/threads/contract/wire/feeds';
import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { SvelteMap } from 'svelte/reactivity';
import { Live, type LiveConnection } from '$lib/wire/Live.js';

const NONE: PulseCounts = { working: 0, awaiting: 0 };

export class ProjectPulse extends Service<ProjectPulse>()('ProjectPulse', { tier: 'app' }) {
  static *make() {
    return new ProjectPulse(yield* Live, yield* Scope, yield* Failure);
  }

  private readonly projects = new SvelteMap<number, PulseCounts>();

  constructor(live: LiveConnection, scope: Scope, failure: Failure) {
    super();
    const held = live.hold(
      (client) => client['threads.pulse']({}),
      (event) => {
        if (event.type === 'all') {
          this.projects.clear();
          for (const project of event.projects) this.projects.set(project.projectId, project);
        } else if (event.working === 0 && event.awaiting === 0) this.projects.delete(event.projectId);
        else this.projects.set(event.projectId, event);
      },
      (reason) => {
        if (reason.kind === 'subscription') failure.report(new Error(reason.message));
      },
    );
    scope.defer(() => held.unsubscribe());
  }

  of(projectId: number): PulseCounts {
    return this.projects.get(projectId) ?? NONE;
  }
}
