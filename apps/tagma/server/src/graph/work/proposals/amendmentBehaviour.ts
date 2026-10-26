import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { Behaviour } from '../../contract/service/behaviours.js';
import { AMENDMENT } from '../../contract/wire/tags/amendment.js';
import { LIFECYCLE } from '../../contract/wire/tags/lifecycle.js';
import { endsAt } from '../lifecycleBehaviour.js';

const VERDICT = { slot: 'status', contract: LIFECYCLE } as const;
const VERDICTS = ['run', 'declined', 'answered'] as const;

export const amendment: Behaviour = {
  id: AMENDMENT,
  slots: { ops: { kind: { schema: 'amendmentOps' } } },
  words: { run: VERDICT, declined: VERDICT, answered: VERDICT },
  actions: [
    { op: 'accept_amendment', moves: [{ to: 'run', says: 'its deferred operations ran' }] },
    { op: 'reject_amendment', moves: [{ to: 'declined', says: 'declined with a reason; its operations never run' }] },
    { op: 'uphold_amendment', moves: [{ to: 'answered', says: 'finished work already answers it' }] },
    { op: 'revise_amendment' },
  ],
  requires: [LIFECYCLE],
  check: ({ from, binding }, over) => {
    const lifecycle = over.binding(LIFECYCLE);
    const field = lifecycle?.slots.status;
    if (lifecycle === null || field === undefined) return null;
    for (const verdict of VERDICTS) {
      const word = binding.words[verdict];
      if (word === undefined || endsAt(over.gates, field, word)) continue;
      return new GateRefusal(
        'tag-incoherent',
        `#${from}.contracts["${AMENDMENT}"].words.${verdict} names "${word}", which is not an ending of #${from}.fields.${field}`,
        ['name an ending — a verdict is where a finding stops'],
      );
    }
    const generic = lifecycle.words.done ?? lifecycle.words.closed;
    if (generic === undefined) return null;
    const ending = lifecycle.words.done === undefined ? 'closed' : 'done';
    return new GateRefusal(
      'tag-incoherent',
      `#${from} ends on a verdict and also names "${generic}" for the generic ${ending === 'closed' ? 'close' : 'finish'}`,
      [`drop ${ending} from ${LIFECYCLE}: an amendment ends on run, declined or answered and on nothing else`],
    );
  },
  fromRoles: ({ amendment: bound }) =>
    bound === undefined
      ? null
      : { slots: { ops: bound.field }, words: { run: bound.run, declined: bound.declined, answered: bound.answered } },
};
