import { afterAll, expect } from 'bun:test';
import { release } from '@runlith/git/testing';
import { it } from '@runlith/effect-test';
import { basename, join } from 'node:path';
import { Deferred, Effect, Fiber, FileSystem, Layer } from 'effect';
import { replaced } from '@runlith/files/replace';
import { PlatformError, SystemError } from 'effect/PlatformError';
import { contentDigest } from '@runlith/files/content';
import { CheckoutBaselines } from './CheckoutBaselines';
import { readable } from './checkoutState';
import { CheckoutFlights } from './CheckoutFlights';
import { ShellRun, localRunning } from './ShellRun';
import { machineWorld } from './world/machine';
import { resolveToolOptions } from './workspace/runtime';
import { checkout, host, options, recorder } from './testing/toolHarness';
import type { CommandFacts } from './WorkspaceChanges';

afterAll(release);

const services = Layer.mergeAll(machineWorld.files, machineWorld.exec, machineWorld.git);

const WRITER: CommandFacts = { readsOnly: false, parts: [{ readsOnly: false, named: null, signature: null, listed: false, implicit: [] }] };

const git = (root: string, command: string) => Effect.promise(() => Bun.$`sh -c ${command}`.cwd(root).quiet());

it.live('a command sees same-size rewrites with restored mtime, renames, deletions, new files and files it returned to HEAD', () =>
  Effect.gen(function* () {
    const root = yield* checkout({
      'edit.txt': 'base\n',
      'gone.txt': 'gone\n',
      'empty.txt': 'base\n',
      'back.txt': 'base\n',
      '.gitignore': 'ignored\n',
    });
    yield* host.writeFile(join(root, 'back.txt'), 'dirty\n');
    const edit = join(root, 'edit.txt');
    yield* host.writeFile(edit, 'ours\n');
    yield* host.writeFile(join(root, 'empty.txt'), '');
    yield* host.writeFile(join(root, 'old.txt'), 'old\n');
    const sink = recorder();
    const resolved = resolveToolOptions(options({ cwd: root, changes: sink.port }));
    const baselines = new CheckoutBaselines(new CheckoutFlights());
    const shell = new ShellRun(resolved, baselines, services, root, 'true');
    yield* shell
      .open({ place: { tree: root, ours: true }, refused: null, measuring: true, facts: WRITER, elsewhere: null })
      .pipe(Effect.provide(services));
    const before = yield* host.stat(edit);
    yield* host.writeFile(edit, 'peer\n');
    yield* host.utimes(edit, before.atime, before.mtime);
    yield* host.rename(join(root, 'old.txt'), join(root, 'new.txt'));
    yield* host.rm(join(root, 'gone.txt'));
    yield* host.rm(join(root, 'empty.txt'));
    yield* host.writeFile(join(root, 'created.txt'), 'new\n');
    yield* host.writeFile(join(root, 'ignored'), 'ignored\n');
    yield* git(root, 'git checkout -- back.txt');
    const result = yield* shell.finish({ ...localRunning, code: 0 }).pipe(Effect.provide(services));
    expect(result.moved).toEqual(['back.txt', 'created.txt', 'edit.txt', 'empty.txt', 'gone.txt', 'new.txt', 'old.txt']);
    expect(sink.moves.map((move) => [move.name, move.present])).toEqual([
      ['back.txt', true],
      ['created.txt', true],
      ['edit.txt', true],
      ['empty.txt', false],
      ['gone.txt', false],
      ['new.txt', true],
      ['old.txt', false],
    ]);
    expect(sink.moves.find((move) => move.name === 'edit.txt')?.after).toBe(contentDigest('peer\n'));
    expect(sink.moves.find((move) => move.name === 'back.txt')).toMatchObject({
      before: contentDigest('dirty\n'),
      after: contentDigest('base\n'),
    });
    expect(result.unmeasured).toBeNull();
  }),
);

