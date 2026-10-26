import { Schema } from 'effect';
import { workflowDefinitionSchema, type WorkflowBinding, type WorkflowDefinition, type WorkflowStep } from './definition';
import { WorkflowCompileError, type WorkflowPlan } from './plan';

const decodeDefinition = Schema.decodeUnknownResult(workflowDefinitionSchema);

export type WorkflowVocabulary = {
  readonly seams: ReadonlySet<string>;
  readonly conditions: ReadonlySet<string>;
  readonly workflows: ReadonlySet<string>;
};

export function parseWorkflowDefinition(value: unknown): WorkflowDefinition {
  const parsed = decodeDefinition(value);
  if (parsed._tag !== 'Success') {
    throw new WorkflowCompileError('<unnamed>', [parsed.failure.message]);
  }
  return parsed.success;
}

export function compileWorkflow(definition: WorkflowDefinition, revision: string, vocabulary: WorkflowVocabulary): WorkflowPlan {
  const problems: string[] = [];
  const steps = new Map<string, WorkflowStep>();
  for (const step of definition.steps) {
    if (steps.has(step.id)) problems.push(`two steps are called ${step.id}`);
    steps.set(step.id, step);
  }
  for (const transition of definition.transitions) {
    if (!steps.has(transition.from)) problems.push(`a transition leaves ${transition.from}, which is not a step`);
    if (!steps.has(transition.to)) problems.push(`a transition enters ${transition.to}, which is not a step`);
    if (transition.when !== undefined && !vocabulary.conditions.has(transition.when)) {
      problems.push(`${transition.from} chooses on ${transition.when}, which this host does not hold`);
    }
  }

  const entered = new Set(definition.transitions.map((transition) => transition.to));
  const entries = definition.steps.filter((step) => !entered.has(step.id));
  if (entries.length === 0) problems.push('every step is entered by another, so nothing starts');
  if (entries.length > 1) {
    problems.push(`${entries.map((step) => step.id).join(', ')} all start, and a run begins in one place`);
  }
  const entry = entries[0];
  const reachable = reachableFrom(entry?.id, definition);
  for (const step of definition.steps) {
    if (!reachable.has(step.id)) problems.push(`${step.id} is never reached`);
  }
  for (const transition of definition.transitions) {
    if (transition.when === undefined && reachesUndecided(transition.to, transition.from, definition)) {
      problems.push(`${transition.from} enters ${transition.to} and comes back with nothing deciding: a loop nothing leaves never ends`);
    }
  }
  for (const step of definition.steps) {
    problems.push(...stepProblems(step, steps, definition, entry?.id, vocabulary));
  }

  if (problems.length > 0) throw new WorkflowCompileError(definition.name, problems);
  if (!entry) throw new WorkflowCompileError(definition.name, ['nothing starts']);
  return {
    name: definition.name,
    description: definition.description,
    input: definition.input ?? {},
    revision,
    steps: definition.steps,
    transitions: definition.transitions,
    entry: entry.id,
  };
}

function stepProblems(
  step: WorkflowStep,
  steps: ReadonlyMap<string, WorkflowStep>,
  definition: WorkflowDefinition,
  entry: string | undefined,
  vocabulary: WorkflowVocabulary,
): readonly string[] {
  const problems: string[] = [];
  const signature = definition.input ?? {};

  if (step.kind === 'transform') {
    for (const source of step.from ?? []) {
      if (!steps.has(source)) problems.push(`${step.id} folds ${source}, which is not a step`);
    }
    if (!vocabulary.seams.has(step.seam)) {
      problems.push(`${step.id} folds through ${step.seam}, which this host does not hold`);
    }
    return problems;
  }

  if (step.kind === 'call' && !vocabulary.workflows.has(step.workflow)) {
    problems.push(`${step.id} calls ${step.workflow}, which no floor holds`);
  }

  if (step.kind === 'pack') {
    const count = step.count;
    const widest = typeof count === 'number' ? count : count.limit;
    if (typeof count !== 'number') {
      problems.push(...bindingProblems(`${step.id} fans over`, count, step, steps, definition, entry, signature));
    }
    if (step.completion.rule === 'at-least' && step.completion.atLeast > widest) {
      const of = typeof count === 'number' ? `${widest}` : `at most ${widest}`;
      problems.push(`${step.id} waits for ${step.completion.atLeast} of ${of} members, which never happens`);
    }
  }

  if (step.kind === 'pack' || step.kind === 'agent' || step.kind === 'call') {
    for (const [name, binding] of Object.entries(step.input ?? {})) {
      problems.push(...bindingProblems(`${step.id} takes ${name} from`, binding, step, steps, definition, entry, signature));
    }
  }
  return problems;
}

function bindingProblems(
  what: string,
  binding: WorkflowBinding | { from: 'run'; field: string } | { from: 'step'; stepId: string; field: string },
  reader: WorkflowStep,
  steps: ReadonlyMap<string, WorkflowStep>,
  definition: WorkflowDefinition,
  entry: string | undefined,
  signature: Readonly<Record<string, string>>,
): readonly string[] {
  if (binding.from === 'run') {
    return binding.field in signature ? [] : [`${what} ${binding.field}, which the signature does not declare`];
  }
  if (binding.from === 'member' || binding.from === 'index') {
    if (reader.kind !== 'pack') return [`${what} a pack member, and ${reader.id} is not a pack`];
    if (typeof reader.count === 'number' && binding.from === 'member') {
      return [`${what} a pack member, and ${reader.id} fans over no list`];
    }
    return [];
  }
  const source = steps.get(binding.stepId);
  if (!source) return [`${what} ${binding.stepId}, which is not a step`];
  if (source.kind !== 'transform') {
    return [`${what} ${binding.stepId}, and only a transform declares what it answers`];
  }
  const problems: string[] = [];
  if (!(binding.field in source.output)) {
    problems.push(`${what} ${binding.stepId}.${binding.field}, which ${binding.stepId} does not answer`);
  }
  if (!dominates(binding.stepId, reader.id, definition, entry)) {
    problems.push(`${what} ${binding.stepId}, which a run can reach ${reader.id} without running`);
  }
  return problems;
}

function dominates(through: string, step: string, definition: WorkflowDefinition, entry: string | undefined): boolean {
  if (through === step) return false;
  if (entry === undefined) return false;
  if (entry === step) return false;
  const seen = new Set<string>([through]);
  const pending = [entry];
  while (pending.length > 0) {
    const at = pending.pop();
    if (at === undefined || seen.has(at)) continue;
    if (at === step) return false;
    seen.add(at);
    for (const transition of definition.transitions) {
      if (transition.from === at) pending.push(transition.to);
    }
  }
  return true;
}

function reachesUndecided(from: string, to: string, definition: WorkflowDefinition): boolean {
  const seen = new Set<string>();
  const pending = [from];
  while (pending.length > 0) {
    const at = pending.pop();
    if (at === undefined || seen.has(at)) continue;
    if (at === to) return true;
    seen.add(at);
    for (const transition of definition.transitions) {
      if (transition.from === at && transition.when === undefined) pending.push(transition.to);
    }
  }
  return false;
}

function reachableFrom(entry: string | undefined, definition: WorkflowDefinition): ReadonlySet<string> {
  const seen = new Set<string>();
  if (entry === undefined) return seen;
  const pending = [entry];
  while (pending.length > 0) {
    const step = pending.pop();
    if (step === undefined || seen.has(step)) continue;
    seen.add(step);
    for (const transition of definition.transitions) {
      if (transition.from === step) pending.push(transition.to);
    }
  }
  return seen;
}
