import { Effect } from 'effect';
import type { WorkflowRun } from '@runlith/agent/workflow/run';
import { body, type OperationPair, pair } from '../../platform/contract/service/body.js';
import { birthOf } from '../../platform/contract/wire/actor.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { BlockNames } from '../../graph/contract/service/acts.js';
import { GraphScopes } from '../../graph/contract/service/serving.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { Workflows } from '../contract/service/workflows.js';
import { declaredRefusals } from '../../threads/refusalAnswers.js';
import { WORKFLOW_OPERATIONS as OPS, type WorkflowOperationId } from '../contract/wire/operations/workflows.js';

const wireRun = (run: WorkflowRun) => ({
  id: run.id,
  workflow: run.workflow,
  thread: run.thread,
  status: run.status,
  revision: run.plan.revision,
  reason: run.reason,
  steps: run.records.map((record) => ({
    stepId: record.stepId,
    attempt: record.attempt,
    status: record.status,
    members: record.members,
    reason: record.reason ?? null,
  })),
});

export const WORKFLOW_PAIRS: { readonly [K in WorkflowOperationId]: OperationPair<(typeof OPS)[K]> } = {
  list_workflows: pair(
    OPS.list_workflows,
    body(OPS.list_workflows, {
      execute: () =>
        declaredRefusals(OPS.list_workflows)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const catalog = yield* (yield* Workflows).list(call.project.id);
            return {
              status: 'ok' as const,
              resolved: catalog.resolved.map((entry) => ({
                name: entry.name,
                floor: entry.floor,
                revision: entry.revision,
                description: entry.plan.description,
                input: entry.plan.input,
              })),
              rejected: catalog.rejected,
            };
          }),
        ),
    }),
  ),
  list_workflow_runs: pair(
    OPS.list_workflow_runs,
    body(OPS.list_workflow_runs, {
      execute: () =>
        declaredRefusals(OPS.list_workflow_runs)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const runs = yield* (yield* Workflows).runsOf(call.project.id);
            return { status: 'ok' as const, runs: runs.map(wireRun) };
          }),
        ),
    }),
  ),
  start_workflow: pair(
    OPS.start_workflow,
    body(OPS.start_workflow, {
      execute: (input, _prepared: undefined, caller: Caller) =>
        declaredRefusals(OPS.start_workflow)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const scopeBlockUuid =
              input.scopeName === undefined
                ? undefined
                : (yield* (yield* GraphScopes).scope(call.project.id, yield* (yield* BlockNames).idOfName(input.scopeName))).uuid;
            const { actor } = caller;
            const started = yield* (yield* Workflows).start({
              projectId: call.project.id,
              workflow: input.name,
              input: input.input,
              createdBySessionId: null,
              scopeBlockUuid,
              ...birthOf(actor),
            });
            return { status: 'started' as const, ...started };
          }),
        ),
    }),
  ),
};
