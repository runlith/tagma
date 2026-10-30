import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { join } from 'node:path';
import { toolDecode } from '@runlith/agent/tool/arguments';
import { Effect } from 'effect';
import { createTools } from './index';
import { answer, call, createTempDir, host, options } from './testing/toolHarness';
import { TOOL_OUTPUT_MAX_BYTES } from '@runlith/agent/ToolOutputSpool';

const cursorOf = (text: string): string => {
  const cursor = text.match(/cursor="([^"]+)"/)?.[1];
  if (!cursor) throw new Error(`a cut page must print its cursor:\n${text}`);
  return cursor;
};

const entriesOf = (text: string): string[] => {
  const lines = text.split('\n');
  const body = lines.slice(lines.indexOf('<entries>') + 1, lines.indexOf('</entries>'));
  return body.filter((line) => line.length > 0 && !line.startsWith('('));
};

const rowsOf = (text: string): string[] => {
  const lines = text.split('\n');
  return lines.at(-1)?.startsWith('(') === true ? lines.slice(0, -1) : lines;
};

it.live('grep preserves the regex source, error position and cause in a bad-pattern refusal', () =>
  Effect.gen(function* () {
    const dir = yield* createTempDir();
    yield* host.writeFile(join(dir, 'source.ts'), 'token\n', 'utf8');
    const tools = createTools(options({ cwd: dir }));
    const pattern = 'records.held|record.held|changes.held|\\({';

    const result = yield* answer(tools.grep, { pattern, output_mode: 'content', limit: 1 });

    expect(result.refusal?.code).toBe('bad-pattern');
    const diagnosis = String(result.value);
    expect(diagnosis).toContain('records.held|record.held|changes.held');
    expect(diagnosis).toContain('^');
    expect(diagnosis).toContain('repetition quantifier expects a valid decimal');
  }),
);

const BASE_MS = 1_700_000_000_000;

const aged = (path: string, index: number) => {
  const at = new Date(BASE_MS + index * 60_000);
  return host.utimes(path, at, at);
};

it.live('glob pages newest-first to the end, and a cursor alone continues the walk', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    for (let index = 0; index < 5; index++) {
      const file = join(root, `file-${index}.txt`);
      yield* host.writeFile(file, 'x', 'utf8');
      yield* aged(file, index);
    }
    const tools = createTools(options({ cwd: root }));

    const first = yield* call(tools.glob, { pattern: '*.txt', limit: 2 });
    const head = first.split('\n');
    expect(head).toHaveLength(3);
    expect(head[0]).toContain('file-4.txt');
    expect(head[1]).toContain('file-3.txt');

    const second = yield* call(tools.glob, { cursor: cursorOf(first), limit: 2 });
    const middle = second.split('\n');
    expect(middle).toHaveLength(3);
    expect(middle[0]).toContain('file-2.txt');
    expect(middle[1]).toContain('file-1.txt');
    expect(middle[2]).toContain('next: glob(cursor="');

    const last = yield* call(tools.glob, { cursor: cursorOf(second) });
    const tail = last.split('\n');
    expect(tail).toHaveLength(2);
    expect(tail[0]).toContain('file-0.txt');
  }),
);

it.live('grep answers the paths of matching files newest first by default, and pages them to the end with no repeat or skip', () =>
  Effect.gen(function* () {
    const dir = yield* createTempDir();
    for (const [index, name] of ['a.ts', 'b.ts', 'c.ts'].entries()) {
      const file = join(dir, name);
      yield* host.writeFile(file, 'const token = 1;\nconst other = token;\n', 'utf8');
      yield* aged(file, index);
    }
    const tools = createTools(options({ cwd: dir }));

    const whole = yield* call(tools.grep, { pattern: 'token' });
    expect(rowsOf(whole)).toEqual(['c.ts', 'b.ts', 'a.ts']);
    expect(whole).not.toContain('cursor=');

    const first = yield* call(tools.grep, { pattern: 'token', limit: 2 });
    expect(rowsOf(first)).toEqual(['c.ts', 'b.ts']);

    const last = yield* call(tools.grep, { pattern: 'token', limit: 2, cursor: cursorOf(first) });
    expect(rowsOf(last)).toEqual(['a.ts']);
    expect(last).not.toContain('cursor=');
  }),
);

it.live('a grep cursor whose earlier rows changed refuses instead of skipping', () =>
  Effect.gen(function* () {
    const dir = yield* createTempDir();
    for (const [index, name] of ['a.ts', 'b.ts', 'c.ts'].entries()) {
      const file = join(dir, name);
      yield* host.writeFile(file, 'const token = 1;\n', 'utf8');
      yield* aged(file, index);
    }
    const tools = createTools(options({ cwd: dir }));

    const first = yield* call(tools.grep, { pattern: 'token', limit: 1 });
    expect(rowsOf(first)).toEqual(['c.ts']);
    yield* host.writeFile(join(dir, 'c.ts'), 'const other = 1;\n', 'utf8');

    expect(yield* call(tools.grep, { pattern: 'token', limit: 1, cursor: cursorOf(first) })).toContain('cursor-stale');
  }),
);

