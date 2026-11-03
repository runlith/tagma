import { expect, test } from 'bun:test';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { stepsIn } from '@runlith/utils/sequenceDiff';
import { foldPath, type FoldInput } from './fold.js';
import {
  contentOf,
  hunkWork,
  prepareHunk,
  recordStep,
  restoreFold,
  startFold,
  type Content,
  type FoldRow,
  type FoldState,
} from './folding.js';
import { FoldMemory } from './memory.js';
import { alignBase, projectFold, type Proven, type Verdict } from './projection.js';

type Folded = ReturnType<typeof foldPath>;

const A = 'holder-a';
const B = 'holder-b';
const budget = () => stepsIn(100_000);
const text = (...lines: string[]) => lines.join('\n') + '\n';
const row = (id: string, holder: string, before: string | null, after: string | null): FoldRow => ({
  id,
  holder,
  before: contentOf(before),
  after: contentOf(after),
});
const input = (base: string | null, working: string | null, rows: readonly FoldRow[], normalized = false): FoldInput => ({
  base: contentOf(base),
  head: contentOf(base),
  working: contentOf(working),
  rows,
  normalized,
});
const tokens = (content: Content, normalized: boolean): readonly string[] =>
  content.kind !== 'text' ? [] : ((normalized ? content.text.replaceAll('\r\n', '\n') : content.text).match(/[^\n]*\n|[^\n]+$/g) ?? []);

function prove(verdict: Verdict, value: FoldInput): Proven {
  expect(verdict.verdict).toBe('proven');
  if (verdict.verdict !== 'proven') throw new Error(JSON.stringify(verdict));
  if (verdict.counts === 'unweighed') {
    expect(verdict.lines).toBe('unweighed');
    return verdict;
  }
  const before = tokens(value.head, value.normalized);
  const after = tokens(value.working, value.normalized);
  let previous = Array.from({ length: after.length + 1 }, () => 0);
  const identical = before.length === after.length && before.every((line, at) => line === after[at]);
  if (!identical)
    for (const left of before) {
      const current = [0];
      for (let j = 0; j < after.length; j += 1)
        current.push(left === after[j] ? (previous[j] as number) + 1 : Math.max(previous[j + 1] as number, current[j] as number));
      previous = current;
    }
  const equal = identical ? before.length : (previous[after.length] as number);
  expect(verdict.counts, JSON.stringify({ before, after, rows: value.rows })).toEqual({
    added: after.length - equal,
    removed: before.length - equal,
  });
  expect(verdict.hands.reduce((sum, hand) => sum + hand.added, verdict.nobody.added)).toBe(verdict.counts.added);
  expect(verdict.hands.reduce((sum, hand) => sum + hand.removed, verdict.nobody.removed)).toBe(verdict.counts.removed);
  return verdict;
}

function folded(value: FoldInput, cached?: FoldState): Folded & { readonly result: Proven } {
  const answer = foldPath(value, budget(), cached === undefined ? undefined : { kind: 'after', state: cached, row: cached.last });
  return { ...answer, result: prove(answer.result, value) };
}

const stateOf = (answer: Folded): FoldState => {
  if (answer.working === null) throw new Error('the fold did not build a text frontier');
  return answer.working;
};
const by = (verdict: Proven, kind: 'added' | 'removed') =>
  verdict.lines === 'unweighed'
    ? []
    : verdict.lines
        .filter((line) => line.kind === kind)
        .map((line) => [line.text, line.mark === 'external' ? 'external' : line.mark.holder]);

test('a sole writer owns both inserted lines beside a duplicate base brace', () => {
  const base = text('a', '}', 'b');
  const work = text('a', 'x', '}', '}', 'b');
  const value = input(base, work, [
    {
      ...row('a1', A, base, work),
      hunk: { firstLine: 2, oldLines: 0, newLines: 2, windowBefore: 0, oldText: '', newText: text('x', '}') },
    },
  ]);
  expect(by(folded(value).result, 'added')).toEqual([
    ['x\n', A],
    ['}\n', A],
  ]);
});

