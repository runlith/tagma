import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Context, Deferred, Effect, Fiber, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import type { ThreadBornOf } from '../protocol/birth';
import { ThreadCallBroke } from '../thread/ThreadBorder';
import { ThreadOwner, ThreadStore, ThreadWorkflowMembers, ThreadToolRegistry, threadToolSources } from '../thread/ThreadPorts';
import { makeAggregateStorage } from '../thread/storage/InMemoryAggregateStorage';
import { compileWorkflow, type WorkflowVocabulary } from './compile';
import type { WorkflowDefinition } from './definition';
import { WorkflowEngine, workflowEngineLayer } from './engine';
import { WorkflowLibrary, type WorkflowSource } from './library';
import { makeWorkflowRuns } from './memory';
import type { WorkflowRunStorage } from './storage';
import { WorkflowArgumentsError } from './run';
import { DeclaredWorkflow, type WorkflowConfig } from './WorkflowConfig';
const THREAD = 'thread-run';
const HELD = { seams: ['collect-findings'], conditions: ['anything-standing'] };
const HOST: WorkflowVocabulary = {
  seams: new Set(HELD.seams),
  conditions: new Set(HELD.conditions),
  workflows: new Set(['review', 'inner']),
};
const definition: WorkflowDefinition = {
  name: 'review',
  description: 'Three readers, then a judge',
  steps: [
    {
      kind: 'pack',
      id: 'readers',
      agentType: 'reviewer',
      task: 'Review from your lens',
      count: 3,
      completion: { rule: 'all' },
    },
    { kind: 'agent', id: 'judge', agentType: 'judge', task: 'Decide' },
  ],
  transitions: [{ from: 'readers', to: 'judge' }],
};
function plane(
  options: {
    silent?: readonly string[];
    waiting?: Deferred.Deferred<void>;
    answerAfterMs?: number;
    refused?: string;
  } = {},
) {
  const started: string[] = [];
  const asked: string[] = [];
  const tasks: string[] = [];
  const acts = new Map<string, ThreadBornOf>();
  const members = Layer.succeed(
    ThreadWorkflowMembers,
    ThreadWorkflowMembers.of({
      startMember: (input) =>
        input.name === options.refused
          ? Effect.fail(new ThreadCallBroke({ cause: new Error('Member birth failed') }))
          : Effect.sync(() => {
              started.push(input.name);
              asked.push(input.requestId);
              tasks.push(input.task);
              acts.set(input.name, input.bornOf);
              return { threadId: `thread-${input.name}` };
            }),
      waitForReports: Effect.fnUntraced(function* (input) {
        if (options.waiting) yield* Deferred.succeed(options.waiting, undefined);
        if (options.answerAfterMs !== undefined) yield* Effect.sleep(options.answerAfterMs);
        return new Map(
          input.members
            .filter((member) => !(options.silent ?? []).includes(member))
            .map((member) => [member, `${member} answered`] as const),
        );
      }),
    }),
  );
  const aggregate = makeAggregateStorage();
  const store = Layer.succeed(ThreadStore, {
    ...aggregate,
    find: (id) => Effect.succeed(id === THREAD ? aggregate.row(THREAD) : undefined),
  });
  return { started, asked, tasks, acts, layer: Layer.mergeAll(members, store, Layer.succeed(ThreadToolRegistry, threadToolSources())) };
}
const engineOver = Effect.fnUntraced(function* (
  runs: WorkflowRunStorage,
  world: ReturnType<typeof plane>,
  options: {
    ownerId?: string;
    leaseMs?: number;
    sources?: readonly WorkflowSource[];
    unhosted?: boolean;
  } = {},
) {
  const workflow: WorkflowConfig = {
    runs,
    library: () => Effect.succeed(new WorkflowLibrary(options.sources ?? [], HELD)),
    seams: {
      'collect-findings': (input) =>
        Effect.succeed({
          findings: input.from.flatMap((source) => (source.output.reports as string[] | undefined) ?? []),
        }),
    },
    conditions: {
      'anything-standing': (input) => Effect.succeed(((input.step.output.findings as unknown[] | undefined) ?? []).length > 0),
    },
    leaseMs: options.leaseMs ?? 60_000,
    stepDeadlineMs: 1_000,
  };
  const config = Layer.mergeAll(
    Layer.succeed(ThreadOwner, { id: options.ownerId ?? 'engine-1' }),
    Layer.succeed(DeclaredWorkflow, options.unhosted ? null : workflow),
  );
  return Context.get(yield* Layer.build(workflowEngineLayer.pipe(Layer.provide(Layer.mergeAll(world.layer, config)))), WorkflowEngine);
});
const opened = (runs: WorkflowRunStorage, id: string, plan: ReturnType<typeof compileWorkflow>, input: Record<string, unknown> = {}) =>
  runs.start({ id, workflow: 'review', plan, thread: THREAD, input });
