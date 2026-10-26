import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Fiber } from 'effect';
import { contentDigest } from '@runlith/files/content';
import { makeWalks } from '../../../change-record/lines/walks.js';
import { collectReleased, sweepVersions } from '../../../change-record/record/versions.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { call, FILE, MINE, THEIRS } from '../checkoutFixture.js';
import { base, commandLayer, commandWorld, fileReady } from './commandWorld.js';

const printed = (lines: readonly string[]) => `printf '%s\\n' ${lines.map((line) => `'${line}'`).join(' ')} > src/a.ts`;

const reasons = (s: Effect.Success<ReturnType<typeof commandWorld>>, threadId: string) =>
  s.commands.unattributed({ projectId: s.w.projectId, threadId }).map((one) => [one.path, one.reason]);

layer(commandLayer, { excludeTestServices: true })('command writes', (it) => {
  for (const [snapshot, also] of [
    ['read by its changed paths', ''],
    ['read whole because the ignore rules moved', ` && printf 'ignored/\\n' > .gitignore`],
  ] as const)
    it.effect(`a command’s edit of a tracked file stays its own while a lagging fsmonitor hides it, its after-snapshot ${snapshot}`, () =>
      Effect.gen(function* () {
        const s = yield* commandWorld({ cursor: true });
        const hook = join(s.w.root, '.git', 'hooks', 'stale-monitor');
        writeFileSync(hook, "#!/bin/sh\nprintf 'stale\\0'\n", { mode: 0o755 });
        yield* s.w.run(['config', 'core.fsmonitor', hook]);
        utimesSync(s.w.file, 1_000_000_000, 1_000_000_000);
        for (const _ of [1, 2]) yield* spawnedEffect(['git', 'status', '--porcelain'], { cwd: s.w.root });
        yield* call(s.mine.bash, { command: `printf 'rewritten\\n' > src/a.ts${also}`, description: 'Rewrite the file' });
        const stale = yield* spawnedEffect(['git', 'status', '--porcelain', '--untracked-files=no'], { cwd: s.w.root });
        expect(new TextDecoder().decode(stale.stdout)).toBe('');
        yield* s.decided(MINE);

        expect(yield* s.held('src/a.ts')).toEqual([[MINE, contentDigest(base), contentDigest('rewritten\n')]]);
      }),
    );

  it.effect('a file the write tool makes keeps its row, and a script of the same step changing it after is unproven', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      yield* Effect.all(
        [
          call(s.mine.write, { path: 'src/new.ts', content: 'one\n' }),
          call(s.mine.bash, {
            command: `exec bun -e 'const fs = require("node:fs"); await new Promise(resolve => { const ready = () => { if (fs.existsSync("src/new.ts") && fs.statSync("src/new.ts").size > 0) { observer.close(); resolve(); } }; const observer = fs.watch("src", ready); ready(); }); fs.appendFileSync("src/new.ts", "two\\n");'`,
            description: 'Append to the new file once it stands',
          }),
        ],
        { concurrency: 2 },
      );
      yield* s.decided(MINE);

      expect(readFileSync(join(s.w.root, 'src/new.ts'), 'utf8')).toBe('one\ntwo\n');
      expect(yield* s.held('src/new.ts')).toEqual([[MINE, contentDigest(''), contentDigest('one\n')]]);
      expect(reasons(s, MINE)).toEqual([['src/new.ts', 'unproven']]);
    }),
  );

  it.effect(
    'an edit another session makes while a script runs is recorded on that session, and the script’s step under it is not credited',
    () =>
      Effect.gen(function* () {
        const s = yield* commandWorld();
        const running = yield* Effect.forkChild(
          call(s.mine.bash, {
            command: `exec bun -e 'const fs = require("node:fs"); const done = new Promise(resolve => { const observer = fs.watch("src/a.ts", () => { if (fs.readFileSync("src/a.ts", "utf8") === "v2\\n") { observer.close(); resolve(); } }); }); fs.writeFileSync("src/a.ts", "v1\\n"); await done;'`,
            description: 'Rewrite and wait for the peer edit',
          }),
        );
        yield* fileReady(s.w.file, () => readFileSync(s.w.file, 'utf8') === 'v1\n');
        yield* call(s.theirs.edit, { path: 'src/a.ts', oldString: 'v1', newString: 'v2' });
        yield* Fiber.join(running);
        yield* s.decided(MINE);

        expect(yield* s.held('src/a.ts')).toEqual([[THEIRS, contentDigest('v1\n'), contentDigest('v2\n')]]);
        expect(reasons(s, MINE)).toEqual([]);
      }),
  );

  it.effect('a command over a file another session holds lines in lands its own lines and leaves theirs held', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      yield* call(s.theirs.edit, { path: 'src/a.ts', oldString: 'const one = 1;', newString: 'const one = 100;' });
      yield* call(s.mine.bash, {
        command: printed(['const one = 100;', ...FILE.slice(1, 4), 'const five = 50;']),
        description: 'Rewrite the last line',
      });

      const landed = yield* s.w.submit(MINE, { commands: s.commands });
      expect(landed.status).toBe('landed');
      expect(yield* s.w.committed()).toEqual([...FILE.slice(0, 4), 'const five = 50;']);
      expect(readFileSync(s.w.file, 'utf8')).toBe(`${['const one = 100;', ...FILE.slice(1, 4), 'const five = 50;'].join('\n')}\n`);
      expect((yield* s.held('src/a.ts')).map(([threadId]) => threadId)).toEqual([THEIRS]);
    }),
  );

  it.effect(
    'after a landing’s versions are collected, a command over a file a peer still holds records its own lines from the kept base',
    () =>
      Effect.gen(function* () {
        const s = yield* commandWorld();
        yield* call(s.mine.edit, { path: 'src/a.ts', oldString: 'const one = 1;', newString: 'const one = 10;' });
        expect((yield* s.w.submit(MINE, { commands: s.commands })).status).toBe('landed');
        yield* call(s.theirs.edit, { path: 'src/a.ts', oldString: 'const two = 2;', newString: 'const two = 20;' });
        yield* collectReleased(s.w.units, s.w.store);
        yield* sweepVersions(s.w.units, s.w.store);

        yield* call(s.mine.bash, {
          command: printed(['const one = 10;', 'const two = 20;', ...FILE.slice(2, 4), 'const five = 50;']),
          description: 'Rewrite the last line',
        });
        yield* s.decided(MINE);

        const held = (yield* s.w.rows()).filter((row) => row.committedAt === null).sort((one, two) => one.holder.localeCompare(two.holder));
        expect(held.map((row) => [row.holder, row.oldText, row.newText])).toEqual([
          [THEIRS, 'const two = 2;\n', 'const two = 20;\n'],
          [MINE, 'const five = 5;\n', 'const five = 50;\n'],
        ]);
      }),
  );

  it.effect('a command that returns a held file to HEAD records that move as its own', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      yield* call(s.theirs.edit, { path: 'src/a.ts', oldString: 'const one = 1;', newString: 'const one = 100;' });
      const edited = readFileSync(s.w.file, 'utf8');
      yield* call(s.mine.bash, { command: 'git checkout -- src/a.ts', description: 'Throw the edit away' });
      yield* s.decided(MINE);

      expect(readFileSync(s.w.file, 'utf8')).toBe(base);
      const mine = (yield* s.w.rows()).filter((row) => row.holder === MINE);
      expect(mine.map((row) => [row.path, row.beforeHash, row.afterHash])).toEqual([
        ['src/a.ts', contentDigest(edited), contentDigest(base)],
      ]);
    }),
  );

  it.effect('a file only one command was running for is that command’s, whatever ran before or after it', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      yield* call(s.theirs.bash, { command: 'cat src/a.ts', description: 'Read first' });
      yield* call(s.mine.bash, { command: `printf 'alone\\n' > alone.txt`, description: 'Generate one file' });
      yield* call(s.theirs.bash, { command: 'cat alone.txt', description: 'Read after' });
      yield* Effect.all([s.decided(MINE), s.decided(THEIRS)], { concurrency: 2 });

      expect(yield* s.held('alone.txt')).toEqual([[MINE, contentDigest(''), contentDigest('alone\n')]]);
    }),
  );

  it.effect('rows that cannot be written within their patience leave the paths unattributed and named, and readers go on', () =>
    Effect.gen(function* () {
      const cut = yield* Effect.acquireRelease(
        Effect.sync(() => makeWalks({ size: 1, wall: 1 })),
        (walks) => walks.close,
      );
      const s = yield* commandWorld({ walks: cut, patience: { firstMs: 10, lastMs: 10, totalMs: 40 } });
      yield* call(s.mine.bash, { command: `printf 'made\\n' > src/made.ts`, description: 'Make a file' });
      yield* s.decided(MINE);

      expect((yield* s.w.rows()).filter((row) => row.holder === MINE)).toEqual([]);
      expect(s.commands.unattributed({ projectId: s.w.projectId, threadId: MINE }).map((one) => one.path)).toEqual(['src/made.ts']);
    }),
  );
});
