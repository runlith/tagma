import Puzzle from '@lucide/svelte/icons/puzzle';
import { ComposerRefused, type ComposerHandler, type ComposerSlashCommand } from '@runlith/chat-ui/composer';
import type { PluginActionRow, PluginActionSet } from '@tagma/server/views/contract/wire/actions';
import type { CommandEntry } from '@tagma/server/views/contract/wire/points';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import type { Point } from '@runlith/layer/Point';
import { Effect } from 'effect';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { type Action, type ActionEnv, type ActionSet, Actions } from '$lib/features/workspace/action.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
import { type SurfaceDeclaration, Surfaces } from '$lib/features/workspace/surface.js';
import { Door } from '$lib/wire/Door.js';
import { Live } from '$lib/wire/Live.js';
import { toldOf } from '$lib/wire/refusal.js';
import type { ComposerFace } from './composer.js';
import { paneId, PLUGIN_PANE } from './panes.js';
import { sectionSurface } from './surfaces.js';

const SECTIONS = 'plugin-views:sections';
const ACTIONS = 'plugin-views:actions';
const ARGUMENTS = '$ARGUMENTS';
const WORDS = [{ id: 'args', label: 'Words', optional: true }];
const COMMAND_ORDER = 80;

export const pluginAction = (plugin: string, act: string): string => `plugin.${plugin}.${act}`;

const titleOf = (row: PluginActionRow): string =>
  row.kind === 'section' ? `Go to ${row.title}` : row.kind === 'pane' ? `Open ${row.title} beside` : row.title;

const runsIn = (set: PluginActionSet, projectId: number | undefined): boolean =>
  projectId !== undefined && set.projects.includes(projectId);

async function act(env: ActionEnv, plugins: PluginActions, set: PluginActionSet, row: PluginActionRow, project: number): Promise<void> {
  const notices = env.resolve(Notices);
  if (row.kind === 'action') {
    const said = await plugins.run(set, row.id, project, { args: '' });
    if (said !== null) notices.said(said);
    return;
  }
  const shell = shellActs(env.resolve(ShellOps), notices);
  if (env.project?.id !== project) await shell.openProject(project, 'palette');
  if (row.kind === 'section') await shell.revealSurface(sectionSurface(set.plugin, row.view));
  else await shell.openPane(PLUGIN_PANE, paneId(set.plugin, row.view));
}

const pluginActions = (plugins: PluginActions): readonly Action[] =>
  plugins.sets.flatMap((set) => {
    const enables = (projectId: number | undefined): boolean => runsIn(set, projectId);
    const target = (env: ActionEnv): number | null =>
      enables(env.project?.id) ? env.project!.id : (plugins.workspace.projects.find((project) => enables(project.id))?.id ?? null);
    return set.actions.map((row): Action => ({
      id: pluginAction(set.plugin, row.id),
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
        return project === null ? undefined : act(env, plugins, set, row, project);
      },
    }));
  });

export class PluginActions extends Service<PluginActions>()('PluginActions', { tier: 'app', eager: true }) {
  static *make() {
    const plugins = new PluginActions(yield* Surfaces, yield* Actions, yield* Workspace, yield* Door);
    const scope = yield* Scope;
    const held = (yield* Live).hold(
      (client) => client['views.actions']({}),
      (state) => {
        plugins.sets = state.plugins;
        plugins.problem = null;
        plugins.heard = true;
      },
      (failure) => {
        if (failure.kind !== 'subscription') return;
        plugins.problem = failure.message;
        plugins.heard = true;
      },
    );
    scope.defer(() => held.unsubscribe());
    scope.defer(
      plugins.actions.register(ACTIONS, {
        id: ACTIONS,
        area: 'Plugins',
        actions: () => pluginActions(plugins),
        settled: () => plugins.heard,
      }),
    );
    return plugins;
  }

  sets = $state.raw<readonly PluginActionSet[]>([]);
  problem = $state<string | null>(null);
  private heard = $state(false);
  private shown: (() => void) | null = null;

  constructor(
    private readonly surfaces: Point<SurfaceDeclaration>,
    private readonly actions: Point<ActionSet>,
    readonly workspace: Workspace,
    private readonly door: Door,
  ) {
    super();
  }

  async run(
    set: PluginActionSet,
    action: string,
    project: number,
    call: { readonly threadId?: string; readonly args: string },
  ): Promise<string | null> {
    const { said } = await this.door.perform(
      'run_plugin_action',
      { plugin: set.plugin, action, threadId: call.threadId, args: call.args },
      { project: String(project) },
    );
    return said;
  }

  commands(projectId: number, face: ComposerFace): readonly ComposerSlashCommand[] {
    return this.sets
      .filter((set) => runsIn(set, projectId))
      .flatMap((set) => set.commands.map((command) => this.slash(set, command, face)));
  }

  private slash(set: PluginActionSet, command: CommandEntry, face: ComposerFace): ComposerSlashCommand {
    const named = { name: `${set.plugin}:${command.name}`, description: command.description, order: COMMAND_ORDER };
    if ('action' in command)
      return { ...named, fields: WORDS, run: ({ values }) => this.answered(set, command.action, face, values?.args ?? '') };
    const text = command.text;
    if (!text.includes(ARGUMENTS)) return { ...named, run: () => Effect.sync(() => face.draft.insert(text)) };
    return {
      ...named,
      fields: WORDS,
      run: ({ values }) => Effect.sync(() => face.draft.insert(text.replaceAll(ARGUMENTS, values?.args ?? ''))),
    };
  }

  private answered(set: PluginActionSet, action: string, face: ComposerFace, args: string): ComposerHandler {
    const before = face.draft.text;
    return Effect.tryPromise({
      try: () => this.run(set, action, face.thread.projectId, { threadId: face.thread.id ?? undefined, args }),
      catch: (error) => new ComposerRefused({ message: toldOf(error).text }),
    }).pipe(
      Effect.map((said) => {
        if (said === null) return;
        const now = face.draft.text;
        face.draft.setText(now === before ? said : `${now}\n\n${said}`);
      }),
    );
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
