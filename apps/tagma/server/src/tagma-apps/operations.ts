import { page, type PageQuestion, pageRows, pastKey, readCursor } from '@runlith/paging';
import { Effect } from 'effect';
import { body, pair } from '../platform/contract/service/body.js';
import { ceilingOf } from '../platform/contract/wire/pageFamily.js';
import { cursorRefusal } from '../platform/contract/wire/refusal.js';
import { CurrentProject } from '../projects/contract/service/caller.js';
import { TagmaAppPoints } from './contract/service/points.js';
import { TagmaApps } from './contract/service/supervision.js';
import { TAGMA_APP_OPERATIONS as OPS, TAGMA_APP_ROWS } from './contract/wire/operations.js';
import type { TagmaAppRow } from './contract/wire/rows.js';

const questionOf = (projectId: number): PageQuestion => ({ operation: 'read_apps', selection: { projectId }, order: TAGMA_APP_ROWS.order });
const CEILING = ceilingOf(TAGMA_APP_ROWS);

const keyOf = (row: TagmaAppRow) => [row.id] as const;

const answer = (app: TagmaAppRow) => ({ status: 'ok' as const, app });

const projectId = Effect.map(Effect.flatten(CurrentProject), (call) => call.project.id);

export const TAGMA_APP_PAIRS = {
  read_apps: pair(
    OPS.read_apps,
    body(OPS.read_apps, {
      execute: Effect.fnUntraced(function* (input) {
        const project = yield* projectId;
        const question = questionOf(project);
        const read = input.cursor === undefined ? null : readCursor(input.cursor, question);
        if (read !== null && 'refused' in read) return yield* cursorRefusal(read.refused);
        const rows = yield* (yield* TagmaApps).list(project);
        const after = read === null ? rows : pastKey(rows, keyOf, ['asc'], read.at);
        const shown = page({
          rows: after,
          asked: pageRows(input.limit, TAGMA_APP_ROWS, CEILING),
          keyOf,
          question,
          total: rows.length,
        });
        return { status: 'ok' as const, apps: shown.rows, shown: shown.shown, total: rows.length, next: shown.next };
      }),
    }),
  ),
  read_app_schema: pair(
    OPS.read_app_schema,
    body(OPS.read_app_schema, {
      execute: () => Effect.map(TagmaAppPoints, (points) => ({ status: 'ok' as const, schema: points.schema() })),
    }),
  ),
  install_app: pair(
    OPS.install_app,
    body(OPS.install_app, {
      prepare: () => Effect.map(Effect.flatten(CurrentProject), (call) => call.project),
      execute: Effect.fnUntraced(function* (input) {
        return answer(yield* (yield* TagmaApps).install({ projectId: yield* projectId, id: input.id, enabled: input.enabled ?? true }));
      }),
    }),
  ),
  uninstall_app: pair(
    OPS.uninstall_app,
    body(OPS.uninstall_app, {
      execute: Effect.fnUntraced(function* (input) {
        return answer(yield* (yield* TagmaApps).uninstall({ projectId: yield* projectId, id: input.id }));
      }),
    }),
  ),
  enable_app: pair(
    OPS.enable_app,
    body(OPS.enable_app, {
      prepare: () => Effect.map(Effect.flatten(CurrentProject), (call) => call.project),
      execute: Effect.fnUntraced(function* (input) {
        return answer(yield* (yield* TagmaApps).enable({ projectId: yield* projectId, id: input.id, enabled: input.enabled ?? true }));
      }),
    }),
  ),
};
