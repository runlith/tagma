import { Effect, Layer } from 'effect';
import { type GraphBase, type GraphStep, GraphSteps, type StepStanding } from '../contract/service/steps.js';
import { claimsLeave } from './claimsLeave.js';
import { decisionBecomesSpec } from './decisionBecomesSpec.js';
import { measurementsLeave } from './measurementsLeave.js';
import { moduleCards } from './moduleCards.js';
import { reachLeaves } from './reachLeaves.js';
import { provenanceLeaves } from './provenanceLeaves.js';
import { creationEdges } from './creationEdges.js';
import { operationNames, ruleOperationNames } from './operationNames.js';
import { platformsDeclared } from './platformsDeclared.js';
import { coreNames } from './coreNames.js';
import { ruleDelivery } from './ruleDelivery.js';
import { softwareDevelopmentNames } from './softwareDevelopmentNames.js';
import { releaseFindingsLeave } from './releaseFindingsLeave.js';
import { catalogAgentLeaves } from './catalogAgentLeaves.js';
import { ruleInspections } from './ruleInspections.js';
import { farEdges } from './farEdges.js';
import { knowledgeNames } from './knowledgeNames.js';
import { briefsLeave } from './briefsLeave.js';
import { storageStealth } from './storageStealth.js';
import { storageById } from './storageById.js';
import { holdersProven } from './holdersProven.js';

export const GRAPH_STEPS: readonly GraphStep[] = [
  { id: 'decision-becomes-spec', run: decisionBecomesSpec },
  { id: 'claims-leave', run: claimsLeave },
  { id: 'module-cards', run: moduleCards },
  { id: 'reach-leaves', run: reachLeaves },
  { id: 'measurements-leave', run: measurementsLeave },
  { id: 'provenance-leaves', run: provenanceLeaves },
  { id: 'creation-edges', run: creationEdges },
  { id: 'operation-names', run: operationNames },
  { id: 'platforms-declared', run: platformsDeclared },
  { id: 'core-names', run: coreNames },
  { id: 'rule-delivery', run: ruleDelivery },
  { id: 'software-development-names', run: softwareDevelopmentNames },
  { id: 'release-findings-leave', run: releaseFindingsLeave },
  { id: '20261017170000_catalog_agent_leaves', run: catalogAgentLeaves },
  { id: '20261020030000_rule_operation_names', run: ruleOperationNames },
  { id: '20261020060000_rule_inspections', run: ruleInspections },
  { id: '20261020150000_far_edges', run: farEdges },
  { id: '20261020160000_knowledge_names', run: knowledgeNames },
  { id: '20261020210000_briefs_leave', run: briefsLeave },
  { id: '20261023130000_holders_proven', run: holdersProven },
];

export const GRAPH_BASE: GraphBase | null = null;

const DATED = /^\d{14}_[a-z0-9]+(?:_[a-z0-9]+)*$/u;

export const graphSteps = (
  steps: readonly GraphStep[],
  base: GraphBase | null,
  prepareStorage: GraphSteps['Service']['prepareStorage'] = Effect.void,
): GraphSteps['Service'] => {
  const ids = steps.map((step) => step.id);
  const last = ids.at(-1) ?? base?.step;
  if (last === undefined) throw new Error('A graph form needs a step or a base.');
  ids.forEach((id, at) => {
    const before = ids[at - 1];
    if (ids.indexOf(id) !== at) throw new Error(`Graph step ${id} is declared twice.`);
    if (before !== undefined && DATED.test(before) && !(DATED.test(id) && before < id)) {
      throw new Error(`Graph step ${id} follows ${before}: a step after a dated one is dated <yyyymmddhhmmss>_<words>, later than it.`);
    }
  });
  const folded = (step: string): boolean => base !== null && (!DATED.test(step) || (DATED.test(base.step) && step <= base.step));
  const start = (reached: string | null): boolean => reached === (base === null ? null : base.step);
  const standing = (reached: string | null): StepStanding => {
    if (start(reached)) return ids.length === 0 ? 'current' : 'behind';
    if (reached === null) return 'older';
    const at = ids.indexOf(reached);
    if (at !== -1) return at === ids.length - 1 ? 'current' : 'behind';
    return folded(reached) ? 'older' : 'newer';
  };
  const rank = (step: string | null): number => (start(step) ? -1 : ids.indexOf(step!));
  return GraphSteps.of({
    prepareStorage,
    last,
    base,
    standing,
    after: (reached) => (standing(reached) === 'behind' ? steps.slice(rank(reached) + 1) : []),
    lower: (one, other) => {
      const [first, second] = [standing(one), standing(other)];
      if (first === 'newer' || second === 'newer' || first === 'older' || second === 'older') return undefined;
      return rank(one) <= rank(other) ? one : other;
    },
  });
};

export const shippedSteps = graphSteps(GRAPH_STEPS, GRAPH_BASE, Effect.andThen(storageStealth(), storageById()));

export const graphStepsLayer = Layer.succeed(GraphSteps, shippedSteps);
