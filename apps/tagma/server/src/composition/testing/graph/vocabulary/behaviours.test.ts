import { expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Result } from 'effect';
import { assertComposable } from '../../../../graph/vocabulary/declarationRules.js';
import { CATALOG_IDS, tagsOfCatalogs } from '../../../../catalogs/contract/wire/registry.js';
import { SPEC } from '../../../../graph/contract/wire/tags/spec.js';
import { LEAF } from '../../../../graph/contract/wire/tags/leaf.js';
import { LIFECYCLE } from '../../../../graph/contract/wire/tags/lifecycle.js';
import { OBSERVATION } from '../../../../graph/contract/wire/tags/observation.js';
import { REFLECTION } from '../../../../graph/contract/wire/tags/reflection.js';
import { SELECTION } from '../../../../graph/contract/wire/tags/selection.js';
import { TagIndex } from '../../../../graph/vocabulary/tagIndex.js';
import { BEHAVIOUR_REGISTRY } from '../../composed.js';
import type { Behaviour } from '../../../../graph/contract/service/behaviours.js';
import type { ContractBindings } from '../../../../graph/contract/wire/tags/behaviour.js';
import type { Declaration, Gate, TagFields } from '../../../../graph/contract/wire/tags/declaration.js';
import { WORK } from '../../../../graph/contract/wire/tags/work.js';
import { BehaviourInvalid, bindContracts, registerBehaviours } from '../../../../graph/vocabulary/behaviours.js';

const lifecycle: Behaviour = {
  id: 'core/lifecycle',
  slots: { status: { kind: 'enum', state: 'lifecycle' } },
  words: { initial: { slot: 'status' }, done: { slot: 'status' } },
  actions: [{ op: 'finish_block', moves: [{ to: 'done' }] }],
  requires: [],
};
const work: Behaviour = { id: 'core/work', slots: {}, words: {}, actions: [{ op: 'ready_work' }], requires: ['core/lifecycle'] };
const review: Behaviour = {
  id: 'core/review',
  slots: { phase: { kind: 'enum', state: 'lifecycle' } },
  words: {},
  actions: [],
  requires: [],
};
const holder: Behaviour = {
  id: 'core/holder',
  slots: { holder: { kind: 'session', state: 'holder' } },
  words: {},
  actions: [],
  requires: [],
};
const note: Behaviour = { id: 'core/note', slots: { text: {} }, words: {}, actions: [], requires: [] };

const OPERATIONS: ReadonlySet<string> = new Set(['finish_block', 'ready_work']);

const registry = registerBehaviours(
  [lifecycle, work, review, holder, note].map((entry) => ({ owner: 'graph', entry })),
  OPERATIONS,
);

const fields: TagFields = {
  status: { type: 'enum', values: ['open', 'done'] },
  phase: { type: 'enum', values: ['draft', 'final'] },
  holder: 'session',
  note: 'string',
};

const living = { slots: { status: 'status' }, words: { initial: 'open', done: 'done' } };
const none = { slots: {}, words: {} };

const binds = (...parts: ContractBindings[]) =>
  bindContracts(
    parts.map((contracts, at) => ({ from: `t${at}`, contracts })),
    fields,
    [],
    registry,
  );

test('registration refuses missing requirements, duplicate contracts and unknown operations', () => {
  expect(() => registerBehaviours([{ owner: 'graph', entry: work }], OPERATIONS)).toThrow(BehaviourInvalid);
  expect(() =>
    registerBehaviours(
      [
        { owner: 'graph', entry: lifecycle },
        { owner: 'enforcement', entry: lifecycle },
      ],
      OPERATIONS,
    ),
  ).toThrow(BehaviourInvalid);
  const misspelt: Behaviour = { ...lifecycle, actions: [{ op: 'finish_blok', moves: [{ to: 'done' }] }] };
  expect(() => registerBehaviours([{ owner: 'graph', entry: misspelt }], OPERATIONS)).toThrow(BehaviourInvalid);
});

