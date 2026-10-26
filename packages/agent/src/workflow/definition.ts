import { Schema } from 'effect';

export const workflowSignatureSchema = Schema.Record(Schema.String, Schema.String);

export const workflowBindingSchema = Schema.Union([
  Schema.Struct({ from: Schema.Literal('run'), field: Schema.String.check(Schema.isMinLength(1)) }),
  Schema.Struct({
    from: Schema.Literal('step'),
    stepId: Schema.String.check(Schema.isMinLength(1)),
    field: Schema.String.check(Schema.isMinLength(1)),
  }),
  Schema.Struct({ from: Schema.Literal('member') }),
  Schema.Struct({ from: Schema.Literal('index') }),
]);

export const workflowInputSchema = Schema.Record(Schema.String, workflowBindingSchema);

export const workflowAgentStepSchema = Schema.Struct({
  kind: Schema.Literal('agent'),
  id: Schema.String.check(Schema.isMinLength(1)),
  agentType: Schema.String.check(Schema.isMinLength(1)),
  task: Schema.String.check(Schema.isMinLength(1)),
  input: Schema.optional(workflowInputSchema),
});

export const workflowCountSchema = Schema.Union([
  Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 64 })),
  Schema.Struct({
    from: Schema.Literal('run'),
    field: Schema.String.check(Schema.isMinLength(1)),
    limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 64 })),
  }),
  Schema.Struct({
    from: Schema.Literal('step'),
    stepId: Schema.String.check(Schema.isMinLength(1)),
    field: Schema.String.check(Schema.isMinLength(1)),
    limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 64 })),
  }),
]);

export const workflowTransformStepSchema = Schema.Struct({
  kind: Schema.Literal('transform'),
  id: Schema.String.check(Schema.isMinLength(1)),
  seam: Schema.String.check(Schema.isMinLength(1)),
  from: Schema.optional(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
  output: workflowSignatureSchema,
});

export const workflowPackStepSchema = Schema.Struct({
  kind: Schema.Literal('pack'),
  id: Schema.String.check(Schema.isMinLength(1)),
  agentType: Schema.String.check(Schema.isMinLength(1)),
  task: Schema.String.check(Schema.isMinLength(1)),
  count: workflowCountSchema,
  completion: Schema.Union([
    Schema.Struct({ rule: Schema.Literal('all') }),
    Schema.Struct({ rule: Schema.Literal('at-least'), atLeast: Schema.Int.check(Schema.isGreaterThan(0)) }),
  ]),
  input: Schema.optional(workflowInputSchema),
});

export const workflowCallStepSchema = Schema.Struct({
  kind: Schema.Literal('call'),
  id: Schema.String.check(Schema.isMinLength(1)),
  workflow: Schema.String.check(Schema.isMinLength(1)),
  input: Schema.optional(workflowInputSchema),
});

export const workflowStepSchema = Schema.Union([
  workflowAgentStepSchema,
  workflowPackStepSchema,
  workflowTransformStepSchema,
  workflowCallStepSchema,
]);

export const workflowTransitionSchema = Schema.Struct({
  from: Schema.String.check(Schema.isMinLength(1)),
  to: Schema.String.check(Schema.isMinLength(1)),
  when: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
});

export const workflowDefinitionSchema = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
  description: Schema.String,
  input: Schema.optional(workflowSignatureSchema),
  steps: Schema.Array(workflowStepSchema).check(Schema.isMinLength(1)),
  transitions: Schema.Array(workflowTransitionSchema),
});

export type WorkflowSignature = typeof workflowSignatureSchema.Type;
export type WorkflowBinding = typeof workflowBindingSchema.Type;
export type WorkflowInput = typeof workflowInputSchema.Type;
export type WorkflowAgentStep = typeof workflowAgentStepSchema.Type;
export type WorkflowPackStep = typeof workflowPackStepSchema.Type;
export type WorkflowCallStep = typeof workflowCallStepSchema.Type;
export type WorkflowTransformStep = typeof workflowTransformStepSchema.Type;
export type WorkflowCount = typeof workflowCountSchema.Type;
export type WorkflowStep = typeof workflowStepSchema.Type;
export type WorkflowTransition = typeof workflowTransitionSchema.Type;
export type WorkflowDefinition = typeof workflowDefinitionSchema.Type;

export function workflowPackMemberId(stepId: string, index: number): string {
  return `${stepId}#${index}`;
}
