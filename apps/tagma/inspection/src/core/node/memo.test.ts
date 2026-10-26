import { describe, expect, test } from 'bun:test';
import { type InspectionMemo, type MemoValue, memoWrites, type ReachHead, type ReachTable, type ReachView } from './memo';

const value: MemoValue = { dependencies: [], listings: [], violations: [], read: [] };

const fixture = () => {
  const acts: string[] = [];
  let head: ReachHead | undefined = { tree: 'base', generation: 1 };
  const store: InspectionMemo = {
    get: () => undefined,
    set: (key) => {
      acts.push(`set ${key}`);
    },
  };
  const table: ReachTable = {
    open: <N, M>() =>
      ({
        head,
        members: undefined,
        node: () => undefined,
        sources: () => [],
        watchers: () => [],
      }) as ReachView<N, M>,
    apply: (key, from, to, _delta, _members, rebuild) => {
      acts.push(`${rebuild === true ? 'rebuild' : 'apply'} ${key} ${from?.tree ?? '-'} ${to}`);
      head = { tree: to, generation: (head?.generation ?? 0) + 1 };
      return 'applied';
    },
  };
  return { acts, store, table, head: () => head };
};

const delta = { nodes: new Map(), added: ['a.ts'], removed: [], derived: [] };

describe('staged reach index', () => {
  test('a round that never commits leaves the stored index untouched', () => {
    const { acts, store, table, head } = fixture();
    const memo = memoWrites(store, table);
    const index = memo.reach!('k');
    index.stage(index.head, 'next', delta, {});
    memo.set('m', value);
    expect(acts).toEqual([]);
    expect(head()).toEqual({ tree: 'base', generation: 1 });
    expect(index.head).toEqual({ tree: 'base', generation: 1 });
  });

  test('commit applies a staged advance after the entry writes', () => {
    const { acts, store, table } = fixture();
    const memo = memoWrites(store, table);
    const index = memo.reach!('k');
    index.stage(index.head, 'next', delta, {});
    memo.set('m', value);
    memo.commit();
    expect(acts).toEqual(['set m', 'apply k base next']);
  });

  test('an explicit rebuild reaches the table with the head it expects to replace', () => {
    const { acts, store, table } = fixture();
    const memo = memoWrites(store, table);
    const index = memo.reach!('k');
    index.stage(index.head, 'fresh', delta, {}, true);
    memo.commit();
    expect(acts).toEqual(['rebuild k base fresh']);
  });
});
