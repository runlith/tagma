import { page, type PageQuestion, pageRows, pastKey, readCursor } from '@runlith/paging';
import { Effect } from 'effect';
import { body, pair } from '../platform/contract/service/body.js';
import { ceilingOf } from '../platform/contract/wire/pageFamily.js';
import { cursorRefusal, GateRefusal } from '../platform/contract/wire/refusal.js';
import type { SettableScope } from '../platform/contract/wire/setting.js';
import { McpServers } from '../mcp/contract/service/servers.js';
import { CurrentProject } from '../projects/contract/service/caller.js';
import { OPERATOR } from '../workspace/contract/wire/checkout.js';
import { Plugins } from './contract/service/plugins.js';
import { createPlugin } from './creation.js';
import { PLUGIN_OPERATIONS as OPS, PLUGIN_ROWS } from './contract/wire/operations.js';
import type { PluginRow } from './contract/wire/rows.js';

const questionOf = (projectId: number): PageQuestion => ({ operation: 'read_plugins', selection: { projectId }, order: PLUGIN_ROWS.order });
const CEILING = ceilingOf(PLUGIN_ROWS);

const keyOf = (row: { readonly id: string }) => [row.id] as const;

const answer = (plugin: PluginRow) => ({ status: 'ok' as const, plugin });

const projectId = Effect.map(Effect.flatten(CurrentProject), (call) => call.project.id);

const reached = Effect.fnUntraced(function* (project: number, plugin: PluginRow) {
  if (!plugin.enabled) return plugin;
  const servers = yield* McpServers;
  const remote = (yield* servers.list(project)).filter(
    (row) => row.scope === 'contributed' && row.contributor === plugin.id && row.enabled && row.reach.transport === 'http',
  );
  yield* Effect.forEach(remote, (row) => servers.raise(project, row.name), { concurrency: 'unbounded', discard: true });
  return plugin;
});

export const PLUGIN_PAIRS = {
  read_plugins: pair(
    OPS.read_plugins,
    body(OPS.read_plugins, {
      execute: Effect.fnUntraced(function* (input) {
        const project = yield* projectId;
        const question = questionOf(project);
        const read = input.cursor === undefined ? null : readCursor(input.cursor, question);
        if (read !== null && 'refused' in read) return yield* cursorRefusal(read.refused);
        const plugins = yield* Plugins;
        const ids = (yield* plugins.ids()).map((id) => ({ id }));
        const after = read === null ? ids : pastKey(ids, keyOf, ['asc'], read.at);
        const shown = page({ rows: after, asked: pageRows(input.limit, PLUGIN_ROWS, CEILING), keyOf, question, total: ids.length });
        const rows = yield* plugins.rows(
          project,
          shown.rows.map((row) => row.id),
        );
        return { status: 'ok' as const, plugins: rows, shown: shown.shown, total: ids.length, next: shown.next };
      }),
    }),
  ),
  install_plugin: pair(
    OPS.install_plugin,
    body(OPS.install_plugin, {
      prepare: Effect.fnUntraced(function* (input) {
        const plugins = yield* Plugins;
        const project = yield* projectId;
        if (input.prepared !== undefined && input.source === undefined)
          return yield* plugins.held({ projectId: project, token: input.prepared });
        if (input.source !== undefined && input.prepared === undefined)
          return yield* plugins.prepare({ projectId: project, source: input.source });
        return yield* new GateRefusal('field-invalid', 'install_plugin takes exactly one of source and prepared.', [
          'name the folder or git URL as source, or the prepared revision a preview answered as prepared',
        ]);
      }),
      execute: Effect.fnUntraced(function* (input, prepared) {
        const project = yield* projectId;
        const plugin = yield* (yield* Plugins).install({
          projectId: project,
          prepared,
          enabled: input.enabled ?? true,
          scope: input.scope ?? 'project',
        });
        return answer(yield* reached(project, plugin));
      }),
    }),
  ),
  enable_plugin: pair(
    OPS.enable_plugin,
    body(OPS.enable_plugin, {
      prepare: Effect.fnUntraced(function* (input) {
        if (input.enabled === false) return null;
        return yield* (yield* Plugins).installed({ projectId: yield* projectId, id: input.id });
      }),
      execute: Effect.fnUntraced(function* (input: { readonly id: string; readonly enabled?: boolean; readonly scope?: SettableScope }) {
        const project = yield* projectId;
        const plugin = yield* (yield* Plugins).enable({
          projectId: project,
          id: input.id,
          enabled: input.enabled ?? true,
          scope: input.scope ?? 'project',
        });
        return answer(yield* reached(project, plugin));
      }),
    }),
  ),
  create_plugin: pair(
    OPS.create_plugin,
    body(OPS.create_plugin, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const path = yield* createPlugin({
          projectId: yield* projectId,
          id: input.id,
          title: input.title,
          scope: input.scope ?? 'project',
          holder: caller.actor.kind === 'thread' ? { kind: 'thread', thread: caller.actor.threadId } : OPERATOR,
        });
        return { status: 'ok' as const, path };
      }),
    }),
  ),
  uninstall_plugin: pair(
    OPS.uninstall_plugin,
    body(OPS.uninstall_plugin, {
      execute: Effect.fnUntraced(function* (input: { readonly id: string }) {
        const project = yield* projectId;
        const plugins = yield* Plugins;
        const servers = yield* McpServers;
        const serving = (rows: readonly PluginRow[]) =>
          new Set(rows.flatMap((row) => row.components.flatMap((component) => (component.kind === 'mcp-server' ? [component.name] : []))));
        const brought = serving(yield* plugins.rows(project, [input.id]));
        const plugin = yield* plugins.uninstall({ projectId: project, id: input.id });
        const kept = serving(yield* plugins.rows(project, yield* plugins.ids()));
        yield* servers.forgetContributed((name) => (brought.has(name) || name.startsWith(`${input.id}-`)) && !kept.has(name));
        return answer(plugin);
      }),
    }),
  ),
};
