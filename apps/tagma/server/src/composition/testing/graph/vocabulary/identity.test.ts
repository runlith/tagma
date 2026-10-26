import { expect, test } from 'bun:test';
import { fieldIdOf, type InstalledRelease, localTypeId, shippedTypeId } from '../../../../graph/contract/wire/tags/identity.js';
import { Identities } from '../../../../graph/vocabulary/identity.js';

const CORE = ['tag', 'catalog'];
const release = (library: string, version: string, exports: string[], members: string[]): InstalledRelease => ({
  library,
  version,
  exports,
  members,
});

test('a renamed type answers its alias, its immutable key and its permanent id with the same key, and its id does not move', () => {
  const before = new Identities(CORE, [{ key: 'chore', declaration: 'aaaa1111', uuid: 'aaaa1111', identity: null }], []);
  const after = new Identities(CORE, [{ key: 'chore', declaration: 'aaaa1111', uuid: 'aaaa1111', identity: { name: 'errand' } }], []);
  const id = before.typeOf('chore')?.id;
  expect(id).toBe(localTypeId('aaaa1111'));
  expect(after.keyOf('errand')).toBe('chore');
  expect(after.keyOf('chore')).toBe('chore');
  expect(after.keyOf(id!)).toBe('chore');
  expect(after.typeOf('errand')).toEqual({ id: id!, ids: [id!], key: 'chore', name: 'errand', declaration: 'aaaa1111', shipped: null });
});

test('a stored reference resolves by key or permanent id and never by an alias', () => {
  const table = new Identities(CORE, [{ key: 'chore', declaration: 'aaaa1111', uuid: 'aaaa1111', identity: { name: 'errand' } }], []);
  expect(table.resolveStoredType('chore')).toBe('chore');
  expect(table.resolveStoredType(localTypeId('aaaa1111'))).toBe('chore');
  expect(table.resolveStoredType('errand')).toBeNull();
});

test('a type is shipped only where an installed release lists it as a member and exports it; the version stays out of the id', () => {
  const declared = [
    { key: 'chore', declaration: 'aaaa1111', uuid: 'aaaa1111', identity: null },
    { key: 'memo', declaration: 'bbbb2222', uuid: 'bbbb2222', identity: null },
    { key: 'claimed', declaration: 'cccc3333', uuid: 'cccc3333', identity: { shipped: { library: 'kit', export: 'claimed' } } },
  ];
  const one = new Identities(CORE, declared, [release('kit', 'r1', ['chore', 'memo'], ['aaaa1111'])]);
  const two = new Identities(CORE, declared, [release('kit', 'r2', ['chore', 'memo'], ['aaaa1111'])]);
  expect(one.typeOf('chore')?.shipped).toEqual({ library: 'kit', export: 'chore', version: 'r1' });
  expect(two.typeOf('chore')?.id).toBe(one.typeOf('chore')!.id);
  expect(one.typeOf('chore')?.id).toBe(shippedTypeId('kit', 'chore'));
  expect(one.typeOf('memo')?.id).toBe(localTypeId('bbbb2222'));
  expect(one.typeOf('claimed')?.shipped).toBeNull();
});

test('a type keeps the shipped id the installer recorded as its permanent id after its catalog leaves; a recorded id two types claim falls back to their local ids', () => {
  const recorded = { key: 'chore', declaration: 'aaaa1111', uuid: 'aaaa1111', identity: { shipped: { library: 'kit', export: 'chore' } } };
  const installed = new Identities(CORE, [recorded], [release('kit', 'r1', ['chore'], ['aaaa1111'])]);
  const removed = new Identities(CORE, [recorded], []);
  expect(removed.typeOf('chore')?.id).toBe(installed.typeOf('chore')!.id);
  const twice = new Identities(CORE, [recorded, { ...recorded, key: 'copy', declaration: 'bbbb2222', uuid: 'bbbb2222' }], []);
  expect(twice.typeOf('chore')?.id).toBe(localTypeId('aaaa1111'));
  expect(twice.typeOf('copy')?.id).toBe(localTypeId('bbbb2222'));
});

test('every id a declaration has held keeps resolving after its catalog leaves or a release adopts it', () => {
  const recorded = { key: 'chore', declaration: 'aaaa1111', uuid: 'aaaa1111', identity: { shipped: { library: 'kit', export: 'chore' } } };
  const installed = new Identities(CORE, [recorded], [release('kit', 'r1', ['chore'], ['aaaa1111'])]);
  const removed = new Identities(CORE, [recorded], []);
  const adopted = new Identities(CORE, [{ ...recorded, identity: null }], [release('kit', 'r1', ['chore'], ['aaaa1111'])]);
  const local = new Identities(CORE, [{ ...recorded, identity: null }], []);
  expect(installed.typeOf('chore')?.id).toBe(shippedTypeId('kit', 'chore'));
  expect(removed.typeOf('chore')?.shipped).toBeNull();
  for (const table of [installed, removed]) {
    expect(table.resolveStoredType(shippedTypeId('kit', 'chore'))).toBe('chore');
    expect(table.resolveStoredType(localTypeId('aaaa1111'))).toBe('chore');
  }
  expect(adopted.resolveStoredType(local.typeOf('chore')!.id)).toBe('chore');
});

