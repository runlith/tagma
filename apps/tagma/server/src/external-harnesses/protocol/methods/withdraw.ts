import { Exit, Schema } from 'effect';
import { withdrawFailed } from '../../../threads/contract/service/failure.js';
import { STEER } from '@runlith/hosted-runner/wire/extensions';
import { failureText } from '../projection.js';
import { handled, settledBy, type Answering, type Handled } from './declaration.js';

const Withdrawn = Schema.Struct({ withdrawn: Schema.Boolean });

const settled = settledBy(Withdrawn);

export const withdraw: Answering = {
  refusal: null,
  answered: (row, request, event) => {
    const read = settled(event);
    if (read._tag === 'Failed') {
      const reason = event._tag === 'ExtensionAnswered' ? 'its answer cannot be read' : failureText(read.cause);
      return { ...handled(row), withdrawals: [{ request: request.id, outcome: Exit.fail(withdrawFailed(reason)) }] };
    }
    const answered: Handled = { ...handled(row), withdrawals: [{ request: request.id, outcome: Exit.succeed(read.answer.withdrawn) }] };
    if (!read.answer.withdrawn) return answered;
    const steers = new Set(
      row.client.requests
        .filter(
          (standing) =>
            standing.meaning === 'extension' &&
            standing.method === STEER &&
            standing.envelopes.some((id) => request.envelopes.includes(id)),
        )
        .map((standing) => standing.id),
    );
    const settling = row.steering.filter((standing) => steers.has(standing.request));
    return {
      ...answered,
      row: { ...row, steering: row.steering.filter((standing) => !steers.has(standing.request)) },
      fates: settling.map((standing) => ({ _tag: 'Withdrawn' as const, turn: standing.turn, envelopes: request.envelopes })),
    };
  },
};
