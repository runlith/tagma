import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect } from 'bun:test';
import { Effect, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { GitNotAdmitted, GitUnavailable, type Git, type GitAnswer } from '@runlith/git/Git';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { FILE, MINE, THEIRS, unstartedOn, type makeCheckout, checkoutFixture, withCheckout } from '../checkoutFixture.js';
const ENVELOPE = 16384;
const enveloped = (git: Git['Service']): Git['Service'] => ({
  run: (args, options) =>
    args.join(' ').length > ENVELOPE
      ? Effect.fail(new GitUnavailable({ command: args, reason: 'the call header exceeds the envelope' }))
      : git.run(args, options),
});
layer(Layer.merge(checkoutFixture, BunFileSystem.layer), { excludeTestServices: true })('checkout', (it) => {
  const racedBy = (world: Effect.Success<ReturnType<typeof makeCheckout>>, lockLost: boolean): Git['Service'] => {
    let armed = true;
    return {
      run: (args, options) => {
        if (!armed || !args.includes(lockLost ? 'update-ref' : 'commit-tree')) return world.git.run(args, options);
        armed = false;
        writeFileSync(join(world.root, 'src', 'other.ts'), 'const other = 1;\n');
        return Effect.flatMap(
          Effect.gen(function* () {
            yield* Effect.orDie(world.run(['add', '--', 'src/other.ts']));
            yield* Effect.orDie(world.run(['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'foreign', '--', 'src/other.ts']));
          }),
          () =>
            lockLost
              ? Effect.succeed<GitAnswer>({
                  status: 128,
                  stdout: '',
                  stderr: "fatal: cannot lock ref 'HEAD'",
                  overflow: false,
                  messageOverflow: false,
                })
              : world.git.run(args, options),
        );
      },
    };
  };
  for (const successor of ['beside', 'same', 'reset'] as const) {
    it.effect(`a lost update-ref answer respects the publication after ${successor}`, () =>
      withCheckout((checkout) =>
        Effect.fnUntraced(function* () {
          const world = checkout;
          const base = yield* world.run(['rev-parse', 'HEAD']);
          const mine = [...FILE.slice(0, 4), 'const five = 55;'];
          const later = [...FILE.slice(0, 4), 'const five = 555;'];
          yield* world.wrote(MINE, mine);
          let armed = true;
          let published: string | null = null;
          const git: Git['Service'] = {
            run: (args, options) => {
              if (!armed || !args.includes('update-ref')) return world.git.run(args, options);
              armed = false;
              return Effect.flatMap(world.git.run(args, options), (answer) =>
                Effect.gen(function* () {
                  if (answer.status !== 0) return answer;
                  published = yield* Effect.orDie(world.run(['rev-parse', 'HEAD']));
                  if (successor === 'reset') yield* Effect.orDie(world.run(['reset', '--hard', base]));
                  if (successor === 'beside' || successor === 'same') {
                    const path = successor === 'same' ? 'src/a.ts' : 'src/later.ts';
                    writeFileSync(join(world.root, path), successor === 'same' ? `${later.join('\n')}\n` : 'export const later = 1;\n');
                    yield* Effect.orDie(world.run(['add', '--', path]));
                    yield* Effect.orDie(world.run(['commit', '-q', '-m', 'later', '--', path]));
                  }
                  return yield* new GitUnavailable({ command: args, reason: 'the command ended and its console could not be read' });
                }),
              );
            },
          };
          const answer = yield* world.submit(MINE, { git });
          if (successor === 'reset') {
            expect(answer.status).toBe('refused');
            expect(yield* world.run(['rev-parse', 'HEAD'])).toBe(base);
            expect(readFileSync(world.file, 'utf8')).toBe(`${FILE.join('\n')}\n`);
          } else {
            expect(answer).toMatchObject({ status: 'landed', commit: published });
            expect(yield* world.committed()).toEqual(successor === 'same' ? later : mine);
            if (successor === 'beside') expect(yield* world.run(['show', 'HEAD:src/later.ts'])).toBe('export const later = 1;');
          }
          expect(yield* world.run(['status', '--porcelain'])).toBe('');
        })(),
      ),
    );
  }
  const hooked = (world: Effect.Success<ReturnType<typeof makeCheckout>>, fixing: boolean): string => {
    const seen = join(world.root, '.git', 'seen-trees');
    const edit = fixing ? "sed 's/mine/MINE/' src/a.ts > src/a.ts.next && mv src/a.ts.next src/a.ts\n" : '';
    writeFileSync(join(world.root, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\ngit write-tree >> "${seen}"\n${edit}`);
    chmodSync(join(world.root, '.git', 'hooks', 'pre-commit'), 0o755);
    return seen;
  };
  for (const lockLost of [false, true]) {
    it.effect(
      `a commit landing ${lockLost ? 'while git commit holds HEAD' : 'between the build and the commit'} is kept, and the session’s own commit stands on it, checked by the hooks`,
      () =>
        withCheckout((checkout) =>
          Effect.fnUntraced(function* () {
            const world = checkout;
            const mine = [...FILE.slice(0, 4), 'const five = 5; // mine'];
            yield* world.wrote(MINE, mine);
            const seen = hooked(world, !lockLost);
            const answer = yield* world.submit(MINE, { git: racedBy(world, lockLost) });
            expect(answer.status).toBe('landed');
            if (answer.status !== 'landed') return;
            if (!lockLost) expect(answer.edited).toEqual(['src/a.ts']);
            expect(answer.commit).toBe(yield* world.run(['rev-parse', 'HEAD']));
            expect((yield* world.run(['log', '-2', '--format=%s'])).split('\n')).toEqual(['the work this commit answers', 'foreign']);
            expect(yield* world.run(['show', 'HEAD:src/other.ts'])).toBe('const other = 1;');
            const committed = lockLost ? mine : [...FILE.slice(0, 4), 'const five = 5; // MINE'];
            expect(yield* world.committed()).toEqual(committed);
            expect(readFileSync(world.file, 'utf8')).toBe(`${committed.join('\n')}\n`);
            expect(yield* world.run(['status', '--porcelain'])).toBe('');
            expect(readFileSync(seen, 'utf8').trim().split('\n').at(-1)).toBe(yield* world.run(['rev-parse', 'HEAD^{tree}']));
          })(),
        ),
    );
  }
  it.effect('a post-commit hook runs at the published commit and preserves work the commit does not carry', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        const both = ['const one = 100;', ...FILE.slice(1, 4), 'const five = 5; // mine'];
        yield* world.wrote(THEIRS, ['const one = 100;', ...FILE.slice(1)]);
        yield* world.wrote(MINE, both);
        writeFileSync(join(world.root, 'src', 'theirs.ts'), 'const theirs = 1;\n');
        writeFileSync(
          join(world.root, '.git', 'hooks', 'post-commit'),
          '#!/bin/sh\ngit rev-parse HEAD > "$(git rev-parse --git-dir)/posted"\ngit reset -q --hard && git clean -fdq\n',
        );
        chmodSync(join(world.root, '.git', 'hooks', 'post-commit'), 0o755);
        const answer = yield* world.submit(MINE);
        expect(answer).toMatchObject({ status: 'landed', carried: [{ path: 'src/a.ts', holders: [THEIRS] }] });
        if (answer.status !== 'landed') return;
        expect(readFileSync(join(world.root, '.git', 'posted'), 'utf8').trim()).toBe(answer.commit);
        expect(readFileSync(join(world.root, 'src', 'theirs.ts'), 'utf8')).toBe('const theirs = 1;\n');
        expect(yield* world.committed()).toEqual(both);
        expect(readFileSync(world.file, 'utf8')).toBe(`${both.join('\n')}\n`);
      })(),
    ),
  );
  it.effect('refusing and index-locking hooks preserve unpublished work, carry their edits back and allow the next landing', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        yield* world.wrote(MINE, [...FILE.slice(0, 4), 'const five = 5; // mine']);
        const before = yield* world.run(['rev-parse', 'HEAD']);
        writeFileSync(
          join(world.root, '.git', 'hooks', 'pre-commit'),
          "#!/bin/sh\nseq 1 300 | sed 's/^/progress step /'\necho 'error: src/a.ts is not formatted'\nexit 1\n",
        );
        chmodSync(join(world.root, '.git', 'hooks', 'pre-commit'), 0o755);
        const answer = yield* world.submit(MINE);
        expect(answer.status).toBe('refused');
        if (answer.status === 'refused') expect(answer.reason).toContain('error: src/a.ts is not formatted');
        expect(yield* world.run(['rev-parse', 'HEAD'])).toBe(before);
        expect(yield* world.run(['diff', '--cached', '--name-only'])).toBe('');
        expect((yield* world.rows()).every((row) => row.commit === null)).toBe(true);
        writeFileSync(
          join(world.root, '.git', 'hooks', 'pre-commit'),
          '#!/bin/sh\nsed \'s/mine/MINE/\' src/a.ts > src/a.ts.next && mv src/a.ts.next src/a.ts\ntouch "$GIT_INDEX_FILE.lock"\n',
        );
        const refused = yield* world.submit(MINE);
        expect(refused).toMatchObject({ status: 'refused', edited: ['src/a.ts'] });
        expect(yield* world.run(['rev-parse', 'HEAD'])).toBe(before);
        const formatted = [...FILE.slice(0, 4), 'const five = 5; // MINE'];
        expect(readFileSync(world.file, 'utf8')).toBe(`${formatted.join('\n')}\n`);
        writeFileSync(join(world.root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\n');
        expect((yield* world.submit(MINE)).status).toBe('landed');
        expect(yield* world.committed()).toEqual(formatted);
      })(),
    ),
  );
  it.effect(
    'hooks stage only the selected tree, see ignored tools, preserve peer work and leave their unstaged and message edits held',
    () =>
      withCheckout((world) =>
        Effect.fnUntraced(function* () {
          const theirs = join(world.root, 'src', 'theirs.ts');
          const left = 'src/left.ts';
          const mine = [...FILE.slice(0, 4), 'const five = 5; // mine'];
          writeFileSync(theirs, 'const theirs = 1;\n');
          writeFileSync(join(world.root, left), `${FILE.join('\n')}\n`);
          writeFileSync(join(world.root, '.gitignore'), 'node_modules/\n');
          yield* world.run(['add', '--', 'src/theirs.ts', left, '.gitignore']);
          yield* world.run(['commit', '-qm', 'the peer file and ignored tools']);
          mkdirSync(join(world.root, 'node_modules'));
          writeFileSync(join(world.root, 'node_modules', 'tool.js'), 'tool\n');
          yield* world.wrote(THEIRS, ['const theirs = 2; // unfinished'], { path: 'src/theirs.ts' });
          yield* world.wrote(MINE, mine);
          yield* world.wrote(MINE, mine, { path: left });
          const held = new Set((yield* world.rows()).filter((row) => row.holder === MINE).map((row) => row.id));
          writeFileSync(
            join(world.root, '.git', 'hooks', 'pre-commit'),
            "#!/bin/sh\ntest -e node_modules/tool.js || exit 1\ngit checkout -- . || exit 1\nsed 's/mine/MINE/' src/a.ts > src/a.ts.next && mv src/a.ts.next src/a.ts\ngit add -A\nsed 's/mine/MINE/' src/left.ts > src/left.ts.next && mv src/left.ts.next src/left.ts\n",
          );
          writeFileSync(join(world.root, '.git', 'hooks', 'commit-msg'), "#!/bin/sh\nprintf '// noted\\n' >> src/left.ts\n");
          chmodSync(join(world.root, '.git', 'hooks', 'pre-commit'), 0o755);
          chmodSync(join(world.root, '.git', 'hooks', 'commit-msg'), 0o755);
          const answer = yield* world.submit(MINE);
          expect(answer).toMatchObject({ status: 'landed', edited: ['src/a.ts', left], left: [{ path: left, reason: 'written' }] });
          expect(readFileSync(theirs, 'utf8')).toBe('const theirs = 2; // unfinished\n');
          expect(yield* world.run(['show', 'HEAD:src/theirs.ts'])).toBe('const theirs = 1;');
          expect(
            (yield* world.run(['ls-tree', '-r', '--name-only', 'HEAD'])).split('\n').filter((path) => path.startsWith('node_modules')),
          ).toEqual([]);
          const formatted = [...FILE.slice(0, 4), 'const five = 5; // MINE'];
          expect(yield* world.committed()).toEqual(formatted);
          expect(yield* world.run(['show', `HEAD:${left}`])).toBe(mine.join('\n'));
          expect(readFileSync(world.file, 'utf8')).toBe(`${formatted.join('\n')}\n`);
          expect(readFileSync(join(world.root, left), 'utf8')).toBe(`${[...formatted, '// noted'].join('\n')}\n`);
          const rows = (yield* world.rows()).filter((row) => row.holder === MINE);
          expect(rows.filter((row) => held.has(row.id)).every((row) => row.commit !== null)).toBe(true);
          expect(rows.some((row) => row.commit === null)).toBe(true);
        })(),
      ),
  );
  it.effect(
    "a fixing hook that refuses leaves its edits in the working files as the session's own work, and the next submit lands them",
    () =>
      withCheckout((checkout) =>
        Effect.fnUntraced(function* () {
          const world = checkout;
          yield* world.wrote(MINE, [...FILE.slice(0, 4), 'const five = 5; // mine']);
          writeFileSync(
            join(world.root, '.git', 'hooks', 'pre-commit'),
            "#!/bin/sh\ngrep -q mine src/a.ts || exit 0\nsed 's/mine/MINE/' src/a.ts > src/a.ts.next && mv src/a.ts.next src/a.ts\nprintf 'made\\n' > src/made.ts\nexit 1\n",
          );
          chmodSync(join(world.root, '.git', 'hooks', 'pre-commit'), 0o755);
          const before = yield* world.run(['rev-parse', 'HEAD']);
          const refused = yield* world.submit(MINE);
          expect(refused).toMatchObject({ status: 'refused', edited: ['src/a.ts', 'src/made.ts'] });
          expect(yield* world.run(['rev-parse', 'HEAD'])).toBe(before);
          const formatted = [...FILE.slice(0, 4), 'const five = 5; // MINE'];
          expect(readFileSync(world.file, 'utf8')).toBe(`${formatted.join('\n')}\n`);
          expect(readFileSync(join(world.root, 'src', 'made.ts'), 'utf8')).toBe('made\n');
          expect((yield* world.submit(MINE)).status).toBe('landed');
          expect(yield* world.committed()).toEqual(formatted);
          expect(yield* world.run(['show', 'HEAD:src/made.ts'])).toBe('made');
        })(),
      ),
  );
  it.effect('more held paths than one git call can name land in one commit', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        const dir = `src/${'a-directory-deep-enough-to-make-every-path-long/'.repeat(16)}and-longer-still`;
        mkdirSync(join(world.root, dir), { recursive: true });
        const paths = Array.from({ length: 24 }, (_, at) => `${dir}/generated-file-${String(at).padStart(3, '0')}.ts`);
        expect(paths.join(' ').length).toBeGreaterThan(ENVELOPE);
        for (const path of paths) {
          writeFileSync(join(world.root, path), `export const n = ${path.length};\n`);
          yield* world.record(MINE, '', `export const n = ${path.length};\n`, { path, origin: 'write' });
        }
        const answer = yield* world.submit(MINE, { git: enveloped(world.git) });
        expect(answer.status).toBe('landed');
        if (answer.status !== 'landed') return;
        expect(answer.committed.length).toBe(paths.length);
        expect(yield* world.run(['status', '--porcelain', '--', dir])).toBe('');
      })(),
    ),
  );
  const WAY_OUT = 'name a live thread of this project to own the command';
  const notAdmittedOn = (git: Git['Service'], verb: string): Git['Service'] => ({
    run: (args, options) =>
      args.includes(verb)
        ? Effect.fail(
            new GitNotAdmitted({
              command: args,
              code: 'terminal-no-owner',
              reason: 'The named owner is not live, so it cannot take ownership.',
              unblock: [WAY_OUT],
            }),
          )
        : git.run(args, options),
  });
  it.effect('Git admission, availability, build and publication refusals preserve the branch, index and held work', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        yield* world.wrote(MINE, [...FILE.slice(0, 4), 'const five = 5; // mine']);
        const before = yield* world.run(['rev-parse', 'HEAD']);
        const refused = yield* Effect.provide(
          Effect.flip(world.submitAs(MINE, { git: notAdmittedOn(world.git, '--absolute-git-dir') })),
          world.context,
        );
        expect(refused).toBeInstanceOf(GateRefusal);
        if (!(refused instanceof GateRefusal)) return;
        expect(refused.code).toBe('git-not-admitted');
        expect(refused.reason).toContain('terminal-no-owner');
        expect(refused.unblock).toEqual([WAY_OUT]);
        expect(yield* world.run(['rev-parse', 'HEAD'])).toBe(before);
        const unavailable = yield* Effect.provide(
          Effect.flip(world.submitAs(MINE, { git: unstartedOn(world.git, '--absolute-git-dir') })),
          world.context,
        );
        expect(unavailable instanceof GateRefusal ? unavailable.code : unavailable).toBe('git-unavailable');
        const rebuilding = yield* Effect.provide(
          Effect.flip(world.submitAs(MINE, { git: notAdmittedOn(world.git, 'read-tree') })),
          world.context,
        );
        expect(rebuilding instanceof GateRefusal ? rebuilding.code : rebuilding).toBe('git-not-admitted');
        const made = yield* world.submit(MINE, { git: unstartedOn(world.git, 'commit-tree') });
        expect(made.status).toBe('refused');
        expect(yield* world.run(['rev-parse', 'HEAD'])).toBe(before);
        expect(yield* world.run(['diff', '--cached', '--name-only'])).toBe('');
        expect((yield* world.rows()).every((row) => row.commit === null)).toBe(true);
        const published = yield* world.submit(MINE, { git: unstartedOn(world.git, 'update-ref') });
        expect(published.status).toBe('refused');
        expect(yield* world.run(['rev-parse', 'HEAD'])).toBe(before);
        expect(yield* world.run(['diff', '--cached', '--name-only'])).toBe('');
        expect(readFileSync(world.file, 'utf8')).toBe(`${[...FILE.slice(0, 4), 'const five = 5; // mine'].join('\n')}\n`);
        expect((yield* world.rows()).every((row) => row.commit === null)).toBe(true);
      })(),
    ),
  );
});