test('an edit inside a peer’s inserted function keeps the function with its original authors', () => {
  const base = text('before', 'after');
  const first = text('before', 'function f() {', '  one();', '  two();', '}', 'after');
  const work = first.replace('  two();', '  changed();');
  const value = input(base, work, [row('a1', A, base, first), row('b1', B, first, work)]);
  expect(by(folded(value).result, 'added')).toEqual([
    ['function f() {\n', A],
    ['  one();\n', A],
    ['  changed();\n', B],
    ['}\n', A],
  ]);
});

test('a replacement transfers both sides to its last writer and undo restores the displaced marks', () => {
  const base = text('L');
  const first = text("L'");
  const work = text("L''");
  const value = input(base, work, [row('a1', A, base, first), row('b1', B, first, work)]);
  const answer = folded(value);
  expect(by(answer.result, 'added')).toEqual([[work, B]]);
  expect(by(answer.result, 'removed')).toEqual([[base, B]]);
  expect(answer.result.overwritten.get('a1')).toEqual(['b1']);
  const restored = restoreFold(stateOf(answer), new Set(['b1']), budget());
  if ('reason' in restored) throw new Error(restored.reason);
  expect(restored.text).toBe(first);
  expect(restored.restored).toEqual(['b1']);
  const back = prove(projectFold(restored.state, value.head, contentOf(restored.text), budget()), input(base, first, []));
  expect(by(back, 'removed')).toEqual([[base, A]]);
  expect(by(back, 'added')).toEqual([[first, A]]);
});

test('partial revert facts survive a cold fold without taking the neighbouring writer', () => {
  const base = text('a', 'middle', 'z');
  const first = text('A', 'middle', 'z');
  const work = text('A', 'middle', 'B');
  const after = text('a', 'middle', 'B');
  const rows = [row('a1', A, base, first), row('b1', B, first, work), { ...row('undo-a', A, work, after), reverts: ['a1'] }];
  const answer = folded(input(base, after, rows));
  expect([...answer.result.standing]).toEqual(['b1']);
  expect(by(answer.result, 'added')).toEqual([['B\n', B]]);
  expect(by(answer.result, 'removed')).toEqual([['z\n', B]]);
});

test('reverting one selected cut preserves an intervening edit to another cut', () => {
  const base = text('a', 'middle', 'z');
  const first = text('A', 'middle', 'Z');
  const work = text('A', 'middle', 'B');
  const value = input(base, work, [row('a1', A, base, first), row('b1', B, first, work)]);
  const answer = folded(value);
  const restored = restoreFold(stateOf(answer), new Set(['a1']), budget());
  if ('reason' in restored) throw new Error(restored.reason);
  expect(restored.text).toBe(text('a', 'middle', 'B'));
  expect(restored.partial).toEqual(['a1']);
  expect(restored.blocked).toEqual([]);
  prove(projectFold(restored.state, value.head, contentOf(restored.text), budget()), input(base, restored.text, []));
});

test('exact historical digests restore ownership through stash and pop', () => {
  const base = text('base');
  const work = text('written');
  const value = input(base, work, [row('a1', A, base, work), row('stash', B, work, base), row('pop', B, base, work)]);
  const answer = folded(value);
  expect([...answer.result.standing]).toEqual(['a1']);
  expect(answer.result.hands).toEqual([{ holder: A, added: 1, removed: 1 }]);
  const undone = folded(input(base, base, value.rows.slice(0, 2)));
  expect(undone.result.hands).toEqual([]);
});

test('an external checkout back to an earlier frontier restores the earlier writer', () => {
  const base = text('base');
  const first = text('A');
  const later = text('B');
  const answer = folded(input(base, first, [row('a1', A, base, first), row('b1', B, first, later)]));
  expect(answer.result.hands).toEqual([{ holder: A, added: 1, removed: 1 }]);
});

test('deleting a file supersedes the earlier edit and owns all removed base lines', () => {
  const base = text('a', 'b');
  const first = text('A', 'b');
  const value = input(base, null, [row('a1', A, base, first), row('b1', B, first, null)]);
  const answer = folded(value);
  expect(by(answer.result, 'removed')).toEqual([
    ['a\n', B],
    ['b\n', B],
  ]);
  expect(answer.result.overwritten.get('a1')).toEqual(['b1']);
});