test('two catalogs exporting one name coexist: the second takes an assigned key and each keeps its own shipped id', () => {
  const first = new Identities(
    CORE,
    [{ key: 'chore', declaration: 'aaaa1111', uuid: 'aaaa1111', identity: null }],
    [release('kit', 'r1', ['chore'], ['aaaa1111'])],
  );
  const key = first.assignKey('other', 'chore');
  expect(key).toBe('other.chore');
  const both = new Identities(
    CORE,
    [
      { key: 'chore', declaration: 'aaaa1111', uuid: 'aaaa1111', identity: null },
      { key, declaration: 'dddd4444', uuid: 'dddd4444', identity: { shipped: { library: 'other', export: 'chore' } } },
    ],
    [release('kit', 'r1', ['chore'], ['aaaa1111']), release('other', 'o1', ['chore'], ['dddd4444'])],
  );
  expect(both.keyOf(shippedTypeId('kit', 'chore'))).toBe('chore');
  expect(both.keyOf(shippedTypeId('other', 'chore'))).toBe('other.chore');
  expect(both.assignKey('other', 'chore')).toBe('other.chore.2');
});

test('permanent ids stay distinct where library, export and declaration spellings overlap', () => {
  const table = new Identities(
    CORE,
    [
      { key: 'one', declaration: 'aaaa1111', uuid: 'aaaa1111', identity: { shipped: { library: 'a/b', export: 'c' } } },
      { key: 'two', declaration: 'bbbb2222', uuid: 'bbbb2222', identity: { shipped: { library: 'a', export: 'b/c' } } },
      { key: 'three', declaration: 'cccc3333', uuid: 'cccc3333', identity: { shipped: { library: 'local', export: 'cccc3333' } } },
    ],
    [release('a/b', 'r', ['c'], ['aaaa1111']), release('a', 'r', ['b/c'], ['bbbb2222']), release('local', 'r', ['cccc3333'], ['cccc3333'])],
  );
  const ids = ['one', 'two', 'three'].map((key) => table.typeOf(key)?.id);
  expect(new Set(ids).size).toBe(3);
  expect(ids).not.toContain(localTypeId('cccc3333'));
  for (const key of ['one', 'two', 'three']) expect(table.resolveStoredType(table.typeOf(key)!.id)).toBe(key);
});

test("a stored key spelled as another type's permanent id resolves to neither and is named a collision", () => {
  const table = new Identities(
    CORE,
    [
      { key: 'chore', declaration: 'aaaa1111', uuid: 'aaaa1111', identity: null },
      { key: localTypeId('aaaa1111'), declaration: 'bbbb2222', uuid: 'bbbb2222', identity: null },
    ],
    [],
  );
  expect(table.resolveStoredType(localTypeId('aaaa1111'))).toBeNull();
  expect(table.collisions).toEqual([localTypeId('aaaa1111')]);
  expect(table.resolveStoredType('chore')).toBe('chore');
});

test('two declarations whose spoken names coincide keep distinct permanent ids from their full uuids', () => {
  const table = new Identities(
    CORE,
    [
      { key: 'one', declaration: 'aaaa1111', uuid: '0190000000007000800000000aaaa1111', identity: null },
      { key: 'two', declaration: 'aaaa1111', uuid: '0190000000007000800000001aaaa1111', identity: null },
    ],
    [],
  );
  expect(table.typeOf('one')?.id).not.toBe(table.typeOf('two')?.id);
  expect(table.resolveStoredType(table.typeOf('two')!.id)).toBe('two');
});

test('an alias two types hold resolves to neither, and a key outranks an alias of the same spelling', () => {
  const table = new Identities(
    CORE,
    [
      { key: 'one', declaration: 'aaaa1111', uuid: 'aaaa1111', identity: { name: 'shared' } },
      { key: 'two', declaration: 'bbbb2222', uuid: 'bbbb2222', identity: { name: 'shared' } },
      { key: 'three', declaration: 'cccc3333', uuid: 'cccc3333', identity: { name: 'one' } },
    ],
    [],
  );
  expect(table.keyOf('shared')).toBeNull();
  expect(table.holderOf('shared', 'one')).toBe('two');
  expect(table.keyOf('one')).toBe('one');
});

test('an inherited field keeps the field id of the type that declared it, and a stored field id resolves to its key', () => {
  const origins = {
    fieldsOf: (type: string) => (type === 'bug' || type === 'chore' ? ['status'] : []),
    originOf: (type: string, field: string) => ((type === 'bug' || type === 'chore') && field === 'status' ? 'chore' : null),
  };
  const table = new Identities(
    CORE,
    [
      { key: 'chore', declaration: 'aaaa1111', uuid: 'aaaa1111', identity: null },
      { key: 'bug', declaration: 'bbbb2222', uuid: 'bbbb2222', identity: null },
    ],
    [],
    origins,
  );
  const declared = fieldIdOf(localTypeId('aaaa1111'), 'status');
  expect(table.fieldIdOf('bug', 'status')).toBe(declared);
  expect(table.fieldIdOf('chore', 'status')).toBe(declared);
  expect(table.resolveStoredField('bug', declared)).toBe('status');
  expect(table.resolveStoredField('bug', fieldIdOf(localTypeId('bbbb2222'), 'status'))).toBeNull();
});

test("a field's name is declared on its declaring type, inherited with its field id, and answers the readers of every type carrying it; a stored reference never resolves by it", () => {
  const origins = {
    fieldsOf: (type: string) => (type === 'bug' || type === 'chore' ? ['status'] : []),
    originOf: (type: string, field: string) => ((type === 'bug' || type === 'chore') && field === 'status' ? 'chore' : null),
  };
  const table = new Identities(
    CORE,
    [
      { key: 'chore', declaration: 'aaaa1111', uuid: 'aaaa1111', identity: { fields: { status: 'state' } } },
      { key: 'bug', declaration: 'bbbb2222', uuid: 'bbbb2222', identity: null },
    ],
    [],
    origins,
  );
  expect(table.fieldNameOf('bug', 'status')).toBe('state');
  expect(table.fieldKeyOf('bug', 'state')).toBe('status');
  expect(table.resolveStoredField('bug', 'state')).toBeNull();
});
