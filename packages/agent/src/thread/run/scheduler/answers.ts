import { ThreadCallBroke } from '../../ThreadBorder';
import { ThreadBudgetSpentError } from '../../ThreadPorts';
import type { ThreadSaid } from './inputs';

export type BudgetRefusal = { readonly refused: { readonly budgetSpent: number } };

export type KeyedAnswer = ThreadSaid;

export type KeyedRecord = KeyedAnswer | BudgetRefusal;

export function decodeRecord(result: unknown): KeyedRecord | null {
  if (typeof result !== 'object' || result === null) return null;
  const record = result as { status?: unknown; runId?: unknown; entry?: unknown; queued?: unknown; itemId?: unknown; refused?: unknown };
  if (record.refused !== undefined) {
    const refused = record.refused as { budgetSpent?: unknown } | null;
    return typeof refused === 'object' && refused !== null && typeof refused.budgetSpent === 'number' ? (result as BudgetRefusal) : null;
  }
  if (typeof record.runId !== 'string') return null;
  switch (record.status) {
    case 'started':
      return typeof record.entry === 'object' && record.entry !== null ? (result as ThreadSaid) : null;
    case 'queued':
      return typeof record.queued === 'object' && record.queued !== null ? (result as ThreadSaid) : null;
    case 'steered':
      return typeof record.itemId === 'string' ? (result as ThreadSaid) : null;
    default:
      return null;
  }
}

export function isRefusal(record: KeyedRecord): record is BudgetRefusal {
  return 'refused' in record;
}

export function refusalFailure(refusal: BudgetRefusal): ThreadCallBroke {
  return new ThreadCallBroke({ cause: new ThreadBudgetSpentError(refusal.refused.budgetSpent) });
}
