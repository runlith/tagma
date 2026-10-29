import { page, type PageQuestion, pageRows, pastKey, readCursor } from '@runlith/paging';
import { Effect } from 'effect';
import { body, pair } from '../platform/contract/service/body.js';
import { ceilingOf } from '../platform/contract/wire/pageFamily.js';
import { cursorRefusal } from '../platform/contract/wire/refusal.js';
import { CurrentProject } from '../projects/contract/service/caller.js';
import { Plugins } from './contract/service/plugins.js';
import { PLUGIN_OPERATIONS as OPS, PLUGIN_ROWS } from './contract/wire/operations.js';
import type { PluginRow } from './contract/wire/rows.js';

const questionOf = (projectId: number): PageQuestion => ({ operation: 'read_plugins', selection: { projectId }, order: PLUGIN_ROWS.order });
const CEILING = ceilingOf(PLUGIN_ROWS);

const keyOf = (row: PluginRow) => [row.id] as const;

const answer = (plugin: PluginRow) => ({ status: 'ok' as const, plugin });

const projectId = Effect.map(Effect.flatten(CurrentProject), (call) => call.project.id);

export const PLUGIN_PAIRS = {
  read_plugins: pair(
    OPS.read_plugins,
    body(OPS.read_plugins, {
      execute: Effect.fnUntraced(function* (input) {
        const project = yield* projectId;
        const question = questionOf(project);
        const read = input.cursor === undefined ? null : readCursor(input.cursor, question);
        if (read !== null && 'refused' in read) return yield* cursorRefusal(read.refused);
        const rows = yield* (yield* Plugins).list(project);
        const after = read === null ? rows : pastKey(rows, keyOf, ['asc'], read.at);
        const shown = page({ rows: after, asked: pageRows(input.limit, PLUGIN_ROWS, CEILING), keyOf, question, total: rows.length });
        return { status: 'ok' as const, plugins: shown.rows, shown: shown.shown, total: rows.length, next: shown.next };
      }),
    }),
  ),
  install_plugin: pair(
    OPS.install_plugin,
    body(OPS.install_plugin, {
      prepare: Effect.fnUntraced(function* (input) {
        return yield* (yield* Plugins).prepare({ projectId: yield* projectId, source: input.source });
      }),
      execute: Effect.fnUntraced(function* (input, prepared) {
        return answer(yield* (yield* Plugins).install({ projectId: yield* projectId, prepared, enabled: input.enabled ?? true }));
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
      execute: Effect.fnUntraced(function* (input: { readonly id: string; readonly enabled?: boolean }) {
        return answer(yield* (yield* Plugins).enable({ projectId: yield* projectId, id: input.id, enabled: input.enabled ?? true }));
      }),
    }),
  ),
  uninstall_plugin: pair(
    OPS.uninstall_plugin,
    body(OPS.uninstall_plugin, {
      execute: Effect.fnUntraced(function* (input: { readonly id: string }) {
        return answer(yield* (yield* Plugins).uninstall({ projectId: yield* projectId, id: input.id }));
      }),
    }),
  ),
};
