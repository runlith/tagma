import { Data, Schema } from 'effect';
import { workflowPlanSchema } from './plan';

export const workflowStepRecordSchema = Schema.Struct({
  stepId: Schema.String.check(Schema.isMinLength(1)),
  attempt: Schema.Int.check(Schema.isGreaterThan(0)),
  members: Schema.Array(Schema.String),
  status: Schema.Literals(['dispatched', 'done', 'failed', 'exhausted']),
  callRunId: Schema.optional(Schema.String),
  output: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  next: Schema.optional(Schema.NullOr(Schema.String)),
  reason: Schema.optional(Schema.String),
});

export const workflowLeaseSchema = Schema.Struct({
  owner: Schema.String.check(Schema.isMinLength(1)),
  until: Schema.Number,
  token: Schema.Int.check(Schema.isGreaterThan(0)),
});

export const workflowRunSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  workflow: Schema.String.check(Schema.isMinLength(1)),
  thread: Schema.String.check(Schema.isMinLength(1)),
  plan: workflowPlanSchema,
  input: Schema.Record(Schema.String, Schema.Unknown),
  status: Schema.Literals(['running', 'completed', 'failed', 'stopped']),
  lease: Schema.NullOr(workflowLeaseSchema),
  records: Schema.Array(workflowStepRecordSchema),
  reason: Schema.NullOr(Schema.String),
});

export type WorkflowStepRecord = typeof workflowStepRecordSchema.Type;
export type WorkflowLease = typeof workflowLeaseSchema.Type;
export type WorkflowRun = typeof workflowRunSchema.Type;

export class WorkflowArgumentsError extends Data.TaggedError('WorkflowArgumentsRefused')<{
  readonly message: string;
  readonly workflow: string;
  readonly missing: readonly string[];
  readonly unknown: readonly string[];
}> {
  constructor(workflow: string, missing: readonly string[], unknown: readonly string[]) {
    const said = [
      ...(missing.length > 0 ? [`does not name ${missing.join(', ')}`] : []),
      ...(unknown.length > 0 ? [`names ${unknown.join(', ')}, which it does not declare`] : []),
    ];
    super({ message: `A run of ${workflow} ${said.join(' and ')}.`, workflow, missing, unknown });
    this.name = 'WorkflowArgumentsError';
  }
}

export function workflowArgumentsRefused(plan: WorkflowRun['plan'], argued: Record<string, unknown>): WorkflowArgumentsError | null {
  const declared = Object.keys(plan.input);
  const missing = declared.filter((field) => !(field in argued));
  const unknown = Object.keys(argued).filter((field) => !declared.includes(field));
  if (missing.length === 0 && unknown.length === 0) return null;
  return new WorkflowArgumentsError(plan.name, missing, unknown);
}

export function executedSteps(run: WorkflowRun): ReadonlySet<string> {
  return new Set(run.records.map((record) => record.stepId));
}

export function amendmentProblems(run: WorkflowRun, next: WorkflowRun['plan']): readonly string[] {
  const executed = executedSteps(run);
  const problems: string[] = [];
  const before = new Map(run.plan.steps.map((step) => [step.id, JSON.stringify(step)]));
  for (const stepId of executed) {
    const kept = next.steps.find((step) => step.id === stepId);
    if (!kept) problems.push(`${stepId} has already run and the amendment removes it`);
    else if (JSON.stringify(kept) !== before.get(stepId)) {
      problems.push(`${stepId} has already run and the amendment rewrites it`);
    }
  }
  if (next.entry !== run.plan.entry) problems.push('an amendment cannot move where the run began');
  if (next.revision === run.plan.revision) {
    problems.push(`an amendment must carry a revision other than ${run.plan.revision}`);
  }
  return problems;
}

export function nextAttempt(run: WorkflowRun, stepId: string): number {
  return run.records.filter((record) => record.stepId === stepId).length + 1;
}

export type WorkflowNext =
  | { readonly kind: 'resume'; readonly record: WorkflowStepRecord }
  | { readonly kind: 'start'; readonly stepId: string; readonly attempt: number }
  | { readonly kind: 'failed'; readonly record: WorkflowStepRecord }
  | { readonly kind: 'completed' };

export function workflowNext(run: WorkflowRun): WorkflowNext {
  const last = run.records[run.records.length - 1];
  if (!last) return { kind: 'start', stepId: run.plan.entry, attempt: 1 };
  if (last.status === 'dispatched') return { kind: 'resume', record: last };
  if (last.status !== 'done') return { kind: 'failed', record: last };
  const next = last.next ?? null;
  if (next === null) return { kind: 'completed' };
  return { kind: 'start', stepId: next, attempt: nextAttempt(run, next) };
}