describe('WorkflowEngine', () => {
  it.effect(
    'a run walks its plan and its ledger holds every step it took',
    Effect.fnUntraced(function* () {
      const runs = makeWorkflowRuns();
      const world = plane();
      yield* opened(runs, 'run-1', compileWorkflow(definition, 'r1', HOST));
      const engine = yield* engineOver(runs, world);
      const finished = yield* engine.advance('run-1');
      expect(finished?.status).toBe('completed');
      expect(world.started).toEqual(['readers#0', 'readers#1', 'readers#2', 'judge']);
      expect(finished?.records.map((record) => [record.stepId, record.status, record.next])).toEqual([
        ['readers', 'done', 'judge'],
        ['judge', 'done', null],
      ]);
      expect(finished?.records[0]?.members).toEqual(['readers#0', 'readers#1', 'readers#2']);
    }),
  );
  it.effect('a failed member birth settles the dispatched step and run before propagating the failure', () =>
    Effect.gen(function* () {
      const runs = makeWorkflowRuns();
      const engine = yield* engineOver(runs, plane({ refused: 'judge' }));
      yield* opened(runs, 'failed-birth', compileWorkflow(definition, 'r1', HOST));
      const advanced = yield* Effect.result(engine.advance('failed-birth'));
      expect(advanced).toMatchObject({ _tag: 'Failure', failure: { _tag: 'ThreadCallBroke' } });
      const ended = yield* runs.find('failed-birth');
      expect(ended).toMatchObject({ status: 'failed', reason: expect.stringContaining('Member birth failed') });
      expect(ended?.records.map(({ stepId, status }) => ({ stepId, status }))).toEqual([
        { stepId: 'readers', status: 'done' },
        { stepId: 'judge', status: 'failed' },
      ]);
    }),
  );
  it.effect(
    'the members of one dispatched step are born of one act, and the next step is another',
    Effect.fnUntraced(function* () {
      const runs = makeWorkflowRuns();
      const world = plane();
      yield* opened(runs, 'run-acts', compileWorkflow(definition, 'r1', HOST));
      const engine = yield* engineOver(runs, world);
      yield* engine.advance('run-acts');
      const readers = { by: 'run-acts', step: 0 };
      expect(world.acts.get('readers#0')).toEqual(readers);
      expect(world.acts.get('readers#1')).toEqual(readers);
      expect(world.acts.get('readers#2')).toEqual(readers);
      expect(world.acts.get('judge')).toEqual({ by: 'run-acts', step: 1 });
    }),
  );
  it.effect(
    'an adopter re-awaits the members the record names instead of opening a second attempt',
    Effect.fnUntraced(function* () {
      const runs = makeWorkflowRuns();
      yield* opened(runs, 'run-2', compileWorkflow(definition, 'r1', HOST));
      const now = yield* Clock.currentTimeMillis;
      const dead = yield* runs.lease('run-2', { owner: 'engine-0', until: now - 1, now: now - 2 });
      if (!dead) return yield* Effect.die('The dead driver could not take the run.');
      yield* runs.dispatch(
        'run-2',
        {
          stepId: 'readers',
          attempt: 1,
          members: ['readers#0', 'readers#1', 'readers#2'],
          status: 'dispatched',
        },
        dead,
      );
      const world = plane();
      const engine = yield* engineOver(runs, world, { ownerId: 'engine-2' });
      const finished = yield* engine.advance('run-2');
      expect(world.asked.slice(0, 3)).toEqual(['run-2:readers:1:readers#0', 'run-2:readers:1:readers#1', 'run-2:readers:1:readers#2']);
      expect(finished?.records.filter((record) => record.stepId === 'readers')).toHaveLength(1);
      expect(finished?.records[0]).toMatchObject({ attempt: 1, status: 'done' });
      expect(finished?.status).toBe('completed');
    }),
  );
  it.effect(
    'a run whose lease another driver holds is left alone, and nobody is started',
    Effect.fnUntraced(function* () {
      const runs = makeWorkflowRuns();
      yield* opened(runs, 'run-3', compileWorkflow(definition, 'r1', HOST));
      const now = yield* Clock.currentTimeMillis;
      yield* runs.lease('run-3', { owner: 'engine-1', until: now + 60_000, now });
      const world = plane();
      const engine = yield* engineOver(runs, world, { ownerId: 'engine-2' });
      const read = yield* engine.advance('run-3');
      expect(world.started).toEqual([]);
      expect(read).toMatchObject({ status: 'running', records: [] });
    }),
  );
  it.effect(
    'a pack nobody finishes ends exhausted, and the run ends failed in that step`s words',
    Effect.fnUntraced(function* () {
      const runs = makeWorkflowRuns();
      const world = plane({ silent: ['thread-readers#2'] });
      yield* opened(runs, 'run-4', compileWorkflow(definition, 'r1', HOST));
      const engine = yield* engineOver(runs, world);
      const stalled = yield* engine.advance('run-4');
      expect(stalled?.records.at(-1)).toMatchObject({
        stepId: 'readers',
        status: 'exhausted',
        reason: '2 of 3 agents reported before the deadline',
      });
      expect(stalled).toMatchObject({ status: 'failed', reason: '2 of 3 agents reported before the deadline' });
      expect(world.started).not.toContain('judge');
    }),
  );
  it.effect(
    'the lease is pushed out while a step waits',
    Effect.fnUntraced(function* () {
      const runs = makeWorkflowRuns();
      const waiting = yield* Deferred.make<void>();
      const world = plane({ waiting, answerAfterMs: 100 });
      yield* opened(runs, 'run-5', compileWorkflow(definition, 'r1', HOST));
      const engine = yield* engineOver(runs, world, { leaseMs: 60 });
      const at = yield* Clock.currentTimeMillis;
      const advancing = yield* Effect.forkScoped(engine.advance('run-5'));
      yield* Deferred.await(waiting);
      expect((yield* runs.find('run-5'))?.lease?.until).toBe(at + 60);
      yield* TestClock.adjust(100);
      const now = yield* Clock.currentTimeMillis;
      const until = (yield* runs.find('run-5'))?.lease?.until;
      expect(until).toBeGreaterThan(now);
      expect(until).toBeLessThanOrEqual(now + 60);
      yield* TestClock.adjust(100);
      expect((yield* Fiber.join(advancing))?.status).toBe('completed');
    }),
  );
  it.effect('an interrupted driver leaves its dispatched step resumable after the lease ends', () =>
    Effect.gen(function* () {
      const runs = makeWorkflowRuns();
      const waiting = yield* Deferred.make<void>();
      yield* opened(runs, 'interrupted', compileWorkflow(definition, 'r1', HOST));
      const engine = yield* engineOver(runs, plane({ waiting, answerAfterMs: 100 }), { leaseMs: 60 });
      const advancing = yield* Effect.forkScoped(engine.advance('interrupted'));
      yield* Deferred.await(waiting);
      yield* Fiber.interrupt(advancing);
      expect(yield* runs.find('interrupted')).toMatchObject({ status: 'running', reason: null, records: [{ status: 'dispatched' }] });
      yield* TestClock.adjust(60);
      const successor = yield* engineOver(runs, plane(), { ownerId: 'successor' });
      expect(yield* successor.advance('interrupted')).toMatchObject({
        status: 'completed',
        records: [{ status: 'done' }, { status: 'done' }],
      });
    }),
  );
  it.effect(
    'an unhosted engine refuses instead of driving a run',
    Effect.fnUntraced(function* () {
      const engine = yield* engineOver(makeWorkflowRuns(), plane(), { unhosted: true });
      const refused = yield* Effect.result(engine.advance('run-x'));
      expect(refused._tag).toBe('Failure');
      if (refused._tag === 'Failure') {
        expect(refused.failure).toBeInstanceOf(ThreadCallBroke);
        expect(refused.failure).toMatchObject({ cause: { message: expect.stringMatching(/declared no workflow/) } });
      }
    }),
  );
});
describe('the values a step binds', () => {
  const signed: WorkflowDefinition = {
    name: 'review',
    description: 'One reviewer per lens',
    input: { scope: 'What is reviewed', lenses: 'One reviewer per lens, by name' },
    steps: [
      {
        kind: 'pack',
        id: 'readers',
        agentType: 'reviewer',
        task: 'Review the scope through the lens you were given',
        input: { scope: { from: 'run', field: 'scope' }, lens: { from: 'member' }, seat: { from: 'index' } },
        count: { from: 'run', field: 'lenses', limit: 8 },
        completion: { rule: 'all' },
      },
    ],
    transitions: [],
  };
  it.effect(
    'a run is checked against the signature its plan declares',
    Effect.fnUntraced(function* () {
      const runs = makeWorkflowRuns();
      const engine = yield* engineOver(runs, plane());
      const plan = compileWorkflow(signed, 'r1', HOST);
      const short = yield* engine.start({ id: 'run-6', workflow: 'review', plan, thread: THREAD, input: { scope: 'a1b2c3d4' } });
      expect(short).toBeInstanceOf(WorkflowArgumentsError);
      expect(short).toMatchObject({ missing: ['lenses'], unknown: [] });
      const wide = yield* engine.start({
        id: 'run-7',
        workflow: 'review',
        plan,
        thread: THREAD,
        input: { scope: 'x', lenses: [], mood: 'brisk' },
      });
      expect(wide).toMatchObject({ missing: [], unknown: ['mood'] });
      expect(yield* runs.find('run-6')).toBeUndefined();
    }),
  );
  it.effect(
    'a pack fans over the list the run was given',
    Effect.fnUntraced(function* () {
      const runs = makeWorkflowRuns();
      const world = plane();
      const engine = yield* engineOver(runs, world);
      yield* engine.start({
        id: 'run-8',
        workflow: 'review',
        plan: compileWorkflow(signed, 'r1', HOST),
        thread: THREAD,
        input: { scope: 'a1b2c3d4', lenses: ['contracts', 'boundaries'] },
      });
      const finished = yield* engine.advance('run-8');
      expect(finished?.status).toBe('completed');
      expect(world.started).toEqual(['readers#0', 'readers#1']);
      expect(world.tasks[0]).toContain('lens: contracts');
      expect(world.tasks[0]).toContain('scope: a1b2c3d4');
      expect(world.tasks[0]).toContain('seat: 0');
      expect(world.tasks[1]).toContain('lens: boundaries');
    }),
  );
  it.effect(
    'a list with nothing in it summons nobody, and the step is done all the same',
    Effect.fnUntraced(function* () {
      const runs = makeWorkflowRuns();
      const world = plane();
      const engine = yield* engineOver(runs, world);
      yield* engine.start({
        id: 'run-9',
        workflow: 'review',
        plan: compileWorkflow(signed, 'r1', HOST),
        thread: THREAD,
        input: { scope: 'a1b2c3d4', lenses: [] },
      });
      const finished = yield* engine.advance('run-9');
      expect(world.started).toEqual([]);
      expect(finished?.status).toBe('completed');
      expect(finished?.records[0]).toMatchObject({ stepId: 'readers', status: 'done', members: [], output: { reports: [] } });
    }),
  );
  it.effect(
    'a fan over something that is not a list fails the step',
    Effect.fnUntraced(function* () {
      const runs = makeWorkflowRuns();
      const engine = yield* engineOver(runs, plane());
      yield* engine.start({
        id: 'run-10',
        workflow: 'review',
        plan: compileWorkflow(signed, 'r1', HOST),
        thread: THREAD,
        input: { scope: 'a1b2c3d4', lenses: 'contracts' },
      });
      expect(yield* engine.advance('run-10')).toMatchObject({
        status: 'failed',
        reason: 'lenses answered string, and a fan is counted from a list',
      });
    }),
  );
});
describe('a fan over what an earlier step answered', () => {
  const fleet: WorkflowDefinition = {
    name: 'review',
    description: 'Readers, an editor, then judges over what they found',
    steps: [
      { kind: 'pack', id: 'readers', agentType: 'reviewer', task: 'Review from your lens', count: 2, completion: { rule: 'all' } },
      { kind: 'transform', id: 'editor', seam: 'collect-findings', from: ['readers'], output: { findings: 'what stands after the merge' } },
      {
        kind: 'pack',
        id: 'judges',
        agentType: 'judge',
        task: 'Try to refute the finding',
        input: { finding: { from: 'member' } },
        count: { from: 'step', stepId: 'editor', field: 'findings', limit: 8 },
        completion: { rule: 'all' },
      },
    ],
    transitions: [
      { from: 'readers', to: 'editor' },
      { from: 'editor', to: 'judges' },
    ],
  };
  it.effect(
    'the judges are as many as the findings, and the transform runs no agent',
    Effect.fnUntraced(function* () {
      const runs = makeWorkflowRuns();
      const world = plane();
      yield* opened(runs, 'run-11', compileWorkflow(fleet, 'r1', HOST));
      const engine = yield* engineOver(runs, world);
      const finished = yield* engine.advance('run-11');
      expect(finished?.status).toBe('completed');
      expect(world.started).toEqual(['readers#0', 'readers#1', 'judges#0', 'judges#1']);
      expect(world.tasks[2]).toContain('finding: thread-readers#0 answered');
      expect(finished?.records.find((record) => record.stepId === 'editor')?.members).toEqual([]);
    }),
  );
  it.effect(
    'a transform whose seam this host does not hold fails the step and the run',
    Effect.fnUntraced(function* () {
      const runs = makeWorkflowRuns();
      const plan = compileWorkflow(fleet, 'r1', HOST);
      const moved = { ...plan, steps: plan.steps.map((step) => (step.id === 'editor' ? { ...step, seam: 'gone' } : step)) };
      yield* opened(runs, 'run-12', moved);
      const engine = yield* engineOver(runs, plane());
      const stalled = yield* engine.advance('run-12');
      expect(stalled?.records.at(-1)).toMatchObject({ stepId: 'editor', status: 'failed' });
      expect(stalled).toMatchObject({ status: 'failed', reason: 'This host holds no seam named gone.' });
    }),
  );
  it.effect(
    'a fold that answers nothing under a field it declares fails where the seam is named',
    Effect.fnUntraced(function* () {
      const runs = makeWorkflowRuns();
      const other: WorkflowDefinition = {
        ...fleet,
        steps: [
          fleet.steps[0]!,
          { kind: 'transform', id: 'editor', seam: 'collect-findings', from: ['readers'], output: { standing: 'what stands' } },
          {
            kind: 'pack',
            id: 'judges',
            agentType: 'judge',
            task: 'Try to refute the finding',
            count: { from: 'step', stepId: 'editor', field: 'standing', limit: 8 },
            completion: { rule: 'all' },
          },
        ],
      };
      yield* opened(runs, 'run-13', compileWorkflow(other, 'r1', HOST));
      const engine = yield* engineOver(runs, plane());
      expect(yield* engine.advance('run-13')).toMatchObject({
        status: 'failed',
        reason: 'collect-findings answered nothing under standing',
      });
    }),
  );
  test('a fan over a step that does not exist refuses at compilation', () => {
    const broken: WorkflowDefinition = {
      ...fleet,
      steps: [
        fleet.steps[0]!,
        fleet.steps[1]!,
        {
          kind: 'pack',
          id: 'judges',
          agentType: 'judge',
          task: 'Try to refute the finding',
          count: { from: 'step', stepId: 'nobody', field: 'findings', limit: 8 },
          completion: { rule: 'all' },
        },
      ],
    };
    expect(() => compileWorkflow(broken, 'r1', HOST)).toThrow('judges fans over nobody, which is not a step');
  });
});
describe('a fork the run chooses', () => {
  const forking: WorkflowDefinition = {
    name: 'review',
    description: 'Judge only what stands',
    steps: [
      { kind: 'pack', id: 'readers', agentType: 'reviewer', task: 'Read', count: 1, completion: { rule: 'all' } },
      { kind: 'transform', id: 'editor', seam: 'collect-findings', from: ['readers'], output: { findings: 'what stands' } },
      { kind: 'agent', id: 'judge', agentType: 'judge', task: 'Refute it' },
      { kind: 'agent', id: 'closer', agentType: 'judge', task: 'Say nothing stands' },
    ],
    transitions: [
      { from: 'readers', to: 'editor' },
      { from: 'editor', to: 'judge', when: 'anything-standing' },
      { from: 'editor', to: 'closer' },
    ],
  };
  it.effect(
    'the branch whose condition holds is the one taken, and the record names it',
    Effect.fnUntraced(function* () {
      const runs = makeWorkflowRuns();
      const world = plane();
      yield* opened(runs, 'run-14', compileWorkflow(forking, 'r1', HOST));
      const engine = yield* engineOver(runs, world);
      const finished = yield* engine.advance('run-14');
      expect(finished?.status).toBe('completed');
      expect(world.started).toEqual(['readers#0', 'judge']);
      expect(finished?.records.find((record) => record.stepId === 'editor')?.next).toBe('judge');
    }),
  );
  it.effect(
    'when nothing holds, the run takes the branch that asks for nothing',
    Effect.fnUntraced(function* () {
      const runs = makeWorkflowRuns();
      const world = plane();
      yield* opened(runs, 'run-15', compileWorkflow(forking, 'r1', HOST));
      const now = yield* Clock.currentTimeMillis;
      const lease = yield* runs.lease('run-15', { owner: 'seed', until: now - 1, now: now - 2 });
      if (!lease) return yield* Effect.die('The seed could not take the run.');
      yield* runs.dispatch('run-15', { stepId: 'readers', attempt: 1, members: ['readers#0'], status: 'dispatched' }, lease);
      yield* runs.settleStep('run-15', { stepId: 'readers', attempt: 1, status: 'done', output: { reports: [] }, next: 'editor' }, lease);
      const engine = yield* engineOver(runs, world);
      const finished = yield* engine.advance('run-15');
      expect(finished?.status).toBe('completed');
      expect(world.started).toEqual(['closer']);
      expect(finished?.records.find((record) => record.stepId === 'editor')?.next).toBe('closer');
    }),
  );
});
describe('a workflow called as a step', () => {
  const inner: WorkflowDefinition = {
    name: 'inner',
    description: 'One judge',
    input: { finding: 'what is judged' },
    steps: [{ kind: 'agent', id: 'judge', agentType: 'judge', task: 'Refute it', input: { finding: { from: 'run', field: 'finding' } } }],
    transitions: [],
  };
  const outer: WorkflowDefinition = {
    name: 'review',
    description: 'Read, then call',
    input: { finding: 'what is judged' },
    steps: [
      { kind: 'pack', id: 'readers', agentType: 'reviewer', task: 'Read', count: 1, completion: { rule: 'all' } },
      { kind: 'call', id: 'called', workflow: 'inner', input: { finding: { from: 'run', field: 'finding' } } },
    ],
    transitions: [{ from: 'readers', to: 'called' }],
  };
  const sources: readonly WorkflowSource[] = [{ floor: 'project', definition: inner, revision: 'r4' }];
  it.effect(
    'the callee runs under the same thread on the revision its name resolves to now',
    Effect.fnUntraced(function* () {
      const runs = makeWorkflowRuns();
      const world = plane();
      const engine = yield* engineOver(runs, world, { sources });
      yield* engine.start({
        id: 'run-16',
        workflow: 'review',
        plan: compileWorkflow(outer, 'r1', HOST),
        thread: THREAD,
        input: { finding: 'the lease is never renewed' },
      });
      const finished = yield* engine.advance('run-16');
      expect(finished?.status).toBe('completed');
      expect(world.started).toEqual(['readers#0', 'judge']);
      expect(world.tasks[1]).toContain('finding: the lease is never renewed');
      expect(yield* runs.find('run-16:called:1')).toMatchObject({ status: 'completed', thread: THREAD, plan: { revision: 'r4' } });
      expect(finished?.records.at(-1)).toMatchObject({ stepId: 'called', status: 'done', callRunId: 'run-16:called:1' });
    }),
  );
  it.effect(
    'a call to a name no floor holds any more fails the step',
    Effect.fnUntraced(function* () {
      const runs = makeWorkflowRuns();
      const engine = yield* engineOver(runs, plane(), { sources: [] });
      yield* engine.start({
        id: 'run-17',
        workflow: 'review',
        plan: compileWorkflow(outer, 'r1', HOST),
        thread: THREAD,
        input: { finding: 'x' },
      });
      expect(yield* engine.advance('run-17')).toMatchObject({ status: 'failed', reason: 'No workflow is saved as inner.' });
    }),
  );
});