it.live('a file unreadable in both snapshots remains unread in the final command observation', () =>
  Effect.gen(function* () {
    const root = yield* checkout({ 'kept.txt': 'base\n' });
    const path = join(root, 'kept.txt');
    yield* host.writeFile(path, 'dirty\n');
    const files = Layer.effect(
      FileSystem.FileSystem,
      Effect.map(
        FileSystem.FileSystem,
        (live) =>
          new Proxy(live, {
            get: (target, property) => {
              if (property === 'readFile')
                return (file: string) =>
                  file === path
                    ? Effect.fail(
                        new PlatformError(
                          new SystemError({
                            _tag: 'PermissionDenied',
                            module: 'FileSystem',
                            method: 'readFile',
                            cause: { code: 'EACCES' },
                          }),
                        ),
                      )
                    : live.readFile(file);
              const member = Reflect.get(target, property, target);
              return typeof member === 'function' ? member.bind(target) : member;
            },
          }),
      ),
    ).pipe(Layer.provide(machineWorld.files));
    const measured = Layer.mergeAll(files, machineWorld.exec, machineWorld.git);
    const sink = recorder();
    const resolved = resolveToolOptions(options({ cwd: root, changes: sink.port, world: { ...machineWorld, files } }));
    const shell = new ShellRun(resolved, new CheckoutBaselines(new CheckoutFlights()), measured, root, 'true');
    yield* shell
      .open({ place: { tree: root, ours: true }, refused: null, measuring: true, facts: WRITER, elsewhere: null })
      .pipe(Effect.provide(measured));
    const result = yield* shell.finish({ ...localRunning, code: 0 }).pipe(Effect.provide(measured));
    expect(result.unread).toEqual(['kept.txt']);
    expect(result.verdicts).toEqual([]);
    expect(sink.moves).toEqual([]);
  }),
);

it.live('snapshots exclude live replacement staging inside new directories and retain tracked files with the same name', () =>
  Effect.gen(function* () {
    const root = yield* checkout({ 'kept.txt': 'base\n' });
    const target = join(root, 'fresh', 'created.txt');
    yield* host.mkdir(join(root, 'fresh'));
    const staged = yield* Deferred.make<string>();
    const publish = yield* Deferred.make<void>();
    const files = yield* FileSystem.FileSystem;
    const writing: FileSystem.FileSystem = {
      ...files,
      writeFile: (path, bytes, options) =>
        files.writeFile(path, bytes, options).pipe(Effect.andThen(Deferred.succeed(staged, path)), Effect.andThen(Deferred.await(publish))),
    };
    const replacement = yield* Effect.forkChild(
      replaced(target, { absent: true }, 'new\n').pipe(Effect.provideService(FileSystem.FileSystem, writing)),
    );
    const temporary = yield* Deferred.await(staged);
    const tracked = basename(temporary);
    yield* host.writeFile(join(root, tracked), 'tracked\n');
    yield* git(root, `git add -- '${tracked}' && git commit -qm tracked`);
    yield* host.writeFile(join(root, tracked), 'edited\n');
    const directory = `.${tracked}`;
    yield* host.mkdir(join(root, directory));
    yield* host.writeFile(join(root, directory, 'kept.txt'), 'kept\n');
    const resolved = resolveToolOptions(options({ cwd: root }));
    const baselines = new CheckoutBaselines(new CheckoutFlights());
    const before = yield* baselines.measure(root, resolved);
    yield* Deferred.succeed(publish, undefined);
    expect(yield* Fiber.join(replacement)).toBe(true);
    const after = yield* baselines.measure(root, resolved);

    expect([...(readable(before)?.keys() ?? [])].sort()).toEqual([tracked, `${directory}/kept.txt`].sort());
    expect([...(readable(after)?.keys() ?? [])].sort()).toEqual([tracked, `${directory}/kept.txt`, 'fresh/created.txt'].sort());
  }).pipe(Effect.provide(services)),
);

it.live('a reading names every untracked file inside new directories and leaves ignored ones out', () =>
  Effect.gen(function* () {
    const root = yield* checkout({ 'kept.txt': 'base\n', '.gitignore': '*.log\n' });
    yield* host.writeFile(join(root, 'kept.txt'), 'edited\n');
    yield* host.writeFile(join(root, 'top.txt'), 'top\n');
    yield* host.mkdir(join(root, 'fresh', 'deeper', 'only-ignored'), { recursive: true });
    yield* host.mkdir(join(root, 'spaced dir'));
    yield* host.writeFile(join(root, 'fresh', 'two.ts'), 'two\n');
    yield* host.writeFile(join(root, 'fresh', 'skip.log'), 'skip\n');
    yield* host.writeFile(join(root, 'fresh', 'deeper', 'one.ts'), 'one\n');
    yield* host.writeFile(join(root, 'fresh', 'deeper', 'only-ignored', 'x.log'), 'x\n');
    yield* host.writeFile(join(root, 'spaced dir', '[x].ts'), 'glob\n');
    const resolved = resolveToolOptions(options({ cwd: root }));
    const reading = yield* new CheckoutBaselines(new CheckoutFlights()).measure(root, resolved).pipe(Effect.provide(services));
    expect([...(readable(reading)?.keys() ?? [])].sort()).toEqual([
      'fresh/deeper/one.ts',
      'fresh/two.ts',
      'kept.txt',
      'spaced dir/[x].ts',
      'top.txt',
    ]);
  }),
);

