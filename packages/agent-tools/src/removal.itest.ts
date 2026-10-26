import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { ToolAnswer, ToolFailed, toolExecute } from '@runlith/agent/tool';
import { Effect, FileSystem, Layer, PlatformError } from 'effect';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { createDeleteTool } from './delete';
import type { RemovalReport } from './removal/model';
import { unthreadedCaller } from './testing/caller';
import { answer, createTempDir, exists, host, options, preparationOf, recorder } from './testing/toolHarness';
import { machineWorld } from './world/machine';
import { landedOf } from './WorkspaceChanges';

const counted = (calls: { count: number }) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.map(FileSystem.FileSystem, (fs) =>
      FileSystem.FileSystem.of(
        Object.fromEntries(
          Object.entries(fs).map(([name, member]) => [
            name,
            typeof member === 'function'
              ? (...args: unknown[]) => {
                  calls.count += 1;
                  return member(...args);
                }
              : member,
          ]),
        ) as unknown as FileSystem.FileSystem,
      ),
    ),
  ).pipe(Layer.provide(machineWorld.files));

it.live('preparing a recursive removal reads as much of the filesystem for a large tree as for a small one', () =>
  Effect.gen(function* () {
    const root = yield* host.realpath(yield* createTempDir());
    yield* host.mkdir(join(root, 'tree/nested'), { recursive: true });
    yield* host.writeFile(join(root, 'tree/nested/first'), 'x');
    const calls = { count: 0 };
    const tool = createDeleteTool(options({ cwd: root, world: { ...machineWorld, files: counted(calls) } }));
    const input = { args: ['-r', '--', 'tree'] };
    yield* preparationOf(tool, input);
    const small = calls.count;
    for (let index = 0; index < 40; index++) yield* host.writeFile(join(root, `tree/nested/file-${index}`), 'x');
    calls.count = 0;
    const preparation = yield* preparationOf(tool, input);
    expect(calls.count).toBe(small);
    expect(preparation?.subjects).toEqual([{ kind: 'write', value: 'tree', file: true, entry: true, tree: true }]);
  }),
);

it.live('a walked entry replaced while its loss is being read remains untouched even with identical bytes', () =>
  Effect.gen(function* () {
    const root = yield* host.realpath(yield* createTempDir());
    const selected = join(root, 'tree/selected.txt');
    const replacement = join(root, 'replacement.txt');
    const bytes = 'same contents\n';
    yield* host.mkdir(join(root, 'tree'));
    yield* host.writeFile(selected, bytes);
    yield* host.writeFile(replacement, bytes);
    const recorded = recorder();
    const result = yield* answer(
      createDeleteTool(
        options({
          cwd: root,
          changes: {
            ...recorded.port,
            records: (path) => (path === selected ? Effect.as(host.rename(replacement, selected), true) : Effect.succeed(true)),
          },
        }),
      ),
      { args: ['-r', 'tree'], glob: false },
    );
    const report = result.value as RemovalReport;
    expect(report.status).toBe('partial');
    expect(report.results.map((row) => [relative(root, row.path), row.status, row.issue?.code])).toEqual([
      ['tree/selected.txt', 'failed', 'file-changed'],
      ['tree', 'failed', 'directory-not-empty'],
    ]);
    expect(report.counts.removed).toBe(0);
    expect(yield* host.readFile(selected, 'utf8')).toBe(bytes);
    expect(recorded.changes).toEqual([]);
  }),
);

it.live('a directory replaced while it is being walked keeps its replacement and nothing more in it is removed', () =>
  Effect.gen(function* () {
    const root = yield* host.realpath(yield* createTempDir());
    const names = ['first', 'second', 'third'];
    yield* host.mkdir(join(root, 'tree'));
    for (const name of names) yield* host.writeFile(join(root, 'tree', name), 'selected');
    let swapped = false;
    const swap = Effect.gen(function* () {
      swapped = true;
      yield* host.rename(join(root, 'tree'), join(root, 'moved'));
      yield* host.mkdir(join(root, 'tree'));
      for (const name of names) yield* host.writeFile(join(root, 'tree', name), 'replacement');
    });
    const tool = createDeleteTool(
      options({ cwd: root, changes: { ...recorder().port, records: () => Effect.as(swapped ? Effect.void : swap, true) } }),
    );
    const report = (yield* answer(tool, { args: ['-r', 'tree'] })).value as RemovalReport;
    expect(report.results.map((row) => [relative(root, row.path), row.status, row.issue?.code])).toEqual([
      ['tree', 'failed', 'file-changed'],
    ]);
    expect(report.counts.removed).toBe(0);
    expect((yield* host.readdir(join(root, 'tree'))).sort()).toEqual(names);
    expect((yield* host.readdir(join(root, 'moved'))).sort()).toEqual(names);
  }),
);

