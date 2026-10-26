import { expect, test } from 'bun:test';
import { Result } from 'effect';
import type { Catalogs } from '../../../../graph/contract/wire/catalogs.js';
import type { Catalog, Declaration, Tag } from '../../../../graph/contract/wire/tags/declaration.js';
import { CORE_LIBRARY, shippedTypeId } from '../../../../graph/contract/wire/tags/identity.js';
import type { KeyedLayer, Section } from '../../../../graph/contract/wire/tags/sections.js';
import { type CatalogCandidate, type Installed, prepareCandidate, type StandingType } from '../../../../graph/vocabulary/candidate.js';
import { SECTION_JOIN } from '../../../../graph/vocabulary/compiler.js';
import { sectionRevision, typeRevision } from '../../../../graph/vocabulary/layers.js';
import { TagIndex } from '../../../../graph/vocabulary/tagIndex.js';
import { BEHAVIOUR_REGISTRY } from '../../../manifest.js';

const CONTRACT = 'A note states one thing.';
const NOTE = shippedTypeId('kit', 'note');

const note = (contract: string, context: Partial<Section> = {}, extra: Partial<Tag> = {}): Tag => ({
  id: 'note',
  fields: {},
  edges: [],
  gates: [],
  roles: {},
  body: { shape: 'content' },
  sections: [
    { key: 'contract', text: contract },
    { key: 'context', text: '', edits: ['append', 'replace'], ...context },
  ],
  prompt: '',
  ...extra,
});

const rule = (enabled: 'boolean' | 'string'): Tag => ({
  id: 'rule',
  fields: { enabled },
  edges: [],
  gates: [],
  roles: { law: 'enabled' },
  body: { shape: 'content' },
  prompt: 'A rule binds.',
});

const shippedAs = (tags: readonly Tag[]): Catalogs['Service'] => {
  const catalog: Catalog = { id: 'kit', guidance: 'The kit.', tags };
  return { key: null, all: [catalog], byId: (id) => (id === 'kit' ? catalog : null), declaring: () => [] };
};

const row = (at: number, declaration: Declaration, more: Partial<StandingType> = {}): StandingType => ({
  row: at,
  uuid: `0198aaaa-0000-7000-8000-00000000000${at}`,
  name: `aaaa000${at}`,
  ord: at,
  declaration,
  unread: null,
  identity: null,
  layer: null,
  fork: null,
  ...more,
});

function stand(types: readonly StandingType[], base: readonly Tag[] | null): { table: TagIndex; installed: Installed } {
  const members = types.filter((type) => base?.some((tag) => tag.id === type.declaration.id)).map((type) => type.name);
  const release = base === null ? null : { revision: 'r1', guidance: 'The kit.', tags: base };
  const installed: Installed = {
    types,
    catalogs:
      release === null
        ? []
        : [
            {
              row: 90,
              name: 'cccc0090',
              id: 'kit',
              guidance: 'The kit.',
              members,
              listed: members,
              release,
              layer: null,
              fork: null,
              unread: null,
            },
          ],
  };
  const table = new TagIndex(
    types.map((type) => ({ name: type.name, declaration: type.declaration, unread: null })),
    BEHAVIOUR_REGISTRY,
    [],
    {
      declarations: new Map(types.map((type) => [type.name, { uuid: type.uuid, identity: null }] as const)),
      releases: release === null ? [] : [{ library: 'kit', version: 'r1', exports: base!.map((tag) => tag.id), members }],
      profiles: [],
      profileErrors: [],
    },
  );
  return { table, installed };
}

const prepared = (types: readonly StandingType[], base: readonly Tag[] | null, now: readonly Tag[]): CatalogCandidate => {
  const { table, installed } = stand(types, base);
  const outcome = prepareCandidate(table, installed, shippedAs(now), ['kit'], BEHAVIOUR_REGISTRY);
  if (Result.isFailure(outcome)) throw new Error(outcome.failure.message);
  return outcome.success;
};

const appendLayer = (text: string): KeyedLayer => ({
  type: NOTE,
  edits: [{ section: 'context', edit: 'append', text, over: sectionRevision({ key: 'context', text: '' }) }],
});

