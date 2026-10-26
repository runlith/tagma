import { expect } from 'bun:test';
import { rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as BunSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFiles from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Exit, Layer, Scope } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { Git, gitLayer } from './Git.js';
import { workingFilesAt, workingTextsAt, workingBlobTextsAt, stagedTextsAt } from './working.js';
import { git, release, tempRepo } from './testing/fixture.js';

class Spawns extends Context.Service<Spawns, { spawned: number; readonly sessions: ChildProcessSpawner.ChildProcessHandle[] }>()(
  'git/test/Spawns',
) {}

class Repo extends Context.Service<Repo, string>()('git/test/Repo') {}

const paths = Array.from({ length: 1_000 }, (_, i) => `file-${i}.txt`);
const text = (i: number) => `${i}: \uFEFFline\n`;
const shown = (rows: readonly { _tag: string; success?: string | null; failure?: { _tag: string } }[]) =>
  rows.map((row) => (row._tag === 'Success' ? row.success : row.failure?._tag));
const sh = (root: string, args: readonly string[]) => Effect.promise(() => git(root, args));

const observed = Layer.effectContext(
  Effect.gen(function* () {
    const base = yield* ChildProcessSpawner.ChildProcessSpawner;
    const spawns = Spawns.of({ spawned: 0, sessions: [] });
    const spawner = ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        spawns.spawned += 1;
        const process = yield* base.spawn(command);
        if (ChildProcess.isStandardCommand(command) && command.args.includes('--batch')) spawns.sessions.push(process);
        return process;
      }),
    );
    return Context.make(ChildProcessSpawner.ChildProcessSpawner, spawner).pipe(Context.add(Spawns, spawns));
  }),
);
const host = BunSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFiles.layer, BunPath.layer)));
const observedGit = gitLayer.pipe(Layer.provideMerge(observed.pipe(Layer.provide(host))));

const repo = Layer.effect(
  Repo,
  Effect.acquireRelease(
    Effect.promise(async () => {
      const root = await tempRepo('git-objects-');
      for (const [i, path] of paths.entries()) writeFileSync(join(root, path), text(i));
      writeFileSync(join(root, 'space name.txt'), 'space\n');
      writeFileSync(join(root, 'tab\tname.txt'), 'tab\n');
      writeFileSync(join(root, 'newline\nname.txt'), 'newline\n');
      symlinkSync('file-0.txt', join(root, 'pointer'));
      await git(root, ['add', '-A']);
      await git(root, ['commit', '-qm', 'files']);
      return root;
    }),
    () => Effect.promise(release),
  ),
);