it.live('a recursive removal records entries the change record keeps and removes the rest unread', () =>
  Effect.gen(function* () {
    const root = yield* host.realpath(yield* createTempDir());
    yield* host.mkdir(join(root, 'tree/checkout'), { recursive: true });
    yield* host.mkdir(join(root, 'tree/outside'), { recursive: true });
    yield* host.writeFile(join(root, 'tree/checkout/kept.txt'), 'kept\n');
    yield* host.writeFile(join(root, 'tree/outside/cache.bin'), 'cache\n');
    const opened: string[] = [];
    const files = Layer.effect(
      FileSystem.FileSystem,
      Effect.map(FileSystem.FileSystem, (fs) =>
        FileSystem.FileSystem.of({
          ...fs,
          open: (path, options) => {
            opened.push(path);
            return fs.open(path, options);
          },
          readFile: (path) => {
            opened.push(path);
            return fs.readFile(path);
          },
        }),
      ),
    ).pipe(Layer.provide(machineWorld.files));
    const recorded = recorder();
    const result = yield* answer(
      createDeleteTool(
        options({
          cwd: root,
          world: { ...machineWorld, files },
          changes: { ...recorded.port, records: (path) => Effect.succeed(path.includes('/checkout/')) },
        }),
      ),
      { args: ['-r', 'tree'] },
    );
    const report = result.value as RemovalReport;
    expect(report.status).toBe('completed');
    expect(report.counts.removed).toBe(5);
    expect(report.results.map((row) => [relative(root, row.path), row.status, row.removed])).toEqual([['tree', 'removed', 5]]);
    expect(recorded.changes.map((change) => relative(root, change.path))).toEqual(['tree/checkout/kept.txt']);
    expect([...new Set(opened.map((path) => relative(root, path)))]).toEqual(['tree/checkout/kept.txt']);
    expect(yield* host.readdir(root)).toEqual([]);
  }),
);

it.live('one removal call attributes a hundred overlapping operands and removes a whole tree', () =>
  Effect.gen(function* () {
    const root = yield* host.realpath(yield* createTempDir());
    yield* host.mkdir(join(root, 'batch/nested'), { recursive: true });
    for (let index = 0; index < 100; index++)
      yield* host.writeFile(join(root, `batch/file-${String(index).padStart(3, '0')}.tmp`), 'old\n');
    for (const name of ['batch/.hidden', 'batch/.gitignore', 'batch/nested/ignored.bin', 'keep.txt'])
      yield* host.writeFile(join(root, name), 'kept\n');
    const operands = ['batch/*.tmp', 'batch/file-0??.tmp', 'batch', 'batch/file-000.tmp'];
    const result = yield* answer(createDeleteTool(options({ cwd: root })), {
      args: ['-vR', operands[0], '-fd', '--', ...operands.slice(1)],
    });
    const report = result.value as RemovalReport;
    expect(result.refusal).toBeUndefined();
    expect(report.status).toBe('completed');
    expect(report.counts.removed).toBe(105);
    expect(new Set(report.results.map((entry) => entry.path)).size).toBe(105);
    expect(report.results.find((entry) => entry.path === join(root, 'batch/file-000.tmp'))?.operands).toEqual(operands);
    const paths = report.results.map((entry) => relative(root, entry.path));
    expect(paths.indexOf('batch/nested/ignored.bin')).toBeLessThan(paths.indexOf('batch/nested'));
    expect(paths.indexOf('batch/nested')).toBeLessThan(paths.indexOf('batch'));
    expect(yield* host.readdir(root)).toEqual(['keep.txt']);
  }),
);

