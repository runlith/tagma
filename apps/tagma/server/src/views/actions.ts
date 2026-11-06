import { type McpAppCallResult, mcpAppResult } from '@runlith/mcp/apps';
import type { McpCaller } from '@runlith/mcp/caller';
import { Effect, PubSub, Stream } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { PluginHost } from '../plugin-host/contract/service/supervision.js';
import { EnabledPlugins, HostedPlugins, Plugins } from '../plugins/contract/service/plugins.js';
import type { PluginContribution, PluginRef } from '../plugins/contract/service/points.js';
import { PluginActions } from './contract/service/actions.js';
import { ACTIONS, SHORTCUTS } from './contract/service/points.js';
import type { PluginActionRow, PluginActionSet, PluginActionState } from './contract/wire/actions.js';
import type { ActionEntries, ShortcutEntries } from './contract/wire/points.js';
import { callRefusal, READ_PLUGINS, refusal, unreadable } from './refusals.js';
import type { Sections } from './sections.js';

type Held<W> = { readonly plugin: PluginRef; readonly value: W };

export const makeActions = Effect.fnUntraced(function* (input: {
  readonly moves: PubSub.PubSub<number | null>;
  readonly changed: () => void;
  readonly viewed: () => ReadonlyMap<string, PluginRef>;
  readonly surfaces: Sections;
  readonly panes: Sections;
}) {
  const { moves, changed, viewed, surfaces, panes } = input;
  const enabled = yield* EnabledPlugins;
  const hosted = yield* HostedPlugins;
  const plugins = yield* Plugins;
  const host = yield* PluginHost;
  const actions = new Map<string, Held<ActionEntries>>();
  const shortcuts = new Map<string, Held<ShortcutEntries>>();

  const holding =
    <W extends readonly unknown[]>(held: Map<string, Held<W>>) =>
    ({ plugin, value }: PluginContribution<W>) =>
      Effect.sync(() => {
        if (value.length === 0) return () => undefined;
        const standing: Held<W> = { plugin, value };
        held.set(plugin.id, standing);
        changed();
        return () => {
          if (held.get(plugin.id) !== standing) return;
          held.delete(plugin.id);
          changed();
        };
      });

  const rowsOf = (plugin: string): readonly PluginActionRow[] => {
    const asked = shortcuts.get(plugin)?.value ?? [];
    const keysOf = (name: string) =>
      asked.filter((shortcut) => shortcut.action === name).map((s) => ({ keys: s.keys, global: s.global === true }));
    return [
      ...(actions.get(plugin)?.value ?? []).map((entry): PluginActionRow => ({
        id: entry.id,
        kind: 'action',
        title: entry.title,
        keys: keysOf(entry.id),
      })),
      ...surfaces.of(plugin).map((entry): PluginActionRow => ({
        id: `section:${entry.view}`,
        kind: 'section',
        view: entry.view,
        title: entry.title,
        keys: keysOf(`section:${entry.view}`),
      })),
      ...panes.of(plugin).map((entry): PluginActionRow => ({
        id: `pane:${entry.view}`,
        kind: 'pane',
        view: entry.view,
        title: entry.title,
        keys: keysOf(`pane:${entry.view}`),
      })),
    ];
  };

  const state = Effect.fn('PluginActions.state')(function* () {
    const roots = yield* hosted.roots();
    const known = viewed();
    const listed: PluginActionSet[] = [];
    for (const [rank, install] of (yield* plugins.installs()).entries()) {
      const there = roots.get(install.id);
      const ref = actions.get(install.id)?.plugin ?? shortcuts.get(install.id)?.plugin ?? known.get(install.id);
      if (there === undefined || ref === undefined) continue;
      const rows = rowsOf(install.id);
      if (rows.length > 0) listed.push({ plugin: install.id, title: ref.title, rank, projects: there.projects, actions: rows });
    }
    return { plugins: listed } satisfies PluginActionState;
  });

  const unknown = (plugin: string, action: string) =>
    new GateRefusal('plugin-action-unknown', `The plugin ${plugin} offers this project no action ${action}.`, [READ_PLUGINS]);

  const sentence = (result: { readonly content: readonly Readonly<Record<string, unknown>>[] }): string | null => {
    const text = result.content
      .flatMap((part) => (part.type === 'text' && typeof part.text === 'string' ? [part.text] : []))
      .join('\n')
      .trim();
    return text === '' ? null : text;
  };

  const answered = (result: McpAppCallResult) =>
    result.isError === true
      ? Effect.fail(refusal('plugin-call-failed', sentence(result) ?? 'The action failed and gave no reason.'))
      : Effect.succeed(sentence(result));

  return {
    contributions: {
      actions: { point: ACTIONS, register: holding(actions) },
      shortcuts: { point: SHORTCUTS, register: holding(shortcuts) },
    },
    service: PluginActions.of({
      sets: Stream.unwrap(
        Effect.map(PubSub.subscribe(moves), (subscription) =>
          Stream.concat(Stream.succeed(null), Stream.fromSubscription(subscription)).pipe(
            Stream.mapEffect(() => state()),
            Stream.changesWith((left, right) => JSON.stringify(left) === JSON.stringify(right)),
          ),
        ),
      ),
      run: Effect.fn('PluginActions.run')(function* (projectId, plugin, action) {
        const declared = actions.get(plugin)?.value.find((entry) => entry.id === action);
        if (declared === undefined) return yield* unknown(plugin, action);
        const admit = Effect.gen(function* () {
          const running = (yield* enabled.held(projectId).pipe(Effect.mapError(unreadable)))();
          const still = actions.get(plugin)?.value.find((entry) => entry.id === action);
          if (!running.includes(plugin) || still?.tool !== declared.tool) return yield* unknown(plugin, action);
        });
        const caller: McpCaller = { kind: 'operator', projectId, view: `action:${action}` };
        const result = yield* host
          .callAdmitted(plugin, admit, declared.tool, {}, { caller })
          .pipe(Effect.mapError((failure) => (failure instanceof GateRefusal ? failure : callRefusal(failure))));
        return yield* answered(mcpAppResult(result));
      }),
    }),
  };
});
