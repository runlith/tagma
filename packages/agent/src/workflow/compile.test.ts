import { describe, expect, test } from 'bun:test';
import { WorkflowAuthor } from './author';
import { compileWorkflow, parseWorkflowDefinition, type WorkflowVocabulary } from './compile';
import type { WorkflowDefinition } from './definition';
import { WorkflowCompileError } from './plan';
import { WorkflowLibrary, WorkflowUnknownError, type WorkflowSource } from './library';

const HOST: WorkflowVocabulary = {
  seams: new Set(['collect-findings']),
  conditions: new Set(['anything-standing']),
  workflows: new Set(['review', 'audit']),
};

const declared: WorkflowDefinition = {
  name: 'review',
  description: 'Read a change from three angles, then decide',
  input: { scope: 'What is reviewed' },
  steps: [
    {
      kind: 'pack',
      id: 'readers',
      agentType: 'reviewer',
      task: 'Review the change from your lens',
      count: 3,
      completion: { rule: 'all' },
    },
    { kind: 'agent', id: 'judge', agentType: 'judge', task: 'Decide from what the readers found' },
  ],
  transitions: [{ from: 'readers', to: 'judge' }],
};

describe('compileWorkflow', () => {
  test('a plan pins the steps, the transitions, the signature and where the run begins', () => {
    const plan = compileWorkflow(declared, 'r1', HOST);

    expect(plan.entry).toBe('readers');
    expect(plan.revision).toBe('r1');
    expect(plan.input).toEqual({ scope: 'What is reviewed' });
    expect(plan.steps.map((step) => step.id)).toEqual(['readers', 'judge']);
  });

  test('the builder emits the same plan as the data written by hand', () => {
    const authored = new WorkflowAuthor('review', 'Read a change from three angles, then decide', {
      scope: 'What is reviewed',
    })
      .step(declared.steps[0]!)
      .step(declared.steps[1]!)
      .then('readers', 'judge')
      .compile('r1', HOST);

    expect(authored).toEqual(compileWorkflow(declared, 'r1', HOST));
  });

  test('a transition to a step that does not exist refuses at compilation', () => {
    const broken = { ...declared, transitions: [{ from: 'readers', to: 'nobody' }] };

    expect(() => compileWorkflow(broken, 'r1', HOST)).toThrow(WorkflowCompileError);
  });

  test('a pack that waits for more members than it has never runs, and says so', () => {
    const broken: WorkflowDefinition = {
      ...declared,
      steps: [{ ...declared.steps[0]!, completion: { rule: 'at-least', atLeast: 9 } } as never, declared.steps[1]!],
    };

    expect(() => compileWorkflow(broken, 'r1', HOST)).toThrow('waits for 9 of 3 members');
  });

  test('a step nothing reaches is a mistake in the writing, not a shape the engine carries', () => {
    const orphan: WorkflowDefinition = {
      ...declared,
      steps: [...declared.steps, { kind: 'agent', id: 'stray', agentType: 'judge', task: 'Nothing points here' }],
    };

    expect(() => compileWorkflow(orphan, 'r1', HOST)).toThrow('stray is never reached');
  });

  test('a definition from a file is parsed at the door, and a broken one never becomes a plan', () => {
    expect(parseWorkflowDefinition(declared)).toEqual(declared);
    expect(() => parseWorkflowDefinition({ name: 'x', description: '', steps: [], transitions: [] })).toThrow(WorkflowCompileError);
  });
});

describe('the names a definition leaves through', () => {
  const folded: WorkflowDefinition = {
    ...declared,
    steps: [
      declared.steps[0]!,
      { kind: 'transform', id: 'editor', seam: 'collect-findings', from: ['readers'], output: { findings: 'each one' } },
    ],
    transitions: [{ from: 'readers', to: 'editor' }],
  };

  test('a fold through a seam this host does not hold refuses at compilation', () => {
    const unheld = { ...folded, steps: [folded.steps[0]!, { ...folded.steps[1]!, seam: 'merge-proposals' } as never] };

    expect(() => compileWorkflow(unheld, 'r1', HOST)).toThrow('folds through merge-proposals, which this host does not hold');
  });

  test('a choice on a condition this host does not hold refuses at compilation', () => {
    const unheld = { ...folded, transitions: [{ from: 'readers', to: 'editor', when: 'anything-at-all' }] };

    expect(() => compileWorkflow(unheld, 'r1', HOST)).toThrow('chooses on anything-at-all, which this host does not hold');
  });

  test('a call to a workflow no floor holds refuses at compilation', () => {
    const calls: WorkflowDefinition = {
      ...declared,
      steps: [declared.steps[0]!, { kind: 'call', id: 'judge', workflow: 'inspect' }],
    };

    expect(() => compileWorkflow(calls, 'r1', HOST)).toThrow('judge calls inspect, which no floor holds');
  });
});