test('line-ending normalization does not attribute a whole CRLF rewrite', () => {
  const base = 'a\r\nb\r\n';
  const work = 'a\nB\n';
  const answer = folded(input(base, work, [row('b1', B, base, work)], true));
  expect(by(answer.result, 'added')).toEqual([['B\n', B]]);
  expect(by(answer.result, 'removed')).toEqual([['b\r\n', B]]);
});

test('empty-file existence is owned separately from an absent file', () => {
  const added = folded(input(null, '', [row('a1', A, null, '')]));
  expect(added.result.hands).toEqual([{ holder: A, added: 0, removed: 0 }]);
  const deleted = input('', null, [row('b1', B, '', null)]);
  expect(folded(deleted).result.hands).toEqual([{ holder: B, added: 0, removed: 0 }]);
  expect(folded(input(null, null, [row('a1', A, null, ''), row('b1', B, '', null)])).result.hands).toEqual([]);
});

test('external edits between recorded rows affect only the divergent window', () => {
  const base = text('a', 'b', 'c', 'd');
  const first = text('A', 'b', 'c', 'd');
  const gap = text('A', 'b', 'external', 'd');
  const work = text('A', 'b', 'external', 'B');
  const answer = folded(input(base, work, [row('a1', A, base, first), row('b1', B, gap, work)]));
  expect(by(answer.result, 'added')).toEqual([
    ['A\n', A],
    ['external\n', 'external'],
    ['B\n', B],
  ]);
  expect(answer.result.nobody).toEqual({ added: 1, removed: 1 });
});

test.each([null, ''])('removing a recorded insertion still belongs to its writer after HEAD carries the insertion (%s)', (working) => {
  const created = text('created');
  const value = { ...input(null, working, [row('a1', A, null, created), row('b1', B, created, working)]), head: contentOf(created) };
  expect(folded(value).result.hands).toEqual([{ holder: B, added: 0, removed: 1 }]);
});

test('a new head reuses the fold and removes committed lines from its projection', () => {
  const base = text('a', 'middle', 'z');
  const first = text('A', 'middle', 'z');
  const work = text('A', 'middle', 'B');
  const firstInput = input(base, work, [row('a1', A, base, first), row('b1', B, first, work)]);
  const original = folded(firstInput);
  if (original.record === null) throw new Error('missing record frontier');
  const next = { ...input(base, work, []), head: contentOf(first) };
  const answer = folded(next, original.record);
  expect(answer.record).toBe(original.record);
  expect(answer.result.hands).toEqual([{ holder: B, added: 1, removed: 1 }]);
  expect(answer.result.overwritten.size).toBe(0);
});

test('a shifted head outside the record aligns bases once and retains line ownership', () => {
  const base = text('a', 'middle', 'z');
  const work = text('a', 'middle', 'B');
  const original = folded(input(base, work, [row('b1', B, base, work)]));
  if (original.record === null) throw new Error('missing frontier');
  const head = text('new head', 'a', 'middle', 'z');
  const bytes = text('new head', 'a', 'middle', 'B');
  const headContent = contentOf(head, 'blob-new');
  const alignment = alignBase({ before: original.record.base, after: headContent, normalized: false }, budget());
  const memory = new FoldMemory(original.record.bytes * 3);
  memory.keep('checkout:path', original.record);
  memory.aligned(alignment);
  const cached = memory.alignment(original.record.base, headContent, false);
  expect(cached).toBe(alignment);
  const value = { ...input(base, bytes, []), head: headContent };
  const kept = memory.fold('checkout:path');
  const answer = foldPath(
    value,
    budget(),
    kept === undefined ? undefined : { kind: 'after', state: kept, row: kept.last },
    (before, after) => memory.alignment(before, after, false),
  );
  expect(answer.record).toBe(original.record);
  expect(prove(answer.result, value).hands).toEqual([{ holder: B, added: 1, removed: 1 }]);
});

