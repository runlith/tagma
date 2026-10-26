import { expect, test } from 'bun:test';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { stepsIn } from '@runlith/utils/sequenceDiff';
import { foldPath, type FoldInput } from './fold.js';
import {
  appendRow,
  contentOf,
  hunkWork,
  prepareHunk,
  recordStep,
  restoreFold,
  startFold,
  type CachedFold,
  type FoldRow,
  type FoldState,
} from './folding.js';
import { alignBase, projectFold, type BaseAlignment, type Proven } from './projection.js';
import { selectFold } from './selection.js';

const row = (id: string, holder: string, before: string | null, after: string | null): FoldRow => ({
  id,
  holder,
  before: contentOf(before),
  after: contentOf(after),
  hunk: before !== null && after !== null ? workspaceChangeHunk(before, after) : undefined,
});
const input = (base: string | null, work: string | null, rows: readonly FoldRow[]): FoldInput => ({
  base: contentOf(base),
  head: contentOf(base),
  working: contentOf(work),
  rows,
  normalized: false,
});
const budget = () => stepsIn(100_000);
const carrying = (holder: string) => ({ holders: new Set([holder]), nobody: false });
function counts(proven: Proven, added: number, removed: number): void {
  expect(proven.counts).toEqual({ added, removed });
  expect(proven.hands.reduce((sum, hand) => sum + hand.added, proven.nobody.added)).toBe(added);
  expect(proven.hands.reduce((sum, hand) => sum + hand.removed, proven.nobody.removed)).toBe(removed);
}
function prove(value: FoldInput, cached?: CachedFold, alignment?: BaseAlignment) {
  const answer = foldPath(value, budget(), cached, alignment);
  if (answer.result.verdict !== 'proven' || answer.result.lines === 'unweighed') throw new Error(JSON.stringify(answer.result));
  const a = value.head.kind === 'text' ? value.head.lines : [];
  const b = value.working.kind === 'text' ? value.working.lines : [];
  let previous = new Array<number>(b.length + 1).fill(0);
  for (const line of a) {
    const next = [0];
    for (let j = 0; j < b.length; j += 1)
      next.push(line === b[j] ? (previous[j] as number) + 1 : Math.max(previous[j + 1] as number, next[j] as number));
    previous = next;
  }
  const equal = previous[b.length] as number;
  counts(answer.result, b.length - equal, a.length - equal);
  return { ...answer, result: answer.result };
}
const stateOf = (value: ReturnType<typeof prove>): FoldState => {
  if (value.record === null) throw new Error('no record');
  return value.record;
};

test('a new write owns a returned observation after the earlier writer left the held chain', () => {
  const reverted = { ...input('b\n', 'a\n', [row('undo', 'A', 'b\n', 'a\n')]), head: contentOf('a\n') };
  const prior = stateOf(prove(reverted));
  const value = { ...reverted, working: contentOf('b\n'), rows: [...reverted.rows, row('fresh', 'B', 'a\n', 'b\n')] };
  for (const cached of [undefined, { kind: 'complete' as const, state: prior }]) {
    const answer = prove(value, cached);
    expect(answer.result.hands).toEqual([{ holder: 'B', added: 1, removed: 1 }]);
    expect(answer.result.nobody).toEqual({ added: 0, removed: 0 });
  }
});

test('an observation restored outside the record still has no writer', () => {
  const value = { ...input('b\n', 'b\n', [row('undo', 'A', 'b\n', 'a\n')]), head: contentOf('a\n') };
  const answer = prove(value);
  expect(answer.result.hands).toEqual([]);
  expect(answer.result.nobody).toEqual({ added: 1, removed: 1 });
});

test('a no-op row does not make an observed version an authored restoration', () => {
  const value = {
    ...input('b\n', 'b\n', [row('noop', 'A', 'b\n', 'b\n'), row('undo', 'A', 'b\n', 'a\n'), row('fresh', 'B', 'a\n', 'b\n')]),
    head: contentOf('a\n'),
  };
  expect(prove(value).result.hands).toEqual([{ holder: 'B', added: 1, removed: 1 }]);
});

