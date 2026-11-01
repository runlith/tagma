import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { call, FILE, MINE, THEIRS } from '../checkoutFixture.js';
import { commandLayer, commandWorld } from './commandWorld.js';

layer(commandLayer, { excludeTestServices: true })('command-written files', (it) => {
  it.effect('a full command rewrite stays indivisible after a partial command edit and after its first commit', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      const rewritten = FILE.map((line) => line.replace('const ', 'let '));
      yield* call(s.theirs.bash, {
        command: `printf '${rewritten.join('\\n')}\\n' > src/a.ts`,
        description: 'Rewrite the whole file',
      });
      yield* s.decided(THEIRS);
      yield* call(s.mine.bash, { command: "printf 'let six = 6;\\n' >> src/a.ts", description: 'Append one line' });
      const first = yield* s.w.submit(MINE, { commands: s.commands });
      expect(first).toMatchObject({ status: 'landed', carried: [{ path: 'src/a.ts', holders: [THEIRS] }] });
      expect(yield* s.w.committed()).toEqual([...rewritten, 'let six = 6;']);
      yield* call(s.theirs.bash, { command: "printf 'let seven = 7;\\n' >> src/a.ts", description: 'Append another line' });
      yield* s.decided(THEIRS);
      yield* call(s.mine.bash, { command: "printf 'let eight = 8;\\n' >> src/a.ts", description: 'Append the last line' });
      expect(yield* s.w.submit(MINE, { commands: s.commands })).toMatchObject({
        status: 'landed',
        carried: [{ path: 'src/a.ts', holders: [THEIRS] }],
      });
      expect(yield* s.w.committed()).toEqual([...rewritten, 'let six = 6;', 'let seven = 7;', 'let eight = 8;']);
    }),
  );

  it.effect('partial command edits keep line ownership, and a file-tools edit disqualifies a later full command rewrite', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      const theirs = ['const one = 10;', ...FILE.slice(1, 4), 'const five = 50;'];
      const both = [...theirs.slice(0, 3), 'const four = 40;', theirs[4]!];
      yield* call(s.theirs.bash, { command: `printf '${theirs.join('\\n')}\\n' > src/a.ts`, description: 'Change one line' });
      yield* s.decided(THEIRS);
      yield* call(s.mine.bash, { command: `printf '${both.join('\\n')}\\n' > src/a.ts`, description: 'Change the next line' });
      expect(yield* s.w.submit(MINE, { commands: s.commands })).toMatchObject({ status: 'landed', carried: [] });
      expect(yield* s.w.committed()).toEqual([...FILE.slice(0, 3), 'const four = 40;', FILE[4]!]);
      expect((yield* s.w.submit(THEIRS, { commands: s.commands })).status).toBe('landed');
      yield* s.decided(MINE);
      yield* call(s.mine.edit, { path: 'src/a.ts', oldString: 'const five = 50;', newString: 'const five = 51;' });
      const rewritten = FILE.map((line) => line.replace('const ', 'let '));
      yield* call(s.mine.bash, { command: `printf '${rewritten.join('\\n')}\\n' > src/a.ts`, description: 'Rewrite after a typed edit' });
      yield* s.decided(MINE);
      yield* call(s.theirs.bash, { command: "printf 'let six = 6;\\n' >> src/a.ts", description: 'Append a peer line' });
      yield* s.decided(THEIRS);
      const own = ['let one = 10;', ...rewritten.slice(1)];
      yield* call(s.mine.bash, {
        command: `printf '${[...own, 'let six = 6;'].join('\\n')}\\n' > src/a.ts`,
        description: 'Change an independent own line',
      });
      expect(yield* s.w.submit(MINE, { commands: s.commands })).toMatchObject({ status: 'landed', carried: [] });
      expect(yield* s.w.committed()).toEqual(own);
    }),
  );

  it.effect('a command-written NUL file lands whole even when its bytes are valid UTF-8', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      writeFileSync(join(s.w.root, 'blob.dat'), 'header\0\nold\nfooter\n');
      yield* s.w.run(['add', '--', 'blob.dat']);
      yield* s.w.run(['commit', '-qm', 'a binary file']);
      yield* call(s.theirs.bash, {
        command: "printf 'header\\0\\npeer\\nfooter\\n' > blob.dat",
        description: 'Rewrite binary bytes',
      });
      yield* s.decided(THEIRS);
      yield* call(s.mine.bash, {
        command: "printf 'header\\0\\nown\\nfooter\\n' > blob.dat",
        description: 'Rewrite binary bytes again',
      });
      expect(yield* s.w.submit(MINE, { commands: s.commands, paths: ['blob.dat'] })).toMatchObject({
        status: 'landed',
        carried: [{ path: 'blob.dat', holders: [THEIRS] }],
      });
      expect(yield* s.w.run(['show', 'HEAD:blob.dat'])).toBe('header\0\nown\nfooter');
    }),
  );
});
