import { Effect, Context, Layer, type Scope } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { compileWorkflow } from './compile';
import type { WorkflowDefinition } from './definition';
import type { WorkflowPlan } from './plan';
import type { WorkflowRunStorage } from './storage';
export type WorkflowRunStorageFactory<E = never> = () => Effect.Effect<WorkflowRunStorage, E, Scope.Scope>;
class Runs extends Context.Service<Runs, WorkflowRunStorage>()('@runlith/agent/testing/WorkflowRuns') {}
const definition: WorkflowDefinition = {
  name: 'review',
  description: 'Readers, then a judge',
  input: { scope: 'What is reviewed' },
  steps: [
    { kind: 'agent', id: 'readers', agentType: 'reviewer', task: 'Read' },
    { kind: 'agent', id: 'judge', agentType: 'judge', task: 'Decide' },
  ],
  transitions: [{ from: 'readers', to: 'judge' }],
};
const THREAD = 'thread-1';
const ARGUMENTS = { scope: 'a1b2c3d4' };
const VOCABULARY = { seams: new Set<string>(), conditions: new Set<string>(), workflows: new Set<string>() };
function planAt(revision: string, description = definition.description): WorkflowPlan {
  return compileWorkflow({ ...definition, description }, revision, VOCABULARY);
}
function started(runId: string): {
  id: string;
  workflow: string;
  plan: WorkflowPlan;
  thread: string;
  input: Record<string, unknown>;
} {
  return { id: runId, workflow: 'review', plan: planAt('r1'), thread: THREAD, input: ARGUMENTS };
}
export function describeWorkflowRunStoragePort<E>(name: string, open: WorkflowRunStorageFactory<E>): void {
  const storage = Layer.effect(Runs, Effect.suspend(open));
  layer(storage)(`${name}: workflow run storage port`, (it) => {
    it.effect(
      'a run starts pinned to its plan, running, unleased and with an empty ledger',
      Effect.fnUntraced(function* () {
        const runs = yield* Runs;
        const run = yield* runs.start(started('run-1'));
        expect(run).toMatchObject({ status: 'running', thread: THREAD, input: ARGUMENTS, lease: null, records: [] });
        expect((yield* runs.find('run-1'))?.plan.revision).toBe('r1');
      }),
    );
    it.effect(
      'one acquisition stands at a time, and the name it was taken under decides nothing',
      Effect.fnUntraced(function* () {
        const runs = yield* Runs;
        yield* runs.start(started('run-2'));
        const held = yield* runs.lease('run-2', { owner: 'engine-1', until: 5_000, now: 1_000 });
        expect(held).toMatchObject({ owner: 'engine-1' });
        expect(yield* runs.lease('run-2', { owner: 'engine-2', until: 9_000, now: 1_000 })).toBeUndefined();
        expect(yield* runs.lease('run-2', { owner: 'engine-1', until: 9_000, now: 1_000 })).toBeUndefined();
      }),
    );
    it.effect(
      'an expired acquisition is taken by the next driver, under a token of its own',
      Effect.fnUntraced(function* () {
        const runs = yield* Runs;
        yield* runs.start(started('run-3'));
        const first = yield* runs.lease('run-3', { owner: 'engine-1', until: 5_000, now: 1_000 });
        const second = yield* runs.lease('run-3', { owner: 'engine-2', until: 9_000, now: 6_000 });
        expect(second).toBeDefined();
        expect(second?.token).not.toBe(first?.token);
      }),
    );
    it.effect(
      'the holder renews its own acquisition, and a displaced holder is refused',
      Effect.fnUntraced(function* () {
        const runs = yield* Runs;
        yield* runs.start(started('run-4'));
        const first = yield* held(runs, 'run-4', 'engine-1', { until: 5_000, now: 1_000 });
        expect(yield* runs.renew('run-4', first, { until: 8_000 })).toBe(true);
        expect((yield* runs.find('run-4'))?.lease).toMatchObject({ until: 8_000, token: first.token });
        const second = yield* held(runs, 'run-4', 'engine-2', { until: 20_000, now: 9_000 });
        expect(yield* runs.renew('run-4', first, { until: 30_000 })).toBe(false);
        expect(yield* runs.renew('run-4', second, { until: 30_000 })).toBe(true);
      }),
    );
    it.effect(
      'a step is dispatched once: the same step and attempt is refused a second time',
      Effect.fnUntraced(function* () {
        const runs = yield* Runs;
        yield* runs.start(started('run-5'));
        const lease = yield* held(runs, 'run-5', 'engine-1', { until: 5_000, now: 1_000 });
        const record = { stepId: 'readers', attempt: 1, members: ['readers'], status: 'dispatched' as const };
        expect(yield* runs.dispatch('run-5', record, lease)).toBe(true);
        expect(yield* runs.dispatch('run-5', record, lease)).toBe(false);
        expect(yield* runs.dispatch('run-5', { ...record, attempt: 2 }, lease)).toBe(true);
        expect((yield* runs.find('run-5'))?.records).toHaveLength(2);
      }),
    );
    it.effect(
      'settling fills a dispatched record in, and a step nobody dispatched settles nothing',
      Effect.fnUntraced(function* () {
        const runs = yield* Runs;
        yield* runs.start(started('run-6'));
        const lease = yield* held(runs, 'run-6', 'engine-1', { until: 5_000, now: 1_000 });
        yield* runs.dispatch('run-6', { stepId: 'readers', attempt: 1, members: ['readers'], status: 'dispatched' }, lease);
        expect(yield* runs.settleStep('run-6', { stepId: 'readers', attempt: 1, status: 'done', output: { said: 'yes' } }, lease)).toBe(
          true,
        );
        expect((yield* runs.find('run-6'))?.records[0]).toMatchObject({
          status: 'done',
          members: ['readers'],
          output: { said: 'yes' },
        });
        expect(yield* runs.settleStep('run-6', { stepId: 'judge', attempt: 1, status: 'done' }, lease)).toBe(false);
      }),
    );
    it.effect(
      'a run ends with the status and the words the driver finished it on',
      Effect.fnUntraced(function* () {
        const runs = yield* Runs;
        yield* runs.start(started('run-7'));
        const lease = yield* held(runs, 'run-7', 'engine-1', { until: 5_000, now: 1_000 });
        expect(yield* runs.finish('run-7', { status: 'failed', reason: 'readers ended exhausted' }, lease)).toBe(true);
        expect(yield* runs.find('run-7')).toMatchObject({ status: 'failed', reason: 'readers ended exhausted' });
      }),
    );
    it.effect(
      'a displaced driver writes nothing: its dispatch, its settle and its finish are all refused',
      Effect.fnUntraced(function* () {
        const runs = yield* Runs;
        yield* runs.start(started('run-8'));
        const first = yield* held(runs, 'run-8', 'engine-1', { until: 5_000, now: 1_000 });
        yield* runs.dispatch('run-8', { stepId: 'readers', attempt: 1, members: ['readers'], status: 'dispatched' }, first);
        yield* held(runs, 'run-8', 'engine-2', { until: 20_000, now: 6_000 });
        expect(yield* runs.dispatch('run-8', { stepId: 'judge', attempt: 1, members: ['judge'], status: 'dispatched' }, first)).toBe(false);
        expect(yield* runs.settleStep('run-8', { stepId: 'readers', attempt: 1, status: 'done' }, first)).toBe(false);
        expect(yield* runs.finish('run-8', { status: 'completed' }, first)).toBe(false);
        expect(yield* runs.find('run-8')).toMatchObject({ status: 'running' });
        expect((yield* runs.find('run-8'))?.records[0]).toMatchObject({ status: 'dispatched' });
      }),
    );
    it.effect(
      'an amendment lands against the revision its editor read, and advances it',
      Effect.fnUntraced(function* () {
        const runs = yield* Runs;
        yield* runs.start(started('run-9'));
        expect(yield* runs.amend('run-9', { fromRevision: 'r1', plan: planAt('r2', 'Readers, then a judge who says why') })).toBe(
          'amended',
        );
        expect(yield* runs.amend('run-9', { fromRevision: 'r1', plan: planAt('r2') })).toBe('stale');
        expect((yield* runs.find('run-9'))?.plan.revision).toBe('r2');
      }),
    );
    it.effect(
      'an amendment that keeps the revision it read is refused, however it changes the plan',
      Effect.fnUntraced(function* () {
        const runs = yield* Runs;
        yield* runs.start(started('run-10'));
        expect(yield* runs.amend('run-10', { fromRevision: 'r1', plan: planAt('r1', 'Another text') })).toBe('stale');
        expect((yield* runs.find('run-10'))?.plan.description).toBe(definition.description);
      }),
    );
    it.effect(
      'an amendment may not rewrite a step the ledger says already began',
      Effect.fnUntraced(function* () {
        const runs = yield* Runs;
        yield* runs.start(started('run-11'));
        const lease = yield* held(runs, 'run-11', 'engine-1', { until: 5_000, now: 1_000 });
        yield* runs.dispatch('run-11', { stepId: 'readers', attempt: 1, members: ['readers'], status: 'dispatched' }, lease);
        const rewritten = compileWorkflow(
          {
            ...definition,
            steps: [{ kind: 'agent', id: 'readers', agentType: 'reviewer', task: 'Read twice' }, definition.steps[1]!],
          },
          'r2',
          VOCABULARY,
        );
        expect(yield* runs.amend('run-11', { fromRevision: 'r1', plan: rewritten })).toBe('stale');
      }),
    );
  });
}
const held = Effect.fnUntraced(function* (
  runs: WorkflowRunStorage,
  runId: string,
  owner: string,
  at: {
    until: number;
    now: number;
  },
) {
  const lease = yield* runs.lease(runId, { owner, ...at });
  if (!lease) return yield* Effect.die(`${owner} could not take ${runId}.`);
  return lease;
});
