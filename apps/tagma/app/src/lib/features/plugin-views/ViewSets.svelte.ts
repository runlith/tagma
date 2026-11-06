import type { PluginViewSet, ShownSection } from '@tagma/server/views/contract/wire/sets';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { ProjectRung, type ProjectAim } from '$lib/features/workspace/ProjectRung.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { PluginModules } from './PluginModules.js';
import { type SheetPort, UtilitiesSheet } from './UtilitiesSheet.js';

type ShownView = { readonly set: PluginViewSet; readonly view: PluginViewSet['views'][number] };

const placedModules = (set: PluginViewSet): readonly string[] =>
  [...set.results, ...set.composer].flatMap((placed) => {
    const built = set.views.find((view) => view.id === placed.view)?.module;
    return built?.state === 'ready' ? [built.address] : [];
  });

export class ViewSets extends Service<ViewSets>()('ViewSets', { tier: 'project' }) {
  static *make() {
    return new ViewSets(yield* ProjectRung.Current, yield* Live, yield* PluginModules, yield* UtilitiesSheet, yield* Scope);
  }

  sets = $state.raw<readonly PluginViewSet[]>([]);
  enabled = $state.raw<readonly string[]>([]);
  known = $state(false);
  problem = $state<string | null>(null);
  private said = '';

  constructor(
    readonly aim: ProjectAim,
    live: LiveConnection,
    modules: PluginModules,
    sheet: SheetPort,
    scope: Scope,
  ) {
    super();
    const feed = live.hold(
      (client) => client['views.subscribe']({ projectId: aim.projectId }),
      (event) => {
        sheet.show(event.sheet);
        const said = JSON.stringify(event);
        if (said !== this.said) {
          this.sets = event.plugins;
          this.enabled = event.enabled;
          modules.preload(event.plugins.flatMap(placedModules));
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

  surface(plugin: string, view: string): ShownSection | undefined {
    return this.sets.find((candidate) => candidate.plugin === plugin)?.surfaces.find((candidate) => candidate.view === view);
  }

  keepsPane(plugin: string, view: string): boolean {
    const set = this.sets.find((candidate) => candidate.plugin === plugin);
    return set === undefined ? this.enabled.includes(plugin) : set.panes.some((candidate) => candidate.view === view);
  }

  pane(plugin: string, view: string): ShownSection | undefined {
    return this.sets.find((candidate) => candidate.plugin === plugin)?.panes.find((candidate) => candidate.view === view);
  }

  view(plugin: string, view: string): ShownView | undefined {
    const set = this.sets.find((candidate) => candidate.plugin === plugin);
    const shown = set?.views.find((candidate) => candidate.id === view);
    return set === undefined || shown === undefined ? undefined : { set, view: shown };
  }
}