test('a shipped text change reaches a type that appended to its context, as text only and without carriers to read', () => {
  const v1 = note(CONTRACT);
  const layered: Declaration = { ...v1, sections: [v1.sections![0]!, { ...v1.sections![1]!, text: 'Cite the file.' }] };
  const candidate = prepared(
    [row(1, layered, { layer: appendLayer('Cite the file.') })],
    [v1],
    [note('A note states one thing, plainly.')],
  );
  expect(candidate.compiled.get('note')?.tag.prompt).toBe(`A note states one thing, plainly.${SECTION_JOIN}Cite the file.`);
  expect(candidate.changed.get('note')).toBe('text');
  expect(candidate.affected).toEqual([]);
});

test('a replaced section whose shipped base changed keeps the local text', () => {
  const v1 = note(CONTRACT, { text: 'Shipped context.' });
  const layer: KeyedLayer = {
    type: NOTE,
    edits: [{ section: 'context', edit: 'replace', text: 'Ours.', over: sectionRevision({ key: 'context', text: 'Shipped context.' }) }],
  };
  const layered: Declaration = { ...v1, sections: [v1.sections![0]!, { ...v1.sections![1]!, text: 'Ours.' }] };
  const candidate = prepared([row(1, layered, { layer })], [v1], [note(CONTRACT, { text: 'Shipped context, revised.' })]);
  expect(candidate.compiled.get('note')?.tag.prompt).toBe(`${CONTRACT}${SECTION_JOIN}Ours.`);
});

test('a layer over a section the shipped type now closes refuses the candidate whole', () => {
  const v1 = note(CONTRACT);
  const { table, installed } = stand([row(1, v1, { layer: appendLayer('Cite the file.') })], [v1]);
  const outcome = prepareCandidate(table, installed, shippedAs([note(CONTRACT, { edits: [] })]), ['kit'], BEHAVIOUR_REGISTRY);
  expect(Result.isFailure(outcome) && outcome.failure.code).toBe('layer-forbidden');
});

test('a copy whose installed base is unknown keeps its declaration, and joins no release', () => {
  const copy: Declaration = { id: 'note', prompt: 'Our own note.' };
  const candidate = prepared([row(1, copy)], null, [note(CONTRACT)]);
  expect(candidate.types).toEqual([]);
  expect(candidate.compiled.get('note')?.tag.prompt).toBe('Our own note.');
  expect(candidate.catalogs[0]?.release.tags).toEqual([]);
  expect(candidate.catalogs[0]?.joining).toEqual([]);
});

test('an old-form copy that only appended to its base becomes an append layer over the new shipped sections', () => {
  const shipped: Tag = { id: 'note', fields: {}, edges: [], gates: [], roles: {}, body: { shape: 'content' }, prompt: CONTRACT };
  const copy: Declaration = { ...shipped, prompt: `${CONTRACT}${SECTION_JOIN}Cite the file.` };
  const candidate = prepared([row(1, copy)], [shipped], [note(CONTRACT)]);
  expect(candidate.types[0]?.layer).toEqual(appendLayer('Cite the file.'));
  expect(candidate.compiled.get('note')?.tag.prompt).toBe(`${CONTRACT}${SECTION_JOIN}Cite the file.`);
});

test('a structural shipped change marks the type and its local descendants as the closure whose carriers are read', () => {
  const v1 = note(CONTRACT);
  const memo: Declaration = { id: 'memo', extends: 'note', prompt: 'A memo.' };
  const candidate = prepared([row(1, v1), row(2, memo)], [v1], [note(CONTRACT, {}, { fields: { due: 'date' } })]);
  expect(candidate.changed.get('note')).toBe('structural');
  expect([...candidate.affected].sort()).toEqual(['memo', 'note']);
});

test('a fork stays as written and a newer shipped revision of its type writes nothing', () => {
  const v1 = note(CONTRACT);
  const forked: Declaration = { id: 'note', prompt: 'Our note.' };
  const v2 = note('A note states two things.');
  const candidate = prepared([row(1, forked, { fork: { library: 'kit', export: 'note', at: typeRevision(v1) } })], [v1], [v2]);
  expect(candidate.types).toEqual([]);
});