layer(Layer.merge(observedGit, repo), { excludeTestServices: true, timeout: '30 seconds' })('Git raw object reads', (it) => {
  it.effect('one session reads a thousand distinct objects with constant process count and isolates absence and capture failures', () =>
    Effect.gen(function* () {
      const root = yield* Repo;
      const service = yield* Git;
      const spawns = yield* Spawns;
      spawns.spawned = 0;
      const rows = yield* workingTextsAt(service, root, 'HEAD', [...paths, 'absent', '../outside']);
      expect(shown(rows.slice(0, paths.length))).toEqual(paths.map((_, i) => text(i)));
      expect(shown(rows.slice(paths.length))).toEqual([null, 'GitUnreadable']);
      expect(spawns.spawned).toBeLessThanOrEqual(5);
      const count = spawns.sessions.length;
      spawns.spawned = 0;
      const again = yield* workingTextsAt(service, root, 'HEAD', ['space name.txt', 'tab\tname.txt', 'newline\nname.txt', 'pointer'], {
        capture: 8,
      });
      expect(shown(again)).toEqual(['space\n', 'tab\n', 'newline\n', 'GitAnswerInvalid']);
      expect(spawns.sessions.length).toBe(count);
      expect(spawns.spawned).toBeLessThanOrEqual(3);
    }),
  );

  it.effect('a live session sees new loose and packed objects while staged entries and conversion attributes stay fresh', () =>
    Effect.gen(function* () {
      const root = yield* Repo;
      const service = yield* Git;
      const fresh = yield* service.run(['-C', root, 'hash-object', '-w', '--stdin'], { stdin: 'fresh\n' });
      expect(shown(yield* workingBlobTextsAt(service, root, [{ blob: fresh.stdout.trim(), path: 'fresh.txt' }]))).toEqual(['fresh\n']);
      writeFileSync(join(root, 'new.txt'), 'new\n');
      yield* sh(root, ['add', 'new.txt']);
      yield* sh(root, ['commit', '-qm', 'new']);
      yield* sh(root, ['repack', '-ad']);
      yield* sh(root, ['prune-packed']);
      expect(shown(yield* workingTextsAt(service, root, 'HEAD', ['new.txt']))).toEqual(['new\n']);
      writeFileSync(join(root, 'new.txt'), 'staged\n');
      yield* sh(root, ['add', 'new.txt']);
      expect(shown(yield* stagedTextsAt(service, root, ['new.txt'], join(root, 'unused')))).toEqual(['staged\n']);
      writeFileSync(join(root, 'new.txt'), 'changed stage\n');
      yield* sh(root, ['add', 'new.txt']);
      expect(shown(yield* stagedTextsAt(service, root, ['new.txt'], join(root, 'unused')))).toEqual(['changed stage\n']);
      writeFileSync(join(root, '.gitattributes'), 'new.txt text eol=crlf\npointer filter=bad\nfile-1.txt filter=bad\n');
      yield* sh(root, ['config', 'filter.bad.smudge', 'false']);
      yield* sh(root, ['config', 'filter.bad.required', 'true']);
      expect(shown(yield* workingTextsAt(service, root, 'HEAD', ['new.txt', 'file-1.txt', 'pointer', 'file-2.txt']))).toEqual([
        'new\r\n',
        'GitUnreadable',
        'file-0.txt',
        text(2),
      ]);
      writeFileSync(join(root, '.gitattributes'), 'new.txt -text\n');
      expect(shown(yield* workingTextsAt(service, root, 'HEAD', ['new.txt']))).toEqual(['new\n']);
    }),
  );

  it.effect('raw cache retains immutable objects without exposing mutable storage or following replace refs', () =>
    Effect.gen(function* () {
      const root = yield* Repo;
      const service = yield* Git;
      const stored = yield* service.run(['-C', root, 'hash-object', '-w', '--stdin'], { stdin: 'cached bytes\n' });
      const oid = stored.stdout.trim();
      const first = (yield* service.objects!(root, [oid]))[0]!;
      expect(first._tag === 'Success' && first.success !== null && new TextDecoder().decode(first.success.bytes)).toBe('cached bytes\n');
      if (first._tag === 'Success' && first.success !== null) first.success.bytes.fill(0);
      rmSync(join(root, '.git', 'objects', oid.slice(0, 2), oid.slice(2)));
      const second = (yield* service.objects!(root, [oid]))[0]!;
      expect(second._tag === 'Success' && second.success !== null && new TextDecoder().decode(second.success.bytes)).toBe('cached bytes\n');
      const original = yield* sh(root, ['rev-parse', 'HEAD:file-3.txt']);
      const replacement = yield* sh(root, ['rev-parse', 'HEAD:file-4.txt']);
      yield* sh(root, ['replace', original, replacement]);
      expect(shown(yield* workingTextsAt(service, root, 'HEAD', ['file-3.txt']))).toEqual([text(3)]);
    }),
  );

  it.effect('ident and working-tree encoding apply by path without contaminating the raw oid cache', () =>
    Effect.gen(function* () {
      const root = yield* Repo;
      const service = yield* Git;
      const stored = yield* service.run(['-C', root, 'hash-object', '-w', '--stdin'], { stdin: '$Id$\n' });
      const oid = stored.stdout.trim();
      writeFileSync(join(root, '.gitattributes'), 'expanded.txt ident\nencoded.txt working-tree-encoding=UTF-16LE\n');
      const raw = yield* workingBlobTextsAt(service, root, [
        { blob: oid, path: 'raw.txt' },
        { blob: oid, path: 'expanded.txt' },
      ]);
      expect(shown(raw)).toEqual(['$Id$\n', `$Id: ${oid} $\n`]);
      writeFileSync(join(root, 'encoded.txt'), Buffer.from('encoded\n', 'utf16le'));
      yield* sh(root, ['add', 'encoded.txt']);
      const bytes = (yield* workingFilesAt(service, root, '', ['encoded.txt']))[0]!;
      expect(bytes._tag === 'Success' && bytes.success).toEqual(new Uint8Array(Buffer.from('encoded\n', 'utf16le')));
    }),
  );

  it.effect('tree traversal preserves modes and confines a missing subtree to its requested descendants', () =>
    Effect.gen(function* () {
      const root = yield* Repo;
      const service = yield* Git;
      const spawns = yield* Spawns;
      const blob = yield* sh(root, ['rev-parse', 'HEAD:file-5.txt']);
      const missing = 'f'.repeat(40);
      const made = yield* service.run(['-C', root, 'mktree', '--missing'], {
        stdin: `040000 tree ${missing}\tbroken\n100755 blob ${blob}\texecutable\n160000 commit ${missing}\tsubmodule\n`,
      });
      expect(made.status).toBe(0);
      const tree = made.stdout.trim();
      expect(shown(yield* workingTextsAt(service, root, 'HEAD', ['file-5.txt']))).toEqual([text(5)]);
      spawns.spawned = 0;
      const rows = yield* workingTextsAt(service, root, tree, ['broken/file', 'executable', 'submodule', 'absent']);
      expect(shown(rows)).toEqual(['GitUnreadable', text(5), null, null]);
      expect(spawns.spawned).toBeLessThanOrEqual(2);
    }),
  );

  it.effect('a Git refusing the startup batch probe still returns each file through its one-object road', () =>
    Effect.gen(function* () {
      const root = yield* Repo;
      const refusing = Layer.effect(
        ChildProcessSpawner.ChildProcessSpawner,
        Effect.map(ChildProcessSpawner.ChildProcessSpawner, (base) =>
          ChildProcessSpawner.make((command) =>
            base.spawn(
              ChildProcess.isStandardCommand(command) && command.args.includes('--batch')
                ? ChildProcess.make(
                    command.command,
                    command.args.map((arg) => (arg === '--batch' ? '--unsupported-batch' : arg)),
                    command.options,
                  )
                : command,
            ),
          ),
        ),
      );
      const result = yield* Effect.flatMap(Git, (service) => workingTextsAt(service, root, 'HEAD', ['file-0.txt', 'absent'])).pipe(
        Effect.provide(Layer.fresh(gitLayer.pipe(Layer.provide(refusing.pipe(Layer.provide(host)))))),
      );
      expect(shown(result)).toEqual([text(0), null]);
    }),
  );

  it.effect('a malformed startup answer from a live process refuses and leaves the next read able to start', () =>
    Effect.gen(function* () {
      const root = yield* Repo;
      let malformed = true;
      const damaged = Layer.effect(
        ChildProcessSpawner.ChildProcessSpawner,
        Effect.map(ChildProcessSpawner.ChildProcessSpawner, (base) =>
          ChildProcessSpawner.make((command) => {
            if (malformed && ChildProcess.isStandardCommand(command) && command.args.includes('--batch')) {
              malformed = false;
              return base.spawn(ChildProcess.make('sh', ['-c', 'printf "invalid\\n"; exec cat >/dev/null'], command.options));
            }
            return base.spawn(command);
          }),
        ),
      );
      const reads = Effect.gen(function* () {
        const service = yield* Git;
        const first = yield* workingTextsAt(service, root, 'HEAD', ['file-0.txt']);
        const second = yield* workingTextsAt(service, root, 'HEAD', ['file-0.txt']);
        return [shown(first), shown(second)];
      }).pipe(Effect.provide(Layer.fresh(gitLayer.pipe(Layer.provide(damaged.pipe(Layer.provide(host)))))));
      expect(yield* reads).toEqual([['GitUnreadable'], [text(0)]]);
    }),
  );

  it.effect('working-form reads spend constant processes plus one per converted path', () =>
    Effect.gen(function* () {
      const root = yield* Repo;
      const service = yield* Git;
      const spawns = yield* Spawns;
      writeFileSync(join(root, '.gitattributes'), '');
      yield* workingTextsAt(service, root, 'HEAD', paths);
      spawns.spawned = 0;
      expect(shown(yield* workingTextsAt(service, root, 'HEAD', [paths[0]!]))).toEqual([text(0)]);
      const single = spawns.spawned;
      spawns.spawned = 0;
      expect(shown(yield* workingTextsAt(service, root, 'HEAD', paths))).toEqual(paths.map((_, at) => text(at)));
      const wide = spawns.spawned;
      expect(wide).toBe(single);
      writeFileSync(join(root, '.gitattributes'), `${paths[0]} text eol=crlf\n${paths[1]} text eol=crlf\n`);
      spawns.spawned = 0;
      const converted = yield* workingTextsAt(service, root, 'HEAD', paths);
      expect(shown(converted)).toEqual(paths.map((_, at) => (at < 2 ? text(at).replaceAll('\n', '\r\n') : text(at))));
      expect(spawns.spawned).toBe(wide + 2);
      console.log('Git working-form process sample', { paths: paths.length, single, wide, converted: 2, processes: spawns.spawned });
      writeFileSync(join(root, '.gitattributes'), '');
    }),
  );

  it.effect('a dead session is restarted, concurrent reads stay framed, and closing its Git service terminates the child', () =>
    Effect.gen(function* () {
      const root = yield* Repo;
      writeFileSync(join(root, 'restart-a.txt'), 'restart a\n');
      writeFileSync(join(root, 'restart-b.txt'), 'restart b\n');
      yield* sh(root, ['add', 'restart-a.txt', 'restart-b.txt']);
      yield* sh(root, ['commit', '-qm', 'restart inputs']);
      const owner = yield* Scope.fork(yield* Effect.scope);
      const own = yield* Layer.buildWithScope(Layer.fresh(observedGit), owner);
      const service = Context.get(own, Git);
      const spawns = Context.get(own, Spawns);
      yield* workingTextsAt(service, root, 'HEAD', ['file-0.txt']);
      const before = spawns.sessions.length;
      for (const session of spawns.sessions) {
        if (!(yield* session.isRunning)) continue;
        yield* session.kill();
        expect((yield* Effect.result(session.exitCode))._tag).toBe('Failure');
      }
      const [a, b] = yield* Effect.all(
        [workingTextsAt(service, root, 'HEAD', ['restart-a.txt']), workingTextsAt(service, root, 'HEAD', ['restart-b.txt'])],
        { concurrency: 2 },
      );
      expect(shown(a)).toEqual(['restart a\n']);
      expect(shown(b)).toEqual(['restart b\n']);
      expect(spawns.sessions.length).toBe(before + 1);
      const running = spawns.sessions.at(-1)!;
      yield* Scope.close(owner, Exit.void);
      expect(yield* running.isRunning).toBe(false);
    }),
  );
});
