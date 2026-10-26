import type { Behaviour } from '../../contract/service/behaviours.js';
import { SPEC } from '../../contract/wire/tags/spec.js';

export const spec: Behaviour = {
  id: SPEC,
  slots: {},
  words: {},
  actions: [],
  requires: [],
  fromRoles: ({ spec }) => (spec === true ? { slots: {}, words: {} } : null),
};