test('a type the installation writes carries the shipped provenance its release verifies, so the next plan has nothing to record', () => {
  const v1 = note(CONTRACT);
  const fresh = prepared([], null, [v1]);
  expect(fresh.types.map((write) => [write.key, write.identity])).toEqual([['note', { shipped: { library: 'kit', export: 'note' } }]]);
  const shipped: Tag = { id: 'note', fields: {}, edges: [], gates: [], roles: {}, body: { shape: 'content' }, prompt: CONTRACT };
  const upgraded = prepared([row(1, { ...shipped, prompt: `${CONTRACT}${SECTION_JOIN}Cite the file.` })], [shipped], [v1]);
  expect(upgraded.types.map((write) => [write.key, write.identity])).toEqual([['note', { shipped: { library: 'kit', export: 'note' } }]]);
});

test('a requested catalog set that omits the system library still prepares it', () => {
  const core: Catalog = { id: CORE_LIBRARY, guidance: 'system', tags: [] };
  const kit: Catalog = { id: 'kit', guidance: 'The kit.', tags: [note(CONTRACT)] };
  const shipped: Catalogs['Service'] = {
    key: null,
    all: [core, kit],
    byId: (id) => (id === CORE_LIBRARY ? core : id === 'kit' ? kit : null),
    declaring: () => [],
  };
  const { table, installed } = stand([], null);
  const outcome = prepareCandidate(table, installed, shipped, ['kit'], BEHAVIOUR_REGISTRY);
  if (Result.isFailure(outcome)) throw new Error(outcome.failure.message);
  expect(outcome.success.catalogs.map((write) => write.catalog).sort()).toEqual(['kit', CORE_LIBRARY].sort());
});

test('a second catalog exporting a name another catalog already ships gets its own key, and its reference to that name stays its own', () => {
  const v1 = note(CONTRACT);
  const { table, installed } = stand([row(1, v1)], [v1]);
  const slip: Tag = {
    id: 'slip',
    extends: 'note',
    fields: {},
    edges: [],
    gates: [],
    roles: {},
    body: { shape: 'content' },
    prompt: 'A slip.',
  };
  const other: Catalog = { id: 'other', guidance: 'Other.', tags: [v1, slip] };
  const shipped: Catalogs['Service'] = {
    key: null,
    all: [{ id: 'kit', guidance: 'The kit.', tags: [v1] }, other],
    byId: (id) => (id === 'kit' ? { id: 'kit', guidance: 'The kit.', tags: [v1] } : id === 'other' ? other : null),
    declaring: () => [],
  };
  const outcome = prepareCandidate(table, installed, shipped, ['kit', 'other'], BEHAVIOUR_REGISTRY);
  if (Result.isFailure(outcome)) throw new Error(outcome.failure.message);
  const write = outcome.success.types.find((type) => type.identity?.shipped?.library === 'other');
  expect(write?.key).toBe('other.note');
  expect(outcome.success.catalogs.find((catalog) => catalog.catalog === 'other')?.joining).toEqual(['other.note', 'slip']);
  expect(outcome.success.types.find((type) => type.key === 'slip')?.declaration.extends).toBe(shippedTypeId('other', 'note'));
  expect(table.identities.typeOf(shippedTypeId('kit', 'note'))?.key).toBe('note');
});

const zone = (extra: Partial<Tag> = {}): Tag => ({
  id: 'zone',
  fields: {},
  edges: [],
  gates: [],
  roles: { container: true },
  contracts: { 'core/container': { slots: {}, words: {} } },
  body: { shape: 'orientation' },
  prompt: 'A region.',
  ...extra,
});

test('a copy kept as written is given the contracts its roles drew, keeping its fork and its text, and a copy that dropped the roles is not', () => {
  const v1 = zone();
  const fork = { library: 'kit', export: 'zone', at: typeRevision(v1) };
  const { contracts: _bare, ...old } = v1;
  const kept = prepared([row(1, { ...old, prompt: 'Our region.' }, { fork })], [v1], [v1]);
  expect(kept.types).toEqual([
    expect.objectContaining({
      key: 'zone',
      row: 1,
      fork,
      keepBody: true,
      declaration: expect.objectContaining({ contracts: v1.contracts }),
    }),
  ]);
  const dropped = prepared([row(1, { ...old, roles: {}, prompt: 'Our region.' }, { fork })], [v1], [v1]);
  expect(dropped.types).toEqual([]);
  const again = prepared([row(1, { ...old, contracts: v1.contracts, prompt: 'Our region.' }, { fork })], [v1], [v1]);
  expect(again.types).toEqual([]);
});
