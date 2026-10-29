import type { SectionEntry } from '@tagma/server/views/contract/wire/points';
import type { TagmaAppViewSet } from '@tagma/server/views/contract/wire/sets';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { ProjectRung, type ProjectAim } from '$lib/features/workspace/ProjectRung.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';

export type ShownView = { readonly set: TagmaAppViewSet; readonly view: TagmaAppViewSet['views'][number] };

export class ViewSets extends Service<ViewSets>()('ViewSets', { tier: 'project' }) {
  static *make() {
    return new ViewSets(yield* ProjectRung.Current, yield* Live, yield* Scope);
  }

  sets = $state.raw<readonly TagmaAppViewSet[]>([]);
  enabled = $state.raw<readonly string[]>([]);
  known = $state(false);
  problem = $state<string | null>(null);
  private said = '';

  constructor(
    readonly aim: ProjectAim,
    live: LiveConnection,
    scope: Scope,
  ) {
    super();
    const feed = live.hold(
      (client) => client['views.subscribe']({ projectId: aim.projectId }),
      (event) => {
        const said = JSON.stringify(event);
        if (said !== this.said) {
          this.sets = event.apps;
          this.enabled = event.enabled;
        }
        this.said = said;
        this.known = true;
        this.problem = null;
      },
      (failure) => {
        if (failure.kind === 'subscription') this.problem = failure.message;
      },
    );
    scope.defer(() => feed.unsubscribe());
  }

  surface(tagmaApp: string, view: string): SectionEntry | undefined {
    return this.sets.find((candidate) => candidate.app === tagmaApp)?.surfaces.find((candidate) => candidate.view === view);
  }

  keepsPane(tagmaApp: string, view: string): boolean {
    const set = this.sets.find((candidate) => candidate.app === tagmaApp);
    return set === undefined ? this.enabled.includes(tagmaApp) : set.panes.some((candidate) => candidate.view === view);
  }

  pane(tagmaApp: string, view: string): SectionEntry | undefined {
    return this.sets.find((candidate) => candidate.app === tagmaApp)?.panes.find((candidate) => candidate.view === view);
  }

  view(tagmaApp: string, view: string): ShownView | undefined {
    const set = this.sets.find((candidate) => candidate.app === tagmaApp);
    const shown = set?.views.find((candidate) => candidate.id === view);
    return set === undefined || shown === undefined ? undefined : { set, view: shown };
  }
}