it.live('grep content answers ripgrep lines with the context asked for, and a single file without its name', () =>
  Effect.gen(function* () {
    const dir = yield* createTempDir();
    const target = join(dir, 'six.ts');
    yield* host.writeFile(target, 'one\ntwo\nneedle\nthree\nfour\nfive\nsix\nneedle needle\n', 'utf8');
    yield* host.writeFile(join(dir, 'span.ts'), 'open (\nclose )\n', 'utf8');
    yield* aged(target, 1);
    yield* aged(join(dir, 'span.ts'), 0);
    const tools = createTools(options({ cwd: dir }));

    expect(rowsOf(yield* call(tools.grep, { pattern: 'needle', output_mode: 'content', after: 1 }))).toEqual([
      'six.ts:3:needle',
      'six.ts-4-three',
      '--',
      'six.ts:8:needle needle',
    ]);
    expect(rowsOf(yield* call(tools.grep, { pattern: 'needle', path: target, output_mode: 'content', before: 1 }))).toEqual([
      '2-two',
      '3:needle',
      '--',
      '7-six',
      '8:needle needle',
    ]);
    expect(rowsOf(yield* call(tools.grep, { pattern: 'e', output_mode: 'content', before: 1, limit: 3 }))).toEqual([
      'six.ts:1:one',
      'six.ts-2-two',
      'six.ts:3:needle',
    ]);
    expect(rowsOf(yield* call(tools.grep, { pattern: 'needle', output_mode: 'count' }))).toEqual(['six.ts:3']);
    expect(rowsOf(yield* call(tools.grep, { pattern: 'open.*close', multiline: true, output_mode: 'content' }))).toEqual([
      'span.ts:1:open (',
      'span.ts:2:close )',
    ]);
  }),
);

it.live('grep content cuts a page of long lines inside the tool-output envelope and continues it with the cursor', () =>
  Effect.gen(function* () {
    const dir = yield* createTempDir();
    const lines = Array.from({ length: 40 }, (_, index) => `needle-${index}-${'x'.repeat(1_990)}`);
    yield* host.writeFile(join(dir, 'wide.ts'), `${lines.join('\n')}\n`, 'utf8');
    const tools = createTools(options({ cwd: dir }));

    const first = yield* call(tools.grep, { pattern: 'needle', output_mode: 'content' });
    expect(Buffer.byteLength(first, 'utf8')).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_BYTES);
    const shown = first.split('\n').filter((line) => line.startsWith('wide.ts:')).length;
    expect(shown).toBeLessThan(40);

    const rest = yield* call(tools.grep, { pattern: 'needle', output_mode: 'content', cursor: cursorOf(first) });
    expect(rest).toContain(`wide.ts:${shown + 1}:needle-${shown}-`);
  }),
);

it.live('every grep mode hands the files on its page to law delivery as found, and a file read as read', () =>
  Effect.gen(function* () {
    const dir = yield* createTempDir();
    for (const [index, name] of ['a.ts', 'b.ts'].entries()) {
      const file = join(dir, name);
      yield* host.writeFile(file, 'const token = 1;\n', 'utf8');
      yield* aged(file, index);
    }
    const tools = createTools(options({ cwd: dir }));
    for (const output_mode of ['files_with_matches', 'content', 'count']) {
      expect((yield* answer(tools.grep, { pattern: 'token', output_mode, limit: 1 })).shown).toEqual([
        { path: join(dir, 'b.ts'), as: 'found' },
      ]);
    }
    expect((yield* answer(tools.read, { path: 'a.ts' })).shown).toEqual([{ path: join(dir, 'a.ts'), as: 'read' }]);
  }),
);

