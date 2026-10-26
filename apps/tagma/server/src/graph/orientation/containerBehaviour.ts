import type { Behaviour } from '../contract/service/behaviours.js';
import { CONTAINER } from '../contract/wire/tags/container.js';

export const container: Behaviour = {
  id: CONTAINER,
  slots: {},
  words: {},
  actions: [],
  requires: [],
  fromRoles: ({ container: grouping }) => (grouping === true ? { slots: {}, words: {} } : null),
};
