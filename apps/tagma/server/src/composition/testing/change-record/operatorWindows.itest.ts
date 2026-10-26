import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Clock, Effect, FileSystem, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { changeOf } from '@runlith/files/change';
import { contentDigest } from '@runlith/files/content';
import { replaced } from '@runlith/files/replace';
import { OPERATOR } from '../../../workspace/contract/wire/checkout.js';
import { changeRecordOf, commandLives, commandRig, journalOf, naming } from '../../../change-record/testing/doubles.js';
import type { RowIntake } from '../../../change-record/record/intake.js';
import { recoverCommands } from '../../../change-record/record/recovery.js';
import { gitCheckoutPaths, testPlace } from '../../../workspace/testing/doubles.js';
import { FILE, MINE } from '../checkoutFixture.js';
import { base, CommandWalks, commandLayer, commandWorld } from './commandWorld.js';

const V1 = `${['const one = 10;', ...FILE.slice(1)].join('\n')}\n`;
const V2 = `${['const one = 10;', 'const two = 20;', ...FILE.slice(2)].join('\n')}\n`;
const V3 = `${['const one = 10;', 'const two = 20;', 'const three = 30;', ...FILE.slice(3)].join('\n')}\n`;

const save = (intake: RowIntake, projectId: number, at: string, after: string) =>
  intake.turn(
    projectId,
    [at],
    Effect.gen(function* () {
      const bytes = new Uint8Array(readFileSync(at));
      const before = new TextDecoder().decode(bytes);
      const fact = changeOf('edit', at, { bytes }, before, after, false, new Date(yield* Clock.currentTimeMillis));
      return yield* intake.land({ projectId, holder: OPERATOR }, [fact], replaced(at, { bytes }, after));
    }),
  );

layer(Layer.merge(commandLayer, BunFileSystem.layer), { excludeTestServices: true })('operator saves in command windows', (it) => {
  it.effect('an operator save inside a command window stands as its own row, so the command takes only the step after it', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      const at = join(s.w.root, 'src/a.ts');
      yield* save(s.intake, s.w.projectId, at, V1);
      const life = yield* (
        s.record.changes({ work: { projectId: s.w.projectId, threadId: MINE } }).command?.(s.w.root, naming(s.w.root)) ??
          Effect.succeed(null)
      );
      if (life === null || life === undefined) return yield* Effect.die('the checkout opened no command window');
      life.opened();
      const from = yield* Clock.currentTimeMillis;
      yield* save(s.intake, s.w.projectId, at, V2);
      writeFileSync(at, V3);
      const written = statSync(at).mtimeMs;
      life.ended();
      yield* life.settle({
        base: null,
        window: { from, to: yield* Clock.currentTimeMillis },
        moves: [
          {
            name: 'src/a.ts',
            before: contentDigest(V1),
            after: contentDigest(V3),
            present: true,
            existed: true,
            written: { from: written, to: written },
            bytes: new TextEncoder().encode(V3),
            link: false,
            mode: null,
          },
        ],
      });
      life.close();
      yield* s.decided(MINE);

      expect(readFileSync(at, 'utf8')).toBe(V3);
      expect(yield* s.held('src/a.ts')).toEqual([
        ['operator', contentDigest(base), contentDigest(V1)],
        ['operator', contentDigest(V1), contentDigest(V2)],
        [MINE, contentDigest(V2), contentDigest(V3)],
      ]);
    }),
  );

  it.effect(
    'after a restart cut a command window off, an operator save made inside it is explained by its own row and is nobody’s loss',
    () =>
      Effect.gen(function* () {
        const s = yield* commandWorld();
        const at = join(s.w.root, 'src/a.ts');
        const walks = yield* CommandWalks;
        const lives = commandLives();
        const paths = gitCheckoutPaths('repo-root', s.w.projectId);
        const { commands, intake } = yield* commandRig({ store: s.w.store, units: s.w.units, git: s.w.git, walks, lives, paths });
        const record = yield* changeRecordOf(s.w.store, s.w.units, paths, intake, commands, walks);
        yield* save(intake, s.w.projectId, at, V1);
        const life = yield* (
          record.changes({ work: { projectId: s.w.projectId, threadId: MINE } }).command?.(s.w.root, naming(s.w.root)) ??
            Effect.succeed(null)
        );
        if (life === null) return yield* Effect.die('the checkout opened no command window');
        yield* life.based({
          head: null,
          at: yield* Clock.currentTimeMillis,
          dirty: new Map([['src/a.ts', { digest: contentDigest(V1), present: true }]]),
          contents: new Map(),
        });
        life.opened();
        yield* save(intake, s.w.projectId, at, V2);

        const after = yield* commandRig({ store: s.w.store, units: s.w.units, git: s.w.git, walks, lives: commandLives(), paths });
        yield* recoverCommands(
          s.w.store,
          s.w.units,
          yield* FileSystem.FileSystem,
          yield* journalOf(s.w.store, s.w.units, walks),
          commandLives(),
          after.commands,
          yield* Clock.currentTimeMillis,
        );

        expect(after.commands.unattributed({ projectId: s.w.projectId, threadId: MINE })).toEqual([]);
        const held = yield* (yield* changeRecordOf(s.w.store, s.w.units, paths, after.intake, after.commands, walks)).held({
          kind: 'path',
          projectId: s.w.projectId,
          place: testPlace('src/a.ts'),
        });
        expect(held.map((row) => [row.threadId, row.afterHash])).toEqual([
          ['operator', contentDigest(V1)],
          ['operator', contentDigest(V2)],
        ]);
      }),
  );
});
