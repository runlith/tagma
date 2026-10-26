import { Effect } from 'effect';
import { page, pageRows, pastKey, readCursor, type PageQuestion } from '@runlith/paging';
import { TOOL_OUTPUT_MAX_BYTES } from '@runlith/agent/ToolOutputSpool';
import { body, pair, type InputOf } from '../platform/contract/service/body.js';
import { ceilingOf } from '../platform/contract/wire/pageFamily.js';
import { cursorRefusal } from '../platform/contract/wire/refusal.js';
import { OperationCatalog } from './contract/service/catalog.js';
import { INVOCATION_OPERATIONS, REGISTRY_ENTRIES, type OperationsAnswer, type RegistryEntry } from './contract/wire/operations.js';
import { registryEntries } from './registryEntries.js';

const keyOf = (row: RegistryEntry) => [row.id];

const ROW_BUDGET_BYTES = TOOL_OUTPUT_MAX_BYTES - (REGISTRY_ENTRIES.reserveBytes ?? 0);

const fitting = (rows: readonly RegistryEntry[], bytes: ReadonlyMap<string, number>): number => {
  let spent = 0;
  let fitted = 0;
  for (const row of rows) {
    spent += bytes.get(row.id) ?? 0;
    if (fitted > 0 && spent > ROW_BUDGET_BYTES) break;
    fitted += 1;
  }
  return fitted;
};

export const READ_OPERATIONS_PAIR = pair(
  INVOCATION_OPERATIONS.read_operations,
  body(INVOCATION_OPERATIONS.read_operations, {
    execute: Effect.fnUntraced(function* (input: InputOf<typeof INVOCATION_OPERATIONS.read_operations>, _prepared: undefined) {
      const { registry } = yield* OperationCatalog;
      const { rows, bytes, contract } = registryEntries(registry);
      const reached = new Set<string>();
      const unknown: string[] = [];
      for (const name of input.ids ?? []) {
        const id = registry.named(name);
        if (id === null) unknown.push(name);
        else reached.add(id);
      }
      const question: PageQuestion = {
        operation: 'read_operations',
        selection: { contract, ids: input.ids === undefined ? null : [...reached].sort() },
        order: REGISTRY_ENTRIES.order,
      };
      const at = input.cursor === undefined ? null : readCursor(input.cursor, question);
      if (at !== null && 'refused' in at) return yield* cursorRefusal(at.refused);
      const selected = input.ids === undefined ? rows : rows.filter((row) => reached.has(row.id));
      const rest = at === null ? selected : pastKey(selected, keyOf, ['asc'], at.at);
      const ceiling = ceilingOf(REGISTRY_ENTRIES);
      const size = fitting(rest.slice(0, pageRows(input.limit, REGISTRY_ENTRIES, ceiling)), bytes);
      const cut = page({ rows: rest.slice(0, size + 1), asked: size, keyOf, question, total: selected.length });
      const answer: OperationsAnswer = {
        status: 'ok',
        contract,
        operations: { rows: cut.rows, shown: cut.shown, total: selected.length, next: cut.next, complete: cut.complete },
        unknown,
      };
      return answer;
    }),
  }),
);