test('an opaque row is recovered from the two adjacent known digests', () => {
  const base = text('a', 'b', 'c');
  const first = text('A', 'b', 'c');
  const second = text('A', 'B', 'c');
  const work = text('A', 'B', 'C');
  const opaque = row('b1', B, first, second);
  const value = input(base, work, [
    row('a1', A, base, first),
    {
      ...opaque,
      before: { kind: 'opaque', digest: 'digest' in opaque.before ? opaque.before.digest : null },
      after: { kind: 'opaque', digest: 'digest' in opaque.after ? opaque.after.digest : null },
    },
    row('a2', A, second, work),
  ]);
  const answer = folded(value);
  expect(by(answer.result, 'added')).toEqual([
    ['A\n', A],
    ['B\n', B],
    ['C\n', A],
  ]);
});

test('unrecoverable history is unknown, never an external guess, until file-level equality proves cleanliness', () => {
  const base = text('base');
  const value = input(base, text('unrelated'), [
    { id: 'opaque', holder: B, before: contentOf(base), after: { kind: 'opaque', digest: 'lost' } },
  ]);
  expect(foldPath(value, budget()).result).toMatchObject({ verdict: 'unknown', reason: 'opaque' });
  const clean = { ...value, working: value.head };
  expect(folded(clean).result.hands).toEqual([]);
  expect(folded({ ...clean, base: { kind: 'unread', cause: 'lost starting snapshot' } }).result.hands).toEqual([]);
});

test('an exhausted work budget and an unread side have distinct unknown verdicts', () => {
  const value = input(text('a'), text('b'), [row('b1', B, text('a'), text('b'))]);
  expect(foldPath(value, stepsIn(0)).result).toMatchObject({ verdict: 'unknown', reason: 'budget' });
  expect(foldPath({ ...value, head: { kind: 'unread', cause: 'read failed' } }, budget()).result).toMatchObject({
    verdict: 'unknown',
    reason: 'unread',
    side: 'head',
    cause: 'read failed',
  });
});

test('binary and large files use the last matching raw digest without line counts', () => {
  const base: Content = { kind: 'whole', digest: 'base' };
  const working: Content = { kind: 'whole', digest: 'after' };
  const value: FoldInput = { base, head: base, working, normalized: true, rows: [{ id: 'b1', holder: B, before: base, after: working }] };
  const answer = folded(value);
  expect(answer.result.hands).toEqual([{ holder: B, added: 0, removed: 0 }]);
  expect([...answer.result.standing]).toEqual(['b1']);
  expect(folded({ ...value, working: { kind: 'whole', digest: 'external' } }).result.existence).toBe('external');
  expect(Array.isArray(folded(input('a\0', 'b\0', [row('b1', B, 'a\0', 'b\0')])).result.lines)).toBe(true);
});

test('two peers deleting equal lines beside an inserted block leave its closing lines with its writer', () => {
  const C = 'holder-c';
  const entry = (name: string, ...keys: string[]) => [
    `    "./${name}": {`,
    ...keys.map((key, at) => `      "${key}": "./src/${name}.ts"${at + 1 < keys.length ? ',' : ''}`),
    '    },',
  ];
  const reports = entry('reports', 'types', 'default');
  const state = entry('state', 'types', 'browser', 'default');
  const added = [...entry('operator', 'types', 'default'), ...entry('web', 'types', 'default')];
  const cloud = ['    "@example/cloud": "workspace:*",'];
  const manifest = (exports: readonly string[], dependencies: readonly string[]) =>
    text(
      '{',
      '  "exports": {',
      ...exports,
      ...entry('accounts', 'types', 'browser', 'default').slice(0, -1),
      '    }',
      '  },',
      '  "dependencies": {',
      ...dependencies,
      '    "@example/inspection": "workspace:*"',
      '  }',
      '}',
    );
  const base = manifest([...reports, ...state], cloud);
  const inserted = manifest([...added, ...reports, ...state], cloud);
  const stateless = manifest([...added, ...reports], []);
  const work = manifest(added, []);
  const value = input(base, work, [
    { ...row('a1', A, base, inserted), hunk: workspaceChangeHunk(base, inserted)! },
    { ...row('b1', B, inserted, stateless), hunk: workspaceChangeHunk(inserted, stateless)! },
    { ...row('c1', C, stateless, work), hunk: workspaceChangeHunk(stateless, work)! },
  ]);
  expect(folded(value).result.hands).toEqual([
    { holder: C, added: 0, removed: 3 },
    { holder: A, added: 6, removed: 0 },
    { holder: B, added: 0, removed: 5 },
  ]);
});

