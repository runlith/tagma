import { Context, type Effect } from 'effect';
import type { ThreadBorderFailed } from '../thread/ThreadBorder';
import type { WorkflowLibrary } from './library';
import type { WorkflowRun } from './run';
import type { WorkflowRunStorage } from './storage';

export type WorkflowSeam = (input: {
  readonly seam: string;
  readonly run: WorkflowRun;
  readonly from: readonly { readonly stepId: string; readonly output: Record<string, unknown> }[];
}) => Effect.Effect<Record<string, unknown>, ThreadBorderFailed>;

export type WorkflowCondition = (input: {
  readonly condition: string;
  readonly run: WorkflowRun;
  readonly step: { readonly stepId: string; readonly output: Record<string, unknown> };
}) => Effect.Effect<boolean, ThreadBorderFailed>;

export type WorkflowConfig = {
  readonly runs: WorkflowRunStorage;
  readonly library: (run: WorkflowRun) => Effect.Effect<WorkflowLibrary, ThreadBorderFailed>;
  readonly seams: Readonly<Record<string, WorkflowSeam>>;
  readonly conditions: Readonly<Record<string, WorkflowCondition>>;
  readonly leaseMs: number;
  readonly stepDeadlineMs: number;
};

export class DeclaredWorkflow extends Context.Service<DeclaredWorkflow, WorkflowConfig | null>()('@runlith/agent/DeclaredWorkflow') {}