it.live('non-verbose removal keeps a spilled outside-checkout report separate from the summary', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    for (const name of ['first', 'second']) yield* host.writeFile(join(root, name), 'selected');
    const tool = createDeleteTool(
      options({
        cwd: root,
        world: { ...machineWorld, environment: { ...machineWorld.environment, tmp: root } },
        changes: {
          ...recorder().port,
          records: () => Effect.succeed(false),
          land: (_batch, write) => Effect.map(write, (written) => landedOf(written, false)),
        },
      }),
    );
    const prefix = './'.repeat(13_000);
    const input = { args: ['first', 'second'].map((name) => prefix + name), glob: false };
    const preparation = yield* preparationOf(tool, input);
    const execute = toolExecute(tool);
    if (execute === null) return yield* Effect.die('Delete has no execution operation.');
    const result = yield* execute(input, {
      toolCallId: 'call-1',
      caller: unthreadedCaller,
      messages: [],
      prepared: preparation?.prepared,
    }) as Effect.Effect<unknown, ToolFailed>;
    if (!(result instanceof ToolAnswer)) return yield* Effect.die('Delete did not return an answer.');
    const report = result.value as RemovalReport;
    expect(report.status).toBe('completed');
    expect(report.counts.removed).toBe(2);
    expect(result.source).toBeUndefined();
    expect(result.text?.split('\n')[0]).toBe('Deletion completed: 2 removed, 0 absent, 0 skipped, 0 failed, 0 unprocessed, 0 unknown.');
    if (report.reportPath === undefined) return yield* Effect.die('The complete report was not retained.');
    const rows = (yield* host.readFile(report.reportPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(rows.map((row) => row.record)).toEqual(['outside', 'outside', undefined]);
    expect(rows.map((row) => row.status)).toEqual(['removed', 'removed', 'completed']);
    expect(yield* exists(join(root, 'first'))).toBe(false);
    expect(yield* exists(join(root, 'second'))).toBe(false);
    tool.settled?.({ toolCallId: 'call-1', caller: unthreadedCaller });
  }),
);

it.live('glob alternatives and classes keep hidden names explicit, and literal mode preserves metacharacters', () =>
  Effect.gen(function* () {
    const root = yield* host.realpath(yield* createTempDir());
    yield* host.mkdir(join(root, 'nested/.secret'), { recursive: true });
    yield* host.mkdir(join(root, '~'));
    for (const name of [
      'one.tmp',
      'nested/two.old',
      'nested/three.log',
      'sane.t',
      'xane.t',
      '.hidden.tmp',
      'nested/.secret/keep.tmp',
      'literal*.tmp',
      'literal*?.keep',
      'quoted*.name',
      'notes [draft].md',
      '~/literal',
      '-leading',
      'space name\n.txt',
      'home-picked',
    ])
      yield* host.writeFile(join(root, name), 'x');
    const tool = createDeleteTool(options({ cwd: root }));
    const expanded = yield* answer(tool, {
      args: ['--', '**/*.{tmp,{old,log}}', '[!x]ane.?', '-leading', 'space name\n.txt', 'quoted\\*.name'],
    });
    expect(expanded.refusal).toBeUndefined();
    expect((expanded.value as RemovalReport).results.map((entry) => relative(root, entry.path)).sort()).toEqual(
      ['-leading', 'literal*.tmp', 'nested/three.log', 'nested/two.old', 'one.tmp', 'quoted*.name', 'sane.t', 'space name\n.txt'].sort(),
    );
    expect(yield* host.readFile(join(root, '.hidden.tmp'), 'utf8')).toBe('x');
    expect(yield* host.readFile(join(root, 'nested/.secret/keep.tmp'), 'utf8')).toBe('x');
    const hiddenClass = yield* answer(tool, { args: ['--', '[.]hidden.tmp'] });
    expect(hiddenClass.refusal).toBeDefined();
    expect((hiddenClass.value as RemovalReport).results[0]?.issue?.code).toBe('no-match');
    const literal = yield* answer(tool, { args: ['--', 'literal*?.keep', 'notes [draft].md', '~/literal'], glob: false });
    expect(literal.refusal).toBeUndefined();
    expect((literal.value as RemovalReport).counts.removed).toBe(3);
    const explicit = yield* answer(tool, { args: ['--', '.hidden.tmp', 'xane.t', `~/${relative(homedir(), join(root, 'home-picked'))}`] });
    expect(explicit.refusal).toBeUndefined();
    expect((explicit.value as RemovalReport).counts.removed).toBe(3);
  }),
);