test('deleting part of an uncommitted replacement leaves its base deletion with the surviving writer', () => {
  const value = input('c\n', 'x\n', [row('a', 'A', 'c\n', 'x\ny\n'), row('b', 'B', 'x\ny\n', 'x\n')]);
  const answer = prove(value);
  expect(answer.result.hands).toEqual([{ holder: 'A', added: 1, removed: 1 }]);
  expect(selectFold(answer.result, value.head, value.working, carrying('A'), new Set())).toMatchObject({ kind: 'whole', rows: ['a'] });
  expect(selectFold(answer.result, value.head, value.working, carrying('B'), new Set())).toEqual({ kind: 'none' });
  const final = prove(input('c\n', 'z\n', [...value.rows, row('c', 'C', 'x\n', 'z\n')]));
  expect(final.result.hands).toEqual([{ holder: 'C', added: 1, removed: 1 }]);
});

test('the actual LCS transfers a displaced anchor across three writers without inventing external lines', () => {
  const value = input('a\nx\n}\n', 'a\nx\na\n}\n', [
    row('b', 'B', 'a\nx\n}\n', 'a\n}\n'),
    row('a', 'A', 'a\n}\n', 'x\na\n}\n'),
    row('c', 'C', 'x\na\n}\n', 'a\nx\na\n}\n'),
  ]);
  const answer = prove(value);
  expect(answer.result.nobody).toEqual({ added: 0, removed: 0 });
  expect(answer.result.hands).toEqual([
    { holder: 'C', added: 1, removed: 0 },
    { holder: 'B', added: 0, removed: 0 },
    { holder: 'A', added: 0, removed: 0 },
  ]);
});

test('unknown folds cannot supply a reusable record and whole still names candidate rows', () => {
  const value = input('a\n', 'c\n', [
    row('a', 'A', 'a\n', 'b\n'),
    { id: 'b', holder: 'B', before: contentOf('b\n'), after: { kind: 'opaque', digest: 'lost' } },
  ]);
  const answer = foldPath(value, budget());
  expect(answer.result).toMatchObject({ verdict: 'unknown', reason: 'opaque', side: 'after', row: 'b' });
  expect(answer.record).toBeNull();
  expect(answer.working).toBeNull();
  expect(selectFold(answer.result, value.head, value.working, carrying('B'), new Set(), true)).toMatchObject({
    kind: 'whole',
    rows: ['a', 'b'],
    carried: { holders: ['A'], unknown: true },
  });
});

test('cached complete inputs skip folded ids and suffixes require the exact frontier cursor', () => {
  const value = input('a\n', 'c\n', [row('a', 'A', 'a\n', 'b\n'), row('b', 'B', 'b\n', 'c\n')]);
  const state = stateOf(prove(value));
  expect(state.last).toBe('b');
  expect(prove(value, { kind: 'complete', state }).record).toBe(state);
  const next = { ...value, rows: [value.rows[1] as FoldRow, row('c', 'C', 'c\n', 'd\n')], working: contentOf('d\n') };
  expect(prove(next, { kind: 'after', state, row: 'b' }).result.hands).toEqual([{ holder: 'C', added: 1, removed: 1 }]);
  for (const invalid of [
    foldPath(next, budget(), { kind: 'after', state, row: 'a' }),
    foldPath({ ...value, rows: value.rows.slice(1) }, budget(), { kind: 'complete', state }),
  ]) {
    expect(invalid.result).toMatchObject({ verdict: 'unknown', reason: 'sequence' });
    expect(invalid.record).toBeNull();
  }
});

test('the S2 hunk window and worker-prepared steps agree, including a stale window', () => {
  const value = input('a\n}\n}\n', 'a\nx\n}\n', [row('a', 'A', 'a\n}\n}\n', 'a\nx\n}\n')]);
  const state = startFold(value.base, false);
  if ('reason' in state) throw new Error(state.reason);
  const recorded = value.rows[0] as FoldRow;
  const request = hunkWork(state, recorded);
  if ('reason' in request) throw new Error(request.reason);
  const applied = recordStep(state, recorded, prepareHunk(request, budget()), budget());
  if ('reason' in applied) throw new Error(applied.reason);
  const verdict = projectFold(applied, value.head, value.working, budget());
  expect(verdict).toMatchObject({ verdict: 'proven', hands: [{ holder: 'A', added: 1, removed: 1 }] });
  if (verdict.verdict === 'proven') counts(verdict, 1, 1);
  const stale: FoldRow = {
    ...recorded,
    hunk: { firstLine: 1, oldLines: 1, newLines: 1, windowBefore: 0, oldText: 'never here\n', newText: 'changed\n' },
  };
  const work = hunkWork(state, stale);
  if ('reason' in work) throw new Error(work.reason);
  expect(prepareHunk(work, budget())).toMatchObject({ reason: 'opaque' });
  const fallback = recordStep(state, stale, prepareHunk(work, budget()), budget());
  if ('reason' in fallback) throw new Error(fallback.reason);
  expect(projectFold(fallback, value.head, value.working, budget())).toMatchObject({
    verdict: 'proven',
    hands: [{ holder: 'A', added: 1, removed: 1 }],
  });
  prove({ ...value, rows: [stale] });
});