test('a positional hunk advances a large frontier under a hunk-sized work budget', () => {
  const base = Array.from({ length: 10_000 }, (_, at) => `${at}\n`).join('');
  const state = startFold(contentOf(base), false);
  if ('reason' in state) throw new Error(state.reason);
  const hunk = { firstLine: 5001, oldLines: 1, newLines: 1, windowBefore: 0, oldText: '5000\n', newText: 'changed\n' };
  const recorded = { id: 'b1', holder: B, before: state.base, after: { kind: 'opaque', digest: 'known-after' }, hunk } as const;
  const work = hunkWork(state, recorded);
  if ('reason' in work) throw new Error(work.reason);
  const prepared = prepareHunk(work, stepsIn(32));
  if ('reason' in prepared) throw new Error(prepared.reason);
  const next = recordStep(state, recorded, prepared, budget());
  if ('reason' in next) throw new Error(next.reason);
  expect(next.snapshot.digest).toBe('known-after');
  const restored = restoreFold(next, new Set(['b1']), budget());
  if ('reason' in restored) throw new Error(restored.reason);
  expect(restored.text).toBe(base);
  const value = input(base, base, []);
  prove(projectFold(restored.state, value.head, value.working, budget()), value);
});

test('net attribution conserves a shortest diff through repeated and reordered lines', () => {
  const bases = [text('a', 'b', 'a'), text('a', 'b', 'c'), text('a', 'a', 'b')];
  const fronts = [text('a', 'c', 'b'), text('b', 'a', 'c'), text('c', 'a', 'b')];
  for (const base of bases)
    for (const first of fronts)
      for (const work of fronts) {
        const answer = folded(input(base, work, [row('a1', A, base, first), row('b1', B, first, work)]));
        expect(answer.result.nobody, JSON.stringify({ base, first, work })).toEqual({ added: 0, removed: 0 });
      }
});

test('a forced minimum-diff anchor transfer belongs to the last crossing writer', () => {
  const base = text('a', 'b', 'c');
  const first = text('a', 'c', 'b');
  const work = text('c', 'a', 'b');
  const value = input(base, work, [row('a1', A, base, first), row('b1', B, first, work)]);
  const answer = folded(value);
  expect(by(answer.result, 'added')).toEqual([['c\n', B]]);
  expect(by(answer.result, 'removed')).toEqual([['c\n', B]]);
});

test('a write whose shortest diff moves a line across lines it removed holds every line of the patch', () => {
  const base = text('', 'u', 'k', '', 'u', 't');
  const work = text('k', '', 'u', '', 'u');
  const value = input(base, work, [{ ...row('a1', A, base, work), hunk: workspaceChangeHunk(base, work)! }]);
  const answer = folded(value);
  expect(answer.result.nobody).toEqual({ added: 0, removed: 0 });
  expect(answer.result.hands.map((hand) => hand.holder)).toEqual([A]);
});

test('a replaced new file has no residual creation holder', () => {
  const first = text('A');
  const work = text('B');
  const answer = folded(input(null, work, [row('a1', A, null, first), row('b1', B, first, work)]));
  expect(answer.result.hands).toEqual([{ holder: B, added: 1, removed: 0 }]);
  expect(answer.result.overwritten.get('a1')).toEqual(['b1']);
});

test('a partial inverse is replayed durably even when another cut of the same row is overwritten', () => {
  const base = text('a', 'middle', 'z');
  const first = text('A', 'middle', 'Z');
  const work = text('A', 'middle', 'B');
  const after = text('a', 'middle', 'B');
  const rows = [row('a1', A, base, first), row('b1', B, first, work), { ...row('undo-a', A, work, after), reverts: ['a1'] }];
  const answer = folded(input(base, after, rows));
  expect(answer.result.hands).toEqual([{ holder: B, added: 1, removed: 1 }]);
});

test('normalized undo keeps the working endings of untouched lines and restores the original removed bytes', () => {
  const base = 'a\r\nb\r\n';
  const work = 'a\nB\n';
  const after = 'a\nb\r\n';
  const value = input(base, work, [row('b1', B, base, work)], true);
  const answer = folded(value);
  const restored = restoreFold(stateOf(answer), new Set(['b1']), budget(), value.working);
  if ('reason' in restored) throw new Error(restored.reason);
  expect(restored.text).toBe(after);
  prove(projectFold(restored.state, value.head, contentOf(after), budget()), input(base, after, [], true));
  folded(input(base, after, [...value.rows, { ...row('undo-b', B, work, after), reverts: ['b1'] }], true));
});

