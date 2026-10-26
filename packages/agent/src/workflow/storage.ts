import type { Effect } from 'effect';
import type { ThreadPortFailure } from '../thread/ThreadBorder';
import type { WorkflowPlan } from './plan';
import type { WorkflowLease, WorkflowRun, WorkflowStepRecord } from './run';

export type WorkflowRunStorage = {
  start(input: {
    id: string;
    workflow: string;
    plan: WorkflowPlan;
    thread: string;
    input: Record<string, unknown>;
  }): Effect.Effect<WorkflowRun, ThreadPortFailure>;

  find(runId: string): Effect.Effect<WorkflowRun | undefined, ThreadPortFailure>;

  lease(runId: string, input: { owner: string; until: number; now: number }): Effect.Effect<WorkflowLease | undefined, ThreadPortFailure>;

  renew(runId: string, lease: WorkflowLease, input: { until: number }): Effect.Effect<boolean, ThreadPortFailure>;

  dispatch(runId: string, record: WorkflowStepRecord, lease: WorkflowLease): Effect.Effect<boolean, ThreadPortFailure>;

  settleStep(
    runId: string,
    input: {
      stepId: string;
      attempt: number;
      status: 'done' | 'failed' | 'exhausted';
      output?: Record<string, unknown>;
      next?: string | null;
      reason?: string;
    },
    lease: WorkflowLease,
  ): Effect.Effect<boolean, ThreadPortFailure>;

  amend(runId: string, input: { fromRevision: string; plan: WorkflowPlan }): Effect.Effect<'amended' | 'stale', ThreadPortFailure>;

  finish(
    runId: string,
    input: { status: 'completed' | 'failed' | 'stopped'; reason?: string },
    lease: WorkflowLease,
  ): Effect.Effect<boolean, ThreadPortFailure>;
};
