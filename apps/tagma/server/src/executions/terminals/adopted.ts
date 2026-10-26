import { Effect } from 'effect';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import type { TerminalAdopters } from '../contract/service/adopters.js';
import type { TerminalRow } from '../contract/wire/terminals.js';

export const withAdopters = Effect.fnUntraced(function* (
  adopters: TerminalAdopters['Service'],
  projectId: number,
  rows: readonly TerminalRow[],
) {
  const adopted = yield* adopters.of(
    projectId,
    rows.map((row) => row.record.execution.execution),
  );
  return rows.map((row): TerminalRow => {
    const thread = adopted.get(row.record.execution.execution);
    return thread === undefined ? row : { ...row, record: { ...row.record, adoptedBy: ThreadId.make(thread) } };
  });
});
