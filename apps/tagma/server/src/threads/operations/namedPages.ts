import { actDigest } from '@runlith/agent/thread/keyed';
import { type Cursor, page, type PageFamily, type PageQuestion, pageRows, readCursor } from '@runlith/paging';
import { Effect } from 'effect';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { cursorRefusal } from '../../platform/contract/wire/refusal.js';

export type NamedPage = { readonly ids: readonly string[]; readonly total: number; readonly next: Cursor | null };

export const namedPage = Effect.fnUntraced(function* (input: {
  readonly operation: string;
  readonly family: PageFamily;
  readonly project: number;
  readonly threads: readonly string[];
  readonly cursor?: string;
  readonly limit?: number;
}) {
  const question: PageQuestion = {
    operation: input.operation,
    selection: { project: input.project, threads: actDigest(input.threads) },
    order: input.family.order,
  };
  const read = input.cursor === undefined ? null : readCursor(input.cursor, question);
  if (read !== null && 'refused' in read) return yield* cursorRefusal(read.refused);
  const after = read === null ? -1 : read.at[0];
  if (typeof after !== 'number' || !Number.isSafeInteger(after) || after < -1 || after >= input.threads.length) {
    return yield* cursorRefusal('bad-cursor');
  }
  const asked = pageRows(input.limit, input.family, ceilingOf(input.family));
  const window = input.threads.slice(after + 1, after + 2 + asked).map((threadId, offset) => ({ threadId, index: after + 1 + offset }));
  const cut = page({ rows: window, asked, keyOf: (row) => [row.index], question, total: input.threads.length });
  return { ids: cut.rows.map((row) => row.threadId), total: input.threads.length, next: cut.next } satisfies NamedPage;
});