test('a revert fact whose bytes differ falls back to its known after text', () => {
  const value = input('L\n', 'C\n', [
    row('a', 'A', 'L\n', 'A\n'),
    row('b', 'B', 'A\n', 'B\n'),
    { ...row('c', 'C', 'B\n', 'C\n'), reverts: ['a'] },
  ]);
  expect(prove(value).result.hands).toEqual([{ holder: 'C', added: 1, removed: 1 }]);
});

test('base alignment belongs to a pair of blobs and its normalization mode', () => {
  const value = input('a\n', 'A\n', [row('a', 'A', 'a\n', 'A\n')]);
  const state = stateOf(prove(value));
  const head = contentOf('prefix\na\n', 'blob-next');
  const alignment = alignBase({ before: state.base, after: head, normalized: false }, budget());
  for (const invalid of [
    { ...alignment, from: 'other-blob' },
    { ...alignment, normalized: true },
  ])
    expect(projectFold(state, head, value.working, budget(), invalid)).toMatchObject({ verdict: 'unknown', reason: 'alignment' });
});

test('a fold answers the base alignment it computed, and the next fold proves the same verdict reusing it', () => {
  const value = { ...input('a\n', 'A\nb\n', [row('a', 'A', 'a\n', 'A\n')]), head: contentOf('a\nb\n', 'blob-head') };
  const first = prove(value);
  if (first.alignment === null) throw new Error('a moved head must be aligned');
  expect(prove(value, undefined, first.alignment).result).toEqual(first.result);
});

test('a cold fold over the rows still held releases retired history while preserving the remaining writer and inverse', () => {
  const rows = Array.from({ length: 64 }, (_, at) => row(String(at), 'A', `${at}\n`, `${at + 1}\n`));
  const old = stateOf(prove(input('0\n', '64\n', rows)));
  const state = stateOf(prove(input('63\n', '64\n', rows.slice(-1))));
  expect(state.bytes).toBeLessThan(old.bytes / 4);
  const next = { base: state.base, head: state.base, working: contentOf('64\n'), rows: [], normalized: false };
  expect(prove(next, { kind: 'after', state, row: state.last }).result.hands).toEqual([{ holder: 'A', added: 1, removed: 1 }]);
  const inverse = restoreFold(state, new Set(['63']), budget());
  if ('reason' in inverse) throw new Error(inverse.reason);
  expect(inverse.text).toBe('63\n');
  expect(
    prove({ ...next, working: contentOf(inverse.text) }, { kind: 'after', state: inverse.state, row: inverse.state.last }).result.hands,
  ).toEqual([]);
});

test('delete and recreate transfers the whole file while undo restores the deletion owner', () => {
  const value = input('a\n', 'b\n', [row('a', 'A', 'a\n', null), row('b', 'B', null, 'b\n')]);
  const answer = prove(value);
  expect(answer.result.hands).toEqual([{ holder: 'B', added: 1, removed: 1 }]);
  expect(answer.result.overwritten.get('a')).toEqual(['b']);
  const inverse = restoreFold(stateOf(answer), new Set(['b']), budget());
  if ('reason' in inverse) throw new Error(inverse.reason);
  expect(inverse.text).toBeNull();
  expect(
    prove({ ...value, rows: [], working: contentOf(null) }, { kind: 'after', state: inverse.state, row: inverse.state.last }).result.hands,
  ).toEqual([{ holder: 'A', added: 0, removed: 1 }]);
});