describe('what a step binds', () => {
  const bound = (input: Record<string, unknown>): WorkflowDefinition => ({
    ...declared,
    steps: [{ ...declared.steps[0]!, input } as never, declared.steps[1]!],
  });

  test('a value taken from the run must be a field the signature declares', () => {
    expect(() => compileWorkflow(bound({ lens: { from: 'run', field: 'lenses' } }), 'r1', HOST)).toThrow(
      'takes lens from lenses, which the signature does not declare',
    );
  });

  test('a member and an index belong to a pack that fans over a list', () => {
    expect(() => compileWorkflow(bound({ lens: { from: 'member' } }), 'r1', HOST)).toThrow(
      'readers takes lens from a pack member, and readers fans over no list',
    );
  });

  test('only a transform declares what it answers, and the field has to be one of them', () => {
    const chain: WorkflowDefinition = {
      ...declared,
      steps: [
        declared.steps[0]!,
        { kind: 'transform', id: 'editor', seam: 'collect-findings', from: ['readers'], output: { findings: 'each' } },
        { ...declared.steps[1]!, input: { held: { from: 'step', stepId: 'editor', field: 'standing' } } } as never,
      ],
      transitions: [
        { from: 'readers', to: 'editor' },
        { from: 'editor', to: 'judge' },
      ],
    };

    expect(() => compileWorkflow(chain, 'r1', HOST)).toThrow('editor.standing, which editor does not answer');
  });

  test('a fan reads a list from a step a run cannot reach it without running', () => {
    const forked: WorkflowDefinition = {
      ...declared,
      steps: [
        declared.steps[0]!,
        { kind: 'transform', id: 'editor', seam: 'collect-findings', from: ['readers'], output: { findings: 'each' } },
        {
          kind: 'pack',
          id: 'judges',
          agentType: 'judge',
          task: 'Refute it',
          count: { from: 'step', stepId: 'editor', field: 'findings', limit: 8 },
          completion: { rule: 'all' },
        },
      ],
      transitions: [
        { from: 'readers', to: 'editor', when: 'anything-standing' },
        { from: 'readers', to: 'judges' },
      ],
    };

    expect(() => compileWorkflow(forked, 'r1', HOST)).toThrow('which a run can reach judges without running');
  });
});

describe('loops', () => {
  const looping = (when: string | undefined): WorkflowDefinition => ({
    ...declared,
    steps: [{ kind: 'agent', id: 'open', agentType: 'reviewer', task: 'Begin' }, ...declared.steps],
    transitions: [
      { from: 'open', to: 'readers' },
      { from: 'readers', to: 'judge' },
      when === undefined ? { from: 'judge', to: 'readers' } : { from: 'judge', to: 'readers', when },
    ],
  });

  test('a back edge that decides compiles', () => {
    expect(compileWorkflow(looping('anything-standing'), 'r1', HOST).entry).toBe('open');
  });

  test('a back edge on no condition refuses: the run would never end', () => {
    expect(() => compileWorkflow(looping(undefined), 'r1', HOST)).toThrow('a loop nothing leaves never ends');
  });
});

describe('WorkflowLibrary', () => {
  const held = { seams: ['collect-findings'], conditions: ['anything-standing'] };
  const sourced = (sources: readonly WorkflowSource[]) => new WorkflowLibrary(sources, held);

  test('a project`s workflow shadows the person`s of the same name', () => {
    const library = sourced([
      { floor: 'user', definition: { ...declared, description: 'mine' }, revision: 'r7' },
      { floor: 'project', definition: { ...declared, description: 'ours' }, revision: 'r2' },
    ]);

    const resolved = library.resolve('review');
    if (resolved instanceof WorkflowUnknownError) throw new Error('The workflow did not resolve.');
    expect(resolved.floor).toBe('project');
    expect(resolved.revision).toBe('r2');
    expect(resolved.plan.description).toBe('ours');
  });

  test('a file a floor could not read is listed as rejected beside the workflows that resolved', () => {
    const library = new WorkflowLibrary([{ floor: 'project', definition: declared, revision: 'r1' }], held, [
      { floor: 'user', path: '/home/me/.tagma/workflows/notes.json', reason: 'unreadable' },
    ]);

    const catalog = library.list();
    expect(catalog.resolved.map((row) => row.name)).toEqual(['review']);
    expect(catalog.rejected).toEqual([{ name: '/home/me/.tagma/workflows/notes.json', floor: 'user', reason: 'unreadable' }]);
  });

  test('a name no floor holds is a refusal the caller reads', () => {
    const library = sourced([]);

    expect(library.resolve('nobody')).toBeInstanceOf(WorkflowUnknownError);
    expect(library.list().resolved).toEqual([]);
  });

  test('a definition that does not compile is rejected by name, and the rest still resolve', () => {
    const library = sourced([
      { floor: 'project', definition: declared, revision: 'r1' },
      {
        floor: 'project',
        definition: { ...declared, name: 'broken', transitions: [{ from: 'nobody', to: 'judge' }] },
        revision: 'r1',
      },
    ]);

    const catalog = library.list();
    expect(catalog.resolved.map((entry) => entry.name)).toEqual(['review']);
    expect(catalog.rejected.map((entry) => entry.name)).toEqual(['broken']);
    expect(library.resolve('review')).not.toBeInstanceOf(WorkflowUnknownError);
  });

  test('a call to a name a floor holds compiles, and one nobody holds is rejected by name', () => {
    const library = sourced([
      { floor: 'project', definition: declared, revision: 'r1' },
      {
        floor: 'project',
        definition: {
          ...declared,
          name: 'audit',
          steps: [declared.steps[0]!, { kind: 'call', id: 'judge', workflow: 'review' }],
        },
        revision: 'r1',
      },
      {
        floor: 'project',
        definition: {
          ...declared,
          name: 'stray',
          steps: [declared.steps[0]!, { kind: 'call', id: 'judge', workflow: 'nobody' }],
        },
        revision: 'r1',
      },
    ]);

    const catalog = library.list();
    expect(catalog.resolved.map((entry) => entry.name).sort()).toEqual(['audit', 'review']);
    expect(catalog.rejected.map((entry) => entry.name)).toEqual(['stray']);
  });
});