test('a partial input whose recorded edit no longer fits its window is opaque rather than diffed against the replayed bytes', () => {
  const base = 'a\r\nb\r\nc\r\n';
  const middle = 'a\nB\nc\n';
  const work = 'A\nB\nc\n';
  const omitted: Content = { kind: 'opaque', digest: contentOf(middle).digest };
  const rows: FoldRow[] = [
    {
      ...row('a1', A, base, middle),
      after: omitted,
      hunk: { firstLine: 2, windowBefore: 0, oldLines: 1, newLines: 1, oldText: 'b\r\n', newText: 'B\n' },
    },
    {
      ...row('b1', B, middle, work),
      before: omitted,
      hunk: { firstLine: 1, windowBefore: 0, oldLines: 1, newLines: 1, oldText: 'a\n', newText: 'A\n' },
    },
  ];
  const answer = foldPath({ ...input(base, work, rows), partial: true }, budget());
  expect(answer.result).toMatchObject({ verdict: 'unknown', reason: 'opaque' });
});

test('a new head in the middle of a replacement chain gives both remaining sides to the last writer', () => {
  const base = text('L');
  const a = text('A');
  const b = text('B');
  const c = text('C');
  const initial = folded(input(base, c, [row('a1', A, base, a), row('b1', B, a, b), row('c1', 'holder-c', b, c)]));
  const value = { ...input(base, c, []), head: contentOf(a) };
  const answer = folded(value, initial.record ?? undefined);
  expect(by(answer.result, 'removed')).toEqual([[a, 'holder-c']]);
  expect(by(answer.result, 'added')).toEqual([[c, 'holder-c']]);
});

test('a binary writer who returns last wins even when another holder appeared later in the record', () => {
  const base: Content = { kind: 'whole', digest: 'base' };
  const changed: Content = { kind: 'whole', digest: 'changed' };
  const work: Content = { kind: 'whole', digest: 'after' };
  const value: FoldInput = {
    base,
    head: base,
    working: work,
    normalized: false,
    rows: [
      { id: 'a1', holder: A, before: base, after: changed },
      { id: 'b1', holder: B, before: changed, after: work },
      { id: 'a2', holder: A, before: changed, after: work },
    ],
  };
  const answer = folded(value).result;
  expect([...answer.standing]).toEqual(['a1', 'a2']);
  expect(answer.verdict === 'proven' && answer.hands.map((hand) => hand.holder)).toEqual([A]);
});

test('a binary built on another holder’s uncommitted version credits the whole writer chain', () => {
  const base: Content = { kind: 'whole', digest: 'base' };
  const changed: Content = { kind: 'whole', digest: 'changed' };
  const work: Content = { kind: 'whole', digest: 'after' };
  const value: FoldInput = {
    base,
    head: base,
    working: work,
    normalized: false,
    rows: [
      { id: 'a1', holder: A, before: base, after: changed },
      { id: 'b1', holder: B, before: changed, after: work },
    ],
  };
  expect(folded(value).result.hands.map((hand) => hand.holder)).toEqual([A, B]);
});

test('fold memory evicts the least recently used path within its byte budget', () => {
  const state = startFold(contentOf(text('a')), false);
  if ('reason' in state) throw new Error(state.reason);
  const memory = new FoldMemory((state.bytes + 256) * 2);
  memory.keep('first', state);
  memory.keep('second', state);
  expect(memory.fold('first')).toBe(state);
  memory.keep('third', state);
  expect(memory.fold('first')).toBe(state);
  expect(memory.fold('second')).toBeUndefined();
  expect(memory.fold('third')).toBe(state);
  expect(memory.retained).toBeLessThanOrEqual(memory.limit);
  memory.keep('oversized', { ...state, bytes: memory.limit + 1 });
  expect(memory.fold('oversized')).toBeUndefined();
  memory.clear();
  expect(memory.retained).toBe(0);
});
