import { GRAPH_STEPS } from '../../graph/steps/sequence.js';
import type { Steps } from '../../installation/cut/pipeline.js';
import { ENTRY_KINDS } from '../manifest.js';

export const STEPS: Steps = {
  graph: GRAPH_STEPS.map((step) => step.id),
  journal: ENTRY_KINDS.steps.map((step) => step.name),
};
