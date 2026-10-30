import { Schema } from 'effect';
import { Retrying } from '@runlith/hosted-runner/wire/extensions';
import { handled, type Noticing } from './declaration.js';

const isRetrying = Schema.is(Retrying);

export const retrying: Noticing = {
  noticed: (row, event) => {
    const turn = row.client.turn?.id ?? row.turns.at(-1)?.id;
    if (!isRetrying(event.params) || turn === undefined) return handled(row);
    const { uuid, attempt, of, delayMs, family, httpStatus, message } = event.params;
    return { ...handled(row), retries: [{ order: 0, turn, uuid, attempt, of, delayMs, family, status: httpStatus, message }] };
  },
};
