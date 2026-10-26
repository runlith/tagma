import type { Behaviour } from './contract/service/behaviours.js';
import { lifecycle } from './work/lifecycleBehaviour.js';
import { holder, work } from './work/tasks/workBehaviours.js';
import { spec } from './work/tasks/specBehaviour.js';
import { container } from './orientation/containerBehaviour.js';
import { explanation } from './orientation/explanationBehaviour.js';
import { observation, reflection } from './work/reflectionBehaviours.js';
import { amendment } from './work/proposals/amendmentBehaviour.js';
import { leaf } from './blocks/leafBehaviour.js';
import { selection } from './reading/selectionBehaviour.js';

export const graphBehaviours: readonly Behaviour[] = [
  lifecycle,
  work,
  holder,
  spec,
  container,
  explanation,
  observation,
  reflection,
  amendment,
  leaf,
  selection,
];
