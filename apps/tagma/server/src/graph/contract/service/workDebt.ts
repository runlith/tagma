import { Context, type Effect } from 'effect';
import type { RemainingDebt } from '../wire/answers.js';

export type DebtReport = {
  readonly debt?: readonly RemainingDebt[];
  readonly debtUnreadable?: readonly string[];
};

export type DebtAt = {
  readonly projectId: number;
  readonly root: string;
  readonly owner: string;
  readonly commit: string;
};

export class WorkDebt extends Context.Service<
  WorkDebt,
  {
    remaining(input: DebtAt): Effect.Effect<DebtReport>;
  }
>()('tagma/graph/WorkDebt') {}
