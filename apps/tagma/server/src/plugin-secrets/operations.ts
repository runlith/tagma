import { page, type PageQuestion, pageRows, pastKey, readCursor } from '@runlith/paging';
import { Effect } from 'effect';
import { body, pair } from '../platform/contract/service/body.js';
import { ceilingOf } from '../platform/contract/wire/pageFamily.js';
import { cursorRefusal } from '../platform/contract/wire/refusal.js';
import { CurrentProject } from '../projects/contract/service/caller.js';
import { PluginSecrets } from './contract/service/secrets.js';
import { SECRET_OPERATIONS as OPS, SECRET_ROWS } from './contract/wire/operations.js';
import type { PluginSecretSet } from './contract/wire/rows.js';

const questionOf = (projectId: number): PageQuestion => ({
  operation: 'read_plugin_secrets',
  selection: { projectId },
  order: SECRET_ROWS.order,
});
const CEILING = ceilingOf(SECRET_ROWS);

const keyOf = (row: PluginSecretSet) => [row.plugin] as const;

const projectId = Effect.map(Effect.flatten(CurrentProject), (call) => call.project.id);

export const SECRET_PAIRS = {
  read_plugin_secrets: pair(
    OPS.read_plugin_secrets,
    body(OPS.read_plugin_secrets, {
      execute: Effect.fnUntraced(function* (input) {
        const project = yield* projectId;
        const question = questionOf(project);
        const read = input.cursor === undefined ? null : readCursor(input.cursor, question);
        if (read !== null && 'refused' in read) return yield* cursorRefusal(read.refused);
        const rows = yield* (yield* PluginSecrets).read(project);
        const after = read === null ? rows : pastKey(rows, keyOf, ['asc'], read.at);
        const shown = page({
          rows: after,
          asked: pageRows(input.limit, SECRET_ROWS, CEILING),
          keyOf,
          question,
          total: rows.length,
        });
        return { status: 'ok' as const, plugins: shown.rows, shown: shown.shown, total: rows.length, next: shown.next };
      }),
    }),
  ),
  set_plugin_secret: pair(
    OPS.set_plugin_secret,
    body(OPS.set_plugin_secret, {
      execute: Effect.fnUntraced(function* (input) {
        const secret = yield* (yield* PluginSecrets).set(
          { projectId: yield* projectId, plugin: input.plugin, name: input.name },
          input.value,
        );
        return { status: 'ok' as const, plugin: input.plugin, secret };
      }),
    }),
  ),
  remove_plugin_secret: pair(
    OPS.remove_plugin_secret,
    body(OPS.remove_plugin_secret, {
      execute: Effect.fnUntraced(function* (input) {
        const secret = yield* (yield* PluginSecrets).remove({ projectId: yield* projectId, plugin: input.plugin, name: input.name });
        return { status: 'ok' as const, plugin: input.plugin, secret };
      }),
    }),
  ),
};
