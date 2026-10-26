import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, FileSystem, Layer, Schedule, Stream } from 'effect';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { inboxOf } from '../../../threads/testing/doubles.js';
import { nativeLeads, subscriptionLogin } from '../claudeLogin.js';
import { holdThreads } from '../threadScope.js';
import type { WorkflowRun } from '../../../native-harness/contract/wire/workflows.js';
import type { FaultsPage } from '../../../activity/contract/wire/faults.js';
import { join } from 'node:path';
import { doorFixture, DoorFixture, projectLeaving } from '../doorFixture.js';

layer(
  doorFixture({
    models: (standing) => ({
      ...standing,
      request: (input) => ({
        ...standing.request(input),
        stream: () =>
          Stream.fromIterable([
            { type: 'text-start', id: 'report' },
            { type: 'text-delta', id: 'report', text: 'Member report' },
            { type: 'text-end', id: 'report' },
            { type: 'finish', reason: 'stop' },
          ]),
      }),
    }),
  }).pipe(Layer.provideMerge(BunFileSystem.layer)),
  { excludeTestServices: true },
)('workflows door', (it) => {
  it.effect('the catalog serves a project workflow and identifies an unreadable file on the same floor', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* world.directory('workflows');
      const folder = join(root, '.tagma', 'workflows');
      yield* files.makeDirectory(folder, { recursive: true });
      yield* files.writeFileString(
        join(folder, 'panel.json'),
        JSON.stringify({
          name: 'panel',
          description: 'One reader per lens',
          input: { scope: 'The block under review', lenses: 'One reader per lens, by name' },
          steps: [
            {
              kind: 'pack',
              id: 'readers',
              agentType: 'tagma',
              task: 'Read the scope through the lens you were given',
              input: { scope: { from: 'run', field: 'scope' }, lens: { from: 'member' } },
              count: { from: 'run', field: 'lenses', limit: 8 },
              completion: { rule: 'all' },
            },
          ],
          transitions: [],
        }),
      );
      const broken = join(folder, 'notes.json');
      yield* files.writeFileString(broken, 'not json at all');
      const project = yield* world.stealthProject(root);
      yield* projectLeaving(world, project);
      const response = yield* world.op('list_workflows', {}, `project=${project}`);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        resolved: [{ name: 'panel', floor: 'project', description: 'One reader per lens' }],
        rejected: [{ name: yield* files.realPath(broken), floor: 'project' }],
      });
    }),
  );

  it.effect('pack reports advance the chair without opening a turn in the workflow thread', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* world.directory('council');
      const folder = join(root, '.tagma', 'workflows');
      yield* files.makeDirectory(folder, { recursive: true });
      yield* files.writeFileString(
        join(folder, 'council.json'),
        JSON.stringify({
          name: 'council',
          description: 'A pack followed by a chair',
          steps: [
            { kind: 'pack', id: 'answers', agentType: 'tagma', task: 'Answer', count: 2, completion: { rule: 'all' } },
            { kind: 'agent', id: 'chair', agentType: 'tagma', task: 'Decide' },
          ],
          transitions: [{ from: 'answers', to: 'chair' }],
        }),
      );
      const project = yield* world.stealthProject(root);
      yield* projectLeaving(world, project);
      yield* holdThreads(world);
      yield* nativeLeads(world, yield* subscriptionLogin(world));
      const started = yield* world.op('start_workflow', { name: 'council', input: {} }, `project=${project}`);
      expect(started.status).toBe(200);
      const { runId, threadId } = started.body as { runId: string; threadId: string };
      const runs = Effect.suspend(() =>
        Effect.map(world.op('list_workflow_runs', {}, `project=${project}`), (answer) =>
          (answer.body as { runs: readonly WorkflowRun[] }).runs.find((run) => run.id === runId),
        ),
      );
      const ended = yield* Effect.repeat(runs, { schedule: Schedule.spaced('10 millis'), until: (run) => run?.status !== 'running' });
      expect(ended).toMatchObject({ status: 'completed' });
      expect(ended?.steps.map(({ stepId, status, members }) => ({ stepId, status, members }))).toEqual([
        { stepId: 'answers', status: 'done', members: ['answers#0', 'answers#1'] },
        { stepId: 'chair', status: 'done', members: ['chair'] },
      ]);
      const thread = yield* Context.get(world.runtime.owners, ThreadHarness).reads.snapshot(threadId);
      expect(thread.latestRun).toBeNull();
      expect(thread.activeRun).toBeNull();
      const collected = yield* inboxOf(world.runtime.owners).arrivals({ threadId, after: null, reports: 'all' });
      expect(
        collected.items.flatMap((item) =>
          item.kind === 'envelope' && item.body.intent === 'report' ? [item.body.text.endsWith('Member report')] : [],
        ),
      ).toEqual([true, true, true]);

      yield* files.writeFileString(
        join(folder, 'broken.json'),
        JSON.stringify({
          name: 'broken',
          description: 'A member type that cannot be born',
          steps: [{ kind: 'agent', id: 'member', agentType: 'missing-workflow-agent', task: 'Answer' }],
          transitions: [],
        }),
      );
      const broken = yield* world.op('start_workflow', { name: 'broken', input: {} }, `project=${project}`);
      expect(broken.status).toBe(200);
      const failed = broken.body as { runId: string; threadId: string };
      const failedRun = yield* Effect.repeat(
        Effect.suspend(() =>
          Effect.map(world.op('list_workflow_runs', {}, `project=${project}`), (answer) =>
            (answer.body as { runs: readonly WorkflowRun[] }).runs.find((run) => run.id === failed.runId),
          ),
        ),
        { schedule: Schedule.spaced('10 millis'), until: (run) => run?.status !== 'running' },
      );
      expect(failedRun).toMatchObject({ status: 'failed', steps: [{ stepId: 'member', status: 'failed' }], reason: expect.any(String) });
      const fault = yield* Effect.repeat(
        Effect.suspend(() =>
          Effect.map(world.op('read_faults', { limit: 10 }), (answer) =>
            (answer.body as FaultsPage).faults.find((fault) => fault.thread === failed.threadId),
          ),
        ),
        { schedule: Schedule.spaced('10 millis'), until: (fault) => fault !== undefined },
      );
      expect(fault).toMatchObject({ kind: 'defect', place: 'workflow-run', project });
    }),
  );
});
