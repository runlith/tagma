import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Behaviour } from '../contract/service/behaviours.js';
import type { Gate } from '../contract/wire/tags/declaration.js';
import { LIFECYCLE } from '../contract/wire/tags/lifecycle.js';

const MEANINGS = [
  { meaning: 'initial', ends: false },
  { meaning: 'claimed', ends: false },
  { meaning: 'done', ends: true },
  { meaning: 'closed', ends: true },
] as const;

export const endsAt = (gates: readonly Gate[], field: string, word: string): boolean =>
  !gates.some((gate) => gate.gate === 'transition' && gate.field === field && gate.from === word);

const leavesOnlyTo = (gates: readonly Gate[], field: string, word: string, initial: string): boolean =>
  gates.every((gate) => gate.gate !== 'transition' || gate.field !== field || gate.from !== word || gate.to === initial);

export const lifecycle: Behaviour = {
  id: LIFECYCLE,
  slots: { status: { kind: 'enum', state: 'lifecycle' } },
  words: {
    initial: { slot: 'status' },
    claimed: { slot: 'status', optional: true },
    done: { slot: 'status', optional: true },
    closed: { slot: 'status', optional: true },
  },
  actions: [
    { op: 'finish_block', moves: [{ to: 'done', label: 'Finish', says: 'the work happened' }] },
    { op: 'close_block', moves: [{ to: 'closed', label: 'Close', says: 'dropped, answered elsewhere, or accepted' }] },
  ],
  requires: [],
  check: ({ from, binding }, over) => {
    const field = binding.slots.status;
    if (field === undefined) return null;
    for (const { meaning, ends } of MEANINGS) {
      const word = binding.words[meaning];
      if (word === undefined) continue;
      if (ends ? leavesOnlyTo(over.gates, field, word, binding.words.initial ?? '') : !endsAt(over.gates, field, word)) continue;
      return new GateRefusal(
        'tag-incoherent',
        ends
          ? `#${from}.contracts["${LIFECYCLE}"].words.${meaning} names "${word}", which #${from} moves out of to something other than its initial word`
          : `#${from}.contracts["${LIFECYCLE}"].words.${meaning} names "${word}", which #${from} declares no move out of`,
        [
          ends
            ? `drop the transitions out of "${word}" except the one back to the initial word: an ending is a word work stops at, or is reopened from`
            : `add a transition out of "${word}": a node standing there could never move again`,
        ],
      );
    }
    const { done, closed } = binding.words;
    if (done !== undefined && done === closed) {
      return new GateRefusal('tag-incoherent', `#${from} spells done and closed with one word, "${done}"`, [
        'name two: the distinction between work that happened and work that was dropped is the whole of what an ending says',
      ]);
    }
    return null;
  },
  fromRoles: ({ status }) =>
    status === undefined
      ? null
      : {
          slots: { status: status.field },
          words: {
            initial: status.initial,
            ...(status.claimed === undefined ? {} : { claimed: status.claimed }),
            ...(status.done === undefined ? {} : { done: status.done }),
            ...(status.closed === undefined ? {} : { closed: status.closed }),
          },
        },
};
