import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Clock, Effect, Fiber } from 'effect';
import { contentDigest } from '@runlith/files/content';
import { OVERLAP_REASON } from '../../../change-record/record/commands.js';
import { holdingsOver } from '../../../change-record/testing/holdings.js';
import { naming } from '../../../change-record/testing/doubles.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { call, MINE, THEIRS } from '../checkoutFixture.js';
import { base, CommandWalks, commandLayer, commandWorld, fileReady } from './commandWorld.js';

type World = Effect.Success<ReturnType<typeof commandWorld>>;

const git = (s: World, args: readonly string[]) => s.w.run(args);

const windowsOf = Effect.fnUntraced(function* (s: World) {
  return yield* Effect.forEach([MINE, THEIRS], (threadId) =>
    Effect.flatMap(
      s.record.changes({ work: { projectId: s.w.projectId, threadId } }).command?.(s.w.root, naming(s.w.root)) ?? Effect.succeed(null),
      (life) => (life === null ? Effect.die('the checkout opened no command window') : Effect.succeed(life)),
    ),
  );
});

layer(commandLayer, { excludeTestServices: true })('command landing', (it) => {
  it.effect(
    'a command that generates a picture and sweeps files by a glob proves none of them, and submit_work naming them lands them all',
    () =>
      Effect.gen(function* () {
        const s = yield* commandWorld();
        for (const name of ['b', 'c']) writeFileSync(join(s.w.root, 'src', `${name}.ts`), base);
        yield* git(s, ['add', '--', 'src']);
        yield* git(s, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'more files']);

        yield* call(s.mine.bash, {
          command: `printf '\\122\\111\\106\\106\\000\\377' > picture.webp && perl -pi -e 's/const one = 1;/const one = 10;/' src/*.ts`,
          description: 'Generate a picture and rewrite three files',
        });

        expect((yield* s.w.submit(MINE, { commands: s.commands })).status).toBe('nothing');
        const landed = yield* s.w.submit(MINE, { commands: s.commands, paths: ['picture.webp', 'src'] });
        expect(landed.status).toBe('landed');
        if (landed.status !== 'landed') return;
        expect([...landed.committed].sort()).toEqual(['picture.webp', 'src/a.ts', 'src/b.ts', 'src/c.ts']);
        expect(yield* git(s, ['status', '--porcelain'])).toBe('');
        expect(yield* git(s, ['show', 'HEAD:src/c.ts'])).toBe(base.replace('const one = 1;', 'const one = 10;').trimEnd());
      }),
  );

  it.effect(
    'a command after an overlap preserves the unknown author’s lines, attributes its own, and retires with the whole-file commit',
    () =>
      Effect.gen(function* () {
        const s = yield* commandWorld();
        const reading = join(s.w.root, '.git', 'reading');
        const read = yield* Effect.forkChild(
          call(s.theirs.bash, {
            command: `exec bun -e 'const fs = require("node:fs"); fs.writeFileSync(".git/reading", ""); await new Promise(resolve => { const ready = () => { if (fs.existsSync("gen.txt")) { observer.close(); resolve(); } }; const observer = fs.watch(".", ready); ready(); }); process.stdout.write(fs.readFileSync("src/a.ts", "utf8")); fs.writeFileSync(".git/read-done", "");'`,
            description: 'Read while the other runs',
          }),
        );
        yield* fileReady(reading);
        yield* call(s.mine.bash, {
          command: `exec bun -e 'const fs = require("node:fs"); const done = new Promise(resolve => { const ready = () => { if (fs.existsSync(".git/read-done")) { observer.close(); resolve(); } }; const observer = fs.watch(".git", ready); ready(); }); fs.writeFileSync("gen.txt", "made\\n"); await done;'`,
          description: 'Generate one file',
        });
        yield* Fiber.join(read);
        yield* Effect.all([s.decided(MINE), s.decided(THEIRS)], { concurrency: 2 });

        expect(yield* s.held('gen.txt')).toEqual([]);
        for (const threadId of [MINE, THEIRS]) {
          expect(s.commands.unattributed({ projectId: s.w.projectId, threadId })).toMatchObject([
            { checkout: 'repo-root', path: 'gen.txt', reason: OVERLAP_REASON },
          ]);
        }
        yield* call(s.mine.bash, { command: `printf 'mine\\n' >> gen.txt`, description: 'Append after the overlap' });
        yield* s.decided(MINE);
        const rig = yield* holdingsOver(s.w.store, s.w.units, s.w.git, s.w.root, yield* CommandWalks);
        const judged = yield* rig.holdings.judged(RootId.make('repo-root'), ['gen.txt']);
        expect(judged.get('gen.txt')?.holding.verdict).toMatchObject({
          verdict: 'proven',
          hands: [{ holder: { kind: 'thread', thread: MINE }, added: 1, removed: 0 }],
          nobody: [{ added: 1, removed: 0 }],
        });
        const landed = yield* s.w.submit(MINE, { commands: s.commands, paths: ['gen.txt'], whole: ['gen.txt'] });
        expect(landed.status).toBe('landed');
        if (landed.status !== 'landed') return;
        expect([...landed.committed]).toEqual(['gen.txt']);
        expect((yield* s.w.rows()).filter((row) => row.path === 'gen.txt').map((row) => [row.state, row.commit])).toEqual([
          ['committed', landed.commit],
        ]);
      }),
  );

  it.effect('a formatter over a file this session edited keeps its lines while another session runs its tests', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      const formatter = join(s.w.root, 'node_modules', '.bin', 'oxfmt');
      mkdirSync(dirname(formatter), { recursive: true });
      writeFileSync(
        formatter,
        `#!/bin/sh\nfor f; do case "$f" in -*) ;; *) perl -pi -e 's/;$//' "$f" ;; esac; done\ntouch .git/format-done\n`,
      );
      chmodSync(formatter, 0o755);
      const waiting = join(dirname(s.w.root), 'wait.ts');
      writeFileSync(
        waiting,
        `const fs = require("node:fs"); fs.writeFileSync(".git/testing", ""); await new Promise(resolve => { const ready = () => { if (fs.existsSync(".git/format-done")) { observer.close(); resolve(); } }; const observer = fs.watch(".git", ready); ready(); });\n`,
      );
      writeFileSync(join(s.w.root, 'package.json'), JSON.stringify({ scripts: { test: `bun ${waiting}` } }));
      yield* call(s.mine.edit, { path: 'src/a.ts', oldString: 'const one = 1;', newString: 'const one = 10;' });

      const tests = yield* Effect.forkChild(call(s.theirs.bash, { command: 'bun run test', description: 'Run the tests' }));
      yield* fileReady(join(s.w.root, '.git', 'testing'));
      yield* call(s.mine.bash, { command: 'bunx --no-install oxfmt --threads=3 src/a.ts', description: 'Format' });
      yield* Fiber.join(tests);
      yield* Effect.all([s.decided(MINE), s.decided(THEIRS)], { concurrency: 2 });

      expect(s.commands.unattributed({ projectId: s.w.projectId, threadId: MINE })).toEqual([]);
      const landed = yield* s.w.submit(MINE, { commands: s.commands });
      expect(landed).toMatchObject({ status: 'landed', committed: ['src/a.ts'] });
      expect(yield* git(s, ['show', 'HEAD:src/a.ts'])).toBe(
        base.replace('const one = 1;', 'const one = 10;').replaceAll(';', '').trimEnd(),
      );
    }),
  );

  it.effect('a directory selection lands retained nobody-attributed command paths within it', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      const from = yield* Clock.currentTimeMillis;
      const active = yield* windowsOf(s);
      for (const life of active) life.opened();
      const text = 'generated\n';
      const names = ['src/generated.ts', 'src-other.ts'];
      for (const name of names) writeFileSync(join(s.w.root, name), text);
      const writtenAt = yield* Clock.currentTimeMillis;
      for (const life of active) life.ended();
      for (const life of active) {
        yield* life.settle({
          base: null,
          window: { from, to: writtenAt },
          moves: names.map((name) => ({
            name,
            before: null,
            after: contentDigest(text),
            present: true,
            existed: false,
            written: { from: writtenAt, to: writtenAt },
            bytes: null,
            link: false,
            mode: null,
          })),
        });
        life.close();
      }
      yield* s.decided(MINE);
      expect(yield* s.held('src/generated.ts')).toEqual([]);
      expect(s.commands.unattributed({ projectId: s.w.projectId, threadId: MINE }).map((one) => one.path)).toEqual(names);

      const landed = yield* s.w.submit(MINE, { commands: s.commands, paths: ['src/'], whole: ['src/'] });
      expect(landed).toMatchObject({ status: 'landed', committed: ['src/generated.ts'] });
      expect(yield* git(s, ['show', 'HEAD:src/generated.ts'])).toBe(text.trimEnd());
      expect(yield* git(s, ['status', '--porcelain'])).toBe('?? src-other.ts');
    }),
  );

  it.effect('a symlink to a directory a command creates lands as a link', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      yield* call(s.mine.bash, { command: 'ln -s src linked', description: 'Link a directory' });
      const landed = yield* s.w.submit(MINE, { commands: s.commands });
      expect(landed).toMatchObject({ status: 'landed', committed: ['linked'] });
      expect(yield* git(s, ['ls-tree', 'HEAD', 'linked'])).toStartWith('120000 blob');
    }),
  );

  it.effect(
    'a picture another session changed and has not landed lands with the session that overwrites it, carrying and naming that session',
    () =>
      Effect.gen(function* () {
        const s = yield* commandWorld();
        writeFileSync(join(s.w.root, 'picture.png'), new Uint8Array([0x89, 0x50, 0, 1]));
        writeFileSync(join(s.w.root, '.gitattributes'), 'picture.png linguist-generated=false\n');
        yield* git(s, ['add', '--', 'picture.png', '.gitattributes']);
        yield* git(s, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'a picture']);
        yield* call(s.theirs.bash, { command: `printf '\\211PNG\\000\\002' > picture.png`, description: 'Repaint' });
        yield* s.decided(THEIRS);
        yield* call(s.mine.bash, { command: `printf '\\211PNG\\000\\003' > picture.png`, description: 'Repaint again' });
        yield* s.decided(MINE);
        const landed = yield* s.w.submit(MINE, { commands: s.commands, paths: ['picture.png'] });
        expect(landed).toMatchObject({
          status: 'landed',
          committed: ['picture.png'],
          carried: [{ path: 'picture.png', holders: [THEIRS] }],
        });
        expect(yield* git(s, ['status', '--porcelain'])).toBe('');
        expect((yield* s.w.rows()).map((row) => [row.holder, row.state]).sort()).toEqual(
          [
            [THEIRS, 'committed'],
            [MINE, 'committed'],
          ].sort(),
        );
      }),
  );

  it.effect('an empty file a command creates and an empty tracked file it deletes both land', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      writeFileSync(join(s.w.root, 'src', 'gone.ts'), '');
      yield* git(s, ['add', '--', 'src/gone.ts']);
      yield* git(s, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'an empty file']);
      yield* call(s.mine.bash, { command: 'touch src/empty.ts && rm src/gone.ts', description: 'Make one empty file and drop another' });

      const landed = yield* s.w.submit(MINE, { commands: s.commands });
      expect(landed.status).toBe('landed');
      if (landed.status === 'landed') expect([...landed.committed].sort()).toEqual(['src/empty.ts', 'src/gone.ts']);
      expect(yield* git(s, ['status', '--porcelain'])).toBe('');
    }),
  );

  it.effect('a submit that lands past overlap command paths names them unattributed, and naming them lands a deletion among them', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      const goneText = 'export const gone = 1;\n';
      writeFileSync(join(s.w.root, 'src', 'gone.ts'), goneText);
      yield* git(s, ['add', '--', 'src/gone.ts']);
      yield* git(s, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'a file to delete']);
      const from = yield* Clock.currentTimeMillis;
      const active = yield* windowsOf(s);
      for (const life of active) life.opened();
      const madeText = 'export const made = 1;\n';
      rmSync(join(s.w.root, 'src', 'gone.ts'));
      writeFileSync(join(s.w.root, 'src', 'made.ts'), madeText);
      const writtenAt = yield* Clock.currentTimeMillis;
      for (const life of active) life.ended();
      const moves = [
        {
          name: 'src/gone.ts',
          before: contentDigest(goneText),
          after: contentDigest(''),
          present: false,
          existed: true,
          written: null,
          bytes: null,
          link: false,
          mode: null,
        },
        {
          name: 'src/made.ts',
          before: null,
          after: contentDigest(madeText),
          present: true,
          existed: false,
          written: { from: writtenAt, to: writtenAt },
          bytes: null,
          link: false,
          mode: null,
        },
      ];
      for (const life of active) {
        yield* life.settle({ base: null, window: { from, to: writtenAt }, moves });
        life.close();
      }
      yield* s.decided(MINE);
      expect(
        s.commands
          .unattributed({ projectId: s.w.projectId, threadId: MINE })
          .map((one) => one.path)
          .sort(),
      ).toEqual(['src/gone.ts', 'src/made.ts']);
      yield* call(s.mine.bash, { command: `printf 'export const own = 1;\\n' > src/own.ts`, description: 'Make an attributed file' });
      yield* s.decided(MINE);

      const landed = yield* s.w.submit(MINE, { commands: s.commands });
      expect(landed.status).toBe('landed');
      if (landed.status !== 'landed') return;
      expect([...landed.committed]).toEqual(['src/own.ts']);
      expect(landed.unattributed).toEqual(['src/gone.ts', 'src/made.ts']);
      expect(yield* git(s, ['status', '--porcelain'])).toBe(' D src/gone.ts\n?? src/made.ts');

      const named = yield* s.w.submit(MINE, { commands: s.commands, paths: ['src/gone.ts', 'src/made.ts'] });
      expect(named.status).toBe('landed');
      if (named.status !== 'landed') return;
      expect([...named.committed].sort()).toEqual(['src/gone.ts', 'src/made.ts']);
      expect(named.unattributed).toBeUndefined();
      expect(yield* git(s, ['status', '--porcelain'])).toBe('');
      expect(yield* git(s, ['ls-tree', '--name-only', 'HEAD', '--', 'src/gone.ts'])).toBe('');
      expect(yield* git(s, ['show', 'HEAD:src/made.ts'])).toBe(madeText.trimEnd());
    }),
  );
});
