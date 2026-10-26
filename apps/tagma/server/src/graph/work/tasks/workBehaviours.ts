import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { Behaviour } from '../../contract/service/behaviours.js';
import { HOLDER, HOLDER_SLOT } from '../../contract/wire/tags/holder.js';
import { LIFECYCLE } from '../../contract/wire/tags/lifecycle.js';
import { WORK } from '../../contract/wire/tags/work.js';
import { SPEC } from '../../contract/wire/tags/spec.js';

export const work: Behaviour = {
  id: WORK,
  slots: {},
  words: {},
  actions: [{ op: 'ready_work' }],
  requires: [LIFECYCLE],
  edges: [
    { kind: 'waits-on', from: WORK, to: WORK, meaning: 'dependency', acyclic: true },
    { kind: 'implements', from: WORK, to: SPEC, meaning: 'implementation', standing: true },
  ],
  check: ({ from }, over) => {
    const words = over.binding(LIFECYCLE)?.words;
    const missing = words?.done === undefined ? 'done' : words.closed === undefined ? 'closed' : null;
    return missing === null
      ? null
      : new GateRefusal('tag-incoherent', `#${from} binds ${WORK}, and its ${LIFECYCLE} names no ${missing} word`, [
          `name both endings in ${LIFECYCLE}: done is where work that happened lands, closed where work decided against lands`,
          `drop ${WORK}, if a #${from} is not a thing that can be finished or dropped`,
        ]);
  },
  fromRoles: ({ work: worked }) => (worked === true ? { slots: {}, words: {} } : null),
};

export const holder: Behaviour = {
  id: HOLDER,
  slots: { [HOLDER_SLOT]: { kind: 'session', state: 'holder' } },
  words: {},
  actions: [
    {
      op: 'claim_block',
      moves: [{ contract: LIFECYCLE, to: 'claimed', label: 'Take', says: 'signs this session in as holder' }],
      writes: [HOLDER_SLOT],
    },
    {
      op: 'release_block',
      moves: [{ contract: LIFECYCLE, to: 'initial', from: 'active', needs: ['claimed'], label: 'Give back', says: 'clears the holder' }],
      writes: [HOLDER_SLOT],
    },
  ],
  requires: [],
  fromRoles: ({ holder: field }) => (field === undefined ? null : { slots: { [HOLDER_SLOT]: field }, words: {} }),
};