test('only registered contracts bind, with their requirements closed by the set', () => {
  expect(Result.isFailure(binds({ 'core/unknown': none }))).toBe(true);
  expect(Result.isFailure(binds({ 'core/work': none }))).toBe(true);
  expect(Result.isSuccess(binds({ 'core/work': none, 'core/lifecycle': living }))).toBe(true);
});

test('a binding is held to its descriptor: every slot bound to a declared field of its kind, every word one the field holds', () => {
  expect(Result.isFailure(binds({ 'core/lifecycle': { slots: {}, words: {} } }))).toBe(true);
  expect(Result.isFailure(binds({ 'core/lifecycle': { ...living, slots: { status: 'missing' } } }))).toBe(true);
  expect(Result.isFailure(binds({ 'core/lifecycle': { ...living, slots: { status: 'note' } } }))).toBe(true);
  expect(Result.isFailure(binds({ 'core/lifecycle': { ...living, words: { initial: 'open', done: 'closed' } } }))).toBe(true);
  expect(Result.isFailure(binds({ 'core/lifecycle': { ...living, words: { initial: 'open' } } }))).toBe(true);
  expect(Result.isFailure(binds({ 'core/lifecycle': { ...living, slots: { status: 'status', extra: 'note' } } }))).toBe(true);
});

test('one single-valued state has one binding owner, even over distinct fields', () => {
  expect(Result.isFailure(binds({ 'core/lifecycle': living, 'core/review': { slots: { phase: 'phase' }, words: {} } }))).toBe(true);
  expect(Result.isSuccess(binds({ 'core/lifecycle': living, 'core/holder': { slots: { holder: 'holder' }, words: {} } }))).toBe(true);
});

test('two contracts never share a field', () => {
  expect(
    Result.isFailure(
      binds({ 'core/holder': { slots: { holder: 'holder' }, words: {} }, 'core/note': { slots: { text: 'holder' }, words: {} } }),
    ),
  ).toBe(true);
  expect(
    Result.isSuccess(
      binds({ 'core/holder': { slots: { holder: 'holder' }, words: {} }, 'core/note': { slots: { text: 'note' }, words: {} } }),
    ),
  ).toBe(true);
});

test('a descriptor answers only for its own slots and words, never for a name every object inherits', () => {
  expect(Result.isFailure(binds({ 'core/lifecycle': { ...living, slots: { status: 'status', constructor: 'note' } } }))).toBe(true);
  expect(Result.isFailure(binds({ 'core/lifecycle': { ...living, words: { ...living.words, toString: 'open' } } }))).toBe(true);
  expect(Result.isFailure(binds({ 'core/note': { slots: { text: 'constructor' }, words: {} } }))).toBe(true);
});

test('a contract bound by two parts is one binding when equal, kept with its first provenance, and refused when it differs', () => {
  const same = binds({ 'core/lifecycle': living }, { 'core/lifecycle': living, 'core/work': none });
  expect(Result.isSuccess(same) && same.success).toEqual([
    { contract: 'core/lifecycle', binding: living, from: 't0' },
    { contract: 'core/work', binding: none, from: 't1' },
  ]);
  expect(
    Result.isFailure(binds({ 'core/lifecycle': living }, { 'core/lifecycle': { ...living, words: { initial: 'done', done: 'open' } } })),
  ).toBe(true);
});

test('a role binds its meaning only where the declaration carries what that meaning reads', () => {
  const tagma = new TagIndex(tagsOfCatalogs(CATALOG_IDS), BEHAVIOUR_REGISTRY);
  const contractsOf = (id: string) => Object.keys(tagma.tagById(id)?.contracts ?? {}).sort();
  expect(contractsOf('reflection')).toEqual([OBSERVATION, REFLECTION].sort());
  expect(contractsOf('spec')).toEqual([LIFECYCLE, SPEC].sort());
  expect(contractsOf('view')).toEqual([LEAF, SELECTION].sort());
  const sighting = new TagIndex(
    [{ id: 'sighting', fields: { place: 'string' }, roles: { observation: true }, prompt: '' }],
    BEHAVIOUR_REGISTRY,
  );
  expect(Object.keys(sighting.tagById('sighting')?.contracts ?? {})).toEqual([OBSERVATION]);
  const shelf = new TagIndex([{ id: 'shelf', roles: { leaf: true }, prompt: '' }], BEHAVIOUR_REGISTRY);
  expect(Object.keys(shelf.tagById('shelf')?.contracts ?? {})).toEqual([LEAF]);
});