test('undo restores the actual bytes removed after an earlier newline normalization', () => {
  const value = { ...input('a\r\nb\r\n', null, [row('a', 'A', 'a\r\nb\r\n', 'a\nB\n'), row('b', 'B', 'a\nB\n', null)]), normalized: true };
  const answer = foldPath(value, budget());
  if (answer.result.verdict !== 'proven' || answer.record === null) throw new Error(JSON.stringify(answer.result));
  counts(answer.result, 0, 2);
  const inverse = restoreFold(answer.record, new Set(['b']), budget(), value.working);
  if ('reason' in inverse) throw new Error(inverse.reason);
  expect(inverse.text).toBe('a\nB\n');
  const verdict = projectFold(inverse.state, value.head, contentOf(inverse.text), budget());
  if (verdict.verdict !== 'proven') throw new Error(verdict.reason);
  counts(verdict, 1, 1);
  expect(verdict.hands).toEqual([{ holder: 'A', added: 1, removed: 1 }]);
});

test('a whole-marked row with matching readable neighbours becomes a textual step', () => {
  const value = input('a\n', 'c\n', [
    { id: 'a', holder: 'A', before: contentOf('a\n'), after: { kind: 'whole', digest: contentOf('b\n').digest as string } },
    row('b', 'B', 'b\n', 'c\n'),
  ]);
  expect(prove(value).result.hands).toEqual([{ holder: 'B', added: 1, removed: 1 }]);
});

test('two hundred positional edits and their inverse do not rescan a hundred-thousand-line frontier', () => {
  const lines = Array.from({ length: 100_000 }, (_, at) => `line ${at}\n`);
  const base = contentOf(lines.join(''));
  if (base.kind !== 'text') throw new Error('the fixture is a text file');
  const initial = startFold(base, false);
  if ('reason' in initial) throw new Error(initial.reason);
  let state = initial;
  const selected = new Set<string>();
  for (let i = 0; i < 200; i += 1) {
    const at = i * 499;
    const changed: FoldRow = {
      id: `change-${i}`,
      holder: 'A',
      before: { kind: 'opaque', digest: state.snapshot.digest },
      after: { kind: 'opaque', digest: `after-${i}` },
      hunk: { firstLine: at + 1, oldLines: 1, newLines: 1, windowBefore: 0, oldText: lines[at] as string, newText: `changed ${i}\n` },
    };
    const next = appendRow(state, changed, stepsIn(32));
    if ('reason' in next) throw new Error(next.reason);
    state = next;
    selected.add(changed.id);
  }
  const inverse = restoreFold(state, selected, stepsIn(1000));
  if ('reason' in inverse) throw new Error(inverse.reason);
  expect(inverse.text).toBe(base.text);
  expect(inverse.restored.length).toBe(200);
  expect(inverse.blocked).toEqual([]);
  expect(inverse.partial).toEqual([]);
  const verdict = projectFold(inverse.state, base, base, stepsIn(0));
  if (verdict.verdict !== 'proven') throw new Error(verdict.reason);
  counts(verdict, 0, 0);
});

test('distant function edits in 12000 repetitive lines fit a small walk budget', () => {
  const fn = (i: number) => [`function f${i}() {\n`, `  const v = ${i};\n`, '\n', '  return v;\n', '}\n', '\n'];
  const base = Array.from({ length: 2000 }, (_, at) => fn(at)).flat();
  const first = [...base];
  first.splice(60, 6);
  const work = [...first];
  work.splice(work.length - 6, 0, ...fn(99999));
  const value = input(base.join(''), work.join(''), [
    row('a', 'A', base.join(''), first.join('')),
    row('b', 'B', first.join(''), work.join('')),
  ]);
  let used = 0;
  const answer = foldPath(value, { expired: (amount) => (used += amount) > 5000 });
  if (answer.result.verdict !== 'proven') throw new Error(JSON.stringify({ ...answer.result, used }));
  counts(answer.result, 6, 6);
  expect(answer.result.regions.length).toBe(2);
  expect(answer.result.hands).toEqual([
    { holder: 'A', added: 0, removed: 6 },
    { holder: 'B', added: 6, removed: 0 },
  ]);
  expect(used).toBeLessThan(1000);
});

test('a three-line edit of a large file lands apart from a peer migration that reindented every line', () => {
  const tests = Array.from({ length: 900 }, (_, at) => [
    `test('t${at}', () => {`,
    `  const v = ${at};`,
    `  expect(v).toBe(${at});`,
    '});',
    '',
  ]).flat();
  const text = (rows: readonly string[]) => `${rows.join('\n')}\n`;
  const migrated = ["describe('runner', () => {", ...tests.map((line) => (line === '' ? '' : `  ${line}`)), '});'];
  const added = ['// stop reason', 'expect(stopped).toBe(true);', '// end'];
  const work = [...migrated.slice(0, 2006), ...added, ...migrated.slice(2006)];
  const value = input(text(tests), text(work), [row('m', 'M', text(tests), text(migrated)), row('a', 'A', text(migrated), text(work))]);
  const answer = foldPath(value, stepsIn(2_000_000));
  expect(selectFold(answer.result, value.head, value.working, carrying('A'), new Set())).toMatchObject({
    kind: 'text',
    text: text([...tests.slice(0, 2005), ...added, ...tests.slice(2005)]),
    carried: { holders: [] },
  });
});

