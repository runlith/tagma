import { Effect, Exit } from 'effect';
import { activity } from '@runlith/activity/Activity';
import { activityKind } from '@runlith/activity/fact';
import { threadBorderOut } from '@runlith/agent/thread/ThreadBorder';
import { uuidv7 } from 'uuidv7';
import { WorkflowArgumentsError, workflowArgumentsRefused } from '@runlith/agent/workflow/run';
import { WorkflowUnknownError, type WorkflowCatalog } from '@runlith/agent/workflow/library';
import { Cause } from 'effect';
import { Projects } from '../../projects/contract/service/registry.js';
import { failedAs } from '../../threads/contract/service/failure.js';
import { ThreadHarness } from '../../threads/contract/service/engine.js';
import { Workflows } from '../contract/service/workflows.js';
import type { WorkflowRuns } from './runStorage.js';
import { ThreadInputRefused, type HarnessFailure } from '../../threads/contract/service/failure.js';
import { ThreadBirths } from '../../threads/birth/acts.js';
import { ThreadGraphs } from '../contract/service/graphs.js';
import { readWorkflowLibrary } from './sources.js';

export type WorkflowsInput = { readonly runs: WorkflowRuns; readonly dataPath: string | null };

const WORKFLOW_RUN = activityKind<{ readonly runId: string }>('workflow-run');

export const workflows = Effect.fnUntraced(function* ({ runs, dataPath }: WorkflowsInput) {
  const harness = yield* ThreadHarness;
  const { graph } = yield* ThreadGraphs;

  const list = Effect.fnUntraced(function* (projectId: number): Effect.fn.Return<WorkflowCatalog, HarnessFailure> {
    const project = yield* failedAs(
      'workflow-project',
      Effect.provide(
        Effect.flatMap(Projects, (projects) => projects.byId(projectId)),
        graph,
      ),
    );
    const library = yield* failedAs('workflow-floors', readWorkflowLibrary({ projectRoot: project.rootPath, dataPath }));
    return library.list();
  });

  const drive = Effect.fnUntraced(function* (runId: string, threadId: string, projectId: number) {
    const outcome = yield* Effect.exit(
      activity(WORKFLOW_RUN, { runId }, threadBorderOut(harness.workflows.advance(runId)), {
        thread: threadId,
        project: projectId,
        actor: { kind: 'server', name: 'workflow' },
      }),
    );
    if (Exit.isSuccess(outcome)) return;
    if (Cause.hasInterrupts(outcome.cause)) return yield* Effect.failCause(outcome.cause);
    yield* Effect.logError('a workflow run stopped', { runId, reason: Cause.pretty(outcome.cause) });
  });

  return Workflows.of({
    list,

    start: Effect.fnUntraced(function* (input) {
      const catalog = yield* list(input.projectId);
      const resolved = catalog.resolved.find((entry) => entry.name === input.workflow);
      if (resolved === undefined) {
        return yield* Effect.fail(
          new ThreadInputRefused('workflow-unknown', new WorkflowUnknownError(input.workflow).message, [
            'tagma workflow list — the workflows this project holds, and the files that could not become one',
          ]),
        );
      }
      const refused = workflowArgumentsRefused(resolved.plan, input.input);
      if (refused !== null) {
        return yield* Effect.fail(
          new ThreadInputRefused('workflow-arguments', refused.message, [
            `tagma workflow list — the fields ${resolved.name} declares, each described`,
          ]),
        );
      }
      const thread = yield* (yield* ThreadBirths).create({
        projectId: input.projectId,
        createdBySessionId: input.createdBySessionId,
        createdBy: `workflow:${input.workflow}`,
        title: input.workflow,
        scopeBlockUuid: input.scopeBlockUuid,
        askedBy: input.askedBy,
        bornOf: input.bornOf,
      });
      const run = yield* harness.workflows.start({
        id: uuidv7(),
        workflow: resolved.name,
        plan: resolved.plan,
        thread: thread.thread.id,
        input: input.input,
      });
      if (run instanceof WorkflowArgumentsError) return yield* Effect.die(run);
      yield* Effect.forkDetach(drive(run.id, thread.thread.id, input.projectId));
      return { runId: run.id, threadId: thread.thread.id };
    }),

    runsOf: (projectId) => Effect.orDie(runs.ofProject(projectId)),
  });
});
