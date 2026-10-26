import { Context, Data, type Effect } from 'effect';
import type { OUTCOME_KINDS } from '../wire/notification.js';

export type Settled = {
  readonly id: string;
  readonly sender: string;
  readonly title: string;
  readonly kind: (typeof OUTCOME_KINDS)[number];
  readonly answer: string | null;
  readonly at: number;
};

export class OutcomeRefused extends Data.TaggedError('OutcomeRefused')<{ readonly reason: string }> {}

export class Outcomes extends Context.Service<Outcomes, { deliver(outcome: Settled): Effect.Effect<void, OutcomeRefused> }>()(
  'tagma/notify/Outcomes',
) {}
