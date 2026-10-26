import { Schema } from 'effect';

export const workflowCatalogSchema = Schema.Struct({
  resolved: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      floor: Schema.Literals(['project', 'user']),
      revision: Schema.String,
      description: Schema.String,
      input: Schema.Record(Schema.String, Schema.String),
    }),
  ),
  rejected: Schema.Array(Schema.Struct({ name: Schema.String, floor: Schema.Literals(['project', 'user']), reason: Schema.String })),
});

export type WorkflowCatalog = typeof workflowCatalogSchema.Type;

export const workflowRunSchema = Schema.Struct({
  id: Schema.String,
  workflow: Schema.String,
  thread: Schema.String,
  status: Schema.Literals(['running', 'completed', 'failed', 'stopped']),
  revision: Schema.String,
  reason: Schema.NullOr(Schema.String),
  steps: Schema.Array(
    Schema.Struct({
      stepId: Schema.String,
      attempt: Schema.Int,
      status: Schema.Literals(['dispatched', 'done', 'failed', 'exhausted']),
      members: Schema.Array(Schema.String),
      reason: Schema.NullOr(Schema.String),
    }),
  ),
});

export type WorkflowRun = typeof workflowRunSchema.Type;

export const workflowStartedSchema = Schema.Struct({ runId: Schema.String, threadId: Schema.String });

export type WorkflowStarted = typeof workflowStartedSchema.Type;
