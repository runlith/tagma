import { Data, Schema } from 'effect';
import { workflowSignatureSchema, workflowStepSchema, workflowTransitionSchema } from './definition';

export const workflowPlanSchema = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
  description: Schema.String,
  input: workflowSignatureSchema,
  revision: Schema.String.check(Schema.isMinLength(1)),
  steps: Schema.Array(workflowStepSchema).check(Schema.isMinLength(1)),
  transitions: Schema.Array(workflowTransitionSchema),
  entry: Schema.String.check(Schema.isMinLength(1)),
});

export type WorkflowPlan = typeof workflowPlanSchema.Type;

export class WorkflowCompileError extends Data.TaggedError('WorkflowCompileFailed')<{
  readonly message: string;
  readonly workflow: string;
  readonly problems: readonly string[];
}> {
  constructor(workflow: string, problems: readonly string[]) {
    super({ message: `Workflow ${workflow} does not compile: ${problems.join('; ')}`, workflow, problems });
    this.name = 'WorkflowCompileError';
  }
}
