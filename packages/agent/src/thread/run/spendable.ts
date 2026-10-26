import { Effect } from 'effect';
import type { ThreadMetadataRow } from '../rows';
import { ThreadCallBroke, type ThreadBorderFailed } from '../ThreadBorder';
import { budgetQueryOf, ThreadBudgetSpentError, type ThreadBudget } from '../ThreadPorts';

export const spendable = Effect.fnUntraced(function* (
  budgets: ThreadBudget['Service'],
  thread: ThreadMetadataRow,
): Effect.fn.Return<void, ThreadBorderFailed> {
  const budget = yield* budgets.of(budgetQueryOf(thread));
  if (budget.remaining !== null && budget.remaining <= 0) {
    return yield* new ThreadCallBroke({ cause: new ThreadBudgetSpentError(budget.allowed ?? 0) });
  }
});