it.live('a command measures checkout files while untracked Git merge temporaries stay outside its writes', () =>
  Effect.gen(function* () {
    const root = yield* checkout({ 'kept.txt': 'base\n', '.merge_file_ABCDEF': 'tracked\n' });
    const sink = recorder();
    const resolved = resolveToolOptions(options({ cwd: root, changes: sink.port }));
    const shell = new ShellRun(resolved, new CheckoutBaselines(new CheckoutFlights()), services, root, 'git show HEAD:kept.txt');
    yield* shell
      .open({ place: { tree: root, ours: true }, refused: null, measuring: true, facts: WRITER, elsewhere: null })
      .pipe(Effect.provide(services));
    yield* host.writeFile(join(root, '.merge_file_123abc'), 'external merge base\n');
    yield* host.writeFile(join(root, '.merge_file_a1B2c3'), 'external merge ours\n');
    yield* host.writeFile(join(root, '.merge_file_ABCDEF'), 'tracked edit\n');
    yield* host.writeFile(join(root, 'kept.txt'), 'changed\n');
    const result = yield* shell.finish({ ...localRunning, code: 0 }).pipe(Effect.provide(services));
    expect(result.moved).toEqual(['.merge_file_ABCDEF', 'kept.txt']);
    expect(sink.moves.map((move) => [move.name, move.after])).toEqual([
      ['.merge_file_ABCDEF', contentDigest('tracked edit\n')],
      ['kept.txt', contentDigest('changed\n')],
    ]);
  }),
);

it.live('a peer commit changes HEAD without making unchanged checkout bytes a write of the command', () =>
  Effect.gen(function* () {
    const root = yield* checkout({ 'file.txt': 'base\n' });
    yield* host.writeFile(join(root, 'file.txt'), 'peer edit\n');
    const sink = recorder();
    const resolved = resolveToolOptions(options({ cwd: root, changes: sink.port }));
    const shell = new ShellRun(resolved, new CheckoutBaselines(new CheckoutFlights()), services, root, 'git log -1');
    yield* shell
      .open({ place: { tree: root, ours: true }, refused: null, measuring: true, facts: WRITER, elsewhere: null })
      .pipe(Effect.provide(services));
    yield* git(root, 'git add file.txt && git commit -qm peer');
    const result = yield* shell.finish({ ...localRunning, code: 0 }).pipe(Effect.provide(services));
    expect(result.head).toMatchObject({ from: expect.any(String), to: expect.any(String) });
    expect(result.moved).toEqual([]);
    expect(sink.moves).toEqual([]);
  }),
);

it.live('a lost checkout listing refuses that reading and the next reading recovers current state', () =>
  Effect.gen(function* () {
    const root = yield* checkout({ 'file.txt': 'base\n' });
    yield* host.writeFile(join(root, 'file.txt'), 'first\n');
    const resolved = resolveToolOptions(options({ cwd: root }));
    const baselines = new CheckoutBaselines(new CheckoutFlights());
    const measure = baselines.measure(root, resolved).pipe(Effect.provide(services));
    const first = yield* measure;
    expect(readable(first)?.get('file.txt')).toBe(contentDigest('first\n'));
    yield* host.rename(join(root, '.git'), join(root, 'git-held'));
    expect('unreadable' in (yield* measure)).toBe(true);
    yield* host.rename(join(root, 'git-held'), join(root, '.git'));
    yield* host.writeFile(join(root, 'file.txt'), 'later\n');
    const recovered = yield* measure;
    expect(readable(recovered)?.get('file.txt')).toBe(contentDigest('later\n'));
  }),
);
