import { expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Result } from 'effect';
import { Git, GitUnavailable } from './Git.js';
import { ChunkedListing, diffCommitsAt, parseDiffTreeZero, parseTreeIds, pointedTreeAt, treePresentAt } from './trees.js';

test('a listing changed by additions, edits and deletions equals one listed whole, and shares every chunk the change does not reach', () => {
  const objects = new Map<string, string>(),
    sizes = new Map<string, number>();
  for (let at = 0; at < 20000; at += 1) {
    const path = `dir${String(at % 40).padStart(2, '0')}/file${String(at).padStart(5, '0')}.ts`;
    objects.set(path, `o${at}`);
    sizes.set(path, at);
  }
  const base = ChunkedListing.of(objects, sizes);
  const changes = [
    { path: 'dir00/file00000.ts', object: 'edited', size: 7 },
    { path: 'dir05/added.ts', object: 'new', size: 3 },
    { path: 'aaa/first.ts', object: 'first', size: 1 },
    { path: 'zzz/last.ts', object: 'last', size: 2 },
    { path: 'dir20/file00020.ts', object: null, size: 0 },
  ];
  const next = base.with(changes);
  for (const { path, object, size } of changes) {
    if (object === null) {
      objects.delete(path);
      sizes.delete(path);
    } else {
      objects.set(path, object);
      sizes.set(path, size);
    }
  }
  const whole = ChunkedListing.of(objects, sizes);
  expect([...next.ordered]).toEqual([...whole.ordered]);
  expect(new Map(next.objects)).toEqual(new Map(whole.objects));
  expect(new Map(next.sizes)).toEqual(new Map(whole.sizes));
  expect([...next.ordered.under('dir05')]).toEqual([...whole.ordered].filter((path) => path.startsWith('dir05/')));
  expect(next.ordered.size).toBe(whole.ordered.size);
  expect([...next.chunks].filter((chunk) => base.chunks.includes(chunk)).length).toBeGreaterThanOrEqual([...base.chunks].length - 5);
  expect([...base.ordered]).not.toContain('dir05/added.ts');
});

it.effect('point lookups preserve literal paths and missing files over a bounded argv transport', () =>
  Effect.gen(function* () {
    const tree = 'a'.repeat(40);
    const blob = 'b'.repeat(40);
    const file = `src/${'long-'.repeat(20)}file [x]\n.ts`;
    const git = Git.of({
      run: (args, options) => {
        if (args.reduce((bytes, arg) => bytes + Buffer.byteLength(arg) + 1, 0) > 160)
          return Effect.fail(new GitUnavailable({ command: args, reason: 'the argv transport is full' }));
        const stdout =
          String(options?.stdin)
            .split('\0')
            .slice(0, -1)
            .map((name) => (name === tree ? `${tree} tree 0` : name === `${tree}:${file}` ? `${blob} blob 7` : `${name} missing`))
            .join('\0') + '\0';
        return Effect.succeed({ status: 0, stdout, stderr: '', overflow: false, messageOverflow: false });
      },
    });
    const listed = yield* pointedTreeAt(git, '/repo', tree, [file, 'missing.ts']);
    expect([...listed.objects]).toEqual([[file, blob]]);
    expect([...listed.sizes]).toEqual([[file, 7]]);
  }),
);

it.effect('an absent optional tree differs from an unreadable git process', () =>
  Effect.gen(function* () {
    const tree = 'a'.repeat(40);
    const missing = Git.of({
      run: () =>
        Effect.succeed({
          status: 0,
          stdout: `${tree} missing\0`,
          stderr: '',
          overflow: false,
          messageOverflow: false,
        }),
    });
    expect(yield* treePresentAt(missing, '/repo', tree)).toBe(false);
    const unreadable = Git.of({ run: (args) => Effect.fail(new GitUnavailable({ command: args, reason: 'unreachable' })) });
    const failed = yield* Effect.result(treePresentAt(unreadable, '/repo', tree));
    expect(Result.isFailure(failed) && failed.failure._tag).toBe('GitUnreadable');
  }),
);

test('tree pairs refuse missing or malformed ids', () => {
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(64);
  expect(parseTreeIds(`${a}\n${b}\n`)).toEqual({ baseTree: a, builtTree: b });
  expect(parseTreeIds(a)).toBeUndefined();
  expect(parseTreeIds(`${a}\nnot-a-tree`)).toBeUndefined();
});

it.effect(
  'a batched commit diff answers each pair under its own commit, an empty one included, and refuses an answer missing a commit',
  () =>
    Effect.gen(function* () {
      const [root, one, two, empty] = ['1', '2', '3', '4'].map((digit) => digit.repeat(40)) as [string, string, string, string];
      const [a, x, b] = ['a', 'c', 'e'].map((digit) => digit.repeat(40)) as [string, string, string];
      const zero = '0'.repeat(40);
      const answering = (stdout: string) =>
        Git.of({ run: () => Effect.succeed({ status: 0, stdout, stderr: '', overflow: false, messageOverflow: false }) });
      const whole = `${one}\0:000000 100644 ${zero} ${a} A\0a\0${two}\0:100644 100644 ${a} ${x} M\0a\0:000000 100644 ${zero} ${b} A\0:b c\0`;
      const pairs = [
        { from: root, to: one },
        { from: one, to: two },
        { from: two, to: empty },
      ];
      const diffs = yield* diffCommitsAt(answering(`${whole}${empty}\0`), '/repo', pairs);
      expect(diffs.map((changes) => changes.map(({ path, status }) => `${status} ${path}`))).toEqual([['A a'], ['M a', 'A :b c'], []]);
      const cut = yield* Effect.result(diffCommitsAt(answering(whole), '/repo', pairs));
      expect(Result.isFailure(cut) && cut.failure._tag).toBe('GitUnreadable');
      const short = yield* Effect.result(diffCommitsAt(answering(whole), '/repo', [{ from: root, to: one.slice(0, 8) }]));
      expect(Result.isFailure(short) && short.failure._tag).toBe('GitUnreadable');
    }),
);

test('diff-tree zero records null object sides and literal names', () => {
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);
  expect(parseDiffTreeZero(`:100644 100644 ${a} ${b} M\0dir/a[b].ts\0:000000 100644 ${'0'.repeat(40)} ${b} A\0new.ts\0`)).toEqual([
    { path: 'dir/a[b].ts', before: a, after: b, mode: '100644', status: 'M' },
    { path: 'new.ts', before: null, after: b, mode: '100644', status: 'A' },
  ]);
});
