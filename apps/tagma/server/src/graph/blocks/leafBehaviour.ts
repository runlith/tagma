import type { Behaviour } from '../contract/service/behaviours.js';
import { LEAF } from '../contract/wire/tags/leaf.js';

export const leaf: Behaviour = {
  id: LEAF,
  slots: {},
  words: {},
  actions: [],
  requires: [],
  fromRoles: ({ leaf: childless }) => (childless === true ? { slots: {}, words: {} } : null),
};