it.live('invalid options and syntax reject the whole request before deleting an earlier operand', () =>
  Effect.gen(function* () {
    const root = yield* host.realpath(yield* createTempDir());
    yield* host.writeFile(join(root, 'keep'), 'unchanged');
    const tool = createDeleteTool(options({ cwd: root }));
    const invalid = [
      { args: ['keep', '--interactive'], code: 'unsupported-option' },
      { args: ['keep', '--', '{1..3}'], code: 'bad-pattern' },
      { args: ['keep', '--', '@(a|b)'], code: 'bad-pattern' },
      { args: ['keep', '--', '{@,x}(a|b)'], code: 'bad-pattern' },
      { args: ['keep', '--', '[{1..3}]'], code: 'bad-pattern' },
      { args: ['keep', '--', 'tree/..'], code: 'invalid-operand' },
      { args: ['keep', '--', 'unclosed['], code: 'bad-pattern' },
      { args: ['keep', '--', ''], code: 'invalid-argument' },
    ];
    for (const { args, code } of invalid) {
      const refused = yield* answer(tool, { args });
      expect(refused.refusal?.code).toBe(code);
      expect(yield* host.readFile(join(root, 'keep'), 'utf8')).toBe('unchanged');
    }
    const forced = yield* answer(tool, { args: ['missing', '-f', '--', '*.absent', 'keep'] });
    expect(forced.refusal).toBeUndefined();
    expect((forced.value as RemovalReport).counts.absent).toBe(2);
    expect((forced.value as RemovalReport).results.filter((entry) => entry.status === 'absent').map((entry) => entry.operands)).toEqual([
      ['missing'],
      ['*.absent'],
    ]);
    expect(yield* host.readdir(root)).toEqual([]);
    expect((yield* answer(tool, { args: ['-f'] })).refusal).toBeUndefined();
  }),
);

it.live('prepared removal pins explicit symlink parents and unlinks final links without traversing them', () =>
  Effect.gen(function* () {
    const root = yield* host.realpath(yield* createTempDir());
    for (const name of ['original', 'replacement', 'outside']) yield* host.mkdir(join(root, name));
    for (const name of ['original/chosen', 'replacement/chosen', 'outside/keep']) yield* host.writeFile(join(root, name), name);
    yield* host.symlink('original', join(root, 'parent'));
    yield* host.symlink('../missing', join(root, 'original/dangling'));
    yield* host.symlink('../outside', join(root, 'original/directory-link'));
    const tool = createDeleteTool(options({ cwd: root }));
    const input = { args: ['-r', '--', 'parent/chosen', 'parent/dangling/', 'parent/directory-link/'] };
    const preparation = yield* preparationOf(tool, input);
    yield* host.rm(join(root, 'parent'));
    yield* host.symlink('replacement', join(root, 'parent'));
    const execute = toolExecute(tool);
    if (execute === null) return yield* Effect.die('Delete has no execution operation.');
    const result = yield* execute(input, {
      toolCallId: 'call-1',
      caller: unthreadedCaller,
      messages: [],
      prepared: preparation?.prepared,
    }) as Effect.Effect<unknown, ToolFailed>;
    expect(result instanceof ToolAnswer).toBe(true);
    const report = (result as ToolAnswer).value as RemovalReport;
    expect(report.status).toBe('completed');
    expect(report.results.map((entry) => [relative(root, entry.path), entry.kind])).toEqual([
      ['original/chosen', 'file'],
      ['original/dangling', 'link'],
      ['original/directory-link', 'link'],
    ]);
    expect(yield* exists(join(root, 'original/chosen'))).toBe(false);
    expect(yield* host.readdir(join(root, 'original'))).toEqual([]);
    expect(yield* host.readFile(join(root, 'replacement/chosen'), 'utf8')).toBe('replacement/chosen');
    expect(yield* host.readFile(join(root, 'outside/keep'), 'utf8')).toBe('outside/keep');
  }),
);

