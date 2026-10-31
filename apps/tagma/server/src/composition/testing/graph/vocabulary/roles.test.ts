import { expect, test } from 'bun:test';
import { DEFAULT_CATALOGS, tagsOfCatalogs } from '../../../../catalogs/contract/wire/registry.js';
import type { Role } from '../../../../graph/contract/wire/tags/declaration.js';
import { initialStatus, statusTargets, statusWords, terminalStatuses } from '../../../../graph/contract/wire/tags/roles.js';
import { TagIndex } from '../../../../graph/vocabulary/tagIndex.js';
import { deliveryOf, isEnabled } from '../../../../graph/contract/wire/tags/law.js';
import { VOCABULARY_FORMAT } from '../../../../graph/contract/wire/tags/revision.js';
import { BEHAVIOUR_REGISTRY } from '../../composed.js';
import { LIFECYCLE } from '../../../../graph/contract/wire/tags/lifecycle.js';
import { WORK } from '../../../../graph/contract/wire/tags/work.js';
import type { ContractId } from '../../../../graph/contract/wire/tags/behaviour.js';
import { HOLDER } from '../../../../graph/contract/wire/tags/holder.js';
import { SPEC } from '../../../../graph/contract/wire/tags/spec.js';
import { CONTAINER } from '../../../../graph/contract/wire/tags/container.js';
import { ENFORCED, LAW } from '../../../../graph/contract/wire/tags/lawContracts.js';
import { LEAF } from '../../../../graph/contract/wire/tags/leaf.js';
import { OBSERVATION } from '../../../../graph/contract/wire/tags/observation.js';

const shipped = new TagIndex(tagsOfCatalogs(DEFAULT_CATALOGS), BEHAVIOUR_REGISTRY);

const CONTRACT_OF_ROLE: Record<Role, ContractId> = {
  status: LIFECYCLE,
  holder: HOLDER,
  work: WORK,
  spec: SPEC,
  container: CONTAINER,
  law: LAW,
  leaf: LEAF,
  observation: OBSERVATION,
  enforcement: ENFORCED,
  delivery: LAW,
};

test('every shipped role is answered by its contract over exactly the types that bound the role', () => {
  for (const [role, contract] of Object.entries(CONTRACT_OF_ROLE)) {
    const bound = shipped.tags.filter((tag) => tag.roles[role as Role] !== undefined).map((tag) => tag.id);
    expect([...shipped.typesSupporting(contract)].sort()).toEqual(bound.sort());
  }
  expect(shipped.supports({ tags: ['invoice'] }, WORK)).toBe(false);
});

test('a status field says what the lifecycle verbs say', () => {
  for (const id of shipped.declaredTags()) {
    const tag = shipped.tagById(id);
    if (tag === null) throw new Error(`${id} is listed and does not resolve`);
    const words = statusWords(tag);
    expect(words.length > 0).toBe(shipped.supports({ tags: [id] }, LIFECYCLE));
    if (words.length === 0) continue;
    const born = initialStatus(tag);
    expect(born).not.toBeNull();
    expect(words).toContain(born as string);
    expect(terminalStatuses(tag)).not.toContain(born as string);
    const moved = shipped.actionsOf(id).moves.map((move) => move.to);
    for (const word of terminalStatuses(tag)) expect(moved).toContain(word);
  }
});

test('a field is read through the role its tag binds, never off a name', () => {
  const held = { tags: ['task'], fields: { status: 'in_work', holder: 7 } };
  expect(shipped.statusOf(held)).toBe('in_work');
  expect(shipped.holderOf(held)).toBe(7);
  expect(shipped.isTerminal(held)).toBe(false);

  const decision = { tags: ['spec'], fields: { status: 'open', holder: 7 } };
  expect(shipped.statusOf(decision)).toBe('open');
  expect(shipped.holderOf(decision)).toBeNull();
  expect(shipped.isTerminal({ tags: ['spec'], fields: { status: 'closed' } })).toBe(true);
});

const enabled = (node: { tags: string[]; fields: Record<string, unknown> }) => isEnabled(shipped.lawProjection(node), node);

test('a law is in force unless its own switch says otherwise', () => {
  expect(enabled({ tags: ['rule'], fields: {} })).toBe(true);
  expect(enabled({ tags: ['rule'], fields: { enabled: false } })).toBe(false);
  expect(enabled({ tags: ['idea'], fields: {} })).toBe(false);
});

test('a rule is delivered by its own delivery field, and left unset by whether it has sources', () => {
  const delivered = (fields: Record<string, unknown>, sourced: boolean) => {
    const node = { tags: ['rule'], fields };
    return deliveryOf(shipped.lawProjection(node), node, sourced);
  };
  expect([delivered({}, false), delivered({}, true)]).toEqual(['prompt', 'code']);
  expect([delivered({ delivery: 'prompt' }, true), delivered({ delivery: 'code' }, false)]).toEqual(['prompt', 'code']);
});

