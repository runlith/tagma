import { Context, type Effect } from 'effect';
import type { OutcomeRefused, Outcomes, Settled } from './outcomes.js';

export class Senders extends Context.Service<
  Senders,
  {
    register(sender: string, receiver: Outcomes['Service']): () => void;
    accepts(sender: string): boolean;
    deliver(outcome: Settled): Effect.Effect<void, OutcomeRefused>;
  }
>()('notify/Senders') {}
