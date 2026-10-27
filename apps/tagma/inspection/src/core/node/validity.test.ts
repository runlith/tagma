import { describe, expect, test } from 'bun:test';
import { checkedOnce, Dependents, type MemoValue, Validity, validMemo } from './memo';

const value = (dependencies: readonly string[], parents: readonly string[] = [], listings: readonly string[] = []): MemoValue => ({
  dependencies: dependencies.map((name) => [name, 'o'] as const),
  listings: listings.map((query) => [query, 's'] as const),
  parents,
  violations: [],
  read: [],
});
const edit = (path: string) => ({ path, before: 'old', after: 'new' });

describe('validity carried from one tree to the next', () => {
  test('a key stands until a change reaches its own dependency or a parent’s', () => {
    const base = Validity.fresh(new Dependents(100));
    base.settle('P', value(['src/b.ts']));
    base.settle('K', value(['src/a.ts'], ['P']));
    const elsewhere = base.derive([edit('src/c.ts')]);
    expect([elsewhere.stands('K'), elsewhere.stands('P')]).toEqual([true, true]);
    const below = elsewhere.derive([edit('src/b.ts')]);
    expect([below.stands('K'), below.stands('P')]).toEqual([false, false]);
    const own = base.derive([edit('src/a.ts')]);
    expect([own.stands('K'), own.stands('P')]).toEqual([false, true]);
  });

  test('a key settled on the older tree after the newer was derived is judged against the change itself', () => {
    const base = Validity.fresh(new Dependents(100));
    const next = base.derive([edit('src/b.ts')]);
    base.settle('P', value(['src/b.ts']));
    base.settle('K', value(['src/a.ts'], ['P']));
    base.settle('Z', value(['src/z.ts']));
    expect([next.stands('P'), next.stands('K'), next.stands('Z')]).toEqual([false, false, true]);
  });

  test('a directory unit is reached by any change beneath it, and a membership change reaches every key with a listing', () => {
    const base = Validity.fresh(new Dependents(100));
    base.settle('U', value(['packages/a/**/']));
    base.settle('L', value([], [], ['["package","a"]']));
    const edited = base.derive([edit('packages/a/src/deep/x.ts')]);
    expect([edited.stands('U'), edited.stands('L')]).toEqual([false, true]);
    const added = base.derive([{ path: 'packages/b/new.ts', before: null, after: 'new' }]);
    expect([added.stands('U'), added.stands('L')]).toEqual([true, false]);
  });

  test('a key the index let go no longer stands', () => {
    const base = Validity.fresh(new Dependents(1));
    base.settle('A', value(['a.ts']));
    expect(base.stands('A')).toBe(true);
    base.settle('B', value(['b.ts']));
    expect(base.stands('A')).toBe(false);
  });

  test('what a tree held survives being written out and read into a fresh index, and still meets later changes', () => {
    const before = new Dependents(100);
    const base = Validity.fresh(before);
    base.settle('P', value(['src/b.ts']));
    base.settle('K', value(['src/a.ts'], ['P']));
    base.settle('L', value([], [], ['["package","a"]']));
    const held = base.held();
    const entries = before.exported(held);
    const after = new Dependents(100);
    after.imported(entries);
    const restored = Validity.restored(after, held);
    expect([restored.stands('P'), restored.stands('K'), restored.stands('L')]).toEqual([true, true, true]);
    const moved = restored.derive([edit('src/b.ts')]);
    expect([moved.stands('P'), moved.stands('K'), moved.stands('L')]).toEqual([false, false, true]);
    const added = restored.derive([{ path: 'src/new.ts', before: null, after: 'new' }]);
    expect([added.stands('K'), added.stands('L')]).toEqual([true, false]);
  });

  test('a key that stands is still judged against the installed files it read, which no tree change reaches', () => {
    const base = Validity.fresh(new Dependents(100));
    const memo = new Map<string, MemoValue>([['K', { ...value(['src/a.ts']), installed: [['node_modules/x/base.json', 'first']] }]]);
    let installed = 'first';
    const objects = (name: string) => (name === 'src/a.ts' ? 'o' : installed);
    expect(validMemo('K', objects, () => '', memo, checkedOnce(base))).toBe(true);
    const next = base.derive([edit('src/c.ts')]);
    installed = 'second';
    expect([next.stands('K'), validMemo('K', objects, () => '', memo, checkedOnce(next))]).toEqual([true, false]);
  });

  test('a long line of trees still carries what no change reached', () => {
    const base = Validity.fresh(new Dependents(100));
    base.settle('kept', value(['kept.ts']));
    base.settle('moved', value(['moved.ts']));
    let at = base;
    for (let step = 0; step < 40; step += 1) at = at.derive([edit(step === 20 ? 'moved.ts' : `other${step}.ts`)]);
    expect([at.stands('kept'), at.stands('moved')]).toEqual([true, false]);
  });
});
