import type { Behaviour } from '../contract/service/behaviours.js';
import { EXPLANATION } from '../contract/wire/tags/explanation.js';

export const explanation: Behaviour = {
  id: EXPLANATION,
  slots: {},
  words: {},
  actions: [],
  requires: [],
};
