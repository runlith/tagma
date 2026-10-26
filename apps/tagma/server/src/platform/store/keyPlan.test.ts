import { expect, test } from 'bun:test';
import { type ForeignKey, keyPlan, rebuiltBy } from './keyPlan.js';
import type { StatementWrite } from './statementTarget.js';

const key = (child: string): ForeignKey => ({ child, parent: 'thread', id: 0, from: ['thread_id'], to: ['id'] });
const write = (table: string, verb: StatementWrite['verb'], columns: readonly string[] = []): StatementWrite => ({
  kind: 'write',
  table,
  verb,
  columns: new Set(columns),
  replacing: false,
});

const rebuiltThread = {
  existed: new Set(['thread', 'thread_event', 'thread_entry']),
  touched: new Set(['thread']),
  written: [] as StatementWrite[],
  rekeyed: new Map<string, ReadonlySet<number>>(),
  restored: new Set<string>(),
  added: [],
  moved: 1,
  keys: [key('thread_event'), key('thread_entry')],
};

const empty = { full: [], checks: [], defaults: [], probes: [] };

test('a rebuilt parent whose keys all survive checks none of its children', () => {
  expect(keyPlan({ ...rebuiltThread, changes: [{ parent: 'thread', to: ['id'], removed: 0 }] })).toEqual(empty);
});

test('removed parent keys are probed only in their referencing constraints', () => {
  const plan = keyPlan({ ...rebuiltThread, changes: [{ parent: 'thread', to: ['id'], removed: 3 }] });
  expect(plan.full).toEqual([]);
  expect(plan.checks).toEqual([]);
  expect(plan.probes).toEqual(rebuiltThread.keys);
});

test('an unread parent key checks only its referencing constraints', () => {
  const plan = keyPlan({ ...rebuiltThread, changes: [{ parent: 'thread', to: ['id'], removed: 'unread' }] });
  expect(plan.full).toEqual([]);
  expect(plan.checks).toEqual(rebuiltThread.keys);
});

test('parent payload writes and child non-key updates need no key check', () => {
  expect(
    keyPlan({ ...rebuiltThread, written: [write('thread', 'update', ['title']), write('thread_entry', 'update', ['body'])], changes: [] }),
  ).toEqual(empty);
});

test('parent insertion and child deletion cannot create dangling references', () => {
  expect(keyPlan({ ...rebuiltThread, written: [write('thread', 'insert', ['id']), write('thread_entry', 'delete')], changes: [] })).toEqual(
    empty,
  );
});

test('updating a child key checks that constraint and no other child', () => {
  const plan = keyPlan({ ...rebuiltThread, written: [write('thread_entry', 'update', ['thread_id'])], changes: [] });
  expect(plan).toEqual({ full: [], checks: [rebuiltThread.keys[1]!], defaults: [], probes: [] });
});

test('deleting or updating a parent key probes only keys that disappeared', () => {
  for (const written of [[write('thread', 'delete')], [write('thread', 'update', ['id'])]]) {
    expect(keyPlan({ ...rebuiltThread, written, changes: [{ parent: 'thread', to: ['id'], removed: 0 }] })).toEqual(empty);
    expect(keyPlan({ ...rebuiltThread, written, changes: [{ parent: 'thread', to: ['id'], removed: 1 }] }).probes).toEqual(
      rebuiltThread.keys,
    );
  }
});

test('a parent changed in shape but never rebuilt removes no key', () => {
  expect(keyPlan({ ...rebuiltThread, changes: [] })).toEqual(empty);
});

test('the rebuild statements name the dropped table and both ends of a rename', () => {
  expect(
    [
      ...rebuiltBy([
        'CREATE TABLE `__new_thread` (`id` text PRIMARY KEY);',
        'INSERT INTO `__new_thread`("id") SELECT "id" FROM `thread`;',
        'DROP TABLE `thread`;',
        'ALTER TABLE `__new_thread` RENAME TO `thread`;',
        'DROP TABLE IF EXISTS "main"."old ""x""";',
      ]),
    ].sort(),
  ).toEqual(['__new_thread', 'old "x"', 'thread']);
});

test('a migration that moved no row checks only changed foreign-key declarations', () => {
  expect(keyPlan({ ...rebuiltThread, moved: 0, changes: [] })).toEqual(empty);
  expect(keyPlan({ ...rebuiltThread, moved: 0, rekeyed: new Map([['thread_event', new Set([0])]]), changes: [] })).toEqual({
    full: [],
    checks: [rebuiltThread.keys[0]!],
    defaults: [],
    probes: [],
  });
});

test('a migration that moved no row still probes the keys a replaced parent lost', () => {
  const plan = keyPlan({ ...rebuiltThread, moved: 0, changes: [{ parent: 'thread', to: ['id'], removed: 2 }] });
  expect(plan.probes).toEqual(rebuiltThread.keys);
});
