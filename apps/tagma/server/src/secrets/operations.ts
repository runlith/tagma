import { page, type PageQuestion, pageRows, pastKey, readCursor } from '@runlith/paging';
import { Effect } from 'effect';
import { body, pair } from '../platform/contract/service/body.js';
import { ceilingOf } from '../platform/contract/wire/pageFamily.js';
import { cursorRefusal } from '../platform/contract/wire/refusal.js';
import { CurrentProject } from '../projects/contract/service/caller.js';
import { Secrets } from './contract/service/secrets.js';
import { SECRET_OPERATIONS as OPS, SECRET_ROWS } from './contract/wire/operations.js';
import type { SecretSet } from './contract/wire/rows.js';

const questionOf = (projectId: number, owner: string, id: string | undefined): PageQuestion => ({
  operation: 'read_secrets',
  selection: { projectId, owner, id: id ?? null },
  order: SECRET_ROWS.order,
});
const CEILING = ceilingOf(SECRET_ROWS);

const keyOf = (row: SecretSet) => [row.id] as const;

const projectId = Effect.map(Effect.flatten(CurrentProject), (call) => call.project.id);

export const SECRET_PAIRS = {
  read_secrets: pair(
    OPS.read_secrets,
    body(OPS.read_secrets, {
      execute: Effect.fnUntraced(function* (input) {
        const project = yield* projectId;
        const question = questionOf(project, input.owner, input.id);
        const read = input.cursor === undefined ? null : readCursor(input.cursor, question);
        if (read !== null && 'refused' in read) return yield* cursorRefusal(read.refused);
        const rows = [...(yield* (yield* Secrets).read(project, input.owner, input.id))].sort((left, right) =>
          left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
        );
        const after = read === null ? rows : pastKey(rows, keyOf, ['asc'], read.at);
        const shown = page({ rows: after, asked: pageRows(input.limit, SECRET_ROWS, CEILING), keyOf, question, total: rows.length });
        return { status: 'ok' as const, sets: shown.rows, shown: shown.shown, total: rows.length, next: shown.next };
      }),
    }),
  ),
  set_secret: pair(
    OPS.set_secret,
    body(OPS.set_secret, {
      execute: Effect.fnUntraced(function* (input) {
        const target = { owner: input.owner, id: input.id, name: input.name };
        const secret = yield* (yield* Secrets).set(yield* projectId, target, input.value);
        return { status: 'ok' as const, owner: input.owner, id: input.id, secret };
      }),
    }),
  ),
  remove_secret: pair(
    OPS.remove_secret,
    body(OPS.remove_secret, {
      execute: Effect.fnUntraced(function* (input) {
        const secret = yield* (yield* Secrets).remove(yield* projectId, { owner: input.owner, id: input.id, name: input.name });
        return { status: 'ok' as const, owner: input.owner, id: input.id, secret };
      }),
    }),
  ),
};
