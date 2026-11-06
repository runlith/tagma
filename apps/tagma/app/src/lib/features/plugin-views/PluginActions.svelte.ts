import Puzzle from '@lucide/svelte/icons/puzzle';
import type { PluginActionRow, PluginActionSet } from '@tagma/server/views/contract/wire/actions';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import type { Point } from '@runlith/layer/Point';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { type Action, type ActionEnv, type ActionSet, Actions } from '$lib/features/workspace/action.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
import { type SurfaceDeclaration, Surfaces } from '$lib/features/workspace/surface.js';
import { Door } from '$lib/wire/Door.js';
import { Live } from '$lib/wire/Live.js';
import { paneId, PLUGIN_PANE } from './panes.js';
import { sectionSurface } from './surfaces.js';

const SECTIONS = 'plugin-views:sections';
const ACTIONS = 'plugin-views:actions';

const titleOf = (row: PluginActionRow): string =>
  row.kind === 'section' ? `Go to ${row.title}` : row.kind === 'pane' ? `Open ${row.title} beside` : row.title;

async function act(env: ActionEnv, set: PluginActionSet, row: PluginActionRow, project: number): Promise<void> {
  const notices = env.resolve(Notices);
  if (row.kind === 'action') {
    const { said } = await env
      .resolve(Door)
      .perform('run_plugin_action', { plugin: set.plugin, action: row.id }, { project: String(project) });
    if (said !== null) notices.said(said);
    return;
  }
  const shell = shellActs(env.resolve(ShellOps), notices);
  if (env.project?.id !== project) await shell.openProject(project, 'palette');
  const view = row.id.slice(row.id.indexOf(':') + 1);
  if (row.kind === 'section') await shell.revealSurface(sectionSurface(set.plugin, view));
  else await shell.openPane(PLUGIN_PANE, paneId(set.plugin, view));
}

const pluginActions = (sets: readonly PluginActionSet[], workspace: Workspace): readonly Action[] =>
  sets.flatMap((set) => {
    const enables = (projectId: number | undefined): boolean => projectId !== undefined && set.projects.includes(projectId);
    const target = (env: ActionEnv): number | null =>
      enables(env.project?.id) ? env.project!.id : (workspace.projects.find((project) => enables(project.id))?.id ?? null);
    return set.actions.map((row): Action => ({
      id: `plugin.${set.plugin}.${row.id}`,
      title: titleOf(row),
      keywords: [set.title, 'plugin'],
      order: 70,
      icon: Puzzle,
      keys: row.keys.map((key) => (key.global ? { keys: key.keys, global: true as const } : key.keys)),
      by: { plugin: set.plugin, title: set.title, rank: set.rank },
      available: (env) => target(env) !== null,
      listed: (env) => enables(env.project?.id),
      run: (env) => {
        const project = target(env);
        return project === null ? undefined : act(env, set, row, project);
      },
    }));
  });

export class PluginActions extends Service<PluginActions>()('PluginActions', { tier: 'app', eager: true }) {
  static *make() {
    const plugins = new PluginActions(yield* Surfaces, yield* Actions, yield* Workspace);
    const scope = yield* Scope;
    const held = (yield* Live).hold(
      (client) => client['views.actions']({}),
      (state) => {
        plugins.sets = state.plugins;
        plugins.problem = null;
      },
      (failure) => {
        if (failure.kind === 'subscription') plugins.problem = failure.message;
      },
    );
    scope.defer(() => held.unsubscribe());
    scope.defer(
      plugins.actions.register(ACTIONS, { id: ACTIONS, area: 'Plugins', actions: () => pluginActions(plugins.sets, plugins.workspace) }),
    );
    return plugins;
  }

  sets = $state.raw<readonly PluginActionSet[]>([]);
  problem = $state<string | null>(null);
  private shown: (() => void) | null = null;

  constructor(
    private readonly surfaces: Point<SurfaceDeclaration>,
    private readonly actions: Point<ActionSet>,
    private readonly workspace: Workspace,
  ) {
    super();
  }

  show(sections: readonly SurfaceDeclaration[]): () => void {
    this.shown?.();
    const released = this.surfaces.register(SECTIONS, ...sections);
    const release = (): void => {
      if (this.shown !== release) return;
      this.shown = null;
      released();
    };
    this.shown = release;
    return release;
  }
}