it.live('a cursor handed to another narrowing refuses cursor-stale', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const first = join(root, 'first');
    const second = join(root, 'second');
    yield* host.mkdir(first);
    yield* host.mkdir(second);
    for (const name of ['a.ts', 'b.ts', 'c.ts']) yield* host.writeFile(join(first, name), 'const token = 1;\n', 'utf8');
    yield* host.writeFile(join(second, 'other.ts'), 'const token = 1;\n', 'utf8');
    const tools = createTools(options({ cwd: root }));

    const globCursor = cursorOf(yield* call(tools.glob, { pattern: '*.ts', limit: 1 }));
    expect(yield* call(tools.glob, { pattern: '*.md', cursor: globCursor })).toContain('cursor-stale');
    expect(yield* call(tools.glob, { pattern: '*.ts', path: second, cursor: globCursor })).toContain('cursor-stale');
    expect(yield* call(tools.grep, { pattern: 'token', cursor: globCursor })).toContain('bad-cursor');

    const grepCursor = cursorOf(yield* call(tools.grep, { pattern: 'token', limit: 1 }));
    expect(grepCursor.length).toBeLessThan(24);
    expect(yield* call(tools.grep, { pattern: 'other', cursor: grepCursor })).toContain('cursor-stale');
    expect(yield* call(tools.grep, { pattern: 'token', glob: '*.md', cursor: grepCursor })).toContain('cursor-stale');
    expect(yield* call(tools.grep, { pattern: 'token', output_mode: 'content', cursor: grepCursor })).toContain('cursor-stale');
    expect(yield* call(tools.grep, { pattern: 'token', cursor: grepCursor })).not.toContain('cursor-stale');

    const lsCursor = cursorOf(yield* call(tools.ls, { path: first, limit: 1 }));
    expect(yield* call(tools.ls, { path: second, cursor: lsCursor })).toContain('cursor-stale');

    const dirCursor = cursorOf(yield* call(tools.read, { path: first, limit: 1 }));
    expect(yield* call(tools.read, { path: second, cursor: dirCursor })).toContain('cursor-stale');
  }),
);

it.live('a word no read minted refuses bad-cursor, and a patternless fresh call names the pattern', () =>
  Effect.gen(function* () {
    const dir = yield* createTempDir();
    yield* host.writeFile(join(dir, 'a.ts'), 'const token = 1;\n', 'utf8');
    const tools = createTools(options({ cwd: dir }));

    expect(yield* call(tools.glob, { pattern: '*.ts', cursor: 'definitely-not-a-cursor' })).toContain('bad-cursor');
    expect(yield* call(tools.glob, { cursor: 'definitely-not-a-cursor' })).toContain('bad-cursor');
    expect(yield* call(tools.glob, {})).toContain('pattern is required');
    expect(yield* call(tools.grep, { pattern: 'token', cursor: 'definitely-not-a-cursor' })).toContain('bad-cursor');
    expect(yield* call(tools.ls, { cursor: 'definitely-not-a-cursor' })).toContain('bad-cursor');
    expect(yield* call(tools.read, { path: dir, cursor: 'definitely-not-a-cursor' })).toContain('bad-cursor');
  }),
);

it.live('ls pages a sorted listing to its end without a repeated or skipped entry', () =>
  Effect.gen(function* () {
    const dir = yield* createTempDir();
    for (const name of ['c.txt', 'a.txt', 'b.txt']) yield* host.writeFile(join(dir, name), 'x', 'utf8');
    const tools = createTools(options({ cwd: dir }));

    const first = yield* call(tools.ls, { limit: 2 });
    expect(entriesOf(first)).toEqual(['a.txt', 'b.txt']);
    expect(first).toContain('Showing 2 of 3 entries');
    const last = yield* call(tools.ls, { cursor: cursorOf(first) });
    expect(entriesOf(last)).toEqual(['c.txt']);
    expect(last).toContain('(3 entries)');
    expect(last).not.toContain('next:');
  }),
);

it.live('read pages a directory with cursor, and refuses each control on the wrong branch', () =>
  Effect.gen(function* () {
    const dir = yield* createTempDir();
    for (let index = 0; index < 5; index++) yield* host.writeFile(join(dir, `file-${index}.txt`), 'x', 'utf8');
    yield* host.writeFile(join(dir, 'notes.md'), '# notes\nline two\n', 'utf8');
    const tools = createTools(options({ cwd: dir }));

    const first = yield* call(tools.read, { path: dir, limit: 2 });
    expect(rowsOf(first)).toEqual(['file-0.txt', 'file-1.txt']);

    const second = yield* call(tools.read, { path: dir, limit: 2, cursor: cursorOf(first) });
    expect(rowsOf(second)).toEqual(['file-2.txt', 'file-3.txt']);

    const last = yield* call(tools.read, { path: dir, limit: 2, cursor: cursorOf(second) });
    expect(rowsOf(last)).toEqual(['file-4.txt', 'notes.md']);
    expect(last).not.toContain('cursor=');
    expect(yield* call(tools.read, { path: dir })).not.toContain('cursor=');

    expect(yield* call(tools.read, { path: dir, offset: 2 })).toContain('with cursor, not offset');
    expect(yield* call(tools.read, { path: join(dir, 'notes.md'), cursor: cursorOf(first) })).toContain('with offset, not cursor');
  }),
);

it.effect('a page past the ceiling is refused at the door', () =>
  Effect.gen(function* () {
    const tools = createTools(options({ cwd: '/tmp' }));

    yield* Effect.flip(toolDecode(tools.glob, { pattern: '*.ts', limit: 99999 }));
    yield* Effect.flip(toolDecode(tools.grep, { pattern: 'x', limit: 99999 }));
    yield* Effect.flip(toolDecode(tools.ls, { limit: 99999 }));
    expect(yield* toolDecode(tools.glob, { pattern: '*.ts', limit: 1 })).toBeDefined();
  }),
);
