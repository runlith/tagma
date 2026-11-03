import { expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { CATALOG_IDS, tagsOfCatalogs } from '../../../../catalogs/contract/wire/registry.js';
import {
  CATALOG_DECLARATION,
  type Declaration,
  sectioned,
  type Tag,
  TAG_DECLARATION,
} from '../../../../graph/contract/wire/tags/declaration.js';
import { type Candidate, sameSchema } from '../../../../graph/vocabulary/compiler.js';
import { SECTION_JOIN } from '../../../../graph/contract/wire/tags/sections.js';
import { TagIndex } from '../../../../graph/vocabulary/tagIndex.js';
import { BEHAVIOUR_REGISTRY } from '../../composed.js';
import { WORK } from '../../../../graph/contract/wire/tags/work.js';

const indexed = (declared: readonly (Declaration | Candidate)[]) => new TagIndex(declared, BEHAVIOUR_REGISTRY);
const withoutContracts = ({ contracts: _, ...tag }: Tag) => tag;

const shipped = tagsOfCatalogs(['core', 'software-development']);

function shippedTag(id: string): Tag {
  const tag = shipped.find((candidate) => candidate.id === id);
  if (tag === undefined) throw new Error(`no shipped catalog declares #${id}`);
  return tag;
}

const task = shippedTag('task');

const bug: Declaration = {
  id: 'bug',
  extends: 'task',
  fields: { severity: { type: 'enum', values: ['low', 'high'] } },
  gates: [{ gate: 'required', field: 'severity' }],
  prompt: 'A #bug is a defect somebody reproduced.',
};

const refusalOf = (declared: readonly Declaration[], id: string): string | undefined =>
  indexed(declared).unreadable.find((entry) => entry.id === id)?.reason;

test('a declaration that extends nothing compiles to itself, so every shipped vocabulary answers as it is declared', () => {
  for (const id of CATALOG_IDS) {
    const declared = tagsOfCatalogs([id]);
    const table = indexed(declared);
    expect(table.unreadable).toEqual([]);
    expect(table.tags.map(withoutContracts)).toEqual([TAG_DECLARATION, CATALOG_DECLARATION, ...declared].map(withoutContracts));
  }
});

test('a subtype carries every part its ancestors declare, adds its own, and the roles read it as their own', () => {
  const regression: Declaration = { id: 'regression', extends: 'bug', prompt: '' };
  const table = indexed([...shipped, regression, bug]);
  expect(table.unreadable).toEqual([]);
  const compiled = table.tagById('bug');
  expect(compiled?.extends).toBe('task');
  expect(compiled?.fields).toEqual({ ...task.fields, severity: { type: 'enum', values: ['low', 'high'] } });
  expect(compiled?.gates).toEqual([...task.gates, { gate: 'required', field: 'severity' }]);
  expect(compiled?.roles).toEqual(task.roles);
  expect(compiled?.edges).toEqual(task.edges);
  expect(compiled?.body).toEqual(task.body);
  expect(compiled?.sections).toEqual([...(task.sections ?? []), { key: 'bug', text: bug.prompt }]);
  expect(compiled?.prompt).toBe(`${task.prompt}${SECTION_JOIN}${bug.prompt}`);
  expect(table.provenanceOf('bug')?.sections).toEqual([...(task.sections ?? []).map(() => ({ type: 'task' })), { type: 'bug' }]);
  expect(table.provenanceOf('bug')?.fields.severity).toBe('bug');
  expect(table.provenanceOf('bug')?.fields.status).toBe('task');
  expect(table.tagById('regression')?.prompt).toBe(compiled?.prompt);
  expect(table.tagById('regression')?.gates).toEqual(compiled?.gates);
  expect([...table.typesSupporting(WORK)]).toEqual(['task', 'regression', 'bug']);
  expect(table.holderOf({ tags: ['regression'], fields: { status: 'in_work', holder: 4 } })).toBe(4);
  expect(table.descendantsOf('task')).toEqual(['bug', 'regression']);
  expect(table.lawProjectionOf('bug')).toBeNull();
});

test('a subtype of a law-bearing type binds the same law projection under its own id', () => {
  const rule = shippedTag('rule');
  const table = indexed([...shipped, { id: 'standard', extends: 'rule', prompt: '' }]);
  const law = table.lawProjectionOf('rule');
  if (law === null) throw new Error('#rule binds no law');
  expect(table.lawProjectionOf('standard')).toEqual({ ...law, type: 'standard' });
  expect(table.lawBearingTypes()).toEqual([rule.id, 'standard']);
});

test('a lifecycle is restated whole or not at all, and the refusal names the type that owns it', () => {
  const machine = task.gates.filter((gate) => gate.gate === 'transition');
  const reopening: Declaration = {
    id: 'chore',
    extends: 'task',
    gates: [...machine, { gate: 'transition', field: 'status', from: 'done', to: 'in_work' }],
    prompt: '',
  };
  expect(refusalOf([...shipped, reopening], 'chore')).toContain('#task');
  expect(refusalOf([...shipped, { id: 'chore', extends: 'task', gates: machine.slice(1), prompt: '' }], 'chore')).toContain('#task');
  expect(
    indexed([...shipped, { id: 'chore', extends: 'task', gates: [...machine].reverse(), prompt: '' }]).tagById('chore')?.gates,
  ).toEqual(task.gates);
});

test('a single-valued state keeps one binding owner along the chain', () => {
  const rebound: Declaration = {
    id: 'chore',
    extends: 'task',
    fields: { state: { type: 'enum', values: ['open', 'done', 'closed'] } },
    roles: { status: { field: 'state', initial: 'open', done: 'done', closed: 'closed' } },
    prompt: '',
  };
  expect(refusalOf([...shipped, rebound], 'chore')).toContain('#task');
  const reheld: Declaration = { id: 'chore', extends: 'task', fields: { assignee: 'string' }, roles: { holder: 'assignee' }, prompt: '' };
  expect(refusalOf([...shipped, reheld], 'chore')).toContain('#task');
  expect(
    indexed([...shipped, { id: 'chore', extends: 'task', roles: { status: task.roles.status }, prompt: '' }]).tagById('chore')?.roles,
  ).toEqual(task.roles);
});

test('edges and sources widen only where the base declared the slot open, and a descendant cannot reopen a closed slot', () => {
  const claim = shippedTag('idea');
  const waiting: Declaration = { id: 'finding', extends: 'idea', edges: ['reviews'], prompt: '' };
  expect(refusalOf([...shipped, waiting], 'finding')).toContain('#idea');
  const opened = shipped.map((tag) => (tag.id === 'idea' ? { ...tag, open: ['edges' as const] } : tag));
  expect(indexed([...opened, waiting]).tagById('finding')?.edges).toEqual([...claim.edges, 'reviews']);
  expect(refusalOf([...shipped, { id: 'finding', extends: 'idea', open: ['sources'], prompt: '' }], 'finding')).toContain('#idea');
  const restating = indexed([
    ...opened,
    { id: 'finding', extends: 'idea', open: ['edges'], prompt: '' },
    { id: 'lead', extends: 'finding', edges: ['reviews'], prompt: '' },
  ]);
  expect(restating.tagById('lead')?.edges).toEqual([...claim.edges, 'reviews']);
  const closing = indexed([
    ...opened,
    { id: 'finding', extends: 'idea', open: [], prompt: '' },
    { id: 'lead', extends: 'finding', open: [], edges: ['reviews'], prompt: '' },
  ]);
  expect(closing.unreadable.find((entry) => entry.id === 'lead')?.reason).toContain('#finding');
  const unchanged = indexed([
    ...shipped,
    { id: 'finding', extends: 'idea', open: [], prompt: '' },
    { id: 'lead', extends: 'finding', edges: ['reviews'], prompt: '' },
  ]);
  expect(unchanged.unreadable.find((entry) => entry.id === 'lead')?.reason).toContain('#idea');
});

it.effect('a subtype whose composition is incoherent is sent to the type that declares the inherited part', () => {
  const memo: Declaration = {
    id: 'memo',
    fields: { state: { type: 'enum', values: ['open', 'done', 'dropped'] } },
    roles: { status: { field: 'state', initial: 'open', done: 'done' } },
    gates: [
      { gate: 'transition', field: 'state', from: 'open', to: 'done' },
      { gate: 'transition', field: 'state', from: 'open', to: 'dropped' },
    ],
    prompt: '',
  };
  const table = indexed([memo]);
  expect(table.unreadable).toEqual([]);
  return table.redeclare({ id: 'job', extends: 'memo', roles: { work: true }, prompt: '' }, null).pipe(
    Effect.flip,
    Effect.map((refused) => {
      expect(refused.code).toBe('tag-incoherent');
      expect(refused.unblock.join(' ')).toContain('#memo');
    }),
  );
});

test('a body keeps the shape its base gives it, and the tightest cap along the chain binds', () => {
  expect(refusalOf([...shipped, { id: 'note2', extends: 'area', body: { shape: 'content' }, prompt: '' }], 'note2')).toContain('#area');
  const capped = indexed([
    ...shipped,
    { id: 'note2', extends: 'idea', body: { shape: 'content', cap: 400 }, prompt: '' },
    { id: 'note3', extends: 'note2', body: { shape: 'content', cap: 900 }, prompt: '' },
  ]);
  expect(capped.tagById('note3')?.body).toEqual({ shape: 'content', cap: 400 });
});

test('a type whose parent is undeclared, unreadable or itself stands unreadable, and so do its descendants', () => {
  const table = indexed([
    ...shipped,
    { id: 'orphan', extends: 'nowhere', prompt: '' },
    { id: 'first', extends: 'second', prompt: '' },
    { id: 'second', extends: 'first', prompt: '' },
    { id: 'heir', extends: 'orphan', prompt: '' },
    { id: 'tagged', extends: 'tag', prompt: '' },
  ]);
  expect(table.unreadable.map((entry) => entry.id)).toEqual(['orphan', 'first', 'second', 'heir', 'tagged']);
  for (const id of ['orphan', 'first', 'second', 'heir', 'tagged']) expect(table.tagById(id)).toBeNull();
});

test('sections are inherited whole: a subtype adds its own after its ancestors, the prompt derives from them, and only the installer names a layered origin', () => {
  const contract: Declaration = {
    id: 'charter',
    sections: [
      { key: 'contract', text: 'What every charter answers.' },
      { key: 'project-context', text: '', edits: ['append'] },
    ],
    prompt: 'an authored body that the sections replace',
  };
  const local: Declaration = { id: 'bylaw', extends: 'charter', sections: [{ key: 'contract', text: 'What a bylaw adds.' }], prompt: '' };
  const table = indexed([
    { name: '#charter', declaration: contract, unread: null, layered: { 'project-context': { edit: 'append', over: 'base' } } },
    local,
  ]);
  expect(table.unreadable).toEqual([]);
  expect(table.tagById('charter')?.prompt).toBe('What every charter answers.');
  expect(table.tagById('bylaw')?.sections).toEqual([...(contract.sections ?? []), { key: 'contract', text: 'What a bylaw adds.' }]);
  expect(table.tagById('bylaw')?.prompt).toBe(`What every charter answers.${SECTION_JOIN}What a bylaw adds.`);
  expect(table.provenanceOf('bylaw')?.sections).toEqual([
    { type: 'charter' },
    { type: 'charter', origin: { edit: 'append', over: 'base' } },
    { type: 'bylaw' },
  ]);
  expect(indexed([contract]).revision()).toEqual(indexed([{ ...contract, sections: [{ key: 'contract', text: 'Reworded.' }] }]).revision());
  expect(
    refusalOf(
      [
        {
          id: 'twice',
          sections: [
            { key: 'a', text: 'one' },
            { key: 'a', text: 'two' },
          ],
          prompt: '',
        },
      ],
      'twice',
    ),
  ).toContain('"a"');
});

it.effect(
  'a redeclaration answers every type it reaches, refuses one that would break a descendant, and a reworded prompt reaches the descendants as text alone',
  () =>
    Effect.gen(function* () {
      const table = indexed([...shipped, bug]);
      const standing = { id: 'task', name: '#task' };
      const gated = {
        ...task,
        fields: { ...task.fields, estimate: 'number' as const },
        gates: [...task.gates, { gate: 'required' as const, field: 'estimate' }],
      };
      const changes = yield* table.redeclare(gated, standing);
      expect(changes.map((change) => change.type)).toEqual(['task', 'bug']);
      expect(changes[1]?.now.gates).toContainEqual({ gate: 'required', field: 'estimate' });
      expect(changes[1]?.now.fields.estimate).toBe('number');

      const clashing = { ...task, fields: { ...task.fields, severity: 'string' as const } };
      const refused = yield* table.redeclare(clashing, standing).pipe(Effect.flip);
      expect(refused.code).toBe('tag-incoherent');
      expect(refused.reason).toContain('#bug');

      const renamed = yield* table.redeclare({ ...task, id: 'job' }, standing).pipe(Effect.flip);
      expect(renamed.reason).toContain('#bug');

      const reworded = yield* table.redeclare(sectioned({ ...task, prompt: 'Reworded.' }), standing);
      expect(reworded.map((change) => change.type)).toEqual(['task', 'bug']);
      expect(reworded.every(({ was, now }) => was !== null && sameSchema(was, now))).toBe(true);
      expect(reworded[1]?.now.prompt).toBe(`Reworded.${SECTION_JOIN}${bug.prompt}`);

      const cycle = yield* table.redeclare({ ...task, extends: 'bug' }, standing).pipe(Effect.flip);
      expect(cycle.reason).toContain('#bug');
    }),
);
