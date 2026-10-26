import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { and, eq } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import { changeOf } from '@runlith/files/change';
import { contentDigest } from '@runlith/files/content';
import { replaced, type Standing } from '@runlith/files/replace';
import { OPERATOR } from '../../../workspace/contract/wire/checkout.js';
import type { Holding } from '../../../change-record/contract/wire/holdings.js';
import { collectReleased } from '../../../change-record/record/versions.js';
import { standing, workspaceChange, workspaceChangeContent } from '../../../change-record/store/tables.js';
import { BORN, PROJECT, edited, fixture, layers } from './threadFilesWorld.js';

type World = Effect.Success<typeof fixture>;

const save = (world: World, path: string, after: string) => {
  const at = world.paths.join(world.root, path);
  return world.intake.turn(
    PROJECT,
    [at],
    Effect.gen(function* () {
      const bytes = yield* world.files.readFile(at).pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)));
      const stood: Standing = bytes === null ? { absent: true } : { bytes };
      const before = bytes === null ? '' : new TextDecoder().decode(bytes);
      const fact = changeOf(bytes === null ? 'write' : 'edit', at, stood, before, after, false, new Date(yield* Clock.currentTimeMillis));
      return yield* world.intake.land({ projectId: PROJECT, holder: OPERATOR }, [fact], replaced(at, stood, after));
    }),
  );
};

const rowsAt = (world: World, path: string) =>
  world.store.db
    .select({ holder: workspaceChange.holder, state: workspaceChange.state })
    .from(workspaceChange)
    .where(and(eq(workspaceChange.checkout, world.rootId), eq(workspaceChange.path, path), standing));

const holdingAt = (world: World, path: string): Effect.Effect<Holding | undefined, unknown> =>
  Effect.map(world.holdings.judged(world.rootId, [path]), (judged) => judged.get(path)?.holding);

const handsOf = (holding: Holding | undefined) => (holding?.verdict.verdict === 'proven' ? holding.verdict.hands : []);

const grown = (count: number): string => `${BORN}${Array.from({ length: count }, (_, at) => `line ${at + 1}\n`).join('')}`;

layer(layers, { excludeTestServices: true })('the operator as a holder of lines', (it) => {
  it.effect('successive operator saves stand as one row and one version beyond the base, and the joined row is judged again', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      expect(yield* save(world, 'kept.txt', grown(1))).toEqual({ _tag: 'written', kept: true });
      expect(handsOf(yield* holdingAt(world, 'kept.txt'))).toEqual([
        { holder: OPERATOR, added: 1, removed: 0, writing: false, retired: false },
      ]);

      for (let count = 2; count <= 3; count += 1) yield* save(world, 'kept.txt', grown(count));

      expect(yield* rowsAt(world, 'kept.txt')).toEqual([{ holder: 'operator', state: 'held' }]);
      yield* collectReleased(world.units, world.store);
      const versions = yield* world.store.db.select({ digest: workspaceChangeContent.digest }).from(workspaceChangeContent);
      expect(versions.map((one) => one.digest).sort()).toEqual([contentDigest(BORN), contentDigest(grown(3))].sort());
      expect(handsOf(yield* holdingAt(world, 'kept.txt'))).toEqual([
        { holder: OPERATOR, added: 3, removed: 0, writing: false, retired: false },
      ]);
    }),
  );

  it.effect('an operator save after a thread’s row on the path stands as its own row, never joined across another holder', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      yield* save(world, 'kept.txt', grown(1));
      yield* edited(world.mine, world.paths.join(world.root, 'kept.txt'), grown(1), grown(2));
      yield* world.files.writeFileString(world.paths.join(world.root, 'kept.txt'), grown(2));
      yield* save(world, 'kept.txt', grown(3));

      expect((yield* rowsAt(world, 'kept.txt')).map((row) => row.holder)).toEqual(['operator', 'thread-mine', 'operator']);
    }),
  );

  it.effect('an operator save after the operator moved the file stands as its own row, never joined into the move', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const from = world.paths.join(world.root, 'kept.txt');
      const to = world.paths.join(world.root, 'moved.txt');
      yield* world.intake.land(
        { projectId: PROJECT, holder: OPERATOR },
        [
          { origin: 'delete', path: from, at: new Date(yield* Clock.currentTimeMillis), before: contentDigest(BORN) },
          {
            origin: 'write',
            path: to,
            at: new Date(yield* Clock.currentTimeMillis),
            before: contentDigest(''),
            after: contentDigest(BORN),
            afterText: BORN,
            movedFrom: from,
          },
        ],
        Effect.as(world.files.rename(from, to), true),
      );
      yield* save(world, 'moved.txt', grown(1));

      expect((yield* rowsAt(world, 'moved.txt')).map((row) => row.holder)).toEqual(['operator', 'operator']);
    }),
  );

  it.effect('one turn over two spellings of one place takes that place once instead of waiting on itself', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      yield* world.files.makeDirectory(world.paths.join(world.root, 'dir'));
      yield* world.files.symlink(world.paths.join(world.root, 'dir'), world.paths.join(world.root, 'alias'));
      const spellings = [world.paths.join(world.root, 'dir', 'kept.txt'), world.paths.join(world.root, 'alias', 'kept.txt')];

      expect(yield* world.intake.turn(PROJECT, spellings, Effect.succeed('ran'), 'entry')).toBe('ran');
    }),
  );

  it.effect('a created file recorded without texts, whose after is the working bytes, is weighed line by line', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const at = world.paths.join(world.root, 'made.txt');
      const text = 'a\nb\nc\n';
      yield* world.intake.land(
        { projectId: PROJECT, holder: OPERATOR },
        [
          {
            origin: 'write',
            path: at,
            at: new Date(yield* Clock.currentTimeMillis),
            before: contentDigest(''),
            after: contentDigest(text),
          },
        ],
        replaced(at, { absent: true }, text),
      );

      const holding = yield* holdingAt(world, 'made.txt');
      expect(holding?.lines).toEqual({ added: 3, removed: 0 });
      expect(handsOf(holding)).toEqual([{ holder: OPERATOR, added: 3, removed: 0, writing: false, retired: false }]);
    }),
  );
});
