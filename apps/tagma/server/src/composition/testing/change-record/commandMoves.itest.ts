import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Deferred, Effect, Fiber } from 'effect';
import { eq } from 'drizzle-orm';
import { bytesDigest, contentDigest, versionContentLimit } from '@runlith/files/content';
import { journalOf, workspaceChange } from '../../../change-record/testing/doubles.js';
import { call, MINE, THEIRS } from '../checkoutFixture.js';
import { base, CommandWalks, commandLayer, commandWorld, fileReady } from './commandWorld.js';

layer(commandLayer, { excludeTestServices: true })('command moves', (it) => {
  it.effect('shell globs and find deletion roots own their deletions beside an opaque peer, without claiming unmatched paths', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      const named = [
        'dist/a.js',
        'run.log',
        'build/nested/a.map',
        'negative/a-b.js',
        'quoted/{a,b}1.js',
        'classes/a.js',
        'classes/!.js',
        'classes/^.js',
        'dash/-.js',
      ];
      const outside = ['dist/a.txt', 'dist/.hidden.js', 'dist/deeper/b.js', 'negative/a/b.js', 'quoted/a1.js', 'classes/b.js', 'dash/m.js'];
      for (const dir of ['dist/deeper', 'build/nested', 'negative/a', 'quoted', 'classes', 'dash'])
        mkdirSync(join(s.w.root, dir), { recursive: true });
      for (const name of [...named, ...outside]) writeFileSync(join(s.w.root, name), `${name}\n`);
      yield* s.w.run(['add', '--', 'dist', 'build', 'run.log', 'negative', 'quoted', 'classes', 'dash']);
      yield* s.w.run(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'deletion inputs']);
      const peer = yield* Effect.forkChild(
        call(s.theirs.bash, {
          command: `exec bun -e 'const fs = require("node:fs"); await new Promise(resolve => { const check = () => { if (!fs.existsSync("dist/a.js") && !fs.existsSync("build/nested/a.map")) { observer.close(); resolve(); } }; const observer = fs.watch(".", {recursive:true}, check); fs.writeFileSync("running", "ready"); check(); }); for (const name of ${JSON.stringify(outside)}) fs.unlinkSync(name);'`,
          description: 'Wait for both deletions and remove unmatched files',
        }),
      );
      yield* fileReady(join(s.w.root, 'running'));
      yield* call(s.mine.bash, {
        command: String.raw`rm -f dist/*.js *.log negative/a[!x]b.js quoted/'{a,b}'*.js classes/[\!a].js classes/[\^a].js dash/[a\-z].js`,
        description: 'Remove shell matches',
      });
      yield* call(s.mine.bash, { command: "find build -name '*.map' -delete", description: 'Remove maps under build' });
      yield* Fiber.join(peer);
      yield* Effect.all([s.decided(MINE), s.decided(THEIRS)]);
      for (const name of named) expect(yield* s.held(name)).toEqual([[MINE, contentDigest(`${name}\n`), null]]);
      for (const name of outside) expect(yield* s.held(name)).toEqual([]);
    }),
  );

  it.effect('a file past the text limit written by a command is held by its thread at the digest of its bytes', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      const big = new Uint8Array(versionContentLimit + 1).fill(97);
      writeFileSync(join(s.w.root, 'source.bin'), big);
      yield* call(s.mine.bash, { command: 'cp source.bin big.bin', description: 'Copy one file past the text limit' });
      yield* s.decided(MINE);

      expect((yield* s.held('big.bin')).map(([threadId, , after]) => [threadId, after])).toEqual([[MINE, bytesDigest(big)]]);
    }),
  );

  it.effect('a command decided and written leaves no window in the journal', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      const closed = yield* Deferred.make<void>();
      yield* Effect.acquireRelease(
        Effect.sync(() => s.commands.onClose(() => Effect.asVoid(Deferred.succeed(closed, undefined)))),
        (stop) => Effect.sync(stop),
      );
      yield* call(s.mine.bash, { command: `printf 'journaled\\n' > src/a.ts`, description: 'Rewrite one file' });
      yield* s.decided(MINE);
      const journal = yield* journalOf(s.w.store, s.w.units, yield* CommandWalks);
      yield* Deferred.await(closed);
      expect(yield* journal.windows()).toEqual([]);
      expect((yield* s.held('src/a.ts')).map(([threadId]) => threadId)).toEqual([MINE]);
    }),
  );

  it.effect('a command that moves a file records the new path as moved from the old one', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      yield* call(s.mine.bash, { command: 'mv src/a.ts src/moved.ts', description: 'Move one file' });
      yield* s.decided(MINE);

      const rows = yield* s.w.store.db
        .select({ path: workspaceChange().path, origin: workspaceChange().origin, movedFrom: workspaceChange().movedFrom })
        .from(workspaceChange())
        .where(eq(workspaceChange().holder, MINE));
      expect([...rows].sort((one, other) => one.path.localeCompare(other.path))).toEqual([
        { path: 'src/a.ts', origin: 'delete', movedFrom: null },
        { path: 'src/moved.ts', origin: 'write', movedFrom: 'src/a.ts' },
      ]);
    }),
  );

  it.effect('two edits of one file at once go in turn, and each row stands on the bytes the other left', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      yield* Effect.all(
        [
          call(s.mine.edit, { path: 'src/a.ts', oldString: 'const one = 1;', newString: 'const one = 10;' }),
          call(s.theirs.edit, { path: 'src/a.ts', oldString: 'const five = 5;', newString: 'const five = 50;' }),
        ],
        { concurrency: 2 },
      );

      const text = readFileSync(s.w.file, 'utf8');
      expect(text).toBe(base.replace('const one = 1;', 'const one = 10;').replace('const five = 5;', 'const five = 50;'));
      const rows = yield* s.held('src/a.ts');
      expect(rows).toHaveLength(2);
      expect(rows[0]?.[1]).toBe(contentDigest(base));
      expect(rows[1]?.[1]).toBe(rows[0]?.[2]);
      expect(rows[1]?.[2]).toBe(contentDigest(text));
    }),
  );

  it.effect('a command that moves an empty file records the new path as moved from the old one', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      writeFileSync(join(s.w.root, 'src', 'empty.ts'), '');
      yield* s.w.run(['add', '--', 'src/empty.ts']);
      yield* s.w.run(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'an empty file']);
      yield* call(s.mine.bash, { command: 'mv src/empty.ts src/still-empty.ts', description: 'Move the empty file' });
      yield* s.decided(MINE);

      const rows = yield* s.w.store.db
        .select({ path: workspaceChange().path, movedFrom: workspaceChange().movedFrom })
        .from(workspaceChange())
        .where(eq(workspaceChange().holder, MINE));
      expect(rows.find((row) => row.path === 'src/still-empty.ts')?.movedFrom).toBe('src/empty.ts');
    }),
  );
});
