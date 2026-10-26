import { FAULT } from '@runlith/acp/agent';
import { Schema } from 'effect';
import { WITHDRAW } from '../../contract/wire/extensions.js';
import type { ProtocolRow } from '../row.js';
import { handled, settledBy, type Answering, type Handled, type WordsFate } from './declaration.js';

const WITHDRAWN = -32800;
const UNREAD: ReadonlySet<number> = new Set([FAULT.notFound, FAULT.methodNotFound]);

const Steered = Schema.Struct({ outcome: Schema.Literals(['injected', 'startedNewTurn', 'promptRequired']) });

const settled = settledBy(Steered);

const withdrawing = (row: ProtocolRow, envelopes: readonly string[]): boolean =>
  row.client.requests.some(
    (standing) =>
      standing.meaning === 'extension' && standing.method === WITHDRAW && standing.envelopes.some((id) => envelopes.includes(id)),
  );

export const steer: Answering = {
  refusal: null,
  answered: (row, request, event) => {
    const steering = row.steering.find((standing) => standing.request === request.id);
    if (steering === undefined) return handled(row);
    const next = { ...row, steering: row.steering.filter((standing) => standing !== steering) };
    const decided = (tag: WordsFate['_tag'], landed: Handled = handled(next, [event])): Handled => ({
      ...landed,
      fates: [{ _tag: tag, turn: steering.turn, envelopes: request.envelopes, noted: steering.noted }],
    });
    const afterTurn = (): Handled =>
      row.client.requests.some((standing) => standing.meaning === 'prompt' && standing.turn === steering.turn)
        ? handled(next, [event])
        : decided('Returned');
    const read = settled(event);
    if (read._tag === 'Answered')
      return read.answer.outcome === 'promptRequired' ? afterTurn() : decided('Confirmed', handled(next, [event]));
    if (read.cause._tag === 'Unwritten') return decided('Returned');
    if (read.cause._tag === 'Agent' && read.cause.error.code === WITHDRAWN)
      return decided(withdrawing(row, request.envelopes) ? 'Withdrawn' : 'Returned');
    if (read.cause._tag === 'Agent' && UNREAD.has(read.cause.error.code)) return afterTurn();
    return decided('Unconfirmed');
  },
  doubted: (row, request) => {
    const steering = row.steering.find((standing) => standing.request === request.id);
    return steering === undefined
      ? handled(row)
      : { ...handled(row), fates: [{ _tag: 'Unconfirmed', turn: steering.turn, envelopes: request.envelopes }] };
  },
};
