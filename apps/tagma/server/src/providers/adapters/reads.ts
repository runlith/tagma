import { page, type PageKey, type PageQuestion, pageRows, pastKey, readCursor } from '@runlith/paging';
import { Effect } from 'effect';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { cursorRefusal } from '../../platform/contract/wire/refusal.js';
import { ProviderRegistry } from '../contract/service/registry.js';
import { INSTANCE_ROWS } from '../contract/wire/adapterRows.js';
import type { ServedInstance } from '../contract/wire/catalog.js';
import { unsettled } from './instanceActs.js';

type Walk = { readonly limit?: number | undefined; readonly cursor?: string | undefined };

const INSTANCES_CEILING = ceilingOf(INSTANCE_ROWS);

const instanceKey = (row: ServedInstance): PageKey => [row.id];

const ascending = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const resumed = (walk: Walk, question: PageQuestion) => {
  const read = walk.cursor === undefined ? null : readCursor(walk.cursor, question);
  return read !== null && 'refused' in read ? Effect.fail(cursorRefusal(read.refused)) : Effect.succeed(read?.at ?? null);
};

export const readSettings = Effect.fnUntraced(function* (adapter: string, walk: Walk) {
  const question: PageQuestion = { operation: 'read_adapter_settings', selection: { adapter }, order: INSTANCE_ROWS.order };
  const at = yield* resumed(walk, question);
  const { served } = yield* (yield* ProviderRegistry).catalog;
  const declared = served.settings.find((one) => one.adapter === adapter);
  if (declared === undefined) return yield* unsettled(adapter);
  const { instances, ...settings } = declared;
  const rows = [...instances].sort((left, right) => ascending(left.id, right.id));
  const shown = page({
    rows: at === null ? rows : pastKey(rows, instanceKey, ['asc'], at),
    asked: pageRows(walk.limit, INSTANCE_ROWS, INSTANCES_CEILING),
    keyOf: instanceKey,
    question,
    total: rows.length,
  });
  return { settings, instances: shown.rows, shown: shown.shown, total: rows.length, next: shown.next };
});