test('a contract-only lifecycle is held to its endings', () => {
  const state = { type: 'enum', values: ['open', 'done', 'dropped'] } as const;
  const moves = [
    { gate: 'transition', field: 'phase', from: 'open', to: 'done' },
    { gate: 'transition', field: 'phase', from: 'open', to: 'dropped' },
  ] as const;
  const lifecycleOf = (done: string) => ({ slots: { status: 'phase' }, words: { initial: 'open', done, closed: 'dropped' } });
  const unread = (declaration: Declaration) => new TagIndex([declaration], BEHAVIOUR_REGISTRY).unreadable.map((entry) => entry.id);
  const chore = (done: string, gates: readonly Gate[] = moves): Declaration => ({
    id: 'chore',
    fields: { phase: state },
    gates: [...gates],
    contracts: { [LIFECYCLE]: lifecycleOf(done), [WORK]: { slots: {}, words: {} } },
    prompt: '',
  });
  expect(unread(chore('done'))).toEqual([]);
  expect(unread(chore('open'))).toEqual(['chore']);
  expect(unread(chore('done', [...moves, { gate: 'transition', field: 'phase', from: 'done', to: 'dropped' }]))).toEqual(['chore']);
});

it.effect('two tags on one node compose a contract only when both bind it the same way', () =>
  Effect.gen(function* () {
    const state = { phase: { type: 'enum', values: ['open', 'done'] } } as const;
    const gates = [{ gate: 'transition', field: 'phase', from: 'open', to: 'done' }] as const;
    const bound = (initial: string) => ({ [LIFECYCLE]: { slots: { status: 'phase' }, words: { initial } } });
    const table = new TagIndex(
      [
        { id: 'one', fields: state, gates: [...gates], contracts: bound('open'), prompt: '' },
        { id: 'same', fields: state, gates: [...gates], contracts: bound('open'), prompt: '' },
        {
          id: 'other',
          fields: { phase: { type: 'enum', values: ['open', 'done'] } },
          gates: [{ gate: 'transition', field: 'phase', from: 'done', to: 'open' }],
          contracts: bound('done'),
          prompt: '',
        },
      ],
      BEHAVIOUR_REGISTRY,
    );
    const compose = (...ids: string[]) => assertComposable(ids.map((id) => table.tagById(id)!));
    expect(yield* compose('one', 'same').pipe(Effect.result)).toEqual(Result.succeed(undefined));
    expect((yield* compose('one', 'other').pipe(Effect.flip)).code).toBe('role-conflict');
    const staged = { phase: { type: 'enum', values: ['open', 'staging', 'done'] } } as const;
    const machines = new TagIndex(
      [
        {
          id: 'direct',
          fields: staged,
          gates: [
            { gate: 'transition', field: 'phase', from: 'open', to: 'done' },
            { gate: 'transition', field: 'phase', from: 'staging', to: 'done' },
          ],
          contracts: bound('open'),
          prompt: '',
        },
        {
          id: 'staged',
          fields: staged,
          gates: [
            { gate: 'transition', field: 'phase', from: 'open', to: 'staging' },
            { gate: 'transition', field: 'phase', from: 'staging', to: 'done' },
          ],
          contracts: bound('open'),
          prompt: '',
        },
      ],
      BEHAVIOUR_REGISTRY,
    );
    expect((yield* assertComposable([machines.tagById('direct')!, machines.tagById('staged')!]).pipe(Effect.flip)).code).toBe(
      'role-conflict',
    );
  }),
);
