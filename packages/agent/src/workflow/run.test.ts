import { describe, expect, test } from 'bun:test';
import { compileWorkflow, type WorkflowVocabulary } from './compile';
import type { WorkflowDefinition } from './definition';
import { amendmentProblems, workflowNext, type WorkflowRun, type WorkflowStepRecord } from './run';

const HOST: WorkflowVocabulary = { seams: new Set(), conditions: new Set(['again']), workflows: new Set() };

const definition: WorkflowDefinition = {
  name: 'review',
  description: 'Readers, then a judge',
  steps: [
    { kind: 'agent', id: 'readers', agentType: 'reviewer', task: 'Read' },
    { kind: 'agent', id: 'judge', agentType: 'judge', task: 'Decide' },
  ],
  transitions: [{ from: 'readers', to: 'judge' }],
};

function runWith(records: readonly WorkflowStepRecord[], revision = 'r1'): WorkflowRun {
  return {
    id: 'run',
    workflow: 'review',
    thread: 'thread-1',
    plan: compileWorkflow(definition, revision, HOST),
    input: {},
    status: 'running',
    lease: null,
    records,
    reason: null,
  };
}

const dispatched: WorkflowStepRecord = {
  stepId: 'readers',
  attempt: 1,
  members: ['readers'],
  status: 'dispatched',
};

describe('workflowNext', () => {
  test('an empty ledger begins at the entry the plan names', () => {
    expect(workflowNext(runWith([]))).toEqual({ kind: 'start', stepId: 'readers', attempt: 1 });
  });

  test('a dispatched record is resumed, never stepped over and never re-attempted', () => {
    expect(workflowNext(runWith([dispatched]))).toEqual({ kind: 'resume', record: dispatched });
  });

  test('a step that ended badly ends the run, whichever way it ended', () => {
    for (const status of ['failed', 'exhausted'] as const) {
      const record = { ...dispatched, status };
      expect(workflowNext(runWith([record]))).toEqual({ kind: 'failed', record });
    }
  });

  test('a finished step opens the one it chose to go to', () => {
    expect(workflowNext(runWith([{ ...dispatched, status: 'done', next: 'judge' }]))).toEqual({
      kind: 'start',
      stepId: 'judge',
      attempt: 1,
    });
  });

  test('a finished step that chose nowhere completes the run', () => {
    expect(workflowNext(runWith([{ ...dispatched, status: 'done', next: null }]))).toEqual({ kind: 'completed' });
  });

  test('a step the run comes back to opens its next attempt', () => {
    const looped = runWith([
      { ...dispatched, status: 'done', next: 'judge' },
      { stepId: 'judge', attempt: 1, members: ['judge'], status: 'done', next: 'readers' },
    ]);

    expect(workflowNext(looped)).toEqual({ kind: 'start', stepId: 'readers', attempt: 2 });
  });
});

describe('amendmentProblems', () => {
  test('the unexecuted suffix may change under a revision that advances', () => {
    const widened = compileWorkflow(
      { ...definition, steps: [definition.steps[0]!, { kind: 'agent', id: 'judge', agentType: 'judge', task: 'Say why' }] },
      'r2',
      HOST,
    );

    expect(amendmentProblems(runWith([dispatched]), widened)).toEqual([]);
  });

  test('an amendment that keeps its revision is refused: the revision is the swap`s token', () => {
    expect(amendmentProblems(runWith([]), compileWorkflow({ ...definition, description: 'Other' }, 'r1', HOST))).toEqual([
      'an amendment must carry a revision other than r1',
    ]);
  });

  test('a step the ledger has begun may be neither rewritten nor removed', () => {
    const rewritten = compileWorkflow(
      { ...definition, steps: [{ kind: 'agent', id: 'readers', agentType: 'reviewer', task: 'Read twice' }, definition.steps[1]!] },
      'r2',
      HOST,
    );

    expect(amendmentProblems(runWith([dispatched]), rewritten)).toEqual(['readers has already run and the amendment rewrites it']);
  });
});