test('a peer replacing a block joined by commit steps owns the formed line’s deletion', () => {
  const base = 'one\nconst three =\n  3;\nfour\n';
  const work = 'one\nconst three = 3; // peer\nfour\n';
  const value: FoldInput = {
    ...input(base, work, [row('peer', 'A', base, work)]),
    head: contentOf('one\nconst three = 3;\nfour\n'),
    formed: [{ formed: 'const three = 3;\n', from: ['const three =\n', '  3;\n'] }],
  };
  const answer = prove(value).result;
  expect(answer.hands).toEqual([{ holder: 'A', added: 1, removed: 1 }]);
  expect(answer.nobody).toEqual({ added: 0, removed: 0 });
  expect(selectFold(answer, value.head, value.working, carrying('A'), new Set())).toMatchObject({
    kind: 'whole',
    carried: { holders: [], external: false },
  });
});

test('one changed line of a joined block carries its untouched residue with the formed line', () => {
  const base = 'one\nconst three =\n  3;\nfour\n';
  const work = 'one\nconst three =\n  33;\nfour\n';
  const value: FoldInput = {
    ...input(base, work, [row('peer', 'A', base, work)]),
    head: contentOf('one\nconst three = 3;\nfour\n'),
    formed: [{ formed: 'const three = 3;\n', from: ['const three =\n', '  3;\n'] }],
  };
  const answer = prove(value).result;
  expect(answer.hands).toEqual([{ holder: 'A', added: 2, removed: 1 }]);
  expect(answer.nobody).toEqual({ added: 0, removed: 0 });
  expect(selectFold(answer, value.head, value.working, carrying('A'), new Set())).toMatchObject({
    kind: 'whole',
    carried: { holders: [], external: false },
  });
});

test('a joined block whose source lines two writers hold is selected whole with the other author named', () => {
  const base = 'one\nconst three =\n  3;\nfour\n';
  const peer = 'one\nconst three: number =\n  3;\nfour\n';
  const work = 'one\nconst three: number =\n  33;\nfour\n';
  const value: FoldInput = {
    ...input(base, work, [row('peer', 'A', base, peer), row('mine', 'B', peer, work)]),
    head: contentOf('one\nconst three = 33;\nfour\n'),
    formed: [{ formed: 'const three = 33;\n', from: ['const three =\n', '  33;\n'] }],
  };
  const answer = prove(value).result;
  expect(answer.nobody).toEqual({ added: 0, removed: 0 });
  expect(selectFold(answer, value.head, value.working, carrying('A'), new Set())).toMatchObject({
    kind: 'text',
    text: work,
    carried: { holders: ['B'], external: false },
  });
  expect(selectFold(answer, value.head, value.working, carrying('B'), new Set())).toMatchObject({
    kind: 'text',
    text: work,
    carried: { holders: ['A'], external: false },
  });
});

test('inserted unformed text never takes an unrecorded deletion of the line commit steps formed', () => {
  const base = 'one\nconst three = 3;   \nfour\n';
  const absent = 'one\nfour\n';
  const work = 'one\nconst three = 3;   \nconst three = 3;   \nfour\n';
  const value: FoldInput = {
    ...input(base, work, [row('peer', 'A', absent, work)]),
    head: contentOf('one\nconst three = 3;\nfour\n'),
    formed: [{ formed: 'const three = 3;\n', from: ['const three = 3;   \n'] }],
  };
  const answer = prove(value).result;
  expect(answer.hands).toEqual([{ holder: 'A', added: 2, removed: 0 }]);
  expect(answer.nobody).toEqual({ added: 0, removed: 1 });
  expect(selectFold(answer, value.head, value.working, carrying('A'), new Set())).toMatchObject({
    kind: 'text',
    text: 'one\nconst three = 3;   \nconst three = 3;   \nconst three = 3;\nfour\n',
    carried: { holders: [], external: false },
  });
});
