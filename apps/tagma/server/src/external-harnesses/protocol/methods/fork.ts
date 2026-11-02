import { NewSessionResult } from '@runlith/acp/methods';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { handled, settledBy, type Answering } from './declaration.js';

const settled = settledBy(NewSessionResult);

export const fork: Answering = {
  refusal: new GateRefusal('session-fork-failed', 'The agent refused to fork its conversation.', ['read the agent diagnostics']),
  answered: (row, request, event) => {
    const read = settled(event);
    if (read._tag === 'Failed') return handled(row, [{ _tag: 'RequestFailed', request, cause: read.cause }]);
    return handled(row, [{ _tag: 'SessionReady', via: 'new', sessionId: read.answer.sessionId, setup: read.answer }]);
  },
};

export const rewind: Answering = {
  refusal: null,
  answered: (row, request, event) => {
    const standing = row.cut;
    if (standing === null || standing.request !== request.id) return handled(row);
    const read = settled(event);
    if (read._tag === 'Failed')
      return handled({ ...row, cut: read.cause._tag === 'Exited' ? null : { at: standing.at, request: null } }, [
        { _tag: 'RequestFailed', request, cause: read.cause },
      ]);
    return {
      ...handled({ ...row, cut: null }, [{ _tag: 'SessionReady', via: 'new', sessionId: read.answer.sessionId, setup: read.answer }]),
      trim: standing.at,
    };
  },
  doubted: (row, request) => (row.cut?.request === request.id ? handled({ ...row, cut: { at: row.cut.at, request: null } }) : handled(row)),
};
