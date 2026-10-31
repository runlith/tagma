import { GRAPH_STEPS } from '../../graph/steps/sequence.js';
import type { Steps } from '../../installation/cut/pipeline.js';
import type { Manifest } from '../../platform/contract/service/manifest.js';
import { journalSteps } from '../../threads/journal/formSteps.js';

export const stepsOf = (modules: readonly Manifest[]): Steps => ({
  graph: GRAPH_STEPS.map((step) => step.id),
  journal: journalSteps(modules.map((module) => module.formSteps ?? [])).map((step) => step.name),
});
