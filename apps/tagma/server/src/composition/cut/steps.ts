import { GRAPH_STEPS } from '../../graph/steps/sequence.js';
import type { Steps } from '../../installation/cut/pipeline.js';
import type { ServerParts } from '../build.js';
import { entryKinds } from '../entryKinds.js';

export const stepsOf = ({ modules, rested }: ServerParts): Steps => ({
  graph: GRAPH_STEPS.map((step) => step.id),
  journal: entryKinds(modules, rested).steps.map((step) => step.name),
});