it.live('a recursive root replaced after preparation stays, and a walked directory link is unlinked without following it', () =>
  Effect.gen(function* () {
    const root = yield* host.realpath(yield* createTempDir());
    yield* host.mkdir(join(root, 'tree'));
    yield* host.mkdir(join(root, 'outside'));
    yield* host.writeFile(join(root, 'tree/old'), 'old');
    yield* host.writeFile(join(root, 'outside/keep'), 'outside');
    yield* host.symlink('../outside', join(root, 'tree/link'));
    const tool = createDeleteTool(options({ cwd: root }));
    const input = { args: ['-r', '--', 'tree'] };
    const preparation = yield* preparationOf(tool, input);
    yield* host.rename(join(root, 'tree'), join(root, 'selected'));
    yield* host.mkdir(join(root, 'tree'));
    yield* host.writeFile(join(root, 'tree/new'), 'new');
    const execute = toolExecute(tool);
    if (execute === null) return yield* Effect.die('Delete has no execution operation.');
    const result = yield* execute(input, {
      toolCallId: 'call-1',
      caller: unthreadedCaller,
      messages: [],
      prepared: preparation?.prepared,
    }) as Effect.Effect<unknown, ToolFailed>;
    const replaced = (result as ToolAnswer).value as RemovalReport;
    expect(replaced.results.map((entry) => [relative(root, entry.path), entry.status, entry.issue?.code])).toEqual([
      ['tree', 'failed', 'file-changed'],
    ]);
    expect(yield* host.readdir(join(root, 'tree'))).toEqual(['new']);
    const removed = (yield* answer(tool, { args: ['-r', '--', 'selected'] })).value as RemovalReport;
    expect(removed.results.map((entry) => [relative(root, entry.path), entry.status, entry.removed])).toEqual([['selected', 'removed', 3]]);
    expect((yield* host.readdir(root)).sort()).toEqual(['outside', 'tree']);
    expect(yield* host.readFile(join(root, 'outside/keep'), 'utf8')).toBe('outside');
  }),
);

it.live('an unreadable subtree remains explicit while force still removes independent targets', () =>
  Effect.gen(function* () {
    const root = yield* host.realpath(yield* createTempDir());
    const denied = join(root, 'tree/blocked');
    yield* host.mkdir(denied, { recursive: true });
    for (const name of ['tree/blocked/secret', 'tree/accessible', 'independent']) yield* host.writeFile(join(root, name), name);
    const files = Layer.effect(
      FileSystem.FileSystem,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return FileSystem.FileSystem.of({
          ...fs,
          readDirectory: (path) =>
            path === denied
              ? Effect.fail(
                  PlatformError.systemError({
                    _tag: 'PermissionDenied',
                    module: 'FileSystem',
                    method: 'readDirectory',
                    pathOrDescriptor: path,
                    cause: { code: 'EACCES', syscall: 'scandir', message: 'permission denied' },
                  }),
                )
              : fs.readDirectory(path),
        });
      }),
    ).pipe(Layer.provide(machineWorld.files));
    const result = yield* answer(createDeleteTool(options({ cwd: root, world: { ...machineWorld, files } })), {
      args: ['-rf', '--', 'tree', 'independent'],
    });
    const report = result.value as RemovalReport;
    expect(result.refusal).toBeDefined();
    expect(report.status).toBe('partial');
    expect(report.counts.removed).toBe(2);
    const failure = report.results.find((entry) => entry.issue?.code === 'permission-denied');
    expect(failure?.path).toBe(denied);
    expect(failure?.operands).toEqual(['tree']);
    expect(failure?.issue?.reason).toContain('EACCES');
    expect(yield* host.readFile(join(denied, 'secret'), 'utf8')).toBe('tree/blocked/secret');
    expect(yield* host.readdir(join(root, 'tree'))).toEqual(['blocked']);
    expect(yield* host.readdir(root)).toEqual(['tree']);
  }),
);
