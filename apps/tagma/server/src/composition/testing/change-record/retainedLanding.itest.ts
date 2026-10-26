import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Clock, Effect } from 'effect';
import { contentDigest } from '@runlith/files/content';
import { MINE, THEIRS } from '../checkoutFixture.js';
import { base, commandLayer, commandWorld } from './commandWorld.js';
import { naming } from '../../../change-record/testing/doubles.js';

type World = Effect.Success<ReturnType<typeof commandWorld>>;
const git = (s: World, args: readonly string[]) => s.w.run(args);

layer(commandLayer, { excludeTestServices: true })('retained command landing', (it) => {
  it.effect('a peer-held retained path refuses an empty selection, preserves own slicing and lands whole when requested', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      const theirs = base.replace('const one = 1;', 'const one = 10;');
      yield* s.w.wrote(THEIRS, theirs.trimEnd().split('\n'));
      const from = yield* Clock.currentTimeMillis;
      const active = yield* Effect.forEach([MINE, THEIRS], (threadId) =>
        Effect.flatMap(
          s.record.changes({ work: { projectId: s.w.projectId, threadId } }).command?.(s.w.root, naming(s.w.root)) ?? Effect.succeed(null),
          (life) => (life === null ? Effect.die('the checkout opened no command window') : Effect.succeed(life)),
        ),
      );
      for (const life of active) life.opened();
      const text = theirs.replace('const five = 5;', 'const five = 50;');
      writeFileSync(join(s.w.root, 'src/a.ts'), text);
      const writtenAt = yield* Clock.currentTimeMillis;
      for (const life of active) life.ended();
      for (const life of active) {
        yield* life.settle({
          base: null,
          window: { from, to: writtenAt },
          moves: [
            {
              name: 'src/a.ts',
              before: contentDigest(theirs),
              after: contentDigest(text),
              present: true,
              existed: true,
              written: { from: writtenAt, to: writtenAt },
              bytes: null,
              link: false,
              mode: null,
            },
          ],
        });
        life.close();
      }
      yield* s.decided(MINE);
      expect(s.commands.unattributed({ projectId: s.w.projectId, threadId: MINE }).map((one) => one.path)).toEqual(['src/a.ts']);
      const head = yield* git(s, ['rev-parse', 'HEAD']);
      const refused = yield* Effect.flip(s.w.submit(MINE, { commands: s.commands, paths: ['src/a.ts'] }));
      expect(refused).toMatchObject({ code: 'lines-held', reason: expect.stringContaining(THEIRS) });
      expect(yield* git(s, ['rev-parse', 'HEAD'])).toBe(head);
      const mine = text.replace('const five = 50;', 'const five = 500;');
      yield* s.w.wrote(MINE, mine.trimEnd().split('\n'));
      const partial = yield* s.w.submit(MINE, { commands: s.commands, paths: ['src/a.ts'] });
      expect(partial).toMatchObject({ status: 'landed', committed: ['src/a.ts'], carried: [] });
      expect(yield* git(s, ['show', 'HEAD:src/a.ts'])).toBe(base.replace('const five = 5;', 'const five = 500;').trimEnd());
      const landed = yield* s.w.submit(MINE, { commands: s.commands, paths: ['src/a.ts'], whole: ['src/a.ts'] });
      expect(landed).toMatchObject({ status: 'landed', committed: ['src/a.ts'], carried: [{ path: 'src/a.ts', holders: [THEIRS] }] });
      expect(yield* git(s, ['show', 'HEAD:src/a.ts'])).toBe(mine.trimEnd());
    }),
  );
});