test('a role reads the same off the projected spelling as off the typed value', () => {
  expect(enabled({ tags: ['rule'], fields: { enabled: 'false' } })).toBe(false);
  expect(enabled({ tags: ['rule'], fields: { enabled: 'true' } })).toBe(true);
  expect(shipped.holderOf({ tags: ['task'], fields: { status: 'in_work', holder: '7' } })).toBe(7);
  expect(shipped.holderOf({ tags: ['task'], fields: { holder: 'seven' } })).toBeNull();
});

test('a status moves only where its own tag declares a move', () => {
  const task = shipped.tagById('task');
  if (task === null) throw new Error('#task is not declared');
  expect(statusTargets(task, 'open')).toEqual(['in_work', 'done', 'closed']);
  expect(statusTargets(task, 'done')).toEqual(['open']);
});

test('one tag id means what the table it was read from says it means', () => {
  const ticket = new TagIndex(
    [
      {
        id: 'ticket',
        fields: { state: { type: 'enum', values: ['filed', 'shipped', 'dropped'] }, owner: 'session' },
        edges: [],
        gates: [
          { gate: 'transition', field: 'state', from: 'filed', to: 'shipped' },
          { gate: 'transition', field: 'state', from: 'filed', to: 'dropped' },
        ],
        roles: {
          status: { field: 'state', initial: 'filed', done: 'shipped', closed: 'dropped' },
          holder: 'owner',
          work: true,
        },
        body: { shape: 'content' },
        prompt: '',
      },
    ],
    BEHAVIOUR_REGISTRY,
  );
  const row = { tags: ['ticket'], fields: { state: 'filed', owner: 3 } };
  expect(ticket.statusOf(row)).toBe('filed');
  expect(ticket.holderOf(row)).toBe(3);
  expect([...ticket.typesSupporting(WORK)]).toEqual(['ticket']);
  expect(ticket.wordsAt(WORK, 'initial')).toEqual([{ tag: 'ticket', name: 'state', words: ['filed'] }]);
  expect(shipped.statusOf(row)).toBeNull();
  expect(shipped.supports(row, WORK)).toBe(false);
  expect(ticket.tagById('tag')).not.toBeNull();
  expect(shipped.tagById('tag')).not.toBeNull();
});

test('the law projection answers the nodes the law role answers, with the switch and the document it reads', () => {
  const declared = tagsOfCatalogs(DEFAULT_CATALOGS);
  const lawOnly = new TagIndex(
    declared.map((tag) => (tag.id === 'rule' ? { ...tag, roles: { law: 'enabled' } } : tag)),
    BEHAVIOUR_REGISTRY,
  );
  const tables = [shipped, lawOnly];
  for (const table of tables) {
    expect([...table.lawBearingTypes()]).toEqual([...table.typesSupporting(LAW)]);
    for (const tag of declared) {
      const node = { tags: ['note', tag.id], fields: { enabled: false } };
      expect(table.lawProjection(node)?.type ?? null).toBe(table.bindingTag(node, LAW)?.id ?? null);
    }
  }
  expect(shipped.lawProjectionOf('rule')).toEqual({
    type: 'rule',
    enabled: { field: 'enabled', schema: 'boolean' },
    delivery: { field: 'delivery', schema: 'enum' },
    enforcement: { field: 'enforcement', schema: 'lawEnforcement' },
  });
  expect(lawOnly.lawProjectionOf('rule')?.enforcement).toBeNull();
  expect(shipped.lawProjectionOf('idea')).toBeNull();
});

test('a vocabulary revision is stable while the declarations stand, moves when one changes, and ignores prompt prose', () => {
  const declared = tagsOfCatalogs(DEFAULT_CATALOGS);
  const revision = shipped.revision();
  expect(revision.format).toBe(VOCABULARY_FORMAT);
  expect(new TagIndex([...declared].reverse(), BEHAVIOUR_REGISTRY).revision()).toEqual(revision);
  const gated = declared.map((tag) =>
    tag.id === 'rule' ? { ...tag, gates: [...tag.gates, { gate: 'required' as const, field: 'enabled' }] } : tag,
  );
  expect(new TagIndex(gated, BEHAVIOUR_REGISTRY).revision().revision).not.toBe(revision.revision);
  const reworded = declared.map((tag) => (tag.id === 'rule' ? { ...tag, prompt: `${tag.prompt} Reworded.` } : tag));
  expect(new TagIndex(reworded, BEHAVIOUR_REGISTRY).revision()).toEqual(revision);
});
